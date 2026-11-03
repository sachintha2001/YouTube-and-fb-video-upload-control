import React, { useId } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  LogOut,
  Power,
  ShieldCheck,
  Youtube,
} from 'lucide-react';
import type {
  AppSettingsState,
  ConnectedAccountsState,
  CredentialsStatus,
} from '../types/shared';

interface AccountsBarProps {
  accounts: ConnectedAccountsState;
  credentialsStatus: CredentialsStatus | null;
  appSettings: AppSettingsState;
  busyProvider: 'google' | 'facebook' | null;
  onConnectGoogle: () => void;
  onDisconnectGoogle: () => void;
  onConnectFacebook: () => void;
  onDisconnectFacebook: () => void;
  onSelectFacebookPage: (pageId: string) => void;
  onSelectYouTubeChannel: (channelId: string) => void;
  onToggleMinimizeToTray: (enabled: boolean) => void;
  onOpenCredentialsModal: () => void;
}

export const AccountsBar: React.FC<AccountsBarProps> = ({
  accounts,
  credentialsStatus,
  appSettings,
  busyProvider,
  onConnectGoogle,
  onDisconnectGoogle,
  onConnectFacebook,
  onDisconnectFacebook,
  onSelectFacebookPage,
  onSelectYouTubeChannel,
  onToggleMinimizeToTray,
  onOpenCredentialsModal,
}) => {
  const ytChannelSelectId = useId();
  const fbPageSelectId = useId();
  const trayToggleId = useId();

  return (
    <section aria-label="Connected Accounts and Security Status" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-studio-border bg-studio-panel px-4 py-3">
        <div className="flex items-center gap-2.5 text-xs text-slate-300">
          <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          <span>
            Tokens encrypted via{' '}
            <strong className="font-semibold text-slate-100">
              OS Keychain / DPAPI
            </strong>{' '}
            (Main Process Only)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label
            htmlFor={trayToggleId}
            className="flex cursor-pointer items-center gap-2 text-xs text-slate-300"
          >
            <input
              id={trayToggleId}
              type="checkbox"
              checked={appSettings.minimizeToTray}
              onChange={(e) => onToggleMinimizeToTray(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600"
            />
            <Power className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
            <span>Keep Scheduler Running in System Tray</span>
          </label>

          <button
            type="button"
            onClick={onOpenCredentialsModal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20"
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            <span>API Credentials</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Google / YouTube Account Card */}
        <article className="flex items-center justify-between gap-4 rounded-xl border border-studio-border bg-studio-panel p-4">
          <div className="flex min-w-0 items-center gap-3.5">
            {accounts.google.connected && accounts.google.avatarUrl ? (
              <img
                src={accounts.google.avatarUrl}
                alt=""
                width={44}
                height={44}
                className="h-11 w-11 rounded-full border border-slate-700 object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                <Youtube className="h-5 w-5" aria-hidden="true" />
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">
                  YouTube (Google OAuth 2.0)
                </h2>
                {accounts.google.connected ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    Connected
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
                    Not Connected
                  </span>
                )}
              </div>

              {accounts.google.connected ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {accounts.google.channels && accounts.google.channels.length > 1 ? (
                    <div className="flex items-center gap-1.5">
                      <label htmlFor={ytChannelSelectId} className="text-xs text-slate-400">
                        Channel:
                      </label>
                      <select
                        id={ytChannelSelectId}
                        value={accounts.google.channelId || ''}
                        onChange={(e) => onSelectYouTubeChannel(e.target.value)}
                        className="rounded-md border border-slate-700 bg-studio-card px-2 py-1 text-xs text-slate-100"
                      >
                        {accounts.google.channels.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <p className="truncate text-xs text-slate-400">
                      Channel:{' '}
                      <strong className="font-medium text-slate-200">
                        {accounts.google.channelTitle || 'YouTube Channel'}
                      </strong>{' '}
                      {accounts.google.email ? `(${accounts.google.email})` : ''}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  {credentialsStatus?.googleConfigured
                    ? 'Ready to sign in via system browser (PKCE + offline refresh)'
                    : 'Configure Google Client ID in API Credentials first'}
                </p>
              )}
            </div>
          </div>

          <div className="shrink-0">
            {accounts.google.connected ? (
              <button
                type="button"
                disabled={busyProvider === 'google'}
                onClick={onDisconnectGoogle}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-red-500/50 hover:text-red-300 disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Disconnect</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={busyProvider !== null}
                onClick={onConnectGoogle}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:opacity-50"
              >
                {busyProvider === 'google' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    <span>Waiting for Browser...</span>
                  </>
                ) : (
                  <span>Connect Google</span>
                )}
              </button>
            )}
          </div>
        </article>

        {/* Facebook Graph API Card */}
        <article className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-studio-border bg-studio-panel p-4">
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-sm font-bold text-blue-400">
              FB
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">
                  Facebook Page (Graph API)
                </h2>
                {accounts.facebook.connected ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    Connected
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
                    Not Connected
                  </span>
                )}
              </div>

              {accounts.facebook.connected ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {accounts.facebook.pages.length > 1 ? (
                    <div className="flex items-center gap-1.5">
                      <label htmlFor={fbPageSelectId} className="text-xs text-slate-400">
                        Page:
                      </label>
                      <select
                        id={fbPageSelectId}
                        value={accounts.facebook.selectedPageId || ''}
                        onChange={(e) => onSelectFacebookPage(e.target.value)}
                        className="rounded-md border border-slate-700 bg-studio-card px-2 py-1 text-xs text-slate-100"
                      >
                        {accounts.facebook.pages.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <p className="truncate text-xs text-slate-400">
                      Page:{' '}
                      <strong className="font-medium text-slate-200">
                        {accounts.facebook.selectedPageName || 'No Managed Pages Found'}
                      </strong>{' '}
                      {accounts.facebook.userName ? `• ${accounts.facebook.userName}` : ''}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  {credentialsStatus?.facebookConfigured
                    ? 'Exchanges OAuth code for 60-day User & Page Access Tokens'
                    : 'Configure Facebook App ID & Secret in API Credentials first'}
                </p>
              )}
            </div>
          </div>

          <div className="shrink-0">
            {accounts.facebook.connected ? (
              <button
                type="button"
                disabled={busyProvider === 'facebook'}
                onClick={onDisconnectFacebook}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-red-500/50 hover:text-red-300 disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Disconnect</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={busyProvider !== null}
                onClick={onConnectFacebook}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-50"
              >
                {busyProvider === 'facebook' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    <span>Waiting for Browser...</span>
                  </>
                ) : (
                  <span>Connect Facebook</span>
                )}
              </button>
            )}
          </div>
        </article>
      </div>
    </section>
  );
};

