<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Splitpanes, Pane } from 'splitpanes'
import type { SplitpanesResizedPayload } from 'splitpanes'
import { useLiveSocket } from './composables/useLiveSocket'
import {
  downloadAppConfig,
  loadCookie,
  loadGiftCatalog,
  loadLayout,
  loadLiveId,
  loadRules,
  saveCookie,
  saveGiftCatalog,
  saveLayout,
  saveLiveId,
  savePanelFonts,
  saveRules,
  saveWantConnect,
  upsertGiftCatalog,
  type GiftCatalogItem,
  type LiveLayout,
} from './lib/storage'
import { loadStaticGifts, type StaticGift } from './lib/douyinGifts'
import { useGiftDiamondOverrides } from './lib/useGiftDiamondOverrides'
import type { FiredAction } from './types'
import EventFeed from './components/EventFeed.vue'
import EnterLikeBoard from './components/EnterLikeBoard.vue'
import GiftPanel from './components/GiftPanel.vue'
import PrankLog from './components/PrankLog.vue'
import PrankStats from './components/PrankStats.vue'
import RuleStudio from './components/RuleStudio.vue'
import SettingsPage from './components/SettingsPage.vue'
import ReplayPage from './components/ReplayPage.vue'
import ActionToast from './components/ActionToast.vue'
import StatsBar from './components/StatsBar.vue'
import { matchRules } from './lib/prank/rulesEngine'
import { runRuleEffects } from './lib/prank/actionRunner'
import { ReplayRecorder } from './lib/replay/recorder'
import { bindReplayRecorder } from './lib/replay/activeRecorder'
import { persistReplaySession } from './lib/replay/persist'
import { loadReplayConfig } from './lib/replay/settings'
import type { ReplayConfig } from './lib/replay/types'
import { tryAnnounceEvent } from './lib/tts/announce'
import { clearLikeBucket, ingestLike, setLikeSettleHandler } from './lib/likeBatch'
import {
  clearGiftBucket,
  ingestGift,
  setGiftSettleHandler,
} from './lib/giftBatch'
import { stopSpeak } from './lib/tts/speak'
import { reloadPanelFontsFromStorage, usePanelFonts } from './composables/usePanelFonts'
import { reloadPrankMasterFromStorage, usePrankMaster } from './composables/usePrankMaster'
import {
  buildOverlayPayload,
  loadOverlaySettings,
} from './lib/prank/overlaySettings'
import {
  appendFired,
  clearSessionStats,
  loadSessionStats,
  saveSessionStats,
  type SessionStats,
} from './lib/sessionStats'

const RECONNECT_MS = 60_000

type PageId = 'live' | 'rules' | 'replay' | 'settings'

function cookieLooksLoggedIn(c: string) {
  return /(?:^|;\s*)(sessionid|sid_tt|uid_tt|sid_guard)=/i.test(c || '')
}

const {
  coreOnline,
  roomState,
  error,
  events,
  lastEvent,
  clearEvents,
  restoreSessionTotals,
  connectRoom,
  disconnectRoom,
  chatTotal,
  giftTotal,
  enterTotal,
  onlineCount,
  onlineText,
  likeTotal,
  likeText,
} = useLiveSocket()

const page = ref<PageId>('live')
const rules = ref(loadRules())
const session = ref<SessionStats>(loadSessionStats())
const firedActions = computed(() => session.value.firedActions)
const ruleCounts = computed(() => session.value.ruleCounts)
const toast = ref<FiredAction | null>(null)
const liveId = ref(loadLiveId())
const cookie = ref(loadCookie())
const showCookie = ref(false)
const loggingIn = ref(false)
const layout = ref<LiveLayout>(loadLayout())
const giftCatalog = ref<GiftCatalogItem[]>(loadGiftCatalog())
/** 抖音全量礼物静态目录（名+图标），规则页点选用 */
const staticGifts = ref<StaticGift[]>([])
const { overrides: giftDiamondOverrides, resolve: resolveGiftDiamond, reload: reloadGiftDiamondOverrides } =
  useGiftDiamondOverrides()
