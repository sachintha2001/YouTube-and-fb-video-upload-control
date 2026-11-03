import { app, BrowserWindow, Menu, nativeImage, Notification, Tray } from 'electron';
import { SqliteRepository } from '../db/sqlite';
import { SecureVault } from '../security/secureVault';

// Embedded 18x18 crisp RGBA circle + play icon so packaged .dmg / .exe builds never fail on missing icon paths
const EMBEDDED_TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAVElEQVR4nGNgoCVITvv4Hx+miiFEGUaMQoJqSHI2LvW4bCHZZbhcQ8gbZBmET55kg7B5fWANoorX0OXwGkRx9ONzFSGDSLOFRDUYCmleAhBlCLkAADkPQVb1phnhAAAAAElFTkSuQmCC';

export class TrayManager {
  private tray: Tray | null = null;
  private hasShownBackgroundNotice = false;

  constructor(
    private readonly repo: SqliteRepository,
    private readonly vault: SecureVault,
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly onRunDueNow: () => void,
    private readonly onRequestQuit: () => void
  ) {}

  public initialize(): void {
    const icon = nativeImage.createFromDataURL(EMBEDDED_TRAY_ICON_DATA_URL);
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip('SocialStream Studio — Background Scheduler Active');

    this.tray.on('click', () => {
      this.showMainWindow();
    });

    this.tray.on('double-click', () => {
      this.showMainWindow();
    });

    this.refreshContextMenu();
  }

  public showMainWindow(): void {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) {
      return;
    }
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
    if (process.platform === 'darwin' && app.dock) {
      void app.dock.show();
    }
  }

  public notifyRunningInBackgroundOnce(): void {
    if (this.hasShownBackgroundNotice) {
      return;
    }
    this.hasShownBackgroundNotice = true;
    if (Notification.isSupported()) {
      new Notification({
        title: 'SocialStream Studio is running in the background',
        body: 'Scheduled YouTube & Facebook uploads will continue automatically from the System Tray.',
      }).show();
    }
  }

  public refreshContextMenu(): void {
    if (!this.tray) {
      return;
    }

    const pendingCount = this.repo.countScheduledJobs();
    const settings = this.vault.getAppSettings();

    const statusLabel =
      pendingCount === 0
        ? 'Scheduler Active • No Pending Uploads'
        : `Scheduler Active • ${pendingCount} Pending Upload${pendingCount === 1 ? '' : 's'}`;

    this.tray.setToolTip(`SocialStream Studio — ${statusLabel}`);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: statusLabel,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open Dashboard',
        click: () => this.showMainWindow(),
      },
      {
        label: 'Run Due Scheduled Tasks Now',
        click: () => this.onRunDueNow(),
      },
      { type: 'separator' },
      {
        label: 'Keep Running in System Tray on Close/Minimize',
        type: 'checkbox',
        checked: settings.minimizeToTray,
        click: (menuItem) => {
          this.vault.updateAppSettings({ minimizeToTray: menuItem.checked });
          this.refreshContextMenu();
        },
      },
      {
        label: 'Launch Automatically at Login',
        type: 'checkbox',
        checked: settings.launchAtLogin,
        click: (menuItem) => {
          this.vault.updateAppSettings({ launchAtLogin: menuItem.checked });
          app.setLoginItemSettings({ openAtLogin: menuItem.checked });
          this.refreshContextMenu();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Completely',
        click: () => this.onRequestQuit(),
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  public destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

