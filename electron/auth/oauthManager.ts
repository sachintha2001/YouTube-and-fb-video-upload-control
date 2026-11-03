import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import { BrowserWindow, shell } from 'electron';
import type { ConnectedAccountsState } from '../types';
import {
  SecureVault,
  type StoredFacebookPage,
  type StoredGoogleAuth,
} from '../security/secureVault';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';

const FB_GRAPH_VERSION = 'v21.0';
const FB_AUTH_URL = `https://www.facebook.com/${FB_GRAPH_VERSION}/dialog/oauth`;
const FB_GRAPH_BASE = `https://graph.facebook.com/${FB_GRAPH_VERSION}`;

const OAUTH_TIMEOUT_MS = 180_000; // 3 minutes

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(48));
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = base64UrlEncode(hash);
  return { codeVerifier, codeChallenge };
}

function timingSafeStateMatches(expected: string, received: string | null): boolean {
  if (!received) return false;
  const a = Buffer.from(expected, 'utf-8');
  const b = Buffer.from(received, 'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCallbackHtml(success: boolean, providerLabel: string, detail: string): string {
  const accent = success ? '#10b981' : '#ef4444';
  const title = success
    ? `${escapeHtml(providerLabel)} Connected Successfully`
    : `${escapeHtml(providerLabel)} Sign-In Failed`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title} — SocialStream Studio</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0b0f19;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      max-width: 440px;
      padding: 2rem;
      border-radius: 16px;
      background: #111827;
      border: 1px solid #263249;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
    }
    .badge {
      display: inline-block;
      width: 14px;
      height: 14px;
      border-radius: 999px;
      background: ${accent};
      margin-bottom: 0.75rem;
    }
    h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
    p { font-size: 0.925rem; color: #94a3b8; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge"></span>
    <h1>${title}</h1>
    <p>${escapeHtml(detail)}</p>
  </div>
</body>
</html>`;
}

export class OAuthManager {
  private activeCallbackServer: http.Server | null = null;

  constructor(
    private readonly vault: SecureVault,
    private readonly getMainWindow: () => BrowserWindow | null
  ) {}

  private closeActiveServer(): void {
    if (this.activeCallbackServer) {
      try {
        this.activeCallbackServer.close();
      } catch {
        // Ignore already-closed server errors
      }
      this.activeCallbackServer = null;
    }
  }

  private focusAppWindow(): void {
    const win = this.getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  }

  /**
   * Starts a temporary loopback-only HTTP server on 127.0.0.1:<port>, launches the
   * user's default system browser (RFC 8252 compliant), validates CSRF state,
   * and resolves with the single-use authorization code before shutting down immediately.
   */
  private waitForLoopbackAuthorizationCode(params: {
    port: number;
    expectedPathname: string;
    expectedState: string;
    authorizationUrl: string;
    providerLabel: string;
  }): Promise<string> {
    this.closeActiveServer();

    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.closeActiveServer();
          reject(
            new Error(
              `${params.providerLabel} OAuth timed out after 3 minutes. Please try signing in again.`
            )
          );
        }
      }, OAUTH_TIMEOUT_MS);

      const server = http.createServer((req, res) => {
        try {
          const reqUrl = new URL(req.url || '/', `http://localhost:${params.port}`);
          if (reqUrl.pathname !== params.expectedPathname) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
            return;
          }

          const oauthError = reqUrl.searchParams.get('error');
          const oauthErrorDesc =
            reqUrl.searchParams.get('error_description') ||
            reqUrl.searchParams.get('error_message') ||
            oauthError;

          if (oauthError) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
              renderCallbackHtml(
                false,
                params.providerLabel,
                `Authorization cancelled or denied: ${oauthErrorDesc}`
              )
            );
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              this.closeActiveServer();
              reject(new Error(`${params.providerLabel} OAuth denied: ${oauthErrorDesc}`));
            }
            return;
          }

          const state = reqUrl.searchParams.get('state');
          const code = reqUrl.searchParams.get('code');

          if (!timingSafeStateMatches(params.expectedState, state)) {
            res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
              renderCallbackHtml(
                false,
                params.providerLabel,
                'Invalid OAuth CSRF state parameter. Please restart login from the desktop app.'
              )
            );
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              this.closeActiveServer();
              reject(new Error('OAuth state mismatch detected (possible CSRF). Aborting login.'));
            }
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
              renderCallbackHtml(
                false,
                params.providerLabel,
                'No authorization code was returned by the OAuth provider.'
              )
            );
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              this.closeActiveServer();
              reject(new Error('Missing authorization code in OAuth callback.'));
            }
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            renderCallbackHtml(
              true,
              params.providerLabel,
              'You can safely close this browser tab and return to SocialStream Studio.'
            )
          );

          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this.closeActiveServer();
            this.focusAppWindow();
            resolve(code);
          }
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this.closeActiveServer();
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }
      });

      this.activeCallbackServer = server;

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.closeActiveServer();
          if (err.code === 'EADDRINUSE') {
            reject(
              new Error(
                `Local OAuth callback port ${params.port} is already in use. Change the Redirect Port in API Credentials or close the conflicting process.`
              )
            );
          } else {
            reject(err);
          }
        }
      });

      // Bind strictly to 127.0.0.1 loopback so LAN devices cannot hit the OAuth listener.
      server.listen(params.port, '127.0.0.1', () => {
        void shell.openExternal(params.authorizationUrl);
      });
    });
  }

  // ============================================================================
  // GOOGLE / YOUTUBE OAUTH 2.0 (PKCE + OFFLINE REFRESH TOKEN)
  // ============================================================================

  public async connectGoogle(): Promise<ConnectedAccountsState> {
    const cfg = this.vault.getEffectiveConfig();
    if (!cfg.googleClientId) {
      throw new Error(
        'Google Client ID is not configured. Click "API Credentials" in the header to enter your Google Cloud OAuth Client ID.'
      );
    }

    const state = base64UrlEncode(crypto.randomBytes(32));
    const { codeVerifier, codeChallenge } = generatePkcePair();

    const scopes = [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ];

    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set('client_id', cfg.googleClientId);
    authUrl.searchParams.set('redirect_uri', cfg.googleRedirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scopes.join(' '));
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    const code = await this.waitForLoopbackAuthorizationCode({
      port: cfg.redirectPort,
      expectedPathname: '/oauth/google/callback',
      expectedState: state,
      authorizationUrl: authUrl.toString(),
      providerLabel: 'Google / YouTube',
    });

    const tokenParams = new URLSearchParams({
      code,
      client_id: cfg.googleClientId,
      redirect_uri: cfg.googleRedirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });
    if (cfg.googleClientSecret) {
      tokenParams.set('client_secret', cfg.googleClientSecret);
    }

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(
        `Google token exchange failed: ${tokenJson.error_description || tokenJson.error || tokenRes.statusText}`
      );
    }

    const existingAuth = this.vault.getGoogleAuth();
    const refreshToken = tokenJson.refresh_token || existingAuth?.refreshToken;
    if (!refreshToken) {
      throw new Error(
        'Google did not return a refresh_token. Please revoke previous test access at myaccount.google.com/permissions and reconnect.'
      );
    }

    const accessToken = tokenJson.access_token;
    const expiresAt = Date.now() + Number(tokenJson.expires_in ?? 3600) * 1000;

    // Fetch Google user email & YouTube channel metadata
    let email: string | undefined;
    let avatarUrl: string | undefined;
    let channelId: string | undefined;
    let channelTitle: string | undefined;
    const channels: Array<{ id: string; title: string; customUrl?: string; avatarUrl?: string }> = [];

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (userRes.ok) {
      const userJson = (await userRes.json()) as { email?: string; picture?: string };
      email = userJson.email;
      avatarUrl = userJson.picture;
    }

    const ytRes = await fetch(YOUTUBE_CHANNELS_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (ytRes.ok) {
      const ytJson = (await ytRes.json()) as {
        items?: Array<{
          id: string;
          snippet?: {
            title?: string;
            customUrl?: string;
            thumbnails?: { default?: { url?: string } };
          };
        }>;
      };
      for (const item of ytJson.items || []) {
        channels.push({
          id: item.id,
          title: item.snippet?.title || 'YouTube Channel',
          customUrl: item.snippet?.customUrl,
          avatarUrl: item.snippet?.thumbnails?.default?.url,
        });
      }
      const firstChannel = channels[0];
      if (firstChannel) {
        channelId = firstChannel.id;
        channelTitle = firstChannel.title;
        avatarUrl = firstChannel.avatarUrl || avatarUrl;
      }
    }

    const storedRecord: StoredGoogleAuth = {
      accessToken,
      refreshToken,
      expiresAt,
      email,
      channelId,
      channelTitle,
      avatarUrl,
      channels,
    };

    this.vault.setGoogleAuth(storedRecord);
    return this.vault.getSafeAccountsSummary();
  }

  public async getValidGoogleAccessToken(): Promise<string> {
    const stored = this.vault.getGoogleAuth();
    if (!stored) {
      throw new Error('Google / YouTube account is not connected.');
    }

    // Refresh proactively if expiring within 2 minutes
    if (Date.now() < stored.expiresAt - 120_000) {
      return stored.accessToken;
    }

    const cfg = this.vault.getEffectiveConfig();
    if (!cfg.googleClientId) {
      throw new Error('Google Client ID is missing; cannot refresh expired OAuth token.');
    }

    const refreshParams = new URLSearchParams({
      client_id: cfg.googleClientId,
      refresh_token: stored.refreshToken,
      grant_type: 'refresh_token',
    });
    if (cfg.googleClientSecret) {
      refreshParams.set('client_secret', cfg.googleClientSecret);
    }

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshParams.toString(),
    });

    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!res.ok || !json.access_token) {
      throw new Error(
        `Failed to refresh Google OAuth token: ${json.error_description || json.error || res.statusText}`
      );
    }

    const updated: StoredGoogleAuth = {
      ...stored,
      accessToken: json.access_token,
      refreshToken: json.refresh_token || stored.refreshToken,
      expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    };

    this.vault.setGoogleAuth(updated);
    return updated.accessToken;
  }

  public async disconnectGoogle(): Promise<ConnectedAccountsState> {
    const stored = this.vault.getGoogleAuth();
    if (stored?.accessToken) {
      try {
        await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(stored.accessToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      } catch {
        // Proceed with local encrypted vault deletion even if offline
      }
    }
    this.vault.setGoogleAuth(undefined);
    return this.vault.getSafeAccountsSummary();
  }

  // ============================================================================
  // FACEBOOK / META GRAPH API OAUTH 2.0 (LONG-LIVED USER + PAGE ACCESS TOKENS)
  // ============================================================================

  public async connectFacebook(): Promise<ConnectedAccountsState> {
    const cfg = this.vault.getEffectiveConfig();
    if (!cfg.facebookAppId || !cfg.facebookAppSecret) {
      throw new Error(
        'Facebook App ID and App Secret are required. Click "API Credentials" in the header to configure your Meta App credentials.'
      );
    }

    const state = base64UrlEncode(crypto.randomBytes(32));
    const scopes = [
      'public_profile',
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
    ];

    const authUrl = new URL(FB_AUTH_URL);
    authUrl.searchParams.set('client_id', cfg.facebookAppId);
    authUrl.searchParams.set('redirect_uri', cfg.facebookRedirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scopes.join(','));
    authUrl.searchParams.set('state', state);

    const code = await this.waitForLoopbackAuthorizationCode({
      port: cfg.redirectPort,
      expectedPathname: '/oauth/facebook/callback',
      expectedState: state,
      authorizationUrl: authUrl.toString(),
      providerLabel: 'Facebook',
    });

    // 1. Exchange authorization code for short-lived user token
    const shortTokenUrl = new URL(`${FB_GRAPH_BASE}/oauth/access_token`);
    shortTokenUrl.searchParams.set('client_id', cfg.facebookAppId);
    shortTokenUrl.searchParams.set('client_secret', cfg.facebookAppSecret);
    shortTokenUrl.searchParams.set('redirect_uri', cfg.facebookRedirectUri);
    shortTokenUrl.searchParams.set('code', code);

    const shortRes = await fetch(shortTokenUrl.toString());
    const shortJson = (await shortRes.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };

    if (!shortRes.ok || !shortJson.access_token) {
      throw new Error(
        `Facebook token exchange failed: ${shortJson.error?.message || shortRes.statusText}`
      );
    }

    // 2. Upgrade short-lived user token -> 60-day Long-Lived User Token
    let userAccessToken = shortJson.access_token;
    let expiresInSeconds = shortJson.expires_in ?? 5_184_000; // Default 60 days

    const longTokenUrl = new URL(`${FB_GRAPH_BASE}/oauth/access_token`);
    longTokenUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longTokenUrl.searchParams.set('client_id', cfg.facebookAppId);
    longTokenUrl.searchParams.set('client_secret', cfg.facebookAppSecret);
    longTokenUrl.searchParams.set('fb_exchange_token', userAccessToken);

    const longRes = await fetch(longTokenUrl.toString());
    if (longRes.ok) {
      const longJson = (await longRes.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (longJson.access_token) {
        userAccessToken = longJson.access_token;
        expiresInSeconds = longJson.expires_in ?? expiresInSeconds;
      }
    }

    // 3. Fetch User Profile & Managed Facebook Pages (returns Long-Lived Page Access Tokens!)
    const meRes = await fetch(`${FB_GRAPH_BASE}/me?fields=id,name`, {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    const meJson = (await meRes.json()) as { name?: string; error?: { message?: string } };
    if (!meRes.ok) {
      throw new Error(
        `Failed to fetch Facebook user profile: ${meJson.error?.message || meRes.statusText}`
      );
    }

    const pagesRes = await fetch(
      `${FB_GRAPH_BASE}/me/accounts?fields=id,name,category,access_token`,
      {
        headers: { Authorization: `Bearer ${userAccessToken}` },
      }
    );
    const pagesJson = (await pagesRes.json()) as {
      data?: Array<{
        id: string;
        name: string;
        category?: string;
        access_token: string;
      }>;
      error?: { message?: string };
    };

    if (!pagesRes.ok) {
      throw new Error(
        `Failed to list Facebook Pages: ${pagesJson.error?.message || pagesRes.statusText}`
      );
    }

    const pages: StoredFacebookPage[] = (pagesJson.data || []).map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      pageAccessToken: p.access_token,
    }));

    const previousPageId = this.vault.getFacebookAuth()?.selectedPageId;
    const selectedPageId =
      pages.find((p) => p.id === previousPageId)?.id ?? pages[0]?.id;

    this.vault.setFacebookAuth({
      userAccessToken,
      expiresAt: Date.now() + expiresInSeconds * 1000,
      userName: meJson.name,
      selectedPageId,
      pages,
    });

    return this.vault.getSafeAccountsSummary();
  }

  public getSelectedFacebookPageCredentials(): {
    pageId: string;
    pageName: string;
    pageAccessToken: string;
  } {
    const fb = this.vault.getFacebookAuth();
    if (!fb) {
      throw new Error('Facebook account is not connected.');
    }
    if (fb.pages.length === 0) {
      throw new Error(
        'No Facebook Pages were granted during OAuth sign-in. Meta Graph API requires publishing to a Facebook Page you manage.'
      );
    }

    const page = fb.pages.find((p) => p.id === fb.selectedPageId) ?? fb.pages[0];
    return {
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.pageAccessToken,
    };
  }

  public async disconnectFacebook(): Promise<ConnectedAccountsState> {
    this.vault.setFacebookAuth(undefined);
    return this.vault.getSafeAccountsSummary();
  }
}