const { fonts: panelFonts } = usePanelFonts()
const { prankMasterEnabled } = usePrankMaster()
const replayCfg = ref<ReplayConfig>(loadReplayConfig())
const replayRecorder = new ReplayRecorder(replayCfg.value)
bindReplayRecorder(replayRecorder)
/** 点「开播」后为 true；手动「下播」清掉。意外断线保持 true 以便自动重连 */
const wantConnect = ref(false)
saveWantConnect(false)
const connectHint = ref('')
const hasTriedConnect = ref(false)
/** 是否管理员；null=检测中 */
const isAdmin = ref<boolean | null>(null)

const gifts = computed(() => events.value.filter((e) => e.type === 'gift'))
const enters = computed(() => events.value.filter((e) => e.type === 'enter'))
const likes = computed(() => events.value.filter((e) => e.type === 'like'))
/** 规则页礼物选项：静态目录 + 历史收到次数 + 用户改价 */
const giftOptions = computed(() => {
  void giftDiamondOverrides.value
  const map = new Map<
    string,
    { name: string; icon?: string; count?: number; panel?: boolean; diamond?: number }
  >()
  for (const g of staticGifts.value) {
    map.set(g.name, {
      name: g.name,
      icon: g.icon,
      count: 0,
      panel: g.panel,
      diamond: resolveGiftDiamond(g.name, g.diamond),
    })
  }
  for (const g of giftCatalog.value) {
    const prev = map.get(g.name)
    const base = prev?.diamond ?? 0
    map.set(g.name, {
      name: g.name,
      icon: g.icon || prev?.icon,
      count: g.count,
      panel: prev?.panel,
      diamond: resolveGiftDiamond(g.name, base),
    })
  }
  // 本场事件只补图标；次数已写入 giftCatalog，避免重复累加
  for (const e of gifts.value) {
    const name = (e.gift_name || '').trim()
    if (!name) continue
    const prev = map.get(name)
    if (!prev) {
      map.set(name, {
        name,
        icon: e.gift_icon,
        count: 0,
        diamond: resolveGiftDiamond(name, 0),
      })
      continue
    }
    if (e.gift_icon && !prev.icon) {
      map.set(name, { ...prev, icon: e.gift_icon })
    }
  }
  return [...map.values()].sort(
    (a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name, 'zh'),
  )
})

/** 推送整蛊计数到 OBS 叠层 */
function pushOverlayState() {
  const api = window.liveAssistant
  if (!api?.overlaySetState) return
  const settings = loadOverlaySettings()
  const payload = buildOverlayPayload(
    rules.value,
    session.value.firedActions,
    settings,
    session.value.ruleCounts,
  )
  // 未自定义图标时，礼物玩法用礼物目录图标兜底
  const giftIcon = new Map(giftOptions.value.map((g) => [g.name, g.icon || '']))
  for (const row of payload.rows) {
    if (row.icon) continue
    const rule = rules.value.find((r) => r.id === row.ruleId)
    const gName =
      rule?.trigger?.kind === 'gift' ? String(rule.trigger.giftName || '').trim() : ''
    if (gName && giftIcon.get(gName)) row.icon = giftIcon.get(gName) || ''
  }
  void api.overlaySetState(payload)
}

function persistSession() {
  saveSessionStats({
    ...session.value,
    chatTotal: chatTotal.value,
    giftTotal: giftTotal.value,
    enterTotal: enterTotal.value,
  })
}

function recordHits(hits: { fired: FiredAction; rule: (typeof rules.value)[0]; times: number; intervalSec: number }[]) {
  const next = appendFired(session.value, hits.map((h) => h.fired))
  session.value = {
    ...session.value,
    ...next,
    chatTotal: chatTotal.value,
    giftTotal: giftTotal.value,
    enterTotal: enterTotal.value,
  }
  persistSession()
  for (const hit of hits) {
    replayRecorder.pushPrank(hit.fired)
    // 正式触发不弹 Toast/系统通知；测试玩法仍走 RuleStudio 的 dryToast
    void runRuleEffects(hit.rule, hit.times, hit.intervalSec).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      connectHint.value = `玩法执行失败：${msg}`
    })
  }
}

/** 点赞结算 / 礼物结算共用：播报 + 整蛊 */
function onSettledLiveEvent(event: import('./types').LiveEvent) {
  replayRecorder.pushLiveEvent(event)
  void tryAnnounceEvent(event)
  if (!prankMasterEnabled.value) return
  const hits = matchRules(event, rules.value)
  if (!hits.length) return
  recordHits(hits)
}

