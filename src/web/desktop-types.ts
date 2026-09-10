export interface DesktopUpdateState {
  status: 'idle' | 'dev' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

export interface DesktopAPI {
  platform: string;
  isDesktop: boolean;
  isTauri: boolean;
  minimize?: () => Promise<void> | void;
  maximize?: () => Promise<void> | void;
  close?: () => Promise<void> | void;
  openFolderPicker?: () => Promise<string | null>;
  onTouchBarEvent?: (callback: (event: string) => void) => void;
  updateTouchBarStatus?: (data: { status?: string; text?: string; color?: string }) => void;
  checkForUpdates?: () => Promise<DesktopUpdateState>;
  downloadUpdate?: () => Promise<DesktopUpdateState>;
  installUpdate?: () => Promise<DesktopUpdateState>;
  onUpdaterState?: (callback: (state: DesktopUpdateState) => void) => (() => void) | void;
}

declare global {
  interface Window {
    desktopAPI?: DesktopAPI;
    electronAPI?: DesktopAPI;
    __TAURI_INTERNALS__?: unknown;
  }
}
