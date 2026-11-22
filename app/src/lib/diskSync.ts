/**
 * 渲染层 ↔ 本机「文档/直播助手/settings.json」同步
 * localStorage 仍作热缓存；有 Electron 时落盘，导入导出走整夹 zip
 *
 * 注意：启动时必须先 bootstrap，再允许 flush，否则 immediate watch
 * 会把尚未灌入的空 rules 写回磁盘，冲掉玩法配置。
 */
import { DEFAULT_TTS_SETTINGS, type TtsSettings } from './tts/settings'
import { DEFAULT_ANNOUNCE_SETTINGS, type AnnounceSettings } from './tts/announce'
import {
  DEFAULT_OVERLAY_SETTINGS,
  type OverlaySettings,
} from './prank/overlaySettings'
import { EMPTY_SESSION_STATS, type SessionStats } from './sessionStats'
import { DEFAULT_REPLAY_CONFIG, type ReplayConfig } from './replay/types'
import type { GiftCatalogItem, LiveLayout, PanelFonts } from './storage'
import type { GiftDiamondOverrides } from './giftDiamondOverrides'
import type { PrankRule } from '../types'

const KEYS = {
  liveId: 'live-assistant.liveId',
  wantConnect: 'live-assistant.wantConnect',
  cookie: 'live-assistant.douyinCookie',
  rules: 'live-assistant.prankRules',
  prankMaster: 'live-assistant.prankMasterEnabled',
  layout: 'live-assistant.layout',
  giftCatalog: 'live-assistant.giftCatalog',
  giftDiamondOverrides: 'live-assistant.giftDiamondOverrides',
  panelFonts: 'live-assistant.panelFonts',
  tts: 'live-assistant.ttsSettings',
  announce: 'live-assistant.announceSettings',
  overlay: 'live-assistant.overlaySettings',
  session: 'live-assistant.sessionStats',
  replayConfig: 'live-assistant.replayConfig',
} as const

const FALLBACK_LAYOUT: LiveLayout = {
  cols: [43, 27, 30],
  leftRows: [67, 33],
  midRows: [50, 50],
  rightRows: [67, 33],
}

const FALLBACK_FONTS: PanelFonts = {
  feed: 13,
  gift: 13,
  enter: 12,
  like: 12,
  prankStats: 13,
  prankLog: 13,
}

export type DiskSettings = {
  liveId?: string
  wantConnect?: boolean
  cookie?: string
  rules?: PrankRule[]
  /** 全局整蛊总开关，默认 true */
  prankMasterEnabled?: boolean
  layout?: LiveLayout
  giftCatalog?: GiftCatalogItem[]
  /** 用户自定义礼物抖钻覆盖 */
  giftDiamondOverrides?: GiftDiamondOverrides
  panelFonts?: PanelFonts
  ttsSettings?: TtsSettings
  announceSettings?: AnnounceSettings
  overlaySettings?: OverlaySettings
  sessionStats?: SessionStats
  replayConfig?: ReplayConfig
  updatedAt?: string
}

/** 是否已完成磁盘→localStorage 灌入；未完成前禁止落盘 */
let diskHydrated = false

