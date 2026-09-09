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
  }
});