function beginReplaySession() {
  replayCfg.value = loadReplayConfig()
  replayRecorder.updateConfig(replayCfg.value)
  const fin = replayRecorder.onConnected(liveId.value.trim())
  void persistReplayIfNeeded(fin, '开新场')
}

function pauseReplaySession() {
  replayRecorder.onDisconnected()
}

async function persistReplayIfNeeded(s: import('./lib/replay/types').ReplaySession | null, reason: string) {
  if (!s) return
  if (s.eventCount < 1 && s.durationSec < 60) return
  try {
    const res = await persistReplaySession(s, replayCfg.value.maxSessions)
    if (res?.ok) {
      onRuleToast(`复盘已保存（${s.liveId || '本场'} · ${reason}）`)
    }
  } catch (e) {
    console.warn('[replay] save failed', e)
  }
}

async function endReplaySession(reason: string) {
  const s = replayRecorder.finalize()
  await persistReplayIfNeeded(s, reason)
}

function onReplayConfigChanged(cfg: ReplayConfig) {
  replayCfg.value = cfg
  replayRecorder.updateConfig(cfg)
}

function checkReplayPauseTimeout() {
  const fin = replayRecorder.checkPauseTimeout()
  void persistReplayIfNeeded(fin, '断线超时')
}

function onClearSession() {
  clearEvents()
  clearSessionStats()
  session.value = loadSessionStats()
  clearLikeBucket()
  clearGiftBucket()
  pushOverlayState()
}

async function ensureOverlayServer() {
  const api = window.liveAssistant
  if (!api?.overlayStart) return
  const settings = loadOverlaySettings()
  if (!settings.enabled) {
    await api.overlayStop?.()
    return
  }
  const res = await api.overlayStart(settings.port)
  if (res?.ok) pushOverlayState()
}

onMounted(() => {
  setLikeSettleHandler(onSettledLiveEvent)
  setGiftSettleHandler(onSettledLiveEvent)

  void (async () => {
    const { bootstrapFromDisk, flushNowToDisk } = await import('./lib/diskSync')
    const boot = await bootstrapFromDisk()
    // 无论磁盘是否有旧配置，都从 localStorage 再灌一遍到内存
    liveId.value = loadLiveId()
    cookie.value = loadCookie()
    const loaded = loadRules()
    rules.value = loaded
    // 首次/空规则时把默认玩法真正写入，避免只读默认不落盘
    if (!localStorage.getItem('live-assistant.prankRules')) {
      saveRules(loaded)
    }
    layout.value = loadLayout()
    giftCatalog.value = loadGiftCatalog()
    // 非今日次数视为测试数据，清零并落盘
    saveGiftCatalog(giftCatalog.value)
    reloadGiftDiamondOverrides()
    reloadPanelFontsFromStorage()
    reloadPrankMasterFromStorage()
    session.value = loadSessionStats()
    restoreSessionTotals(session.value)
    if (boot.ok) await flushNowToDisk()
    const list = await loadStaticGifts({ force: true })
    staticGifts.value = list
    // 管理员权限检测（顶栏常驻提醒）
    try {
      if (window.liveAssistant?.isAdmin) {
        isAdmin.value = await window.liveAssistant.isAdmin()
      } else {
        isAdmin.value = true
      }
    } catch {
      isAdmin.value = true
    }
    // OBS 叠层：配置启用则随应用启动
    await ensureOverlayServer()
    pushOverlayState()
  })()
})

watch([session, rules], () => pushOverlayState(), { deep: true })
watch(page, (p) => {
  // 设置页改过次数/抖钻后，回规则页要重新灌入
  if (p === 'rules' || p === 'settings') {
    giftCatalog.value = loadGiftCatalog()
    reloadGiftDiamondOverrides()
  }
})
watch([chatTotal, giftTotal, enterTotal], () => {
  session.value = {
    ...session.value,
    chatTotal: chatTotal.value,
    giftTotal: giftTotal.value,
    enterTotal: enterTotal.value,
  }
  persistSession()
})

async function onRelaunchAsAdmin() {
  try {
    await window.liveAssistant?.relaunchAsAdmin?.()
  } catch (e) {
    connectHint.value = e instanceof Error ? e.message : '提权启动失败'
  }
}

