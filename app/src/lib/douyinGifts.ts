/** 抖音礼物静态目录（来自 live.douyin.com/webcast/gift/list） */

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

/** 加载 public/douyin-gifts.json（全量礼物名+图标） */
export async function loadStaticGifts(): Promise<StaticGift[]> {
  if (cache) return cache
  if (loading) return loading
  loading = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}douyin-gifts.json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as CatalogFile
      const list = Array.isArray(data.gifts) ? data.gifts : []
      cache = list
        .filter((g) => g && typeof g.name === 'string' && g.name.trim())
        .map((g) => ({
          id: Number(g.id) || 0,
          name: g.name.trim(),
          diamond: Number(g.diamond) || 0,
          icon: (g.icon || '').trim(),
          panel: !!g.panel,
        }))
      return cache
    } catch (e) {
      console.warn('[douyinGifts] 静态礼物目录加载失败', e)
      cache = []
      return cache
    } finally {
      loading = null
    }
  })()
  return loading
}

export function getCachedStaticGifts(): StaticGift[] {
  return cache || []
}
