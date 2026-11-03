import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type {
  AppSettingsState,
  ConnectedAccountsState,
  CredentialsInput,
  CredentialsStatus,
} from '../types';

export interface StoredYouTubeChannel {
  id: string;
  title: string;
  customUrl?: string;
  avatarUrl?: string;
}

export interface StoredGoogleAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Epoch ms
  email?: string;
  channelId?: string;
  channelTitle?: string;
  avatarUrl?: string;
  channels: StoredYouTubeChannel[];
}

export interface StoredFacebookPage {
  id: string;
  name: string;
  category?: string;
  pageAccessToken: string;
}

export interface StoredFacebookAuth {
  userAccessToken: string;
  expiresAt: number; // Epoch ms
  userName?: string;
  selectedPageId?: string;
  pages: StoredFacebookPage[];
}

interface VaultPayload {
  redirectPort: number;
  googleClientId?: string;
  googleClientSecret?: string;
  facebookAppId?: string;
  facebookAppSecret?: string;
  googleAuth?: StoredGoogleAuth;
  facebookAuth?: StoredFacebookAuth;
}

interface EncryptedEnvelope {
  version: 1;
  algorithm: 'electron-safeStorage-os-keychain';
  updatedAt: string;
  ciphertextBase64: string;
}

const DEFAULT_REDIRECT_PORT = 53682;

export class SecureVault {
  private readonly vaultFilePath: string;
  private readonly settingsFilePath: string;
  private cache: VaultPayload | null = null;

