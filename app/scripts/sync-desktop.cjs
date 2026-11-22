/**
 * 把最新打包的 exe 同步到当前用户桌面：直播助手.exe
 * 若桌面文件被占用（正在运行），则写为 直播助手-更新.exe
 * 同时写入 meloWorkspace.json，便于便携版自动找到 MeloTTS 工程根
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const releaseDir = path.join(__dirname, '..', 'release')
const workspaceRoot = path.resolve(__dirname, '../..')
const desktop = path.join(os.homedir(), 'Desktop')
const targetName = '直播助手.exe'
const targetPath = path.join(desktop, targetName)
const fallbackPath = path.join(desktop, '直播助手-更新.exe')
const dataRoot = path.join(os.homedir(), 'Documents', '直播助手')

function findLatestExe(dir) {
  if (!fs.existsSync(dir)) return null
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.exe') && !f.includes('Setup'))
    .map((f) => {
      const p = path.join(dir, f)
      return { p, m: fs.statSync(p).mtimeMs, size: fs.statSync(p).size }
    })
    .filter((x) => x.size > 1024 * 1024)
    .sort((a, b) => b.m - a.m)
  return files[0]?.p || null
}

function writeMeloHint() {
  try {
    const script = path.join(workspaceRoot, 'core', 'tts_server.py')
    const py = path.join(workspaceRoot, '.venv-melo', 'Scripts', 'python.exe')
    const model = path.join(workspaceRoot, 'models', 'melo-zh', 'checkpoint.pth')
    if (!fs.existsSync(script) || !fs.existsSync(py) || !fs.existsSync(model)) {
      console.warn('[sync-desktop] 跳过 meloWorkspace：工程 TTS 环境不完整')
      return
    }
    fs.mkdirSync(dataRoot, { recursive: true })
    const hintPath = path.join(dataRoot, 'meloWorkspace.json')
    fs.writeFileSync(
      hintPath,
      JSON.stringify({ meloRoot: workspaceRoot, updatedAt: new Date().toISOString() }, null, 2),
      'utf8',
    )
    const settingsPath = path.join(dataRoot, 'settings.json')
    let settings = {}
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) || {}
      } catch {
        settings = {}
      }
    }
    settings.meloRoot = workspaceRoot
    settings.updatedAt = new Date().toISOString()
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
    console.log(`[sync-desktop] MeloTTS 工程路径已记录：${workspaceRoot}`)
  } catch (e) {
    console.warn('[sync-desktop] 写入 meloWorkspace 失败：', e.message || e)
  }
}

const src = findLatestExe(releaseDir)
if (!src) {
  console.error('[sync-desktop] 未找到 release 下的 exe，请先完成打包')
  process.exit(1)
}

fs.mkdirSync(desktop, { recursive: true })
writeMeloHint()

function copyTo(dest) {
  fs.copyFileSync(src, dest)
  console.log(`[sync-desktop] ${src}`)
  console.log(`[sync-desktop] -> ${dest}`)
}

try {
  copyTo(targetPath)
  console.log('[sync-desktop] 桌面已更新为最新版')
} catch (e) {
  const code = e && e.code
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    try {
      copyTo(fallbackPath)
      console.warn('[sync-desktop] 桌面 直播助手.exe 正在运行，无法覆盖')
      console.warn(
        '[sync-desktop] 已另存为：直播助手-更新.exe —— 请先关掉旧版，再双击这个新文件，或删掉旧的后把它改名为 直播助手.exe',
      )
      process.exit(0)
    } catch (e2) {
      console.error('[sync-desktop] 备用复制也失败：', e2.message || e2)
      process.exit(1)
    }
  }
  console.error('[sync-desktop] 复制失败：', e.message || e)
  process.exit(1)
}