function flushDiskOnLeave() {
  void endReplaySession('退出')
  void import('./lib/diskSync').then((m) => m.flushNowToDisk())
}
window.addEventListener('pagehide', flushDiskOnLeave)
window.addEventListener('beforeunload', flushDiskOnLeave)
/** 实时互动：不含进场/点赞/礼物（礼物单独面板） */
const mainEvents = computed(() =>
  events.value.filter((e) => e.type !== 'enter' && e.type !== 'like' && e.type !== 'gift'),
)
const needGiftCookie = computed(() => !cookieLooksLoggedIn(cookie.value))
const cookieLoggedIn = computed(() => cookieLooksLoggedIn(cookie.value))
const canElectronLogin = computed(() => !!window.liveAssistant?.douyinLogin)

/** 监听页常显开播连接状态 */
const showRoomStatus = computed(() => page.value === 'live')

const roomStatusText = computed(() => {
  if (roomState.value === 'connected') return '直播中'
  if (roomState.value === 'connecting') return '开播中…'
  if (wantConnect.value) return '重连中…'
  if (hasTriedConnect.value) return '已断开'
  return '未开播'
})

watch(
  liveId,
  (v) => {
    saveLiveId(v)
  },
  { immediate: true },
)
watch(
  cookie,
  (v) => {
    saveCookie(v)
  },
  { immediate: true },
)
watch(
  rules,
  (v) => {
    saveRules(v)
  },
  { deep: true },
)

watch(wantConnect, (v) => saveWantConnect(v))

function tryConnect(reason: 'manual' | 'pending' | 'retry' = 'manual') {
  const id = liveId.value.trim()
  if (!id) {
    if (reason === 'manual') connectHint.value = '请填写直播号（live.douyin.com/ 后面的数字）'
    return false
  }
  if (!coreOnline.value) {
    if (reason === 'manual') connectHint.value = '本地核心服务未启动（桌面端会自动拉起；若持续失败请查看 Documents/直播助手/logs/live-core.log）'
    return false
  }
  if (roomState.value === 'connecting' || roomState.value === 'connected') return false

  hasTriedConnect.value = true
  wantConnect.value = true
  saveLiveId(id)
  const ok = connectRoom('douyin', id, cookie.value)
  if (ok) {
    const tip = cookie.value.trim() ? '' : '（未填 Cookie，部分直播间可能收不到礼物）'
    const head = reason === 'retry' ? `断线重连 ${id}` : `正在开播连接 ${id}`
    connectHint.value = head + tip
  }
  return ok
}

/** 开播：手动连接直播间 */
function onConnect() {
  connectHint.value = ''
  tryConnect('manual')
}

/** 下播：断开、收尾复盘，且不再自动重连 */
function onDisconnect() {
  wantConnect.value = false
  hasTriedConnect.value = false
  disconnectRoom()
  connectHint.value = ''
  void endReplaySession('下播')
}

watch(coreOnline, (online) => {
  if (online && wantConnect.value && liveId.value.trim()) {
    if (roomState.value === 'disconnected') tryConnect('pending')
  }
})

/** 开播期间意外断线：定时自动重连；手动下播后 wantConnect=false 不会重连 */
let reconnectTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  if (!wantConnect.value) return
  if (!liveId.value.trim()) return
  if (roomState.value === 'connected' || roomState.value === 'connecting') return
  tryConnect('retry')
}, RECONNECT_MS)

/** 断线暂停超过 20 分钟则落盘收尾 */
let replayPauseTimer: ReturnType<typeof setInterval> | null = setInterval(checkReplayPauseTimeout, 30_000)

onUnmounted(() => {
  window.removeEventListener('pagehide', flushDiskOnLeave)
  window.removeEventListener('beforeunload', flushDiskOnLeave)
  flushDiskOnLeave()
  setLikeSettleHandler(null)
  clearLikeBucket()
  clearGiftBucket()
  stopSpeak()
  if (reconnectTimer) {
    clearInterval(reconnectTimer)
    reconnectTimer = null
  }
  if (replayPauseTimer) {
    clearInterval(replayPauseTimer)
    replayPauseTimer = null
  }
})

