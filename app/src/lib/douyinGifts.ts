/** 抖音礼物静态目录（官方 webcast/gift/list → 本机缓存 / 打包内置 json） */

export type StaticGift = {
  id: number
  name: string
  diamond: number
  icon: string
  panel: boolean
}

type CatalogFile = {
  version: number
  updatedAt?: string
  count: number
  gifts: StaticGift[]
}

let cache: StaticGift[] | null = null
let loading: Promise<StaticGift[]> | null = null
let catalogUpdatedAt = ''
let catalogSource = ''

function mapGifts(list: StaticGift[]): StaticGift[] {
  return list
    .filter((g) => g && typeof g.name === 'string' && g.name.trim())
    .map((g) => ({
      id: Number(g.id) || 0,
      name: g.name.trim(),
      diamond: Number(g.diamond) || 0,
      icon: (g.icon || '').trim(),
      panel: !!g.panel,
    }))
}

function applyCatalog(gifts: StaticGift[], meta?: { updatedAt?: string; source?: string }) {
  cache = mapGifts(gifts)
  catalogUpdatedAt = String(meta?.updatedAt || '')
  catalogSource = String(meta?.source || '')
  return cache
}

/** 用官方/缓存结果直接写入内存目录 */
export function setStaticGiftsCache(
  gifts: StaticGift[],
  meta?: { updatedAt?: string; source?: string },
) {
  return applyCatalog(gifts, meta)
}

export function getCatalogSource() {
  return catalogSource
}

/**
 * 加载礼物目录：
 * 1) 本机「文档/直播助手/douyin-gifts.json」（官方接口缓存）
 * 2) 打包内置 public/douyin-gifts.json
 */
export async function loadStaticGifts(opts?: { force?: boolean }): Promise<StaticGift[]> {
  if (!opts?.force && cache) return cache
  if (!opts?.force && loading) return loading
  if (opts?.force) {
    cache = null
    loading = null
  }
  loading = (async () => {
    try {
      const api = window.liveAssistant
      if (api?.loadCachedDouyinGifts) {
        const cached = await api.loadCachedDouyinGifts()
        if (cached?.ok && Array.isArray(cached.gifts) && cached.gifts.length) {
          return applyCatalog(cached.gifts, {
            updatedAt: cached.updatedAt,
            source: cached.source || 'cache',
          })
        }
      }
      const bust = opts?.force ? `?t=${Date.now()}` : catalogUpdatedAt ? `?v=${catalogUpdatedAt}` : ''
      const res = await fetch(`${import.meta.env.BASE_URL}douyin-gifts.json${bust}`, {
        cache: opts?.force ? 'no-store' : 'default',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as CatalogFile
      return applyCatalog(Array.isArray(data.gifts) ? data.gifts : [], {
        updatedAt: data.updatedAt,
        source: 'bundled',
      })
    } catch (e) {
      console.warn('[douyinGifts] 静态礼物目录加载失败', e)
      if (!cache) cache = []
      return cache
    } finally {
      loading = null
    }
  })()
  return loading
}

/** 现场拉取官方接口并更新内存目录 */
export async function syncOfficialGiftsFromApi(): Promise<{
  ok: boolean
  count: number
  updatedAt: string
  source: string
  error?: string
}> {
  const api = window.liveAssistant
  if (!api?.fetchDouyinGifts) {
    // 非桌面端：只能强制重载内置 json
    const list = await loadStaticGifts({ force: true })
    return {
      ok: true,
      count: list.length,
      updatedAt: catalogUpdatedAt,
      source: 'bundled',
      error: '当前非桌面客户端，已重载内置目录（非现场官方接口）',
    }
  }
  const res = await api.fetchDouyinGifts()
  if (!res?.ok || !Array.isArray(res.gifts)) {
    return {
      ok: false,
      count: 0,
      updatedAt: '',
      source: '',
      error: res?.error || '官方礼物列表拉取失败',
    }
  }
  applyCatalog(res.gifts, { updatedAt: res.updatedAt, source: res.source || 'official' })
  return {
    ok: true,
    count: res.count || res.gifts.length,
    updatedAt: res.updatedAt || '',
    source: res.source || 'official',
  }
}

export function getCachedStaticGifts(): StaticGift[] {
  return cache || []
}

export function getCatalogUpdatedAt(): string {
  return catalogUpdatedAt
}
