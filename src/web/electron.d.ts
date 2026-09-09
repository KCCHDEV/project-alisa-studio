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
    };
  }
}