watch(
  lastEvent,
  async (event) => {
    if (!event) return
    if (event.type === 'status') {
      const c = event.content || ''
      if (c.startsWith('error:') || c.startsWith('douyin_error:') || c.startsWith('pump_error:')) {
        connectHint.value = c.replace(/^(error|douyin_error|pump_error):/, '')
      } else if (c === 'douyin_connected') {
        connectHint.value = ''
        beginReplaySession()
      } else if (c === 'live_ended') {
        // 平台侧结束：暂停复盘，开播态下会自动重连
        connectHint.value = wantConnect.value ? '直播已结束，将自动重连' : '直播已结束'
        pauseReplaySession()
      } else if (c === 'douyin_closed') {
        if (wantConnect.value) {
          connectHint.value = '连接断开，将自动重连'
          pauseReplaySession()
        } else {
          connectHint.value = '已下播'
        }
      } else if (c.startsWith('gift_hint:')) {
        connectHint.value = c.replace(/^gift_hint:/, '')
      } else if (c === 'gift_catalog') {
        // 礼物面板包：补全名称与图标，不计入本场送礼次数
        const items = (event.extra?.items as { name?: string; icon?: string }[] | undefined) || []
        let next = giftCatalog.value
        for (const it of items) {
          if (!it?.name) continue
          next = upsertGiftCatalog(next, { name: it.name, icon: it.icon, count: 0, ts: event.ts })
        }
        giftCatalog.value = next
        saveGiftCatalog(next)
      }
      return
    }
    if (event.type === 'room') {
      replayRecorder.pushLiveEvent(event)
      return
    }

    // 收录礼物名，供规则页下拉精确选择
    if (event.type === 'gift' && event.gift_name) {
      giftCatalog.value = upsertGiftCatalog(giftCatalog.value, {
        name: event.gift_name,
        icon: event.gift_icon,
        count: Math.max(1, event.gift_count || 1),
        ts: event.ts,
      })
      saveGiftCatalog(giftCatalog.value)
    }

    // 点赞：聚合窗结束再播报/整蛊
    if (event.type === 'like') {
      ingestLike(event)
      return
    }

    // 礼物：连击结算后再播报/整蛊（避免一条礼触发多次）
    if (event.type === 'gift') {
      ingestGift(event)
      return
    }

    // 其它事件：立即播报 + 整蛊
    onSettledLiveEvent(event)
  },
)

function onRuleToast(msg: string, meta?: { durationMs?: number }) {
  toast.value = {
    id: `toast-${Date.now()}`,
    ruleId: '',
    ruleName: '测试',
    message: msg,
    at: Date.now(),
    durationMs: meta?.durationMs,
  }
}

/** 强制重载礼物目录（优先官方接口） */
async function onRefreshGiftCatalog() {
  try {
    const { syncOfficialGiftsFromApi, loadStaticGifts } = await import('./lib/douyinGifts')
    const res = await syncOfficialGiftsFromApi()
    staticGifts.value = await loadStaticGifts()
    if (!res.ok) onRuleToast(res.error || '礼物目录刷新失败')
    else if (res.source === 'official') onRuleToast(`已从官方同步礼物（${res.count}）`)
    else onRuleToast(`礼物目录已刷新（${staticGifts.value.length}）`)
  } catch (e) {
    onRuleToast(e instanceof Error ? e.message : '礼物目录刷新失败')
  }
}

/** OBS 图层配置变更：启停服务并立即推送 */
async function onOverlayChanged() {
  await ensureOverlayServer()
  pushOverlayState()
}

function persistLayout() {
  saveLayout(layout.value)
}

function onColsResized(payload: SplitpanesResizedPayload) {
  const panes = payload.panes
  if (panes.length < 3) return
  layout.value = {
    ...layout.value,
    cols: [panes[0].size, panes[1].size, panes[2].size],
  }
  persistLayout()
}

function onLeftRowsResized(payload: SplitpanesResizedPayload) {
  const panes = payload.panes
  if (panes.length < 2) return
  layout.value = {
    ...layout.value,
    leftRows: [panes[0].size, panes[1].size],
  }
  persistLayout()
}

function onMidRowsUpdate(sizes: [number, number]) {
  layout.value = { ...layout.value, midRows: sizes }
  persistLayout()
}

function onRightRowsResized(payload: SplitpanesResizedPayload) {
  const panes = payload.panes
  if (panes.length < 2) return
  layout.value = {
    ...layout.value,
    rightRows: [panes[0].size, panes[1].size],
  }
  persistLayout()
}

