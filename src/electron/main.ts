import { app, BrowserWindow, shell, ipcMain, TouchBar } from 'electron';
import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import { fork, ChildProcess } from 'child_process';
import { autoUpdater } from 'electron-updater';

const { TouchBarButton, TouchBarSpacer, TouchBarLabel } = TouchBar;

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let touchBarStatusLabel: any = null;
let persistentTouchBar: any = null;
const SERVER_PORT = 3001;

type UpdaterState = {
  status: 'idle' | 'dev' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
};

let updaterState: UpdaterState = { status: 'idle' };

function sendUpdaterState(next: UpdaterState) {
  updaterState = next;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-state', updaterState);
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    sendUpdaterState({ status: 'checking', message: 'Checking for updates…' });
  });
  autoUpdater.on('update-available', (info) => {
    sendUpdaterState({ status: 'available', version: info.version, message: `Version ${info.version} is ready to download.` });
  });
  autoUpdater.on('update-not-available', (info) => {
    sendUpdaterState({ status: 'not-available', version: info.version, message: 'You are up to date.' });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendUpdaterState({ status: 'downloading', percent: Math.round(progress.percent), message: 'Downloading update…' });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdaterState({ status: 'downloaded', version: info.version, percent: 100, message: 'Update downloaded. Restart to install it.' });
  });
  autoUpdater.on('error', (error) => {
    sendUpdaterState({ status: 'error', message: error.message || 'Unable to check for updates.' });
  });
}

async function checkForUpdates(): Promise<UpdaterState> {
  if (!app.isPackaged) {
    sendUpdaterState({ status: 'dev', message: 'Update checks are available after installing the app.' });
    return updaterState;
  }

  sendUpdaterState({ status: 'checking', message: 'Checking for updates…' });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error: any) {
    sendUpdaterState({ status: 'error', message: error?.message || 'Unable to check for updates.' });
  }
  return updaterState;
}

function setupTouchBar(window: BrowserWindow) {
  if (process.platform !== 'darwin') return;

  if (!persistentTouchBar) {
    const newChatBtn = new TouchBarButton({
      label: '+ New Chat',
      backgroundColor: '#2b2b2b',
      click: () => {
        window.webContents.send('touchbar-new-chat');
      },
    });

    const newProjectBtn = new TouchBarButton({
      label: '📂 Project',
      backgroundColor: '#1c1c1c',
      click: () => {
        window.webContents.send('touchbar-new-project');
      },
    });

    const cmdPaletteBtn = new TouchBarButton({
      label: '⌘ Cmds',
      backgroundColor: '#1f1f1f',
      click: () => {
        window.webContents.send('touchbar-command-palette');
      },
    });

    const rollbackBtn = new TouchBarButton({
      label: '⏪ Rollback',
      backgroundColor: '#3a1a1a',
      click: () => {
        window.webContents.send('touchbar-rollback');
      },
    });

    touchBarStatusLabel = new TouchBarLabel({
      label: '🍓 Alisa: Ready',
      textColor: '#27c93f',
    });

    persistentTouchBar = new TouchBar({
      items: [
        touchBarStatusLabel,
        new TouchBarSpacer({ size: 'small' }),
        newChatBtn,
        newProjectBtn,
        cmdPaletteBtn,
        rollbackBtn,
      ],
    });
  }

  window.setTouchBar(persistentTouchBar);
}

function startBackendServer() {
  const isDev = !app.isPackaged;
  const serverCandidates = isDev
    ? [
        path.join(__dirname, 'server.cjs'),
        path.join(__dirname, '..', '..', 'dist-electron', 'server.cjs'),
        path.join(process.cwd(), 'dist-electron', 'server.cjs'),
      ]
    : [path.join(process.resourcesPath, 'dist-electron', 'server.cjs')];
  const serverScript = serverCandidates.find((candidate) => fs.existsSync(candidate)) || serverCandidates[0];

  if (!fs.existsSync(serverScript)) {
    console.error(`[Electron] Backend server script not found. Checked: ${serverCandidates.join(', ')}`);
    return;
  }

  try {
    serverProcess = fork(serverScript, [], {
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        ALISA_CONFIG_DIR: app.getPath('userData'),
      },
      stdio: 'inherit',
    });

    serverProcess.on('error', (err) => {
      console.error('[Electron] Failed to start backend server:', err);
    });

    serverProcess.on('exit', (code) => {
      console.log(`[Electron] Backend server exited with code ${code}`);
    });
  } catch (err) {
    console.error('[Electron] Server start exception:', err);
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 960,
    minHeight: 640,
    frame: !isMac ? false : false, // Frameless custom window header bar
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    title: 'Project Alisa Studio — AI Coding & Automation Studio',
    icon: path.join(__dirname, '../public/avatar.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: false,
    },
    backgroundColor: '#121212',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (mainWindow) {
      setupTouchBar(mainWindow);
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    sendUpdaterState(updaterState);
  });

  mainWindow.on('focus', () => {
    if (mainWindow) {
      setupTouchBar(mainWindow);
    }
  });

  mainWindow.on('show', () => {
    if (mainWindow) {
      setupTouchBar(mainWindow);
    }
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // Retry loading http://localhost:3001 served by backend server
    const targetUrl = `http://localhost:${SERVER_PORT}`;
    const tryLoad = () => {
      http.get(targetUrl, () => {
        mainWindow?.loadURL(targetUrl);
      }).on('error', () => {
        setTimeout(tryLoad, 300);
      });
    };
    tryLoad();
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });
}

// Window Control IPC Handlers
ipcMain.on('update-touchbar-status', (_event, data: { text?: string; color?: string; status?: string }) => {
  if (touchBarStatusLabel) {
    if (data.text) {
      touchBarStatusLabel.label = data.text;
    } else if (data.status === 'acting' || data.status === 'thinking') {
      touchBarStatusLabel.label = '⚡ Thinking...';
      touchBarStatusLabel.textColor = '#ffaa00';
    } else if (data.status === 'executing' || data.status === 'running') {
      touchBarStatusLabel.label = '⚙️ Executing...';
      touchBarStatusLabel.textColor = '#38bdf8';
    } else {
      touchBarStatusLabel.label = '🍓 Alisa: Ready';
      touchBarStatusLabel.textColor = '#27c93f';
    }
    if (data.color) {
      touchBarStatusLabel.textColor = data.color;
    }
  }
});

ipcMain.on('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow?.close();
});

ipcMain.handle('updater-check', async () => checkForUpdates());

ipcMain.handle('updater-download', async () => {
  if (!app.isPackaged) {
    sendUpdaterState({ status: 'dev', message: 'Update downloads are available after installing the app.' });
    return updaterState;
  }

  try {
    sendUpdaterState({ status: 'downloading', percent: 0, message: 'Downloading update…' });
    await autoUpdater.downloadUpdate();
  } catch (error: any) {
    sendUpdaterState({ status: 'error', message: error?.message || 'Unable to download update.' });
  }
  return updaterState;
});

ipcMain.handle('updater-install', () => {
  if (updaterState.status === 'downloaded') {
    autoUpdater.quitAndInstall();
  }
  return updaterState;
});

app.whenReady().then(() => {
  startBackendServer();
  createWindow();
  setupAutoUpdater();
  setTimeout(() => { void checkForUpdates(); }, 4000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
