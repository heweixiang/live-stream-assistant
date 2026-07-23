/**
 * 把最新打包的 exe 同步到当前用户桌面：直播助手.exe
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const releaseDir = path.join(__dirname, '..', 'release')
const desktop = path.join(os.homedir(), 'Desktop')
const targetName = '直播助手.exe'
const targetPath = path.join(desktop, targetName)

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

const src = findLatestExe(releaseDir)
if (!src) {
  console.error('[sync-desktop] 未找到 release 下的 exe，请先完成打包')
  process.exit(1)
}

fs.mkdirSync(desktop, { recursive: true })
fs.copyFileSync(src, targetPath)
console.log(`[sync-desktop] ${src}`)
console.log(`[sync-desktop] -> ${targetPath}`)
console.log('[sync-desktop] 桌面已更新为最新版')