async function onDouyinLogin(force = false) {
  const api = window.liveAssistant
  if (!api?.douyinLogin) {
    showCookie.value = true
    connectHint.value = '当前不是桌面端，请手动粘贴 Cookie'
    return
  }
  loggingIn.value = true
  if (force) cookie.value = ''
  connectHint.value = '请在弹出窗口中扫码或手机号登录…'
  try {
    const res = await api.douyinLogin({ force })
    if (res.ok && res.cookie) {
      cookie.value = res.cookie
      showCookie.value = false
      let msg = res.reused ? '已复用本地登录态' : '登录成功，Cookie 已保存'
      if (roomState.value === 'connected' || roomState.value === 'connecting') {
        msg += '；请下播后重新开播以生效'
      }
      connectHint.value = msg
    } else if (res.canceled) {
      connectHint.value = '已取消登录'
    } else {
      connectHint.value = res.error || '登录失败'
    }
  } catch (e) {
    connectHint.value = e instanceof Error ? e.message : String(e)
  } finally {
    loggingIn.value = false
  }
}

async function onDouyinLogout() {
  try {
    await window.liveAssistant?.douyinLogout?.()
  } catch {
    // ignore
  }
  cookie.value = ''
  connectHint.value = '已退出抖音登录'
}

async function onExportConfig() {
  try {
    savePanelFonts({ ...panelFonts })
    const api = window.liveAssistant
    if (api?.exportDataZip) {
      const { prepareDataPackageExport } = await import('./lib/dataPackage')
      await prepareDataPackageExport()
      const res = await api.exportDataZip()
      if (res.canceled) return
      if (!res.ok) throw new Error(res.error || '导出失败')
      connectHint.value = `数据包已导出：${res.path}`
      return
    }
    downloadAppConfig()
    connectHint.value = '配置已导出（浏览器模式为 JSON；桌面端可导出整夹 zip）'
  } catch (e) {
    connectHint.value = e instanceof Error ? e.message : '导出失败'
  }
}
</script>

