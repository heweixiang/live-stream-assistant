/** 用户自定义礼物抖钻（覆盖官方目录，防止官价/目录错误） */

const KEY = 'live-assistant.giftDiamondOverrides'

export type GiftDiamondOverrides = Record<string, number>

export function loadGiftDiamondOverrides(): GiftDiamondOverrides {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    const out: GiftDiamondOverrides = {}
    for (const [k, v] of Object.entries(parsed)) {
      const name = String(k || '').trim()
      const n = Number(v)
      if (!name || !Number.isFinite(n) || n < 0) continue
      out[name] = Math.round(n)
    }
    return out
  } catch {
    return {}
  }
}

export function saveGiftDiamondOverrides(map: GiftDiamondOverrides) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
    void import('./diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

/** 写入或清除某礼物的自定义抖钻；diamond=null 表示恢复官价 */
export function setGiftDiamondOverride(name: string, diamond: number | null): GiftDiamondOverrides {
  const key = name.trim()
  const next = { ...loadGiftDiamondOverrides() }
  if (!key) return next
  if (diamond == null || !Number.isFinite(diamond) || diamond < 0) {
    delete next[key]
  } else {
    next[key] = Math.round(diamond)
  }
  saveGiftDiamondOverrides(next)
  return next
}

export function applyGiftDiamond(
  name: string,
  baseDiamond: number,
  overrides?: GiftDiamondOverrides,
): number {
  const map = overrides || loadGiftDiamondOverrides()
  const hit = map[name.trim()]
  if (hit != null && Number.isFinite(hit) && hit >= 0) return hit
  return Math.max(0, Number(baseDiamond) || 0)
}
