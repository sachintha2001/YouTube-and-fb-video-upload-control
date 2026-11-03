import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
} from 'electron';
import type {
  AppSettingsState,
  CreateUploadJobPayload,
  CredentialsInput,
  MediaFileSelection,
} from './types';
import { SecureVault } from './security/secureVault';
import { SqliteRepository } from './db/sqlite';
import { OAuthManager } from './auth/oauthManager';
import { UploadScheduler } from './scheduler/uploadScheduler';
import { TrayManager } from './tray/trayManager';

const ALLOWED_VIDEO_EXTENSIONS = new Map<string, string>([
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.mkv', 'video/x-matroska'],
  ['.webm', 'video/webm'],
  ['.m4v', 'video/x-m4v'],
  ['.avi', 'video/x-msvideo'],
]);

// Register custom streamable protocol for safe local <video> previews without disabling webSecurity
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

let vault: SecureVault;
let repo: SqliteRepository;
let oauth: OAuthManager;
let scheduler: UploadScheduler;
let trayManager: TrayManager;

// Strict allowlist of user-selected video paths allowed over local-media://
const allowedPreviewPaths = new Set<string>();

function inspectAndAllowMediaFile(rawFilePath: string): MediaFileSelection {
  const resolved = path.resolve(rawFilePath);
  const ext = path.extname(resolved).toLowerCase();
  const mimeType = ALLOWED_VIDEO_EXTENSIONS.get(ext);

  if (!mimeType) {
    throw new Error(
      `Unsupported video format "${ext || 'unknown'}". Supported formats: MP4, MOV, MKV, WebM, M4V, AVI.`
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new Error('Selected video file does not exist on disk.');
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error('Selected path is not a valid non-empty video file.');
  }

  allowedPreviewPaths.add(resolved);

  return {
    filePath: resolved,
    fileName: path.basename(resolved),
    sizeBytes: stat.size,
    mimeType,
    previewUrl: `local-media://preview/?path=${encodeURIComponent(resolved)}`,
  };
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: 'SocialStream Studio',
    backgroundColor: '#0b0f19',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Block untrusted external navigations or popups inside the Electron renderer
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, navigationUrl) => {
    const isDevServer =
      process.env.NODE_ENV === 'development' &&
      navigationUrl.startsWith('http://localhost:5173');
    if (!isDevServer && !navigationUrl.startsWith('file://')) {
      event.preventDefault();
    }
  });

  // Background System Tray handling when minimized or closed
  win.on('minimize', () => {
    const settings = vault.getAppSettings();
    if (settings.minimizeToTray && process.platform === 'win32') {
      win.hide();
      trayManager.notifyRunningInBackgroundOnce();
    }
  });

  win.on('close', (event) => {
    const settings = vault.getAppSettings();
    if (!isQuitting && settings.minimizeToTray) {
      event.preventDefault();
      win.hide();
      trayManager.notifyRunningInBackgroundOnce();
    }
  });

  if (process.env.NODE_ENV === 'development') {
    void win.loadURL('http://localhost:5173');
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return win;
}