<template>
  <div class="shell">
    <header class="top">
      <nav class="nav">
        <button type="button" :class="{ on: page === 'live' }" @click="page = 'live'">监听</button>
        <button type="button" :class="{ on: page === 'rules' }" @click="page = 'rules'">整蛊规则</button>
        <button type="button" :class="{ on: page === 'replay' }" @click="page = 'replay'">复盘</button>
        <button type="button" :class="{ on: page === 'settings' }" @click="page = 'settings'">系统设置</button>
      </nav>
      <StatsBar
        :chat-count="chatTotal"
        :gift-count="giftTotal"
        :enter-count="enterTotal"
        :online-count="onlineCount"
        :online-text="onlineText"
        :like-total="likeTotal"
        :like-text="likeText"
        :show-clear="page === 'live'"
        :show-admin-warn="isAdmin === false"
        @clear="onClearSession"
        @export-config="onExportConfig"
        @relaunch-admin="onRelaunchAsAdmin"
      />
      <div v-if="page === 'live'" class="meta">
        <button
          v-if="canElectronLogin"
          type="button"
          class="cookie-toggle login"
          :disabled="loggingIn"
          @click="onDouyinLogin(cookieLoggedIn)"
        >
          {{ loggingIn ? '登录中…' : cookieLoggedIn ? '重新登录抖音' : '扫码/手机登录' }}
        </button>
        <button
          v-if="canElectronLogin && cookieLoggedIn"
          type="button"
          class="cookie-toggle ghost"
          :disabled="loggingIn"
          @click="onDouyinLogout"
        >
          退出登录
        </button>
        <button type="button" class="cookie-toggle" @click="showCookie = !showCookie">
          {{ showCookie ? '收起 Cookie' : '手动填 Cookie' }}
        </button>
        <label class="room">
          <span>直播号</span>
          <input v-model="liveId" placeholder="live.douyin.com/后面的数字" @keyup.enter="onConnect" />
        </label>
        <button
          v-if="roomState !== 'connected'"
          type="button"
          class="connect"
          :disabled="roomState === 'connecting'"
          @click="onConnect"
        >
          {{ roomState === 'connecting' ? '开播中…' : '开播' }}
        </button>
        <button v-else type="button" class="disconnect" @click="onDisconnect">下播</button>
        <div
          v-if="showRoomStatus"
          class="status"
          :class="{
            on: roomState === 'connected',
            wait: roomState === 'connecting' || (wantConnect && roomState === 'disconnected'),
            off: !wantConnect && roomState === 'disconnected',
          }"
        >
          <i />
          {{ roomStatusText }}
        </div>
      </div>
    </header>

    <div v-if="page === 'live' && showCookie" class="cookie-box">
      <textarea
        v-model="cookie"
        rows="2"
        placeholder="浏览器打开 live.douyin.com 并登录 → F12 → Network 任意请求 → 复制 Cookie 整段粘贴到这里"
      />
      <p>
        推荐用「扫码/手机登录」自动获取；手动粘贴后需下播再开播。礼物等完整事件通常需要登录态。
      </p>
    </div>

    <template v-if="page === 'live'">
      <p
        v-if="connectHint"
        class="hint"
        :class="{ danger: !!error || connectHint.includes('未启动') || connectHint.includes('请填写') }"
      >
        {{ connectHint }}
      </p>
      <p v-else-if="error && hasTriedConnect" class="banner">{{ error }}</p>

      <main class="grid">
        <Splitpanes class="live-split" @resized="onColsResized">
          <Pane :size="layout.cols[0]" :min-size="22">
            <Splitpanes class="left-split" horizontal @resized="onLeftRowsResized">
              <Pane :size="layout.leftRows[0]" :min-size="25">
                <EventFeed :events="mainEvents" :room-state="roomState" />
              </Pane>
              <Pane :size="layout.leftRows[1]" :min-size="18">
                <GiftPanel :gifts="gifts" :need-cookie="needGiftCookie" />
              </Pane>
            </Splitpanes>
          </Pane>
          <Pane :size="layout.cols[1]" :min-size="16">
            <EnterLikeBoard
              :enters="enters"
              :likes="likes"
              :row-sizes="layout.midRows"
              @update:row-sizes="onMidRowsUpdate"
            />
          </Pane>
          <Pane :size="layout.cols[2]" :min-size="16">
            <Splitpanes class="right-split" horizontal @resized="onRightRowsResized">
              <Pane :size="layout.rightRows[0]" :min-size="25">
                <PrankStats :actions="firedActions" :rules="rules" :counts="ruleCounts" />
              </Pane>
              <Pane :size="layout.rightRows[1]" :min-size="18">
                <PrankLog :actions="firedActions" />
              </Pane>
            </Splitpanes>
          </Pane>
        </Splitpanes>
      </main>
    </template>

    <main v-else-if="page === 'rules'" class="rules-page">
      <RuleStudio
        v-model:rules="rules"
        :gift-options="giftOptions"
        @toast="onRuleToast"
        @overlay-changed="onOverlayChanged"
        @refresh-gifts="onRefreshGiftCatalog"
      />
    </main>

    <main v-else-if="page === 'replay'" class="rules-page">
      <ReplayPage />
    </main>

    <main v-else class="rules-page">
      <SettingsPage @replay-config-changed="onReplayConfigChanged" />
    </main>

    <ActionToast :item="toast" @done="toast = null" />
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px 20px;
}

.top {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: nowrap;
  min-width: 0;
}

.nav {
  display: inline-flex;
  flex-shrink: 0;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
}

.nav button {
  border: 0;
  background: transparent;
  color: var(--muted);
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 13px;
}

.nav button.on {
  color: var(--text);
  background: rgba(255, 138, 61, 0.18);
}

.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: nowrap;
  flex-shrink: 0;
  margin-left: auto;
}

.cookie-toggle {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 2px;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
}

.cookie-toggle.login {
  color: #f0d9a0;
  text-decoration: none;
  border: 1px solid rgba(232, 201, 138, 0.35);
  background: rgba(232, 201, 138, 0.08);
  border-radius: 999px;
  padding: 6px 12px;
}

.cookie-toggle.ghost {
  text-decoration: none;
  opacity: 0.85;
}

.cookie-toggle:disabled {
  opacity: 0.5;
  cursor: wait;
}

.cookie-box textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.22);
  color: var(--text);
  padding: 8px 10px;
  font-size: 12px;
  outline: none;
}

