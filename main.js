const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { startServer } = require('./server');

// Mejor compatibilidad gráfica para macOS Intel
app.commandLine.appendSwitch('disable-gpu');

let mainWindow = null;
let serverInstance = null;

const SERVER_PORT = 3847;

async function createWindow() {
  serverInstance = await startServer(SERVER_PORT);

  mainWindow = new BrowserWindow({
    width: 470,
    height: 640,
    minWidth: 420,
    minHeight: 560,
    title: 'YouTube Downloader',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#08090d',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverInstance) {
    serverInstance.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (serverInstance) {
    serverInstance.close();
  }
});
