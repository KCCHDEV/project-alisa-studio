import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  onTouchBarEvent: (callback: (event: string) => void) => {
    const events = ['touchbar-new-chat', 'touchbar-new-project', 'touchbar-command-palette', 'touchbar-rollback'];
    events.forEach(eventName => {
      ipcRenderer.on(eventName, () => callback(eventName));
    });
  },
  updateTouchBarStatus: (data: { status?: string; text?: string; color?: string }) => {
    ipcRenderer.send('update-touchbar-status', data);
  },
  checkForUpdates: () => ipcRenderer.invoke('updater-check'),
  downloadUpdate: () => ipcRenderer.invoke('updater-download'),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
  onUpdaterState: (callback: (state: {
    status: string;
    version?: string;
    percent?: number;
    message?: string;
  }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: {
      status: string;
      version?: string;
      percent?: number;
      message?: string;
    }) => callback(state);
    ipcRenderer.on('updater-state', handler);
    return () => ipcRenderer.removeListener('updater-state', handler);
  },
});
