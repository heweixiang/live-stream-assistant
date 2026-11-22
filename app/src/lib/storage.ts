import type { PrankRule } from '../types'
import { loadDefaultRules, migrateRules } from './prank/migrate'
import { loadTtsSettings, type TtsSettings } from './tts/settings'
import { loadAnnounceSettings, type AnnounceSettings } from './tts/announce'

const LIVE_ID_KEY = 'live-assistant.liveId'
const WANT_CONNECT_KEY = 'live-assistant.wantConnect'
const COOKIE_KEY = 'live-assistant.douyinCookie'
const RULES_KEY = 'live-assistant.prankRules'
const LAYOUT_KEY = 'live-assistant.layout'

/** 监听页可拖拽布局（百分比） */
export type LiveLayout = {
  /** 左 / 中 / 右 列宽 % */
  cols: [number, number, number]
  /** 左列：互动 / 礼物 行高 % */
  leftRows: [number, number]
  /** 中列：进场 / 点赞 行高 % */
  midRows: [number, number]
  /** 右列：统计 / 日志 行高 % */
  rightRows: [number, number]
}

export const DEFAULT_LAYOUT: LiveLayout = {
  cols: [43, 27, 30],
  leftRows: [67, 33],
  midRows: [50, 50],
  rightRows: [67, 33],
}

function clampPair(a: number, b: number, min = 15): [number, number] {
  let x = Number.isFinite(a) ? a : DEFAULT_LAYOUT.leftRows[0]
  let y = Number.isFinite(b) ? b : 100 - x
  if (x < min) {
    x = min
    y = 100 - min
  }
  if (y < min) {
    y = min
    x = 100 - min
  }
  const sum = x + y
  if (Math.abs(sum - 100) > 0.5) {
    x = (x / sum) * 100
    y = 100 - x
  }
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10]
}

function clampTriple(vals: number[], min = 12): [number, number, number] {
  let [a, b, c] = vals.map((v, i) =>
    Number.isFinite(v) ? v : DEFAULT_LAYOUT.cols[i as 0 | 1 | 2],
  ) as [number, number, number]
  a = Math.max(min, a)
  b = Math.max(min, b)
  c = Math.max(min, c)
  const sum = a + b + c
  a = (a / sum) * 100
  b = (b / sum) * 100
  c = 100 - a - b
  return [Math.round(a * 10) / 10, Math.round(b * 10) / 10, Math.round(c * 10) / 10]
}

export function loadLayout(): LiveLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) {
      return {
        cols: [...DEFAULT_LAYOUT.cols] as LiveLayout['cols'],
        leftRows: [...DEFAULT_LAYOUT.leftRows] as LiveLayout['leftRows'],
        midRows: [...DEFAULT_LAYOUT.midRows] as LiveLayout['midRows'],
        rightRows: [...DEFAULT_LAYOUT.rightRows] as LiveLayout['rightRows'],
      }
    }
    const parsed = JSON.parse(raw) as Partial<LiveLayout>
    return {
      cols: clampTriple(parsed.cols || DEFAULT_LAYOUT.cols),
      leftRows: clampPair(parsed.leftRows?.[0] ?? 67, parsed.leftRows?.[1] ?? 33),
      midRows: clampPair(parsed.midRows?.[0] ?? 50, parsed.midRows?.[1] ?? 50),
      rightRows: clampPair(parsed.rightRows?.[0] ?? 67, parsed.rightRows?.[1] ?? 33),
    }
  } catch {
    return {
      cols: [...DEFAULT_LAYOUT.cols] as LiveLayout['cols'],
      leftRows: [...DEFAULT_LAYOUT.leftRows] as LiveLayout['leftRows'],
      midRows: [...DEFAULT_LAYOUT.midRows] as LiveLayout['midRows'],
      rightRows: [...DEFAULT_LAYOUT.rightRows] as LiveLayout['rightRows'],
    }
  }
}

