import type { DesktopAPI, DesktopUpdateState } from './desktop-types';

let updaterCallbacks: Array<(state: DesktopUpdateState) => void> = [];
let currentState: DesktopUpdateState = { status: 'idle' };

function notifyUpdater(state: DesktopUpdateState) {
  currentState = state;
  updaterCallbacks.forEach((cb) => {
    try {
      cb(state);
    } catch (e) {
      console.error('Updater callback error:', e);
    }
  });
}

export function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.__TAURI_INTERNALS__ ||
    window.location.hostname.includes('tauri') ||
    window.location.protocol === 'tauri:'
  );
}

async function invokeTauriCommand<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isTauriEnvironment()) return undefined;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.warn(`[Tauri] Invoke '${cmd}' error:`, err);
    return undefined;
  }
}

export const desktopAPI: DesktopAPI = {
  platform: typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac') ? 'darwin' : 'win32',
  isDesktop: isTauriEnvironment(),
  isTauri: isTauriEnvironment(),

  async minimize() {
    await invokeTauriCommand('minimize_window');
  },

  async maximize() {
    await invokeTauriCommand('toggle_maximize_window');
  },

  async close() {
    await invokeTauriCommand('close_window');
  },

  async openFolderPicker(): Promise<string | null> {
    if (isTauriEnvironment()) {
      try {
        const selected = await invokeTauriCommand<string | null>('open_folder_dialog');
        if (selected) return selected;
      } catch (err) {
        console.warn('[Tauri] open_folder_dialog error:', err);
      }
    }

    // Backend fallback
    try {
      const res = await fetch('/api/workspace/pick-folder', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.path === 'string' && data.path.trim()) {
          return data.path.trim();
        }
      }
    } catch (err) {
      console.warn('Backend pick-folder fallback error:', err);
    }
    return null;
  },

  onTouchBarEvent(_callback) {
    // No-op on modern desktop
  },

  updateTouchBarStatus(_data) {
    // No-op on modern desktop
  },

  async checkForUpdates(): Promise<DesktopUpdateState> {
    const state: DesktopUpdateState = {
      status: 'dev',
      message: 'Automatic updates are not configured for this build. Check GitHub Releases manually.',
    };
    notifyUpdater(state);
    return state;
  },

  async downloadUpdate(): Promise<DesktopUpdateState> {
    return currentState;
  },

  async installUpdate(): Promise<DesktopUpdateState> {
    return currentState;
  },

  onUpdaterState(callback: (state: DesktopUpdateState) => void) {
    updaterCallbacks.push(callback);
    callback(currentState);
    return () => {
      updaterCallbacks = updaterCallbacks.filter((cb) => cb !== callback);
    };
  },
};

if (typeof window !== 'undefined') {
  window.desktopAPI = desktopAPI;
  window.electronAPI = desktopAPI;
}
