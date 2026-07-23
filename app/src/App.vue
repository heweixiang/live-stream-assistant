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
import type { FiredAction } from './types'
import EventFeed from './components/EventFeed.vue'
import EnterLikeBoard from './components/EnterLikeBoard.vue'
import GiftPanel from './components/GiftPanel.vue'
import PrankLog from './components/PrankLog.vue'
import PrankStats from './components/PrankStats.vue'
import RuleStudio from './components/RuleStudio.vue'
import SettingsPage from './components/SettingsPage.vue'
import ActionToast from './components/ActionToast.vue'
import StatsBar from './components/StatsBar.vue'
import { matchRules } from './lib/prank/rulesEngine'
import { runRuleEffects } from './lib/prank/actionRunner'
import { tryAnnounceEvent } from './lib/tts/announce'
import { clearLikeBucket, ingestLike, setLikeSettleHandler } from './lib/likeBatch'
import { stopSpeak } from './lib/tts/speak'
import { reloadPanelFontsFromStorage, usePanelFonts } from './composables/usePanelFonts'

const RECONNECT_MS = 60_000

type PageId = 'live' | 'rules' | 'settings'

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
const firedActions = ref<FiredAction[]>([])
const toast = ref<FiredAction | null>(null)
const liveId = ref(loadLiveId())
const cookie = ref(loadCookie())
const showCookie = ref(false)
const loggingIn = ref(false)
const layout = ref<LiveLayout>(loadLayout())
const giftCatalog = ref<GiftCatalogItem[]>(loadGiftCatalog())
/** 抖音全量礼物静态目录（名+图标），规则页点选用 */
const staticGifts = ref<StaticGift[]>([])
const { fonts: panelFonts } = usePanelFonts()
/** 有直播号则默认要连；手动点断开后本会话内暂停自动重连 */
const wantConnect = ref(!!liveId.value.trim())
const connectHint = ref('')
const hasTriedConnect = ref(wantConnect.value)

const gifts = computed(() => events.value.filter((e) => e.type === 'gift'))
const enters = computed(() => events.value.filter((e) => e.type === 'enter'))
const likes = computed(() => events.value.filter((e) => e.type === 'like'))
/** 规则页礼物选项：静态全量目录 + 本场/历史收到的礼物（后者优先图标与计数） */
const giftOptions = computed(() => {
  const map = new Map<
    string,
    { name: string; icon?: string; count?: number; panel?: boolean; diamond?: number }
  >()
  for (const g of staticGifts.value) {
    map.set(g.name, { name: g.name, icon: g.icon, count: 0, panel: g.panel, diamond: g.diamond })
  }
  for (const g of giftCatalog.value) {
    const prev = map.get(g.name)
    map.set(g.name, {
      name: g.name,
      icon: g.icon || prev?.icon,
      count: g.count,
      panel: prev?.panel,
      diamond: prev?.diamond,
    })
  }
  for (const e of gifts.value) {
    const name = (e.gift_name || '').trim()
    if (!name) continue
    const prev = map.get(name)
    map.set(name, {
      name,
      icon: e.gift_icon || prev?.icon,
      count: (prev?.count || 0) + (e.gift_count || 1),
      panel: prev?.panel,
      diamond: prev?.diamond,
    })
  }
  return [...map.values()].sort(
    (a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name, 'zh'),
  )
})

onMounted(() => {
  setLikeSettleHandler((merged) => {
    void tryAnnounceEvent(merged)
    const hits = matchRules(merged, rules.value)
    if (!hits.length) return
    firedActions.value = [...firedActions.value, ...hits.map((h) => h.fired)].slice(-50)
    for (const hit of hits) {
      void runRuleEffects(hit.rule, hit.times, hit.intervalSec).catch((err) => {
        connectHint.value = `玩法执行失败：${err instanceof Error ? err.message : String(err)}`
      })
    }
  })

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
    reloadPanelFontsFromStorage()
    if (boot.ok) await flushNowToDisk()
    const list = await loadStaticGifts()
    staticGifts.value = list
  })()
})

