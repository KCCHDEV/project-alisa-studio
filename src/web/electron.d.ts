export {};

declare global {
  interface Window {
    electronAPI?: {
      platform?: string;
      isElectron?: boolean;
      minimize?: () => void;
      maximize?: () => void;
      close?: () => void;
      onTouchBarEvent?: (callback: (event: string) => void) => void;
      updateTouchBarStatus?: (data: { status?: string; text?: string; color?: string }) => void;
      checkForUpdates?: () => Promise<{
        status: string;
        version?: string;
        percent?: number;
        message?: string;
      }>;
      downloadUpdate?: () => Promise<{
        status: string;
        version?: string;
        percent?: number;
        message?: string;
      }>;
      installUpdate?: () => Promise<{
        status: string;
        version?: string;
        percent?: number;
        message?: string;
      }>;
      onUpdaterState?: (callback: (state: {
        status: string;
        version?: string;
        percent?: number;
        message?: string;
      }) => void) => (() => void) | void;
    };
  }
}
