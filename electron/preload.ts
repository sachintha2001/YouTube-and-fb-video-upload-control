import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppSettingsState,
  CreateUploadJobPayload,
  CredentialsInput,
  DesktopApi,
  UploadProgressEvent,
} from './types';

const desktopApi: DesktopApi = {
  // OAuth & Accounts
  getAccounts: () => ipcRenderer.invoke('auth:get-accounts'),
  connectGoogle: () => ipcRenderer.invoke('auth:connect-google'),
  disconnectGoogle: () => ipcRenderer.invoke('auth:disconnect-google'),
  connectFacebook: () => ipcRenderer.invoke('auth:connect-facebook'),
  disconnectFacebook: () => ipcRenderer.invoke('auth:disconnect-facebook'),
  selectFacebookPage: (pageId: string) =>
    ipcRenderer.invoke('auth:select-facebook-page', pageId),
  selectYouTubeChannel: (channelId: string) =>
    ipcRenderer.invoke('auth:select-youtube-channel', channelId),

  // Encrypted Developer Console Credentials
  getCredentialsStatus: () => ipcRenderer.invoke('credentials:get-status'),
  saveCredentials: (input: CredentialsInput) =>
    ipcRenderer.invoke('credentials:save', input),

  // Media File Selection & Electron 32+ Drag-and-Drop Path Resolution
  pickMediaFile: () => ipcRenderer.invoke('media:pick-file'),
  inspectMediaPath: (filePath: string) =>
    ipcRenderer.invoke('media:inspect-path', filePath),
  resolveDroppedFilePath: (file: File) => webUtils.getPathForFile(file),

  // Jobs, Scheduling & Immediate Uploads
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  createJob: (payload: CreateUploadJobPayload) =>
    ipcRenderer.invoke('jobs:create', payload),
  cancelJob: (jobId: string) => ipcRenderer.invoke('jobs:cancel', jobId),
  triggerJobNow: (jobId: string) => ipcRenderer.invoke('jobs:trigger-now', jobId),
  retryFailedTargets: (jobId: string) =>
    ipcRenderer.invoke('jobs:retry-failed', jobId),

  // System Tray, Settings & External Links
  getAppSettings: () => ipcRenderer.invoke('settings:get'),
  updateAppSettings: (patch: Partial<AppSettingsState>) =>
    ipcRenderer.invoke('settings:update', patch),
  openExternalUrl: (url: string) => ipcRenderer.invoke('system:open-external', url),

  // Real-time Main -> Renderer Events
  onUploadProgress: (callback: (event: UploadProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: UploadProgressEvent) => {
      callback(payload);
    };
    ipcRenderer.on('upload:progress', listener);
    return () => {
      ipcRenderer.removeListener('upload:progress', listener);
    };
  },

  onJobsUpdated: (callback: () => void) => {
    const listener = () => {
      callback();
    };
    ipcRenderer.on('jobs:updated', listener);
    return () => {
      ipcRenderer.removeListener('jobs:updated', listener);
    };
  },
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);