  constructor(userDataDir = app.getPath('userData')) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.vaultFilePath = path.join(userDataDir, 'secure-credentials.vault.json');
    this.settingsFilePath = path.join(userDataDir, 'app-settings.json');
  }

  public isEncryptionReady(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  private assertEncryptionAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'OS-level secure encryption (macOS Keychain / Windows DPAPI) is currently unavailable. Refusing to store OAuth tokens in plaintext.'
      );
    }
  }

  private readVault(): VaultPayload {
    if (this.cache) {
      return this.cache;
    }

    const envPort = Number(process.env.OAUTH_REDIRECT_PORT || DEFAULT_REDIRECT_PORT);
    const defaultPayload: VaultPayload = {
      redirectPort: Number.isInteger(envPort) && envPort > 1024 ? envPort : DEFAULT_REDIRECT_PORT,
    };

    if (!fs.existsSync(this.vaultFilePath)) {
      this.cache = defaultPayload;
      return defaultPayload;
    }

    this.assertEncryptionAvailable();
    const raw = fs.readFileSync(this.vaultFilePath, 'utf-8');
    const envelope = JSON.parse(raw) as EncryptedEnvelope;
    const encryptedBuffer = Buffer.from(envelope.ciphertextBase64, 'base64');
    const decryptedJson = safeStorage.decryptString(encryptedBuffer);
    const parsed = JSON.parse(decryptedJson) as VaultPayload;

    this.cache = {
      ...defaultPayload,
      ...parsed,
    };
    return this.cache;
  }

  private writeVault(nextPayload: VaultPayload): void {
    this.assertEncryptionAvailable();
    const plaintext = JSON.stringify(nextPayload);
    const encryptedBuffer = safeStorage.encryptString(plaintext);

    const envelope: EncryptedEnvelope = {
      version: 1,
      algorithm: 'electron-safeStorage-os-keychain',
      updatedAt: new Date().toISOString(),
      ciphertextBase64: encryptedBuffer.toString('base64'),
    };

    const tempPath = `${this.vaultFilePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(envelope, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    fs.renameSync(tempPath, this.vaultFilePath);
    this.cache = nextPayload;
  }

  public getEffectiveConfig(): {
    redirectPort: number;
    googleClientId: string;
    googleClientSecret: string;
    facebookAppId: string;
    facebookAppSecret: string;
    googleRedirectUri: string;
    facebookRedirectUri: string;
  } {
    let stored: VaultPayload = { redirectPort: DEFAULT_REDIRECT_PORT };
    try {
      if (this.isEncryptionReady()) {
        stored = this.readVault();
      }
    } catch {
      // Fallback safely to env defaults if vault was created under a different OS user profile
    }

    const redirectPort =
      stored.redirectPort ||
      Number(process.env.OAUTH_REDIRECT_PORT) ||
      DEFAULT_REDIRECT_PORT;

    const googleClientId = (stored.googleClientId || process.env.GOOGLE_CLIENT_ID || '').trim();
    const googleClientSecret = (
      stored.googleClientSecret ||
      process.env.GOOGLE_CLIENT_SECRET ||
      ''
    ).trim();
    const facebookAppId = (stored.facebookAppId || process.env.FACEBOOK_APP_ID || '').trim();
    const facebookAppSecret = (
      stored.facebookAppSecret ||
      process.env.FACEBOOK_APP_SECRET ||
      ''
    ).trim();

    return {
      redirectPort,
      googleClientId,
      googleClientSecret,
      facebookAppId,
      facebookAppSecret,
      googleRedirectUri: `http://localhost:${redirectPort}/oauth/google/callback`,
      facebookRedirectUri: `http://localhost:${redirectPort}/oauth/facebook/callback`,
    };
  }

  public getCredentialsStatus(): CredentialsStatus {
    const cfg = this.getEffectiveConfig();
    const maskId = (val: string): string | undefined => {
      if (!val) return undefined;
      if (val.length <= 12) return `${val.slice(0, 4)}••••`;
      return `${val.slice(0, 8)}••••${val.slice(-6)}`;
    };

    return {
      redirectPort: cfg.redirectPort,
      googleConfigured: Boolean(cfg.googleClientId),
      facebookConfigured: Boolean(cfg.facebookAppId && cfg.facebookAppSecret),
      googleClientIdPreview: maskId(cfg.googleClientId),
      facebookAppIdPreview: maskId(cfg.facebookAppId),
      googleRedirectUri: cfg.googleRedirectUri,
      facebookRedirectUri: cfg.facebookRedirectUri,
      encryptionAvailable: this.isEncryptionReady(),
    };
  }

  public saveCredentials(input: CredentialsInput): CredentialsStatus {
    const current = this.readVault();
    const port = Number(input.redirectPort);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Redirect port must be a valid TCP port between 1024 and 65535.');
    }

    const updated: VaultPayload = {
      ...current,
      redirectPort: port,
      googleClientId:
        input.googleClientId !== undefined
          ? input.googleClientId.trim() || undefined
          : current.googleClientId,
      googleClientSecret:
        input.googleClientSecret !== undefined && input.googleClientSecret.trim() !== ''
          ? input.googleClientSecret.trim()
          : current.googleClientSecret,
      facebookAppId:
        input.facebookAppId !== undefined
          ? input.facebookAppId.trim() || undefined
          : current.facebookAppId,
      facebookAppSecret:
        input.facebookAppSecret !== undefined && input.facebookAppSecret.trim() !== ''
          ? input.facebookAppSecret.trim()
          : current.facebookAppSecret,
    };

    this.writeVault(updated);
    return this.getCredentialsStatus();
  }

  public getGoogleAuth(): StoredGoogleAuth | undefined {
    return this.readVault().googleAuth;
  }

  public setGoogleAuth(auth: StoredGoogleAuth | undefined): void {
    const current = this.readVault();
    this.writeVault({
      ...current,
      googleAuth: auth,
    });
  }

  public getFacebookAuth(): StoredFacebookAuth | undefined {
    return this.readVault().facebookAuth;
  }

  public setFacebookAuth(auth: StoredFacebookAuth | undefined): void {
    const current = this.readVault();
    this.writeVault({
      ...current,
      facebookAuth: auth,
    });
  }

  public selectYouTubeChannel(channelId: string): ConnectedAccountsState {
    const current = this.readVault();
    if (!current.googleAuth) {
      throw new Error('Google account is not connected.');
    }
    const found = current.googleAuth.channels.find((c) => c.id === channelId);
    if (!found) {
      throw new Error('Selected YouTube channel was not found in authorized channels.');
    }

    this.writeVault({
      ...current,
      googleAuth: {
        ...current.googleAuth,
        channelId: found.id,
        channelTitle: found.title,
        avatarUrl: found.avatarUrl || current.googleAuth.avatarUrl,
      },
    });
    return this.getSafeAccountsSummary();
  }

  public selectFacebookPage(pageId: string): ConnectedAccountsState {
    const current = this.readVault();
    if (!current.facebookAuth) {
      throw new Error('Facebook account is not connected.');
    }
    const found = current.facebookAuth.pages.find((p) => p.id === pageId);
    if (!found) {
      throw new Error('Selected Facebook Page was not found in authorized Pages.');
    }

    this.writeVault({
      ...current,
      facebookAuth: {
        ...current.facebookAuth,
        selectedPageId: found.id,
      },
    });
    return this.getSafeAccountsSummary();
  }

  /**
   * Returns sanitized metadata safe for the Renderer UI.
   * NEVER exposes access_token, refresh_token, pageAccessToken, or client secrets!
   */
  public getSafeAccountsSummary(): ConnectedAccountsState {
    if (!this.isEncryptionReady()) {
      return {
        google: { connected: false, channels: [] },
        facebook: { connected: false, pages: [] },
      };
    }

    const vault = this.readVault();
    const g = vault.googleAuth;
    const fb = vault.facebookAuth;
    const selectedPage = fb?.pages.find((p) => p.id === fb.selectedPageId) ?? fb?.pages[0];

    return {
      google: g
        ? {
            connected: true,
            email: g.email,
            channelId: g.channelId,
            channelTitle: g.channelTitle,
            avatarUrl: g.avatarUrl,
            channels: (g.channels || []).map((c) => ({
              id: c.id,
              title: c.title,
              customUrl: c.customUrl,
              avatarUrl: c.avatarUrl,
            })),
            expiresAt: g.expiresAt,
          }
        : { connected: false, channels: [] },
      facebook: fb
        ? {
            connected: true,
            userName: fb.userName,
            selectedPageId: selectedPage?.id,
            selectedPageName: selectedPage?.name,
            pages: fb.pages.map((p) => ({
              id: p.id,
              name: p.name,
              category: p.category,
            })),
            expiresAt: fb.expiresAt,
          }
        : { connected: false, pages: [] },
    };
  }

  public getAppSettings(): AppSettingsState {
    const defaults: AppSettingsState = {
      minimizeToTray: true,
      launchAtLogin: false,
    };

    if (!fs.existsSync(this.settingsFilePath)) {
      return defaults;
    }

    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.settingsFilePath, 'utf-8')
      ) as Partial<AppSettingsState>;
      return {
        minimizeToTray: parsed.minimizeToTray ?? true,
        launchAtLogin: parsed.launchAtLogin ?? false,
      };
    } catch {
      return defaults;
    }
  }

  public updateAppSettings(patch: Partial<AppSettingsState>): AppSettingsState {
    const next = {
      ...this.getAppSettings(),
      ...patch,
    };
    fs.writeFileSync(this.settingsFilePath, JSON.stringify(next, null, 2), 'utf-8');
    return next;
  }
}

