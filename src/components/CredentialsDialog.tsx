import React, { useEffect, useId, useRef, useState } from 'react';
import { Copy, Check, Eye, EyeOff, KeyRound, X } from 'lucide-react';
import type { CredentialsInput, CredentialsStatus } from '../types/shared';

interface CredentialsDialogProps {
  open: boolean;
  status: CredentialsStatus | null;
  onClose: () => void;
  onSave: (input: CredentialsInput) => Promise<void>;
}

export const CredentialsDialog: React.FC<CredentialsDialogProps> = ({
  open,
  status,
  onClose,
  onSave,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const baseId = useId();

  const [redirectPort, setRedirectPort] = useState<string>('53682');
  const [googleClientId, setGoogleClientId] = useState<string>('');
  const [googleClientSecret, setGoogleClientSecret] = useState<string>('');
  const [facebookAppId, setFacebookAppId] = useState<string>('');
  const [facebookAppSecret, setFacebookAppSecret] = useState<string>('');

  const [showGoogleSecret, setShowGoogleSecret] = useState(false);
  const [showFbSecret, setShowFbSecret] = useState(false);
  const [copiedUri, setCopiedUri] = useState<'google' | 'facebook' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status) {
      setRedirectPort(String(status.redirectPort));
    }
  }, [status]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const parsedPort = Number(redirectPort) || 53682;
  const googleUri = `http://localhost:${parsedPort}/oauth/google/callback`;
  const facebookUri = `http://localhost:${parsedPort}/oauth/facebook/callback`;

  const handleCopy = async (uri: string, which: 'google' | 'facebook') => {
    await navigator.clipboard.writeText(uri);
    setCopiedUri(which);
    setTimeout(() => setCopiedUri(null), 1800);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({
        redirectPort: Number(redirectPort),
        googleClientId: googleClientId.trim() || undefined,
        googleClientSecret: googleClientSecret.trim() || undefined,
        facebookAppId: facebookAppId.trim() || undefined,
        facebookAppSecret: facebookAppSecret.trim() || undefined,
      });
      setGoogleClientSecret('');
      setFacebookAppSecret('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      {...({ closedby: 'any' } as any)}
      className="studio-dialog w-full max-w-2xl rounded-2xl border border-studio-border bg-studio-panel p-0 text-slate-100 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-studio-border px-6 py-4">
        <div className="flex items-center gap-2.5">
          <KeyRound className="h-5 w-5 text-indigo-400" aria-hidden="true" />
          <h2 className="text-base font-semibold">
            OAuth 2.0 Developer Console Credentials
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close credentials modal"
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 p-6">
        <p className="text-xs leading-relaxed text-slate-400">
          Credentials entered here are encrypted immediately via{' '}
          <strong className="text-slate-200">Electron safeStorage</strong> (macOS Keychain /
          Windows DPAPI) and never stored in plaintext. Leave any field blank to keep its
          currently saved value.
        </p>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-200"
          >
            {error}
          </div>
        )}

        {/* Loopback Redirect Port & Copyable Redirect URIs */}
        <fieldset className="space-y-3 rounded-xl border border-studio-border bg-studio-card/60 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-indigo-300">
            Localhost Loopback Redirect Settings
          </legend>

          <div>
            <label
              htmlFor={`${baseId}-port`}
              className="mb-1 block text-xs font-medium text-slate-300"
            >
              Localhost Callback Port
            </label>
            <input
              id={`${baseId}-port`}
              name="redirectPort"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{4,5}"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={redirectPort}
              onChange={(e) => setRedirectPort(e.target.value)}
              required
              className="w-36 rounded-lg border border-slate-700 bg-studio-bg px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-studio-bg px-3 py-2">
              <span className="text-slate-400">
                Google Redirect URI:{' '}
                <code className="text-indigo-300">{googleUri}</code>
              </span>
              <button
                type="button"
                onClick={() => void handleCopy(googleUri, 'google')}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-300 hover:bg-slate-800"
              >
                {copiedUri === 'google' ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{copiedUri === 'google' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-studio-bg px-3 py-2">
              <span className="text-slate-400">
                Facebook Redirect URI:{' '}
                <code className="text-indigo-300">{facebookUri}</code>
              </span>
              <button
                type="button"
                onClick={() => void handleCopy(facebookUri, 'facebook')}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-300 hover:bg-slate-800"
              >
                {copiedUri === 'facebook' ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{copiedUri === 'facebook' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </fieldset>

        {/* Google Cloud Console Credentials */}
        <fieldset className="space-y-3 rounded-xl border border-studio-border bg-studio-card/60 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-red-300">
            Google Cloud Console (YouTube Data API v3)
          </legend>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Create OAuth Client ID (Desktop App) in Google Cloud Console:</span>
            <button
              type="button"
              onClick={() =>
                void window.desktopApi.openExternalUrl(
                  'https://console.cloud.google.com/apis/credentials'
                )
              }
              className="font-semibold text-indigo-300 underline hover:text-indigo-200"
            >
              Open Google Cloud Console ↗
            </button>
          </div>

          <div>
            <label
              htmlFor={`${baseId}-g-id`}
              className="mb-1 block text-xs font-medium text-slate-300"
            >
              Google OAuth Client ID{' '}
              {status?.googleClientIdPreview && (
                <span className="text-emerald-400">
                  (Saved: {status.googleClientIdPreview})
                </span>
              )}
            </label>
            <input
              id={`${baseId}-g-id`}
              name="googleClientId"
              type="text"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="1234567890-abcdefg.apps.googleusercontent.com"
              value={googleClientId}
              onChange={(e) => setGoogleClientId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-studio-bg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
            />
          </div>

          <div>
            <label
              htmlFor={`${baseId}-g-secret`}
              className="mb-1 block text-xs font-medium text-slate-300"
            >
              Google Client Secret (Issued with Google Desktop / Web OAuth Client)
            </label>
            <div className="relative flex items-center">
              <input
                id={`${baseId}-g-secret`}
                name="googleClientSecret"
                type={showGoogleSecret ? 'text' : 'password'}
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="GOCSPX-••••••••••••••••••••"
                value={googleClientSecret}
                onChange={(e) => setGoogleClientSecret(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-studio-bg py-2 pl-3 pr-10 text-sm text-slate-100 placeholder:text-slate-600"
              />
              <button
                type="button"
                aria-pressed={showGoogleSecret}
                aria-label={showGoogleSecret ? 'Hide Google secret' : 'Show Google secret'}
                onClick={() => setShowGoogleSecret((v) => !v)}
                className="absolute right-2 rounded p-1 text-slate-400 hover:text-slate-200"
              >
                {showGoogleSecret ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </fieldset>

        {/* Facebook / Meta Developer Credentials */}
        <fieldset className="space-y-3 rounded-xl border border-studio-border bg-studio-card/60 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-blue-300">
            Meta for Developers (Facebook Graph API)
          </legend>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Create a Business App &amp; Facebook Login in Meta Developers:</span>
            <button
              type="button"
              onClick={() =>
                void window.desktopApi.openExternalUrl(
                  'https://developers.facebook.com/apps/'
                )
              }
              className="font-semibold text-indigo-300 underline hover:text-indigo-200"
            >
              Open Meta Developers ↗
            </button>
          </div>

          <div>
            <label
              htmlFor={`${baseId}-fb-id`}
              className="mb-1 block text-xs font-medium text-slate-300"
            >
              Facebook App ID{' '}
              {status?.facebookAppIdPreview && (
                <span className="text-emerald-400">
                  (Saved: {status.facebookAppIdPreview})
                </span>
              )}
            </label>
            <input
              id={`${baseId}-fb-id`}
              name="facebookAppId"
              type="text"
              inputMode="numeric"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="987654321012345"
              value={facebookAppId}
              onChange={(e) => setFacebookAppId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-studio-bg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
            />
          </div>

          <div>
            <label
              htmlFor={`${baseId}-fb-secret`}
              className="mb-1 block text-xs font-medium text-slate-300"
            >
              Facebook App Secret
            </label>
            <div className="relative flex items-center">
              <input
                id={`${baseId}-fb-secret`}
                name="facebookAppSecret"
                type={showFbSecret ? 'text' : 'password'}
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="••••••••••••••••••••••••••••••••"
                value={facebookAppSecret}
                onChange={(e) => setFacebookAppSecret(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-studio-bg py-2 pl-3 pr-10 text-sm text-slate-100 placeholder:text-slate-600"
              />
              <button
                type="button"
                aria-pressed={showFbSecret}
                aria-label={showFbSecret ? 'Hide Facebook secret' : 'Show Facebook secret'}
                onClick={() => setShowFbSecret((v) => !v)}
                className="absolute right-2 rounded p-1 text-slate-400 hover:text-slate-200"
              >
                {showFbSecret ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </fieldset>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Encrypting & Saving...' : 'Encrypt & Save Credentials'}
          </button>
        </div>
      </form>
    </dialog>
  );
};
