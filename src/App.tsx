import React, { useCallback, useEffect, useState } from 'react';
import { Radio, RefreshCw } from 'lucide-react';
import type {
  AppSettingsState,
  ConnectedAccountsState,
  CreateUploadJobPayload,
  CredentialsInput,
  CredentialsStatus,
  UploadJob,
  UploadProgressEvent,
} from './types/shared';
import { AccountsBar } from './components/AccountsBar';
import { CredentialsDialog } from './components/CredentialsDialog';
import { ActiveUploadsBanner } from './components/ActiveUploadsBanner';
import { UploadComposer } from './components/UploadComposer';
import { SchedulesTable } from './components/SchedulesTable';
import { HistoryTable } from './components/HistoryTable';

const INITIAL_ACCOUNTS: ConnectedAccountsState = {
  google: { connected: false, channels: [] },
  facebook: { connected: false, pages: [] },
};

export const App: React.FC = () => {
  const [accounts, setAccounts] = useState<ConnectedAccountsState>(INITIAL_ACCOUNTS);
  const [credentialsStatus, setCredentialsStatus] =
    useState<CredentialsStatus | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettingsState>({
    minimizeToTray: true,
    launchAtLogin: false,
  });

  const [upcomingJobs, setUpcomingJobs] = useState<UploadJob[]>([]);
  const [historyJobs, setHistoryJobs] = useState<UploadJob[]>([]);
  const [activeProgressMap, setActiveProgressMap] = useState<
    Record<string, UploadProgressEvent>
  >({});

  const [busyProvider, setBusyProvider] = useState<'google' | 'facebook' | null>(null);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'info' | 'error';
    text: string;
  } | null>(null);

  const refreshAllData = useCallback(async () => {
    try {
      const [acc, creds, settings, jobs] = await Promise.all([
        window.desktopApi.getAccounts(),
        window.desktopApi.getCredentialsStatus(),
        window.desktopApi.getAppSettings(),
        window.desktopApi.listJobs(),
      ]);
      setAccounts(acc);
      setCredentialsStatus(creds);
      setAppSettings(settings);
      setUpcomingJobs(jobs.upcoming);
      setHistoryJobs(jobs.history);
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void refreshAllData();

    const unsubJobs = window.desktopApi.onJobsUpdated(() => {
      void window.desktopApi.listJobs().then((jobs) => {
        setUpcomingJobs(jobs.upcoming);
        setHistoryJobs(jobs.history);
      });
    });

    const unsubProgress = window.desktopApi.onUploadProgress((event) => {
      const key = `${event.jobId}:${event.platform}`;
      setActiveProgressMap((prev) => ({
        ...prev,
        [key]: event,
      }));

      if (event.percent >= 100 || event.phase.startsWith('Error:')) {
        setTimeout(() => {
          setActiveProgressMap((prev) => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
          });
        }, 4500);
      }
    });

    return () => {
      unsubJobs();
      unsubProgress();
    };
  }, [refreshAllData]);

  const formatIpcError = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err);
    return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '');
  };

  const handleConnectGoogle = async () => {
    setBannerNotice(null);
    if (!credentialsStatus?.googleConfigured) {
      setCredentialsOpen(true);
      setBannerNotice({
        type: 'info',
        text: 'First paste your Google OAuth Client ID & Secret below and click "Encrypt & Save Credentials".',
      });
      return;
    }
    setBusyProvider('google');
    try {
      const updated = await window.desktopApi.connectGoogle();
      setAccounts(updated);
      setBannerNotice({
        type: 'info',
        text: 'Google & YouTube channel connected securely.',
      });
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: formatIpcError(err),
      });
    } finally {
      setBusyProvider(null);
    }
  };

  const handleDisconnectGoogle = async () => {
    setBusyProvider('google');
    try {
      const updated = await window.desktopApi.disconnectGoogle();
      setAccounts(updated);
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: formatIpcError(err),
      });
    } finally {
      setBusyProvider(null);
    }
  };

  const handleConnectFacebook = async () => {
    setBannerNotice(null);
    if (!credentialsStatus?.facebookConfigured) {
      setCredentialsOpen(true);
      setBannerNotice({
        type: 'info',
        text: 'First paste your Facebook App ID & App Secret below and click "Encrypt & Save Credentials".',
      });
      return;
    }
    setBusyProvider('facebook');
    try {
      const updated = await window.desktopApi.connectFacebook();
      setAccounts(updated);
      setBannerNotice({
        type: 'info',
        text: 'Facebook account & Page Access Tokens encrypted and saved.',
      });
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: formatIpcError(err),
      });
    } finally {
      setBusyProvider(null);
    }
  };

  const handleDisconnectFacebook = async () => {
    setBusyProvider('facebook');
    try {
      const updated = await window.desktopApi.disconnectFacebook();
      setAccounts(updated);
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyProvider(null);
    }
  };

  const handleSelectFacebookPage = async (pageId: string) => {
    try {
      const updated = await window.desktopApi.selectFacebookPage(pageId);
      setAccounts(updated);
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleSelectYouTubeChannel = async (channelId: string) => {
    try {
      const updated = await window.desktopApi.selectYouTubeChannel(channelId);
      setAccounts(updated);
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleSaveCredentials = async (input: CredentialsInput) => {
    const nextStatus = await window.desktopApi.saveCredentials(input);
    setCredentialsStatus(nextStatus);
    setBannerNotice({
      type: 'info',
      text: 'OAuth Developer Console credentials encrypted into OS Keychain / DPAPI.',
    });
  };

  const handleToggleMinimizeToTray = async (minimizeToTray: boolean) => {
    const next = await window.desktopApi.updateAppSettings({ minimizeToTray });
    setAppSettings(next);
  };

  const handleCreateJob = async (payload: CreateUploadJobPayload) => {
    await window.desktopApi.createJob(payload);
    const jobs = await window.desktopApi.listJobs();
    setUpcomingJobs(jobs.upcoming);
    setHistoryJobs(jobs.history);
    setBannerNotice({
      type: 'info',
      text: payload.publishImmediately
        ? 'Resumable chunked upload started in background worker!'
        : 'Upload scheduled in local SQLite database.',
    });
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await window.desktopApi.cancelJob(jobId);
      const jobs = await window.desktopApi.listJobs();
      setUpcomingJobs(jobs.upcoming);
      setHistoryJobs(jobs.history);
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleTriggerNow = async (jobId: string) => {
    try {
      await window.desktopApi.triggerJobNow(jobId);
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleRetryFailed = async (jobId: string) => {
    try {
      await window.desktopApi.retryFailedTargets(jobId);
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="min-h-screen bg-studio-bg text-slate-100">
      <header className="sticky top-0 z-20 border-b border-studio-border bg-studio-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow">
              <Radio className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-50">
                SocialStream Studio
              </h1>
              <p className="text-xs text-slate-400">
                Personal Desktop Scheduler &amp; Resumable Video Uploader for YouTube &amp;
                Facebook
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void refreshAllData()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-studio-panel px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {bannerNotice && (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-center justify-between rounded-xl border px-4 py-3 text-xs ${
              bannerNotice.type === 'error'
                ? 'border-red-500/40 bg-red-500/10 text-red-200'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
            }`}
          >
            <span>{bannerNotice.text}</span>
            <button
              type="button"
              onClick={() => setBannerNotice(null)}
              className="ml-4 font-semibold underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <AccountsBar
          accounts={accounts}
          credentialsStatus={credentialsStatus}
          appSettings={appSettings}
          busyProvider={busyProvider}
          onConnectGoogle={() => void handleConnectGoogle()}
          onDisconnectGoogle={() => void handleDisconnectGoogle()}
          onConnectFacebook={() => void handleConnectFacebook()}
          onDisconnectFacebook={() => void handleDisconnectFacebook()}
          onSelectFacebookPage={(id) => void handleSelectFacebookPage(id)}
          onSelectYouTubeChannel={(id) => void handleSelectYouTubeChannel(id)}
          onToggleMinimizeToTray={(val) => void handleToggleMinimizeToTray(val)}
          onOpenCredentialsModal={() => setCredentialsOpen(true)}
        />

        <ActiveUploadsBanner activeProgressMap={activeProgressMap} />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_1fr]">
          <UploadComposer accounts={accounts} onCreateJob={handleCreateJob} />

          <div className="space-y-6">
            <SchedulesTable
              jobs={upcomingJobs}
              onTriggerNow={(id) => void handleTriggerNow(id)}
              onCancelJob={(id) => void handleCancelJob(id)}
            />

            <HistoryTable
              jobs={historyJobs}
              onRetryFailed={(id) => void handleRetryFailed(id)}
              onOpenExternal={(url) => void window.desktopApi.openExternalUrl(url)}
            />
          </div>
        </div>
      </main>

      <CredentialsDialog
        open={credentialsOpen}
        status={credentialsStatus}
        onClose={() => setCredentialsOpen(false)}
        onSave={handleSaveCredentials}
      />
    </div>
  );
};

