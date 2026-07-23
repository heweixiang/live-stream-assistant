/**
 * 本机数据目录：文档/直播助手
 * - settings.json 等配置：导入时覆盖
 * - 录音等媒体：导入时若已存在则跳过
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { app, dialog, shell } = require('electron')

const execFileAsync = promisify(execFile)

/** 配置类相对路径（导入覆盖） */
const CONFIG_FILES = new Set([
  'settings.json',
  'voice-clones/samples.json',
  'README.txt',
])

function getDataRoot() {
  // 默认：当前用户「文档」下的「直播助手」
  return path.join(app.getPath('documents'), '直播助手')
}

function ensureDataRoot() {
  const root = getDataRoot()
  fs.mkdirSync(path.join(root, 'voice-clones'), { recursive: true })
  fs.mkdirSync(path.join(root, 'sounds'), { recursive: true })
  const readme = path.join(root, 'README.txt')
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      [
        '直播助手 本地数据目录',
        '',
        'settings.json     —— 规则 / TTS / 播报 / 布局等配置（导入时覆盖）',
        'voice-clones/     —— 语音克隆录音样本（导入时已有文件则跳过）',
        'sounds/          —— 自定义音效（导入时已有文件则跳过）',
        '',
        '可用应用内「导出数据包」打成 zip，或「导入数据包」合并回来。',
        '',
      ].join('\n'),
      'utf8',
    )
  }
  return root
}

function readJson(rel, fallback) {
  const root = ensureDataRoot()
  const abs = path.join(root, rel)
  try {
    if (!fs.existsSync(abs)) return fallback
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(rel, data) {
  const root = ensureDataRoot()
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(data, null, 2), 'utf8')
  return abs
}

function loadSettings() {
  return readJson('settings.json', {})
}

function saveSettings( partialOrFull) {
  const prev = loadSettings()
  const next = { ...prev, ...partialOrFull, updatedAt: new Date().toISOString() }
  writeJson('settings.json', next)
  return next
}

function clonesDir() {
  return path.join(ensureDataRoot(), 'voice-clones')
}

function psEscape(s) {
  return String(s ?? '').replace(/'/g, "''")
}

function walkFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name)
    const st = fs.statSync(abs)
    if (st.isDirectory()) walkFiles(abs, base, out)
    else out.push(path.relative(base, abs).replace(/\\/g, '/'))
  }
  return out
}

function isConfigRel(rel) {
  const n = rel.replace(/\\/g, '/')
  if (CONFIG_FILES.has(n)) return true
  if (n.endsWith('.json') && !n.includes('/')) return true
  if (n.startsWith('config/') && n.endsWith('.json')) return true
  return false
}

/**
 * 合并源目录到数据目录
 * @returns {{ overwritten: string[], skipped: string[], added: string[] }}
 */
function mergeFromDir(srcRoot) {
  const destRoot = ensureDataRoot()
  const result = { overwritten: [], skipped: [], added: [] }
  const files = walkFiles(srcRoot)
  for (const rel of files) {
    const from = path.join(srcRoot, rel)
    const to = path.join(destRoot, rel)
    const conf = isConfigRel(rel)
    const existed = fs.existsSync(to)
    if (existed && !conf) {
      result.skipped.push(rel)
      continue
    }
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    if (existed) result.overwritten.push(rel)
    else result.added.push(rel)
  }
  return result
}

async function exportDataZip(win) {
  const root = ensureDataRoot()
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '导出直播助手数据包',
    defaultPath: path.join(app.getPath('documents'), `直播助手备份-${stamp}.zip`),
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })
  if (canceled || !filePath) return { ok: false, canceled: true }

  // Windows：PowerShell 压缩「直播助手」目录内容
  const out = filePath.toLowerCase().endsWith('.zip') ? filePath : `${filePath}.zip`
  if (fs.existsSync(out)) fs.unlinkSync(out)
  const script = `Compress-Archive -Path '${psEscape(root)}\\*' -DestinationPath '${psEscape(out)}' -Force`
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout: 120000 },
  )
  return { ok: true, path: out }
}

async function importDataZip(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '导入直播助手数据包',
    properties: ['openFile'],
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })
  if (canceled || !filePaths?.length) return { ok: false, canceled: true }

  const zipPath = filePaths[0]
  const tmp = path.join(os.tmpdir(), `live-assistant-import-${Date.now()}`)
  fs.mkdirSync(tmp, { recursive: true })
  try {
    const script = `Expand-Archive -LiteralPath '${psEscape(zipPath)}' -DestinationPath '${psEscape(tmp)}' -Force`
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 120000 },
    )

    // zip 可能是「直播助手/*」或直接打在根上；若只有一层子目录且像数据包，则下钻
    let src = tmp
    const entries = fs.readdirSync(tmp)
    if (entries.length === 1) {
      const only = path.join(tmp, entries[0])
      if (fs.statSync(only).isDirectory()) {
        const hasSettings =
          fs.existsSync(path.join(only, 'settings.json')) ||
          fs.existsSync(path.join(only, 'voice-clones'))
        if (hasSettings) src = only
      }
    }

    const merge = mergeFromDir(src)
    return { ok: true, ...merge, path: zipPath }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

function openDataFolder() {
  const root = ensureDataRoot()
  return shell.openPath(root)
}

/** 从旧版 userData/voice-clones 迁一次 */
function migrateLegacyClones() {
  try {
    const legacy = path.join(app.getPath('userData'), 'voice-clones')
    const dest = clonesDir()
    if (!fs.existsSync(legacy)) return
    for (const name of fs.readdirSync(legacy)) {
      const from = path.join(legacy, name)
      const to = path.join(dest, name)
      if (!fs.existsSync(from) || fs.existsSync(to)) continue
      if (fs.statSync(from).isFile()) fs.copyFileSync(from, to)
    }
  } catch {
    // ignore
  }
}

module.exports = {
  getDataRoot,
  ensureDataRoot,
  loadSettings,
  saveSettings,
  readJson,
  writeJson,
  clonesDir,
  exportDataZip,
  importDataZip,
  openDataFolder,
  migrateLegacyClones,
}