.cookie-box p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.room {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 6px 12px;
}

.room input {
  width: 200px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
}

.connect {
  border: 0;
  border-radius: 999px;
  padding: 8px 16px;
  background: linear-gradient(135deg, var(--accent), #ffb15a);
  color: #1a120c;
  font-weight: 600;
  font-size: 13px;
}

.connect:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.disconnect {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 8px 16px;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
}

.disconnect:hover {
  color: var(--text);
  border-color: rgba(255, 214, 170, 0.35);
}

.status.wait {
  color: var(--accent-2);
}

.status.wait i {
  background: var(--accent);
  box-shadow: 0 0 0 4px rgba(255, 138, 61, 0.18);
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  font-size: 13px;
  flex-shrink: 0;
  white-space: nowrap;
}

.status i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  box-shadow: 0 0 0 4px rgba(255, 107, 107, 0.15);
}

.status.on {
  color: var(--ok);
}

.status.on i {
  background: var(--ok);
  box-shadow: 0 0 0 4px rgba(111, 207, 151, 0.15);
}

.status.off i {
  background: #6b635c;
  box-shadow: none;
}

.banner {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 107, 107, 0.12);
  border: 1px solid rgba(255, 107, 107, 0.35);
  color: #ffc9c9;
  font-size: 13px;
}

.hint {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 200, 87, 0.1);
  border: 1px solid rgba(255, 200, 87, 0.28);
  color: #ffe2a8;
  font-size: 13px;
}

.hint.danger {
  background: rgba(255, 107, 107, 0.12);
  border-color: rgba(255, 107, 107, 0.35);
  color: #ffc9c9;
}

.grid {
  flex: 1;
  min-height: 0;
  display: flex;
}

.live-split,
.left-split,
.right-split {
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-wrap: nowrap;
}

.live-split :deep(.splitpanes__pane),
.left-split :deep(.splitpanes__pane),
.right-split :deep(.splitpanes__pane) {
  background: transparent;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.live-split :deep(.splitpanes__pane > *),
.left-split :deep(.splitpanes__pane > *),
.right-split :deep(.splitpanes__pane > *) {
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
}

/* 仅三列之间的竖缝（不要套到内部横缝） */
.live-split.splitpanes--vertical > :deep(.splitpanes__splitter) {
  width: 10px !important;
  min-width: 10px !important;
  max-width: 10px !important;
  flex: 0 0 10px !important;
  background: transparent;
  position: relative;
  z-index: 2;
  cursor: col-resize;
}

.live-split.splitpanes--vertical > :deep(.splitpanes__splitter::before) {
  content: '';
  position: absolute;
  top: 18%;
  bottom: 18%;
  left: 50%;
  width: 3px;
  margin-left: -1.5px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.14);
}

/* 左列 / 右列横缝 */
.left-split.splitpanes--horizontal > :deep(.splitpanes__splitter),
.right-split.splitpanes--horizontal > :deep(.splitpanes__splitter) {
  height: 14px !important;
  min-height: 14px !important;
  max-height: 14px !important;
  width: 100% !important;
  max-width: none !important;
  flex: 0 0 14px !important;
  background: transparent;
  position: relative;
  z-index: 2;
  cursor: row-resize;
}

.left-split.splitpanes--horizontal > :deep(.splitpanes__splitter::before),
.right-split.splitpanes--horizontal > :deep(.splitpanes__splitter::before) {
  content: '';
  position: absolute;
  left: 22%;
  right: 22%;
  top: 50%;
  height: 4px;
  margin-top: -2px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
}

.live-split.splitpanes--vertical > :deep(.splitpanes__splitter:hover::before),
.live-split.splitpanes--vertical.splitpanes--dragging > :deep(.splitpanes__splitter::before),
.left-split.splitpanes--horizontal > :deep(.splitpanes__splitter:hover::before),
.left-split.splitpanes--horizontal.splitpanes--dragging > :deep(.splitpanes__splitter::before),
.right-split.splitpanes--horizontal > :deep(.splitpanes__splitter:hover::before),
.right-split.splitpanes--horizontal.splitpanes--dragging > :deep(.splitpanes__splitter::before) {
  background: rgba(232, 201, 138, 0.7);
}

.rules-page {
  flex: 1;
  min-height: 0;
  display: flex;
}
</style>