function registerIpcHandlers(): void {
  // OAuth & Accounts
  ipcMain.handle('auth:get-accounts', () => vault.getSafeAccountsSummary());
  ipcMain.handle('auth:connect-google', () => oauth.connectGoogle());
  ipcMain.handle('auth:disconnect-google', () => oauth.disconnectGoogle());
  ipcMain.handle('auth:connect-facebook', () => oauth.connectFacebook());
  ipcMain.handle('auth:disconnect-facebook', () => oauth.disconnectFacebook());
  ipcMain.handle('auth:select-facebook-page', (_event, pageId: string) => {
    if (typeof pageId !== 'string' || !pageId.trim()) {
      throw new Error('Invalid Facebook Page ID.');
    }
    return vault.selectFacebookPage(pageId.trim());
  });
  ipcMain.handle('auth:select-youtube-channel', (_event, channelId: string) => {
    if (typeof channelId !== 'string' || !channelId.trim()) {
      throw new Error('Invalid YouTube Channel ID.');
    }
    return vault.selectYouTubeChannel(channelId.trim());
  });

  // Encrypted Developer Console Credentials
  ipcMain.handle('credentials:get-status', () => vault.getCredentialsStatus());
  ipcMain.handle('credentials:save', (_event, input: CredentialsInput) =>
    vault.saveCredentials(input)
  );

  // Media Picker & Drag-and-Drop Inspection
  ipcMain.handle('media:pick-file', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Video File to Upload',
      properties: ['openFile'],
      filters: [
        {
          name: 'Video Files',
          extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi'],
        },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return inspectAndAllowMediaFile(result.filePaths[0]);
  });

  ipcMain.handle('media:inspect-path', (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new Error('Could not resolve local file path from dropped file.');
    }
    return inspectAndAllowMediaFile(filePath);
  });

  // Upload Jobs & Background Scheduling
  ipcMain.handle('jobs:list', () => repo.listJobs());

  ipcMain.handle('jobs:create', (_event, payload: CreateUploadJobPayload) => {
    const title = (payload.title || '').trim();
    const description = (payload.description || '').trim();
    if (!title) {
      throw new Error('Post/Video title is required.');
    }
    if (!Array.isArray(payload.platforms) || payload.platforms.length === 0) {
      throw new Error('Select at least one platform (YouTube or Facebook).');
    }

    const accounts = vault.getSafeAccountsSummary();
    if (payload.platforms.includes('youtube') && !accounts.google.connected) {
      throw new Error('Please connect your Google / YouTube account before scheduling to YouTube.');
    }
    if (payload.platforms.includes('facebook') && !accounts.facebook.connected) {
      throw new Error('Please connect your Facebook account before scheduling to Facebook.');
    }

    let mediaInfo: MediaFileSelection | null = null;
    if (payload.mediaPath) {
      mediaInfo = inspectAndAllowMediaFile(payload.mediaPath);
    } else if (payload.platforms.includes('youtube')) {
      throw new Error('YouTube uploads require selecting a video file.');
    } else if (!description) {
      throw new Error('Facebook text posts require a post message/description.');
    }

    const scheduledDate = payload.publishImmediately
      ? new Date()
      : new Date(payload.scheduledAtIso);

    if (Number.isNaN(scheduledDate.getTime())) {
      throw new Error('Invalid schedule date and time.');
    }

    if (!payload.publishImmediately && scheduledDate.getTime() < Date.now() - 30_000) {
      throw new Error('Scheduled publish time must be in the future.');
    }

    const createdJob = repo.createJob({
      title,
      description,
      tags: (payload.tags || []).map((t) => t.trim()).filter(Boolean),
      platforms: payload.platforms,
      youtubePrivacy: payload.youtubePrivacy || 'private',
      mediaPath: mediaInfo?.filePath ?? null,
      mediaFileName: mediaInfo?.fileName ?? null,
      mediaSizeBytes: mediaInfo?.sizeBytes ?? 0,
      mediaMimeType: mediaInfo?.mimeType ?? null,
      scheduledAtIso: scheduledDate.toISOString(),
    });

    trayManager.refreshContextMenu();

    if (payload.publishImmediately) {
      void scheduler.triggerJobImmediately(createdJob.id);
    }

    return createdJob;
  });

  ipcMain.handle('jobs:cancel', (_event, jobId: string) => {
    repo.cancelJob(jobId);
    trayManager.refreshContextMenu();
  });

  ipcMain.handle('jobs:trigger-now', (_event, jobId: string) => {
    void scheduler.triggerJobImmediately(jobId);
  });

  ipcMain.handle('jobs:retry-failed', (_event, jobId: string) => {
    repo.resetFailedTargetsForRetry(jobId);
    trayManager.refreshContextMenu();
    void scheduler.triggerJobImmediately(jobId);
  });

  // App Settings & Safe HTTPS External Links
  ipcMain.handle('settings:get', () => vault.getAppSettings());
  ipcMain.handle('settings:update', (_event, patch: Partial<AppSettingsState>) => {
    const updated = vault.updateAppSettings(patch);
    if (patch.launchAtLogin !== undefined) {
      app.setLoginItemSettings({ openAtLogin: updated.launchAtLogin });
    }
    trayManager.refreshContextMenu();
    return updated;
  });

  ipcMain.handle('system:open-external', async (_event, url: string) => {
    if (typeof url !== 'string') {
      throw new Error('Invalid URL.');
    }
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new Error('Only HTTPS external URLs are permitted.');
    }
    await shell.openExternal(parsed.toString());
  });
}

// Enforce Single Desktop Instance so duplicate background cron workers never run concurrently
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (trayManager) {
      trayManager.showMainWindow();
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Handle allowlisted local video preview requests with HTTP Range support
    protocol.handle('local-media', (request) => {
      const reqUrl = new URL(request.url);
      const requestedPath = reqUrl.searchParams.get('path');
      if (!requestedPath) {
        return new Response('Bad Request', { status: 400 });
      }
      const resolved = path.resolve(requestedPath);
      if (!allowedPreviewPaths.has(resolved)) {
        return new Response('Forbidden', { status: 403 });
      }
      return net.fetch(pathToFileURL(resolved).toString(), {
        headers: request.headers,
      });
    });

    const userDataDir = app.getPath('userData');
    vault = new SecureVault(userDataDir);
    repo = new SqliteRepository(path.join(userDataDir, 'socialstream.sqlite'));
    oauth = new OAuthManager(vault, () => mainWindow);

    trayManager = new TrayManager(
      repo,
      vault,
      () => mainWindow,
      () => {
        void scheduler.tick();
      },
      () => {
        isQuitting = true;
        app.quit();
      }
    );

    scheduler = new UploadScheduler(
      repo,
      oauth,
      () => mainWindow,
      () => trayManager.refreshContextMenu()
    );

    registerIpcHandlers();
    mainWindow = createMainWindow();
    trayManager.initialize();
    scheduler.start();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      } else {
        trayManager.showMainWindow();
      }
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
    scheduler?.stop();
    trayManager?.destroy();
    repo?.close();
  });

  // Keep background scheduler alive when windows are hidden to System Tray
  app.on('window-all-closed', () => {
    const settings = vault?.getAppSettings();
    if (!settings?.minimizeToTray && process.platform !== 'darwin') {
      app.quit();
    }
  });
}

