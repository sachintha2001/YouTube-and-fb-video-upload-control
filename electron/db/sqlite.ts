import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  JobOverallStatus,
  JobTarget,
  Platform,
  TargetStatus,
  UploadJob,
  YouTubePrivacy,
} from '../types';

interface PreparedStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
}

interface NativeDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): PreparedStatement;
  close(): void;
}

// Native built-in SQLite engine (Node.js 22.13+ / Electron 35+) — zero C++ node-gyp rebuilds required!
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (location: string) => NativeDatabaseSync;
};

export interface CreateJobRecordInput {
  title: string;
  description: string;
  tags: string[];
  platforms: Platform[];
  youtubePrivacy: YouTubePrivacy;
  mediaPath: string | null;
  mediaFileName: string | null;
  mediaSizeBytes: number;
  mediaMimeType: string | null;
  scheduledAtIso: string;
}

export class SqliteRepository {
  private readonly db: NativeDatabaseSync;

  constructor(dbFilePath: string) {
    if (dbFilePath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
    }
    this.db = new DatabaseSync(dbFilePath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS upload_jobs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        media_path TEXT,
        media_file_name TEXT,
        media_size_bytes INTEGER NOT NULL DEFAULT 0,
        media_mime_type TEXT,
        youtube_privacy TEXT NOT NULL DEFAULT 'private',
        scheduled_at TEXT NOT NULL,
        overall_status TEXT NOT NULL DEFAULT 'scheduled',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        remote_post_id TEXT,
        remote_url TEXT,
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        bytes_uploaded INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        FOREIGN KEY (job_id) REFERENCES upload_jobs(id) ON DELETE CASCADE,
        UNIQUE (job_id, platform)
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_schedule_status
        ON upload_jobs (overall_status, scheduled_at);

      CREATE INDEX IF NOT EXISTS idx_targets_job_id
        ON job_targets (job_id);
    `);
  }

  /**
   * Crash recovery on startup: if the app or OS shut down mid-upload,
   * reset interrupted 'uploading' targets back to 'pending' (up to maxRetries)
   * so the background scheduler safely resumes them.
   */
  public recoverInterruptedJobs(maxRetries = 3): number {
    const stuckJobs = this.db
      .prepare(`SELECT id FROM upload_jobs WHERE overall_status = 'uploading'`)
      .all() as Array<{ id: string }>;

    if (stuckJobs.length === 0) {
      return 0;
    }

    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      for (const row of stuckJobs) {
        this.db
          .prepare(
            `UPDATE job_targets
             SET status = CASE WHEN retry_count < ? THEN 'pending' ELSE 'failed' END,
                 retry_count = retry_count + 1,
                 error_message = CASE
                   WHEN retry_count < ? THEN 'Recovered after unexpected app restart; queued for retry.'
                   ELSE 'Upload interrupted repeatedly across app restarts.'
                 END
             WHERE job_id = ? AND status = 'uploading'`
          )
          .run(maxRetries, maxRetries, row.id);

        this.recomputeOverallJobStatus(row.id, now);
      }
      this.db.exec('COMMIT');
      return stuckJobs.length;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public createJob(input: CreateJobRecordInput): UploadJob {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const uniquePlatforms = Array.from(new Set(input.platforms));

    if (uniquePlatforms.length === 0) {
      throw new Error('At least one target platform (YouTube or Facebook) must be selected.');
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      this.db
        .prepare(
          `INSERT INTO upload_jobs (
            id, title, description, tags_json, media_path, media_file_name,
            media_size_bytes, media_mime_type, youtube_privacy, scheduled_at,
            overall_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`
        )
        .run(
          id,
          input.title,
          input.description,
          JSON.stringify(input.tags),
          input.mediaPath,
          input.mediaFileName,
          input.mediaSizeBytes,
          input.mediaMimeType,
          input.youtubePrivacy,
          input.scheduledAtIso,
          now,
          now
        );

      const insertTarget = this.db.prepare(
        `INSERT INTO job_targets (job_id, platform, status, total_bytes)
         VALUES (?, ?, 'pending', ?)`
      );

      for (const platform of uniquePlatforms) {
        insertTarget.run(id, platform, input.mediaSizeBytes);
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    const created = this.getJobById(id);
    if (!created) {
      throw new Error('Failed to retrieve newly created upload job.');
    }
    return created;
  }

  public getJobById(jobId: string): UploadJob | null {
    const row = this.db
      .prepare(`SELECT * FROM upload_jobs WHERE id = ?`)
      .get(jobId);

    if (!row) {
      return null;
    }

    const targets = this.getTargetsForJob(jobId);
    return this.mapJobRow(row, targets);
  }

  public listJobs(): { upcoming: UploadJob[]; history: UploadJob[] } {
    const upcomingRows = this.db
      .prepare(
        `SELECT * FROM upload_jobs
         WHERE overall_status IN ('scheduled', 'uploading')
         ORDER BY scheduled_at ASC`
      )
      .all();

    const historyRows = this.db
      .prepare(
        `SELECT * FROM upload_jobs
         WHERE overall_status IN ('completed', 'partial_failure', 'failed', 'cancelled')
         ORDER BY updated_at DESC
         LIMIT 100`
      )
      .all();

    return {
      upcoming: upcomingRows.map((r) => this.mapJobRow(r, this.getTargetsForJob(String(r.id)))),
      history: historyRows.map((r) => this.mapJobRow(r, this.getTargetsForJob(String(r.id)))),
    };
  }

  public getDueJobs(nowIso = new Date().toISOString()): UploadJob[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM upload_jobs
         WHERE overall_status = 'scheduled'
           AND scheduled_at <= ?
         ORDER BY scheduled_at ASC`
      )
      .all(nowIso);

    return rows.map((r) => this.mapJobRow(r, this.getTargetsForJob(String(r.id))));
  }

  public countScheduledJobs(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM upload_jobs WHERE overall_status IN ('scheduled', 'uploading')`
      )
      .get();
    return Number(row?.count ?? 0);
  }

  public markJobUploading(jobId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE upload_jobs SET overall_status = 'uploading', updated_at = ? WHERE id = ?`)
      .run(now, jobId);
  }

