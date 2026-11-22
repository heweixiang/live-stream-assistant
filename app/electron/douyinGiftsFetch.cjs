/**
 * 从抖音官方礼物列表接口拉取，写入「文档/直播助手/douyin-gifts.json」
 * 接口：https://live.douyin.com/webcast/gift/list/
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const { getDataRoot, ensureDataRoot } = require('./dataStore.cjs')

const GIFT_LIST_URL =
  'https://live.douyin.com/webcast/gift/list/' +
  '?aid=6383&app_name=douyin_web&live_id=1' +
  '&device_platform=web&language=zh-CN&cookie_enabled=true'

function catalogPath() {
  return path.join(getDataRoot(), 'douyin-gifts.json')
}

function firstUrl(img) {
  if (!img || typeof img !== 'object') return ''
  const urls = img.url_list || img.url_list_list || []
  for (const u of urls) {
    if (typeof u === 'string' && u.startsWith('http')) return u
  }
  const uri = String(img.uri || '').trim()
  if (uri.startsWith('http')) return uri
  if (uri) return `https://p3-webcast.douyinpic.com/img/${uri}~tplv-obj.png`
  return ''
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://live.douyin.com/',
        },
        timeout: 60000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpsGetJson(res.headers.location).then(resolve, reject)
          res.resume()
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8')
            resolve(JSON.parse(text))
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('拉取礼物列表超时'))
    })
  })
}

function normalizeGifts(rawList) {
  const out = []
  const seen = new Set()
  for (const g of rawList || []) {
    const name = String(g.name || g.describe || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push({
      id: Number(g.id) || 0,
      name,
      diamond: Number(g.diamond_count) || 0,
      icon: firstUrl(g.image) || firstUrl(g.icon),
      panel: !!g.is_displayed_on_panel,
    })
  }
  out.sort((a, b) => Number(b.panel) - Number(a.panel) || a.diamond - b.diamond || a.name.localeCompare(b.name, 'zh'))
  return out
}

/** 读本机缓存的官价目录（若有） */
function loadCachedOfficialGifts() {
  try {
    const file = catalogPath()
    if (!fs.existsSync(file)) return null
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const gifts = Array.isArray(data.gifts) ? data.gifts : []
    return {
      ok: true,
      source: 'cache',
      updatedAt: data.updatedAt || '',
      count: gifts.length,
      gifts,
    }
  } catch {
    return null
  }
}

/** 现场请求官方接口并落盘 */
async function fetchAndSaveOfficialGifts() {
  ensureDataRoot()
  const data = await httpsGetJson(GIFT_LIST_URL)
  const raw = (data && data.data && data.data.gifts) || []
  const gifts = normalizeGifts(raw)
  if (!gifts.length) {
    throw new Error('官方接口未返回礼物列表')
  }
  const updatedAt = new Date().toISOString().slice(0, 10)
  const payload = {
    version: 1,
    source: 'https://live.douyin.com/webcast/gift/list/',
    updatedAt,
    count: gifts.length,
    gifts,
  }
  fs.writeFileSync(catalogPath(), JSON.stringify(payload), 'utf8')
  return {
    ok: true,
    source: 'official',
    updatedAt,
    count: gifts.length,
    gifts,
  }
}

module.exports = {
  fetchAndSaveOfficialGifts,
  loadCachedOfficialGifts,
  catalogPath,
}
