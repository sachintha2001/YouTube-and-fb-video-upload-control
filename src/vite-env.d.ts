/// <reference types="vite/client" />
import type { DesktopApi } from './types/shared';

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}