  public markTargetUploading(jobId: string, platform: Platform, totalBytes: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE job_targets
         SET status = 'uploading',
             error_message = NULL,
             bytes_uploaded = 0,
             total_bytes = ?
         WHERE job_id = ? AND platform = ?`
      )
      .run(totalBytes, jobId, platform);

    this.db
      .prepare(`UPDATE upload_jobs SET updated_at = ? WHERE id = ?`)
      .run(now, jobId);
  }

  public updateTargetProgress(
    jobId: string,
    platform: Platform,
    bytesUploaded: number,
    totalBytes: number
  ): void {
    this.db
      .prepare(
        `UPDATE job_targets
         SET bytes_uploaded = ?, total_bytes = ?
         WHERE job_id = ? AND platform = ?`
      )
      .run(bytesUploaded, totalBytes, jobId, platform);
  }

  public markTargetCompleted(
    jobId: string,
    platform: Platform,
    remotePostId: string,
    remoteUrl: string,
    totalBytes: number
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE job_targets
         SET status = 'completed',
             remote_post_id = ?,
             remote_url = ?,
             error_message = NULL,
             bytes_uploaded = ?,
             total_bytes = ?,
             completed_at = ?
         WHERE job_id = ? AND platform = ?`
      )
      .run(remotePostId, remoteUrl, totalBytes, totalBytes, now, jobId, platform);

