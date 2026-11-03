export type Platform = 'youtube' | 'facebook';

export type YouTubePrivacy = 'private' | 'unlisted' | 'public';

export type TargetStatus =
  | 'pending'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type JobOverallStatus =
  | 'scheduled'
  | 'uploading'
  | 'completed'
  | 'partial_failure'
  | 'failed'
  | 'cancelled';

export interface FacebookPageSummary {
  id: string;
  name: string;
  category?: string;
}

export interface YouTubeChannelSummary {
  id: string;
  title: string;
  customUrl?: string;
  avatarUrl?: string;
}

export interface GoogleAccountSummary {
  connected: boolean;
  email?: string;
  channelId?: string;
  channelTitle?: string;
  avatarUrl?: string;
  channels: YouTubeChannelSummary[];
  expiresAt?: number;
}

export interface FacebookAccountSummary {
  connected: boolean;
  userName?: string;
  selectedPageId?: string;
  selectedPageName?: string;
  pages: FacebookPageSummary[];
  expiresAt?: number;
}

export interface ConnectedAccountsState {
  google: GoogleAccountSummary;
  facebook: FacebookAccountSummary;
}

export interface CredentialsInput {
  redirectPort: number;
  googleClientId?: string;
  googleClientSecret?: string;
  facebookAppId?: string;
  facebookAppSecret?: string;
}

export interface CredentialsStatus {
  redirectPort: number;
  googleConfigured: boolean;
  facebookConfigured: boolean;
  googleClientIdPreview?: string;
  facebookAppIdPreview?: string;
  googleRedirectUri: string;
  facebookRedirectUri: string;
  encryptionAvailable: boolean;
}

export interface MediaFileSelection {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  previewUrl: string;
}

export interface CreateUploadJobPayload {
  title: string;
  description: string;
  tags: string[];
  platforms: Platform[];
  youtubePrivacy: YouTubePrivacy;
  mediaPath: string | null;
  publishImmediately: boolean;
  scheduledAtIso: string; // ISO-8601 UTC timestamp
}

export interface JobTarget {
  id: number;
  jobId: string;
  platform: Platform;
  status: TargetStatus;
  remotePostId: string | null;
  remoteUrl: string | null;
  errorMessage: string | null;
  retryCount: number;
  bytesUploaded: number;
  totalBytes: number;
  completedAt: string | null;
}

export interface UploadJob {
  id: string;
  title: string;
  description: string;
  tags: string[];
  mediaPath: string | null;
  mediaFileName: string | null;
  mediaSizeBytes: number;
  mediaMimeType: string | null;
  youtubePrivacy: YouTubePrivacy;
  scheduledAt: string; // ISO-8601 UTC timestamp
  overallStatus: JobOverallStatus;
  createdAt: string;
  updatedAt: string;
  targets: JobTarget[];
}

export interface UploadProgressEvent {
  jobId: string;
  platform: Platform;
  bytesUploaded: number;
  totalBytes: number;
  percent: number;
  phase: string;
}

export interface AppSettingsState {
  minimizeToTray: boolean;
  launchAtLogin: boolean;
}

export interface DesktopApi {
  // OAuth & Accounts (Strictly executed in Main Process)
  getAccounts: () => Promise<ConnectedAccountsState>;
  connectGoogle: () => Promise<ConnectedAccountsState>;
  disconnectGoogle: () => Promise<ConnectedAccountsState>;
  connectFacebook: () => Promise<ConnectedAccountsState>;
  disconnectFacebook: () => Promise<ConnectedAccountsState>;
  selectFacebookPage: (pageId: string) => Promise<ConnectedAccountsState>;
  selectYouTubeChannel: (channelId: string) => Promise<ConnectedAccountsState>;

  // Encrypted Developer Console Credentials
  getCredentialsStatus: () => Promise<CredentialsStatus>;
  saveCredentials: (input: CredentialsInput) => Promise<CredentialsStatus>;

  // Media File Selection & Drag-and-Drop Path Resolution
  pickMediaFile: () => Promise<MediaFileSelection | null>;
  inspectMediaPath: (filePath: string) => Promise<MediaFileSelection>;
  resolveDroppedFilePath: (file: File) => string;

  // Jobs, Scheduling & Immediate Uploads
  listJobs: () => Promise<{ upcoming: UploadJob[]; history: UploadJob[] }>;
  createJob: (payload: CreateUploadJobPayload) => Promise<UploadJob>;
  cancelJob: (jobId: string) => Promise<void>;
  triggerJobNow: (jobId: string) => Promise<void>;
  retryFailedTargets: (jobId: string) => Promise<void>;

  // System Tray, Settings & External Links
  getAppSettings: () => Promise<AppSettingsState>;
  updateAppSettings: (patch: Partial<AppSettingsState>) => Promise<AppSettingsState>;
  openExternalUrl: (url: string) => Promise<void>;

  // Real-time Main -> Renderer Events
  onUploadProgress: (callback: (event: UploadProgressEvent) => void) => () => void;
  onJobsUpdated: (callback: () => void) => () => void;
}

