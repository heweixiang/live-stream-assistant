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
  speak: ttsSpeak,
  playDataUrlNative,
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
const { isRunningAsAdmin, relaunchAsAdmin } = require('./admin.cjs')

/** @type {BrowserWindow | null} */
let mainWindow = null
/** 本会话是否已提示过非管理员 */
let adminPrompted = false

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

// 直播事件播报无需用户手势也可出声
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.liveassistant.desktop')
  }

  ensureDataRoot()
  migrateLegacyClones()
  createWindow()

  ipcMain.handle('app:isAdmin', async () => isRunningAsAdmin())
  ipcMain.handle('app:relaunchAsAdmin', async () => {
    const ok = await isRunningAsAdmin()
    if (ok) return { ok: true, already: true }
    relaunchAsAdmin()
    return { ok: true, already: false }
  })

  // 先出窗口再提示提权，避免开发态「秒退看不见界面」
  const skipPrompt = process.env.LIVE_ASSISTANT_SKIP_ADMIN_PROMPT === '1'
  const elevated = await isRunningAsAdmin()
  if (!elevated && !adminPrompted && !skipPrompt && mainWindow) {
    adminPrompted = true
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '需要管理员权限',
      message: '当前不是管理员权限',
      detail:
        '关闭进程、部分键鼠整蛊等功能在非管理员下可能失败或无效。\n建议以管理员身份重新启动本程序。',
      buttons: ['以管理员启动', '继续使用（功能可能受限）'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response === 0) {
      relaunchAsAdmin()
      return
    }
  }

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

  // TTS：melo（内置）/ azure
  ipcMain.handle('tts:speak', async (_event, opts) => {
    try {
      return await ttsSpeak(opts || {})
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 主进程本机播放 dataUrl（wav/mp3），保证能出声
  ipcMain.handle('tts:playDataUrl', async (_event, payload) => {
    try {
      const dataUrl = typeof payload === 'string' ? payload : payload?.dataUrl
      const volume = typeof payload === 'object' ? payload?.volume : 1
      return await playDataUrlNative(dataUrl, volume)
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