    this.recomputeOverallJobStatus(jobId, now);
  }

  public markTargetFailed(jobId: string, platform: Platform, errorMessage: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE job_targets
         SET status = 'failed',
             error_message = ?,
             retry_count = retry_count + 1
         WHERE job_id = ? AND platform = ?`
      )
      .run(errorMessage, jobId, platform);

    this.recomputeOverallJobStatus(jobId, now);
  }

  public cancelJob(jobId: string): void {
    const job = this.getJobById(jobId);
    if (!job) {
      throw new Error('Job not found.');
    }
    if (job.overallStatus === 'uploading') {
      throw new Error('Cannot cancel a job while an active chunk transfer is in flight.');
    }

    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      this.db
        .prepare(
          `UPDATE job_targets
           SET status = 'cancelled'
           WHERE job_id = ? AND status = 'pending'`
        )
        .run(jobId);

      this.db
        .prepare(
          `UPDATE upload_jobs
           SET overall_status = 'cancelled', updated_at = ?
           WHERE id = ?`
        )
        .run(now, jobId);

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public rescheduleForImmediateRun(jobId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE upload_jobs
         SET scheduled_at = ?, overall_status = 'scheduled', updated_at = ?
         WHERE id = ? AND overall_status = 'scheduled'`
      )
      .run(now, now, jobId);
  }

  /**
   * Resets ONLY failed/cancelled targets back to 'pending' without re-uploading
   * platforms that already succeeded (preventing duplicate YouTube/Facebook uploads!).
   */
  public resetFailedTargetsForRetry(jobId: string): void {
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      this.db
        .prepare(
          `UPDATE job_targets
           SET status = 'pending',
               error_message = NULL,
               bytes_uploaded = 0
           WHERE job_id = ? AND status IN ('failed', 'cancelled')`
        )
        .run(jobId);

      this.db
        .prepare(
          `UPDATE upload_jobs
           SET overall_status = 'scheduled',
               scheduled_at = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(now, now, jobId);

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public recomputeOverallJobStatus(jobId: string, now = new Date().toISOString()): JobOverallStatus {
    const targets = this.getTargetsForJob(jobId);
    const statuses = targets.map((t) => t.status);

    let overall: JobOverallStatus = 'scheduled';

    if (statuses.some((s) => s === 'uploading')) {
      overall = 'uploading';
    } else if (statuses.some((s) => s === 'pending')) {
      overall = 'scheduled';
    } else if (statuses.every((s) => s === 'completed')) {
      overall = 'completed';
    } else if (statuses.every((s) => s === 'cancelled')) {
      overall = 'cancelled';
    } else if (statuses.some((s) => s === 'completed') && statuses.some((s) => s === 'failed')) {
      overall = 'partial_failure';
    } else {
      overall = 'failed';
    }

    this.db
      .prepare(`UPDATE upload_jobs SET overall_status = ?, updated_at = ? WHERE id = ?`)
      .run(overall, now, jobId);

    return overall;
  }

  public close(): void {
    this.db.close();
  }

  private getTargetsForJob(jobId: string): JobTarget[] {
    const rows = this.db
      .prepare(`SELECT * FROM job_targets WHERE job_id = ? ORDER BY id ASC`)
      .all(jobId);

    return rows.map((row) => ({
      id: Number(row.id),
      jobId: String(row.job_id),
      platform: row.platform as Platform,
      status: row.status as TargetStatus,
      remotePostId: row.remote_post_id ? String(row.remote_post_id) : null,
      remoteUrl: row.remote_url ? String(row.remote_url) : null,
      errorMessage: row.error_message ? String(row.error_message) : null,
      retryCount: Number(row.retry_count ?? 0),
      bytesUploaded: Number(row.bytes_uploaded ?? 0),
      totalBytes: Number(row.total_bytes ?? 0),
      completedAt: row.completed_at ? String(row.completed_at) : null,
    }));
  }

  private mapJobRow(row: Record<string, unknown>, targets: JobTarget[]): UploadJob {
    let tags: string[] = [];
    try {
      tags = JSON.parse(String(row.tags_json || '[]')) as string[];
    } catch {
      tags = [];
    }

    return {
      id: String(row.id),
      title: String(row.title),
      description: String(row.description ?? ''),
      tags,
      mediaPath: row.media_path ? String(row.media_path) : null,
      mediaFileName: row.media_file_name ? String(row.media_file_name) : null,
      mediaSizeBytes: Number(row.media_size_bytes ?? 0),
      mediaMimeType: row.media_mime_type ? String(row.media_mime_type) : null,
      youtubePrivacy: (row.youtube_privacy as YouTubePrivacy) || 'private',
      scheduledAt: String(row.scheduled_at),
      overallStatus: row.overall_status as JobOverallStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      targets,
    };
  }
}

