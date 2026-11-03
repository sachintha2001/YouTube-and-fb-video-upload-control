import fs from 'node:fs';
import cron, { type ScheduledTask } from 'node-cron';
import { BrowserWindow, Notification, powerSaveBlocker } from 'electron';
import type { Platform, UploadJob, UploadProgressEvent } from '../types';
import { SqliteRepository } from '../db/sqlite';
import { OAuthManager } from '../auth/oauthManager';
import { uploadVideoToYouTubeResumable } from '../uploaders/youtubeUploader';
import { publishToFacebookPage } from '../uploaders/facebookUploader';

export class UploadScheduler {
  private cronTask: ScheduledTask | null = null;
  private readonly activeJobIds = new Set<string>();
  private powerBlockerId: number | null = null;

  constructor(
    private readonly repo: SqliteRepository,
    private readonly oauth: OAuthManager,
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly onQueueChanged: () => void
  ) {}

  public start(): void {
    // 1. Recover any jobs that were mid-upload when the app or OS last shut down
    const recoveredCount = this.repo.recoverInterruptedJobs(3);
    if (recoveredCount > 0) {
      this.emitJobsUpdated();
    }

    // 2. Poll SQLite every 30 seconds for due scheduled jobs
    this.cronTask = cron.schedule('*/30 * * * * *', () => {
      void this.tick();
    });

    // 3. Run an immediate check on startup
    void this.tick();
  }

  public stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    this.releasePowerSaveBlockerIfIdle();
  }

  public async tick(): Promise<void> {
    const dueJobs = this.repo.getDueJobs(new Date().toISOString());
    for (const job of dueJobs) {
      if (!this.activeJobIds.has(job.id)) {
        void this.executeJob(job.id);
      }
    }
  }

  public async triggerJobImmediately(jobId: string): Promise<void> {
    if (this.activeJobIds.has(jobId)) {
      return;
    }
    this.repo.rescheduleForImmediateRun(jobId);
    this.emitJobsUpdated();
    await this.executeJob(jobId);
  }

  private acquirePowerSaveBlocker(): void {
    if (this.powerBlockerId === null || !powerSaveBlocker.isStarted(this.powerBlockerId)) {
      this.powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
  }

  private releasePowerSaveBlockerIfIdle(): void {
    if (
      this.activeJobIds.size === 0 &&
      this.powerBlockerId !== null &&
      powerSaveBlocker.isStarted(this.powerBlockerId)
    ) {
      powerSaveBlocker.stop(this.powerBlockerId);
      this.powerBlockerId = null;
    }
  }

  private emitProgress(event: UploadProgressEvent): void {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('upload:progress', event);
    }
  }

  private emitJobsUpdated(): void {
    this.onQueueChanged();
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('jobs:updated');
    }
  }

  private notifyDesktop(title: string, body: string): void {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  }

  private async executeJob(jobId: string): Promise<void> {
    if (this.activeJobIds.has(jobId)) {
      return;
    }

    const job = this.repo.getJobById(jobId);
    if (!job) {
      return;
    }

    const pendingTargets = job.targets.filter((t) => t.status === 'pending');
    if (pendingTargets.length === 0) {
      this.repo.recomputeOverallJobStatus(job.id);
      this.emitJobsUpdated();
      return;
    }

    this.activeJobIds.add(jobId);
    this.acquirePowerSaveBlocker();
    this.repo.markJobUploading(jobId);
    this.emitJobsUpdated();

    try {
      // Pre-validate local video file existence if job has media attached
      if (job.mediaPath && !fs.existsSync(job.mediaPath)) {
        for (const target of pendingTargets) {
          this.repo.markTargetFailed(
            job.id,
            target.platform,
            `Local media file not found at path: ${job.mediaPath}`
          );
        }
        this.emitJobsUpdated();
        this.notifyDesktop(
          'Scheduled Upload Failed',
          `Video file missing for "${job.title}".`
        );
        return;
      }

      for (const target of pendingTargets) {
        await this.executePlatformTarget(job, target.platform);
      }

      const finalJob = this.repo.getJobById(jobId);
      if (finalJob?.overallStatus === 'completed') {
        this.notifyDesktop(
          'Upload Completed',
          `"${job.title}" was published successfully to ${pendingTargets
            .map((t) => (t.platform === 'youtube' ? 'YouTube' : 'Facebook'))
            .join(' & ')}.`
        );
      } else if (finalJob?.overallStatus === 'partial_failure') {
        this.notifyDesktop(
          'Partial Upload Failure',
          `"${job.title}" succeeded on one platform and failed on another. Open SocialStream Studio to retry.`
        );
      } else if (finalJob?.overallStatus === 'failed') {
        this.notifyDesktop(
          'Upload Failed',
          `"${job.title}" encountered an API error. Check Upload History for details.`
        );
      }
    } finally {
      this.activeJobIds.delete(jobId);
      this.releasePowerSaveBlockerIfIdle();
      this.emitJobsUpdated();
    }
  }

  private async executePlatformTarget(job: UploadJob, platform: Platform): Promise<void> {
    const totalBytes = Math.max(job.mediaSizeBytes, 1);
    this.repo.markTargetUploading(job.id, platform, totalBytes);
    this.emitJobsUpdated();

    let lastDbPersistMs = 0;
    const handleProgress = (info: {
      bytesUploaded: number;
      totalBytes: number;
      phase: string;
    }): void => {
      const percent =
        info.totalBytes > 0
          ? Math.min(100, Math.round((info.bytesUploaded / info.totalBytes) * 100))
          : 0;

      const now = Date.now();
      if (now - lastDbPersistMs > 750 || info.bytesUploaded >= info.totalBytes) {
        lastDbPersistMs = now;
        this.repo.updateTargetProgress(job.id, platform, info.bytesUploaded, info.totalBytes);
      }

      this.emitProgress({
        jobId: job.id,
        platform,
        bytesUploaded: info.bytesUploaded,
        totalBytes: info.totalBytes,
        percent,
        phase: info.phase,
      });
    };

    try {
      if (platform === 'youtube') {
        if (!job.mediaPath) {
          throw new Error('YouTube Data API v3 requires a local video file.');
        }

        const accessToken = await this.oauth.getValidGoogleAccessToken();
        const result = await uploadVideoToYouTubeResumable({
          accessToken,
          filePath: job.mediaPath,
          mimeType: job.mediaMimeType || 'video/mp4',
          title: job.title,
          description: job.description,
          tags: job.tags,
          privacyStatus: job.youtubePrivacy,
          onProgress: handleProgress,
        });

        this.repo.markTargetCompleted(
          job.id,
          'youtube',
          result.videoId,
          result.videoUrl,
          result.totalBytes
        );
      } else if (platform === 'facebook') {
        const fbCreds = this.oauth.getSelectedFacebookPageCredentials();
        const result = await publishToFacebookPage({
          pageId: fbCreds.pageId,
          pageAccessToken: fbCreds.pageAccessToken,
          title: job.title,
          description: job.description,
          tags: job.tags,
          filePath: job.mediaPath,
          mimeType: job.mediaMimeType,
          onProgress: handleProgress,
        });

        this.repo.markTargetCompleted(
          job.id,
          'facebook',
          result.postId,
          result.postUrl,
          result.totalBytes
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.repo.markTargetFailed(job.id, platform, message);
      this.emitProgress({
        jobId: job.id,
        platform,
        bytesUploaded: 0,
        totalBytes,
        percent: 0,
        phase: `Error: ${message}`,
      });
    }
  }
}

