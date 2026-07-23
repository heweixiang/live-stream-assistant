const { app, BrowserWindow, ipcMain, Notification, Menu, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { executeAction, listWindowProcesses } = require('./actionExecutor.cjs')
const {
  openDouyinLogin,
  clearDouyinAuth,
  peekDouyinCookie,
} = require('./douyinAuth.cjs')
const {
  azureSpeak,
  saveVoiceSample,
  listVoiceSamples,
  deleteVoiceSample,
  readVoiceSampleDataUrl,
} = require('./ttsService.cjs')
const {
  ensureDataRoot,
  getDataRoot,
  loadSettings,
  saveSettings,
  exportDataZip,
  importDataZip,
  openDataFolder,
  migrateLegacyClones,
} = require('./dataStore.cjs')

/** @type {BrowserWindow | null} */
let mainWindow = null

const iconPath = path.join(__dirname, '../build/icon.png')

function createWindow() {
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: '直播助手',
    icon: iconPath,
    backgroundColor: '#14110e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.liveassistant.desktop')
  }

  ensureDataRoot()
  migrateLegacyClones()
  createWindow()

  ipcMain.handle('action:notify', (_event, payload) => {
    const title = payload?.title || '直播助手'
    const body = payload?.body || ''
    if (Notification.isSupported()) {
      new Notification({ title, body, icon: iconPath }).show()
    }
    return true
  })

  // 执行整蛊动作（键鼠/进程/关机等）
  ipcMain.handle('action:run', async (_event, action) => {
    try {
      const result = await executeAction(action)
      if (result?.kind === 'notify' || result?.kind === 'toast') {
        if (result.kind === 'notify' && Notification.isSupported()) {
          new Notification({
            title: '整蛊触发',
            body: result.message || '',
            icon: iconPath,
          }).show()
        }
        return { ok: true, ...result }
      }
      return { ok: true, ...result }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('action:listProcesses', async () => {
    try {
      return await listWindowProcesses()
    } catch {
      return []
    }
  })

  ipcMain.handle('dialog:openFile', async (_event, opts) => {
    const filters = opts?.filters || [{ name: '全部', extensions: ['*'] }]
    const win = BrowserWindow.fromWebContents(_event.sender) || mainWindow
    const res = await dialog.showOpenDialog(win, {
      title: opts?.title || '选择文件',
      properties: ['openFile'],
      filters,
    })
    if (res.canceled || !res.filePaths?.length) return null
    return res.filePaths[0]
  })

  // 抖音扫码/手机号登录 → 导出 Cookie
  ipcMain.handle('auth:douyinLogin', async (event, opts) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
    return openDouyinLogin(win, opts || {})
  })
  ipcMain.handle('auth:douyinLogout', async () => clearDouyinAuth())
  ipcMain.handle('auth:douyinStatus', async () => peekDouyinCookie())

  // 本地媒体转 data URL，供渲染进程播放（绕过 file:// 跨域限制）
  ipcMain.handle('media:asDataUrl', async (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') throw new Error('无效路径')
    const abs = path.resolve(filePath)
    if (!fs.existsSync(abs)) throw new Error('文件不存在')
    const buf = fs.readFileSync(abs)
    if (buf.length > 12 * 1024 * 1024) throw new Error('文件过大（>12MB）')
    const ext = path.extname(abs).toLowerCase().replace('.', '')
    const mime =
      {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        m4a: 'audio/mp4',
        flac: 'audio/flac',
        mp4: 'video/mp4',
        webm: 'audio/webm',
      }[ext] || 'application/octet-stream'
    return `data:${mime};base64,${buf.toString('base64')}`
  })

  // 微软 Azure TTS
  ipcMain.handle('tts:speak', async (_event, opts) => {
    try {
      return await azureSpeak(opts || {})
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 语音克隆样本
  ipcMain.handle('tts:saveSample', async (_event, payload) => {
    try {
      return saveVoiceSample(payload || {})
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e))
    }
  })
  ipcMain.handle('tts:listSamples', async () => listVoiceSamples())
  ipcMain.handle('tts:deleteSample', async (_event, id) => deleteVoiceSample(id))
  ipcMain.handle('tts:readSample', async (_event, id) => readVoiceSampleDataUrl(id))

  // 本机数据目录
  ipcMain.handle('data:getRoot', async () => {
    ensureDataRoot()
    return getDataRoot()
  })
  ipcMain.handle('data:loadSettings', async () => loadSettings())
  ipcMain.handle('data:saveSettings', async (_event, patch) => saveSettings(patch || {}))
  ipcMain.handle('data:openFolder', async () => openDataFolder())
  ipcMain.handle('data:exportZip', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
    try {
      return await exportDataZip(win)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('data:importZip', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
    try {
      return await importDataZip(win)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 麦克风权限（录音克隆）
  const { session } = require('electron')
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'notifications') {
      callback(true)
      return
    }
    callback(false)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