function flushDiskOnLeave() {
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

const showRoomStatus = computed(
  () => hasTriedConnect.value && (roomState.value === 'connecting' || roomState.value === 'connected'),
)

const roomStatusText = computed(() => {
  if (roomState.value === 'connected') return '已连接'
  if (roomState.value === 'connecting') return '连接中…'
  return ''
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

function tryConnect(reason: 'manual' | 'auto' | 'retry' = 'manual') {
  const id = liveId.value.trim()
  if (!id) {
    if (reason === 'manual') connectHint.value = '请填写直播号（live.douyin.com/ 后面的数字）'
    return false
  }
  if (!coreOnline.value) {
    if (reason === 'manual') connectHint.value = '本地服务未启动，请先运行 python core/server.py'
    return false
  }
  if (roomState.value === 'connecting' || roomState.value === 'connected') return false

  hasTriedConnect.value = true
  wantConnect.value = true
  saveLiveId(id)
  const ok = connectRoom('douyin', id, cookie.value)
  if (ok) {
    if (reason !== 'retry') {
      clearEvents()
      firedActions.value = []
    }
    const tip = cookie.value.trim() ? '' : '（未填 Cookie，部分直播间可能收不到礼物）'
    connectHint.value = (reason === 'retry' ? `重连中 ${id}` : `正在连接 ${id}`) + tip
  }
  return ok
}

function onConnect() {
  connectHint.value = ''
  tryConnect('manual')
}

function onDisconnect() {
  wantConnect.value = false
  hasTriedConnect.value = false
  disconnectRoom()
  connectHint.value = ''
}

watch(
  coreOnline,
  (online) => {
    if (online && wantConnect.value && liveId.value.trim()) {
      tryConnect('auto')
    }
  },
  { immediate: true },
)

let reconnectTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  if (!wantConnect.value) return
  if (!liveId.value.trim()) return
  if (roomState.value === 'connected' || roomState.value === 'connecting') return
  tryConnect('retry')
}, RECONNECT_MS)

onUnmounted(() => {
  window.removeEventListener('pagehide', flushDiskOnLeave)
  window.removeEventListener('beforeunload', flushDiskOnLeave)
  flushDiskOnLeave()
  setLikeSettleHandler(null)
  clearLikeBucket()
  stopSpeak()
  if (reconnectTimer) {
    clearInterval(reconnectTimer)
    reconnectTimer = null
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
      } else if (c === 'live_ended') {
        connectHint.value = '直播已结束，将自动重连'
      } else if (c === 'douyin_closed') {
        connectHint.value = wantConnect.value ? '连接断开，将自动重连' : '连接已断开'
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
    if (event.type === 'room') return

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

    // 点赞：按「聚合秒数」固定窗口汇总，整窗结束再播报/整蛊
    if (event.type === 'like') {
      ingestLike(event)
      return
    }

    // 语音播报（与整蛊规则独立）
    void tryAnnounceEvent(event)

    const hits = matchRules(event, rules.value)
    if (!hits.length) return

    firedActions.value = [...firedActions.value, ...hits.map((h) => h.fired)].slice(-50)

    // 异步执行效果，不阻塞后续事件匹配（不再弹窗，日志区高亮）
    for (const hit of hits) {
      void runRuleEffects(hit.rule, hit.times, hit.intervalSec).catch((err) => {
        connectHint.value = `玩法执行失败：${err instanceof Error ? err.message : String(err)}`
      })
    }
  },
)

function onRuleToast(msg: string) {
  toast.value = {
    id: `toast-${Date.now()}`,
    ruleId: '',
    ruleName: '测试',
    message: msg,
    at: Date.now(),
  }
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
        msg += '；请断开后重新连接以生效'
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
      const { flushAllToDisk } = await import('./lib/diskSync')
      await flushAllToDisk()
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
        @clear="clearEvents"
        @export-config="onExportConfig"
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
          {{ roomState === 'connecting' ? '连接中…' : '连接' }}
        </button>
        <button v-else type="button" class="disconnect" @click="onDisconnect">断开</button>
        <div
          v-if="showRoomStatus"
          class="status"
          :class="{ on: roomState === 'connected', wait: roomState === 'connecting' }"
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
        推荐用「扫码/手机登录」自动获取；手动粘贴后需断开再连接。礼物等完整事件通常需要登录态。
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
                <PrankStats :actions="firedActions" :rules="rules" />
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
      <RuleStudio v-model:rules="rules" :gift-options="giftOptions" @toast="onRuleToast" />
    </main>

    <main v-else class="rules-page">
      <SettingsPage />
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