function setRaw(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** 启动时：磁盘 → localStorage（磁盘有值优先） */
export async function bootstrapFromDisk(): Promise<{ ok: boolean; root?: string }> {
  const api = window.liveAssistant
  if (!api?.loadDiskSettings || !api.getDataRoot) {
    // 浏览器预览：无磁盘，直接放行后续 localStorage 写入
    diskHydrated = true
    return { ok: false }
  }
  try {
    const root = await api.getDataRoot()
    const disk = (await api.loadDiskSettings()) as DiskSettings
    const hasDisk = disk && Object.keys(disk).filter((k) => k !== 'updatedAt').length > 0

    if (hasDisk) {
      if (typeof disk.liveId === 'string') setRaw(KEYS.liveId, disk.liveId)
      if (typeof disk.wantConnect === 'boolean') setRaw(KEYS.wantConnect, disk.wantConnect ? '1' : '0')
      if (typeof disk.cookie === 'string') setRaw(KEYS.cookie, disk.cookie)
      // 玩法规则：有数组就灌入（含用户清空后的 []）
      if (Array.isArray(disk.rules)) setRaw(KEYS.rules, JSON.stringify(disk.rules))
      if (typeof disk.prankMasterEnabled === 'boolean') {
        setRaw(KEYS.prankMaster, disk.prankMasterEnabled ? '1' : '0')
      }
      if (disk.layout) setRaw(KEYS.layout, JSON.stringify(disk.layout))
      if (disk.giftCatalog) setRaw(KEYS.giftCatalog, JSON.stringify(disk.giftCatalog))
      if (disk.giftDiamondOverrides) {
        setRaw(KEYS.giftDiamondOverrides, JSON.stringify(disk.giftDiamondOverrides))
      }
      if (disk.panelFonts) setRaw(KEYS.panelFonts, JSON.stringify(disk.panelFonts))
      if (disk.ttsSettings) setRaw(KEYS.tts, JSON.stringify(disk.ttsSettings))
      if (disk.announceSettings) setRaw(KEYS.announce, JSON.stringify(disk.announceSettings))
      if (disk.overlaySettings) setRaw(KEYS.overlay, JSON.stringify(disk.overlaySettings))
      if (disk.sessionStats) setRaw(KEYS.session, JSON.stringify(disk.sessionStats))
      if (disk.replayConfig) setRaw(KEYS.replayConfig, JSON.stringify(disk.replayConfig))
      diskHydrated = true
    } else {
      // 首次：把现有 localStorage（含默认玩法）灌进磁盘
      diskHydrated = true
      await flushAllToDisk()
    }
    return { ok: true, root }
  } catch (e) {
    console.warn('[diskSync] bootstrap failed', e)
    diskHydrated = true
    return { ok: false }
  }
}

/** 收集当前 localStorage → 写 settings.json（含玩法规则） */
export async function flushAllToDisk(): Promise<void> {
  const api = window.liveAssistant
  if (!api?.saveDiskSettings) return
  if (!diskHydrated) return

  const patch: DiskSettings = {
    liveId: localStorage.getItem(KEYS.liveId) || '',
    wantConnect: localStorage.getItem(KEYS.wantConnect) === '1',
    cookie: localStorage.getItem(KEYS.cookie) || '',
    rules: readJson<PrankRule[]>(KEYS.rules, []),
    // 缺省视为开启
    prankMasterEnabled:
      localStorage.getItem(KEYS.prankMaster) === null
        ? true
        : localStorage.getItem(KEYS.prankMaster) === '1',
    layout: readJson(KEYS.layout, FALLBACK_LAYOUT),
    giftCatalog: readJson(KEYS.giftCatalog, []),
    giftDiamondOverrides: readJson(KEYS.giftDiamondOverrides, {}),
    panelFonts: readJson(KEYS.panelFonts, FALLBACK_FONTS),
    ttsSettings: readJson(KEYS.tts, DEFAULT_TTS_SETTINGS),
    announceSettings: readJson(KEYS.announce, DEFAULT_ANNOUNCE_SETTINGS),
    overlaySettings: readJson(KEYS.overlay, DEFAULT_OVERLAY_SETTINGS),
    sessionStats: readJson(KEYS.session, EMPTY_SESSION_STATS),
    replayConfig: readJson(KEYS.replayConfig, DEFAULT_REPLAY_CONFIG),
  }
  await api.saveDiskSettings(patch)
}

/** 改了某一块配置后，异步整份落盘（防抖）；hydrate 完成前不写盘 */
let flushTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleFlushToDisk() {
  if (!window.liveAssistant?.saveDiskSettings) return
  if (!diskHydrated) return
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushAllToDisk()
  }, 300)
}

/** 关闭窗口前立刻落盘，取消防抖 */
export async function flushNowToDisk(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await flushAllToDisk()
}

export function isDiskHydrated() {
  return diskHydrated
}

export async function getDataRootPath(): Promise<string> {
  return (await window.liveAssistant?.getDataRoot?.()) || ''
}
