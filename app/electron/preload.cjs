const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('liveAssistant', {
  notify: (title, body) => ipcRenderer.invoke('action:notify', { title, body }),
  /** 主进程执行键鼠/系统动作 */
  runAction: (action) => ipcRenderer.invoke('action:run', action),
  /** 列出带窗口的进程，供「关闭某程序」点选 */
  listProcesses: () => ipcRenderer.invoke('action:listProcesses'),
  /** 选择本地文件（音效等） */
  openFile: (opts) => ipcRenderer.invoke('dialog:openFile', opts),
  /** 本地媒体 → data URL */
  mediaAsDataUrl: (filePath) => ipcRenderer.invoke('media:asDataUrl', filePath),
  /** TTS 合成 → data URL（melo / azure） */
  ttsSpeak: (opts) => ipcRenderer.invoke('tts:speak', opts),
  /** 主进程本机播放，避免渲染进程 Audio 无声 */
  playAudioDataUrl: (dataUrl, volume) =>
    ipcRenderer.invoke('tts:playDataUrl', { dataUrl, volume }),
  saveVoiceSample: (payload) => ipcRenderer.invoke('tts:saveSample', payload),
  listVoiceSamples: () => ipcRenderer.invoke('tts:listSamples'),
  deleteVoiceSample: (id) => ipcRenderer.invoke('tts:deleteSample', id),
  readVoiceSample: (id) => ipcRenderer.invoke('tts:readSample', id),
  /** 本机「文档/直播助手」数据目录 */
  getDataRoot: () => ipcRenderer.invoke('data:getRoot'),
  loadDiskSettings: () => ipcRenderer.invoke('data:loadSettings'),
  saveDiskSettings: (patch) => ipcRenderer.invoke('data:saveSettings', patch),
  openDataFolder: () => ipcRenderer.invoke('data:openFolder'),
  exportDataZip: () => ipcRenderer.invoke('data:exportZip'),
  importDataZip: () => ipcRenderer.invoke('data:importZip'),
  /** 打开抖音登录窗（扫码/手机号），成功返回 Cookie */
  douyinLogin: (opts) => ipcRenderer.invoke('auth:douyinLogin', opts || {}),
  /** 清除本机抖音登录会话 */
  douyinLogout: () => ipcRenderer.invoke('auth:douyinLogout'),
  /** 查看当前分区是否已登录 */
  douyinAuthStatus: () => ipcRenderer.invoke('auth:douyinStatus'),
  /** 是否以管理员运行 */
  isAdmin: () => ipcRenderer.invoke('app:isAdmin'),
  /** 以管理员重新启动（会弹 UAC） */
  relaunchAsAdmin: () => ipcRenderer.invoke('app:relaunchAsAdmin'),
  platform: process.platform,
})