export function saveLayout(layout: LiveLayout) {
  try {
    localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({
        cols: clampTriple(layout.cols),
        leftRows: clampPair(layout.leftRows[0], layout.leftRows[1]),
        midRows: clampPair(layout.midRows[0], layout.midRows[1]),
        rightRows: clampPair(layout.rightRows[0], layout.rightRows[1]),
      }),
    )
    void import('./diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

export function loadLiveId(): string {
  try {
    return localStorage.getItem(LIVE_ID_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

export function saveLiveId(liveId: string) {
  try {
    const v = liveId.trim()
    if (v) localStorage.setItem(LIVE_ID_KEY, v)
    else localStorage.removeItem(LIVE_ID_KEY)
    void import('./diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

export function loadWantConnect(): boolean {
  try {
    return localStorage.getItem(WANT_CONNECT_KEY) === '1'
  } catch {
    return false
  }
}

export function saveWantConnect(want: boolean) {
  try {
    localStorage.setItem(WANT_CONNECT_KEY, want ? '1' : '0')
    void import('./diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

export function loadCookie(): string {
  try {
    return localStorage.getItem(COOKIE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveCookie(cookie: string) {
  try {
    const v = cookie.trim()
    if (v) localStorage.setItem(COOKIE_KEY, v)
    else localStorage.removeItem(COOKIE_KEY)
    void import('./diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

export function loadRules(): PrankRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY)
    if (!raw) return loadDefaultRules()
    const parsed = JSON.parse(raw)
    const migrated = migrateRules(parsed)
    if (!migrated?.length) return loadDefaultRules()
    return migrated
  } catch {
    return loadDefaultRules()
  }
}

/** 玩法规则持久化：localStorage + 文档/直播助手/settings.json */
export function saveRules(rules: PrankRule[]) {
  try {
    // 去掉 Vue Proxy，避免序列化异常
    const plain = JSON.parse(JSON.stringify(rules)) as PrankRule[]
    localStorage.setItem(RULES_KEY, JSON.stringify(plain))
    void import('./diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

const PRANK_MASTER_KEY = 'live-assistant.prankMasterEnabled'

/** 全局整蛊总开关；缺省开启 */
export function loadPrankMasterEnabled(): boolean {
  try {
    const raw = localStorage.getItem(PRANK_MASTER_KEY)
    if (raw === null) return true
    return raw === '1' || raw === 'true'
  } catch {
    return true
  }
}

export function savePrankMasterEnabled(on: boolean) {
  try {
    localStorage.setItem(PRANK_MASTER_KEY, on ? '1' : '0')
    void import('./diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

const GIFT_CATALOG_KEY = 'live-assistant.giftCatalog'

/** 本地日历日 YYYY-MM-DD，用于「今日收到」 */
export function giftCountDayKey(ts = Date.now()): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export type GiftCatalogItem = {
  name: string
  icon?: string
  /** 所有天累计收到次数（= sum(daily)） */
  count: number
  /** 今日收到次数 */
  todayCount?: number
  /** todayCount 所属日期 */
  countDay?: string
  /** 按日明细 YYYY-MM-DD → 次数 */
  daily?: Record<string, number>
  lastAt: number
}

function sumDaily(daily: Record<string, number>): number {
  let s = 0
  for (const v of Object.values(daily)) s += Math.max(0, Number(v) || 0)
  return s
}

function normalizeGiftCatalogItem(
  g: Partial<GiftCatalogItem> & { name?: string; totalCount?: number },
): GiftCatalogItem | null {
  const name = String(g?.name || '').trim()
  if (!name) return null
  const today = giftCountDayKey()
  const countDay = String(g.countDay || '').trim()
  const daily: Record<string, number> = {}

  if (g.daily && typeof g.daily === 'object') {
    for (const [k, v] of Object.entries(g.daily)) {
      const day = String(k || '').trim()
      const n = Math.max(0, Number(v) || 0)
      if (day && n > 0) daily[day] = n
    }
  }

  if (!Object.keys(daily).length) {
    // 从旧字段迁入按日明细
    if (g.totalCount != null || g.todayCount != null) {
      const total = Math.max(0, Number(g.totalCount ?? g.count) || 0)
      const todayN = countDay === today ? Math.max(0, Number(g.todayCount) || 0) : 0
      if (todayN > 0) daily[today] = todayN
      const rest = Math.max(0, total - todayN)
      if (rest > 0) daily['1970-01-01'] = rest // 无法还原日期的历史累计
    } else if (countDay === today) {
      const c = Math.max(0, Number(g.count) || 0)
      if (c > 0) daily[today] = c
    } else if (countDay) {
      const c = Math.max(0, Number(g.count) || 0)
      if (c > 0) daily[countDay] = c
    } else {
      const c = Math.max(0, Number(g.count) || 0)
      if (c > 0) daily['1970-01-01'] = c
    }
  }

  const todayCount = daily[today] || 0
  const totalCount = sumDaily(daily)
  return {
    name,
    icon: g.icon || '',
    count: totalCount,
    todayCount,
    countDay: today,
    daily,
    lastAt: Number(g.lastAt) || 0,
  }
}

export function loadGiftCatalog(): GiftCatalogItem[] {
  try {
    const raw = localStorage.getItem(GIFT_CATALOG_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as GiftCatalogItem[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((g) => normalizeGiftCatalogItem(g))
      .filter((g): g is GiftCatalogItem => !!g)
  } catch {
    return []
  }
}

export function saveGiftCatalog(list: GiftCatalogItem[]) {
  try {
    const normalized = list
      .map((g) => normalizeGiftCatalogItem(g))
      .filter((g): g is GiftCatalogItem => !!g)
      .map((g) => ({
        name: g.name,
        icon: g.icon || '',
        count: g.count,
        todayCount: g.todayCount || 0,
        countDay: giftCountDayKey(),
        daily: g.daily || {},
        lastAt: g.lastAt || 0,
        totalCount: g.count,
      }))
    localStorage.setItem(GIFT_CATALOG_KEY, JSON.stringify(normalized.slice(0, 2000)))
    void import('./diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

/** 收到礼物时写入目录（按名称聚合）；有图标时补全、不覆盖已有图为空 */
export function upsertGiftCatalog(
  list: GiftCatalogItem[],
  gift: { name?: string; icon?: string; count?: number; ts?: number },
): GiftCatalogItem[] {
  const name = (gift.name || '').trim()
  if (!name) return list
  const add = Math.max(0, Number(gift.count) || 0)
  const ts = gift.ts || Date.now()
  const day = giftCountDayKey(ts)
  const icon = (gift.icon || '').trim()
  const next = list
    .map((g) => normalizeGiftCatalogItem(g))
    .filter((g): g is GiftCatalogItem => !!g)
  const i = next.findIndex((g) => g.name === name)
  if (i >= 0) {
    const daily = { ...(next[i].daily || {}) }
    if (add > 0) daily[day] = (daily[day] || 0) + add
    const todayCount = daily[giftCountDayKey()] || 0
    next[i] = {
      ...next[i],
      daily,
      count: sumDaily(daily),
      todayCount,
      countDay: giftCountDayKey(),
      lastAt: Math.max(next[i].lastAt, ts),
      icon: icon.startsWith('http') ? icon : next[i].icon || icon,
    }
  } else {
    const daily: Record<string, number> = add > 0 ? { [day]: add } : {}
    next.unshift({
      name,
      icon,
      count: add,
      todayCount: day === giftCountDayKey() ? add : 0,
      countDay: giftCountDayKey(),
      daily,
      lastAt: ts,
    })
  }
  next.sort((a, b) => b.lastAt - a.lastAt || b.count - a.count)
  return next.slice(0, 2000)
}

export type GiftClearRangeMode = 'today' | '7d' | '30d' | 'all' | 'custom'

/** 按日期范围清零收到次数 */
export function clearGiftCountsByRange(
  list: GiftCatalogItem[],
  opts: { mode: GiftClearRangeMode; from?: string; to?: string },
): GiftCatalogItem[] {
  const today = giftCountDayKey()
  let from = ''
  let to = ''
  if (opts.mode === 'today') {
    from = to = today
  } else if (opts.mode === '7d' || opts.mode === '30d') {
    const days = opts.mode === '7d' ? 6 : 29
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - days)
    from = giftCountDayKey(d.getTime())
    to = today
  } else if (opts.mode === 'custom') {
    from = String(opts.from || '').trim()
    to = String(opts.to || '').trim() || from
    if (!from) return list.map((g) => normalizeGiftCatalogItem(g)!).filter(Boolean)
  } else {
    // all
    return list.map((g) => {
      const n = normalizeGiftCatalogItem(g)!
      return { ...n, count: 0, todayCount: 0, daily: {}, countDay: today }
    })
  }

  return list
    .map((g) => normalizeGiftCatalogItem(g))
    .filter((g): g is GiftCatalogItem => !!g)
    .map((g) => {
      const daily = { ...(g.daily || {}) }
      for (const day of Object.keys(daily)) {
        if (day >= from && day <= to) delete daily[day]
      }
      return {
        ...g,
        daily,
        count: sumDaily(daily),
        todayCount: daily[today] || 0,
        countDay: today,
      }
    })
}

const PANEL_FONTS_KEY = 'live-assistant.panelFonts'

export type PanelFontKey = 'feed' | 'gift' | 'enter' | 'like' | 'prankStats' | 'prankLog'

export type PanelFonts = Record<PanelFontKey, number>

/** 各面板默认字号（px），与当前视觉预设一致 */
export const DEFAULT_PANEL_FONTS: PanelFonts = {
  feed: 13,
  gift: 13,
  enter: 12,
  like: 12,
  prankStats: 13,
  prankLog: 13,
}

function clampFont(n: unknown, fallback: number) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.round(Math.min(22, Math.max(10, v)))
}

export function loadPanelFonts(): PanelFonts {
  try {
    const raw = localStorage.getItem(PANEL_FONTS_KEY)
    if (!raw) return { ...DEFAULT_PANEL_FONTS }
    const parsed = JSON.parse(raw) as Partial<PanelFonts>
    return {
      feed: clampFont(parsed.feed, DEFAULT_PANEL_FONTS.feed),
      gift: clampFont(parsed.gift, DEFAULT_PANEL_FONTS.gift),
      enter: clampFont(parsed.enter, DEFAULT_PANEL_FONTS.enter),
      like: clampFont(parsed.like, DEFAULT_PANEL_FONTS.like),
      prankStats: clampFont(parsed.prankStats, DEFAULT_PANEL_FONTS.prankStats),
      prankLog: clampFont(parsed.prankLog, DEFAULT_PANEL_FONTS.prankLog),
    }
  } catch {
    return { ...DEFAULT_PANEL_FONTS }
  }
}

export function savePanelFonts(fonts: PanelFonts) {
  try {
    localStorage.setItem(
      PANEL_FONTS_KEY,
      JSON.stringify({
        feed: clampFont(fonts.feed, DEFAULT_PANEL_FONTS.feed),
        gift: clampFont(fonts.gift, DEFAULT_PANEL_FONTS.gift),
        enter: clampFont(fonts.enter, DEFAULT_PANEL_FONTS.enter),
        like: clampFont(fonts.like, DEFAULT_PANEL_FONTS.like),
        prankStats: clampFont(fonts.prankStats, DEFAULT_PANEL_FONTS.prankStats),
        prankLog: clampFont(fonts.prankLog, DEFAULT_PANEL_FONTS.prankLog),
      }),
    )
    void import('./diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

/** 导出全部本地持久化配置（含 Cookie，仅本机备份用） */
export type AppConfigExport = {
  version: 1
  exportedAt: string
  liveId: string
  wantConnect: boolean
  cookie: string
  rules: PrankRule[]
  prankMasterEnabled: boolean
  layout: LiveLayout
  giftCatalog: GiftCatalogItem[]
  panelFonts: PanelFonts
  ttsSettings: TtsSettings
  announceSettings: AnnounceSettings
}

export function buildAppConfigExport(): AppConfigExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    liveId: loadLiveId(),
    wantConnect: loadWantConnect(),
    cookie: loadCookie(),
    rules: loadRules(),
    prankMasterEnabled: loadPrankMasterEnabled(),
    layout: loadLayout(),
    giftCatalog: loadGiftCatalog(),
    panelFonts: loadPanelFonts(),
    ttsSettings: loadTtsSettings(),
    announceSettings: loadAnnounceSettings(),
  }
}

/** 触发浏览器下载 JSON 配置文件 */
export function downloadAppConfig() {
  const data = buildAppConfigExport()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  a.href = url
  a.download = `直播助手配置-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
  return data
}
