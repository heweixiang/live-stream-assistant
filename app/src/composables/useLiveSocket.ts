import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import type { PlatformId } from '../lib/platforms'
import type { LiveEvent } from '../types'

const DEFAULT_URL = 'ws://127.0.0.1:8765'
const CHAT_MERGE_MS = 5000
const GIFT_MERGE_MS = 8000
const DEFAULT_LIKE_MERGE_MS = 4000
const MAX_ROWS = 300

export type RoomState = 'disconnected' | 'connecting' | 'connected'

function likeMergeMs() {
  try {
    const raw = localStorage.getItem('live-assistant.announceSettings')
    if (!raw) return DEFAULT_LIKE_MERGE_MS
    const sec = Number(JSON.parse(raw)?.likeMergeSec)
    if (!Number.isFinite(sec)) return DEFAULT_LIKE_MERGE_MS
    return Math.round(Math.min(60, Math.max(0.5, sec)) * 1000)
  } catch {
    return DEFAULT_LIKE_MERGE_MS
  }
}

function eventTime(e: LiveEvent) {
  const ts = e.ts ?? Date.now()
  return ts > 1e12 ? ts : ts * 1000
}

function canMerge(prev: LiveEvent, next: LiveEvent) {
  const dt = eventTime(next) - eventTime(prev)
  if (prev.user !== next.user || prev.type !== next.type) return false

  if (next.type === 'chat') {
    return prev.content === next.content && dt <= CHAT_MERGE_MS
  }
  if (next.type === 'gift') {
    return prev.gift_name === next.gift_name && dt <= GIFT_MERGE_MS
  }
  if (next.type === 'like') {
    return dt <= likeMergeMs()
  }
  return false
}

function mergeInto(prev: LiveEvent, next: LiveEvent): LiveEvent {
  if (next.type === 'chat') {
    return {
      ...prev,
      repeat: (prev.repeat ?? 1) + 1,
      ts: next.ts,
    }
  }
  if (next.type === 'gift') {
    // 抖音连击推送的是累计数量，取较大值，避免重复累加
    const count = Math.max(prev.gift_count ?? 0, next.gift_count ?? 0)
    const unitPrev = (prev.gift_count || 0) > 0 ? (prev.gift_value ?? 0) / (prev.gift_count || 1) : 0
    const unitNext = (next.gift_count || 0) > 0 ? (next.gift_value ?? 0) / (next.gift_count || 1) : 0
    const unit = Math.max(unitPrev, unitNext)
    return {
      ...prev,
      gift_count: count,
      gift_value: Math.round(unit * count) || Math.max(prev.gift_value ?? 0, next.gift_value ?? 0),
      gift_icon: next.gift_icon || prev.gift_icon,
      content: `送出了 ${prev.gift_name || next.gift_name}`,
      ts: next.ts,
    }
  }
  if (next.type === 'like') {
    const a = Number(prev.extra?.count ?? 1)
    const b = Number(next.extra?.count ?? 1)
    return {
      ...prev,
      extra: { ...(prev.extra ?? {}), count: a + b },
      ts: next.ts,
    }
  }
  return prev
}

export function useLiveSocket(url = DEFAULT_URL) {
  /** 本地 Python 服务是否在线（不是直播间） */
  const coreOnline = ref(false)
  /** 直播间连接状态 */
  const roomState = ref<RoomState>('disconnected')
  const error = ref('')
  const events = shallowRef<LiveEvent[]>([])
  const lastEvent = shallowRef<LiveEvent | null>(null)
  const activePlatform = ref<PlatformId | ''>('')
  /** 会话累计（不受列表裁剪影响） */
  const chatTotal = ref(0)
  const giftTotal = ref(0)
  const enterTotal = ref(0)
  /** 房间实时指标 */
  const onlineCount = ref<number | null>(null)
  const onlineText = ref('')
  const likeTotal = ref<number | null>(null)
  const likeText = ref('')

  let ws: WebSocket | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let seq = 0

  function asNum(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v)
      if (Number.isFinite(n) && n >= 0) return n
    }
    return null
  }

  function applyRoomMetrics(event: LiveEvent) {
    const online = asNum(event.extra?.online)
    if (online != null) onlineCount.value = online

    const oStr = event.extra?.online_str
    if (typeof oStr === 'string' && oStr.trim()) {
      onlineText.value = oStr.trim()
    }

    const likes = asNum(event.extra?.like_total)
    if (likes != null) likeTotal.value = likes

    const lStr = event.extra?.like_str
    if (typeof lStr === 'string' && lStr.trim()) {
      likeText.value = lStr.trim()
    }

    // stats 文案兜底：如「43在线观众」「12.4万本场点赞」
    const display = event.extra?.display
    if (typeof display === 'string' && display) {
      if ((display.includes('在线') || display.includes('观众')) && !onlineText.value) {
        onlineText.value = display.replace(/在线观众|在线/g, '').trim() || display
        const n = asNum(event.extra?.display_value)
        if (n != null) onlineCount.value = n
      }
      if (display.includes('赞')) {
        likeText.value = display
        const n = asNum(event.extra?.display_value) ?? asNum(event.extra?.like_total)
        if (n != null) likeTotal.value = n
      }
    }
  }

  function bumpSession(event: LiveEvent) {
    if (event.type === 'chat') {
      chatTotal.value += 1
      return
    }
    if (event.type === 'enter') {
      enterTotal.value += 1
      return
    }
    if (event.type === 'gift') {
      // 连击推送为累计值：只累加相对上次同用户同礼物的增量
      const list = events.value
      const last = list[list.length - 1]
      const nextCount = Number(event.gift_count || 1)
      if (last && canMerge(last, event)) {
        const prevCount = Number(last.gift_count || 0)
        giftTotal.value += Math.max(0, nextCount - prevCount)
      } else {
        giftTotal.value += nextCount
      }
    }
  }

  function applyRoomExtra(event: LiveEvent) {
    const room = event.extra?.room
    if (room === 'connected' || room === 'connecting' || room === 'disconnected') {
      roomState.value = room
    }
    const platform = event.extra?.platform ?? event.extra?.mode
    if (platform === 'douyin') {
      activePlatform.value = platform
    } else if (event.content === 'idle' || event.content === 'switched:idle') {
      activePlatform.value = ''
      roomState.value = 'disconnected'
    }
  }

  function pushEvent(event: LiveEvent) {
    lastEvent.value = event
    if (event.type === 'status') {
      applyRoomExtra(event)
      const c = event.content || ''
      if (c === 'douyin_connected' || c === 'mock_connected') roomState.value = 'connected'
      if (c.startsWith('connecting:')) roomState.value = 'connecting'
      if (c === 'idle' || c === 'douyin_closed' || c === 'live_ended' || c === 'switched:idle') {
        roomState.value = 'disconnected'
      }
      if (c.startsWith('douyin_error:') || c.startsWith('pump_error:') || c.startsWith('error:')) {
        roomState.value = 'disconnected'
      }
      return
    }

    // 房间统计不进滚动列表
    if (event.type === 'room') {
      applyRoomMetrics(event)
      return
    }

    if (event.type === 'like') {
      const likes = asNum(event.extra?.like_total)
      if (likes != null) likeTotal.value = likes
    }

    bumpSession(event)

    const list = events.value
    const last = list[list.length - 1]
    if (last && canMerge(last, event)) {
      const merged = mergeInto(last, event)
      events.value = [...list.slice(0, -1), merged]
      return
    }

    seq += 1
    const row: LiveEvent = {
      ...event,
      uid: `${event.type}-${seq}-${event.ts ?? Date.now()}`,
      repeat: event.type === 'chat' ? 1 : event.repeat,
    }
    const next = [...list, row]
    events.value = next.length > MAX_ROWS ? next.slice(next.length - MAX_ROWS) : next
  }

  function connectCore() {
    if (disposed) return
    error.value = ''
    try {
      ws = new WebSocket(url)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '连接失败'
      scheduleRetry()
      return
    }

    ws.onopen = () => {
      coreOnline.value = true
      error.value = ''
    }

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data)) as LiveEvent
        pushEvent(data)
      } catch {
        // ignore
      }
    }

    ws.onerror = () => {
      error.value = '本地核心服务未连接，正在重试…'
    }

    ws.onclose = () => {
      coreOnline.value = false
      roomState.value = 'disconnected'
      scheduleRetry()
    }
  }

  function scheduleRetry() {
    if (disposed || retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      connectCore()
    }, 2000)
  }

  function clearEvents() {
    events.value = []
    chatTotal.value = 0
    giftTotal.value = 0
    enterTotal.value = 0
  }

  /** 从持久化恢复本场累计（不清事件列表） */
  function restoreSessionTotals(s: { chatTotal?: number; giftTotal?: number; enterTotal?: number }) {
    chatTotal.value = Math.max(0, Number(s.chatTotal) || 0)
    giftTotal.value = Math.max(0, Number(s.giftTotal) || 0)
    enterTotal.value = Math.max(0, Number(s.enterTotal) || 0)
  }

  /** 连接某个平台的直播间 */
  function connectRoom(platform: PlatformId, roomId: string, cookie = '') {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      error.value = '本地服务未连接'
      return false
    }
    roomState.value = 'connecting'
    activePlatform.value = platform
    // 本场统计持久化，重连不清零（仅「清空列表」重置）
    ws.send(
      JSON.stringify({
        action: 'connect',
        mode: platform,
        platform,
        room_id: roomId.trim(),
        live_id: roomId.trim(),
        cookie: cookie.trim(),
      }),
    )
    return true
  }

  function disconnectRoom() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify({ action: 'disconnect' }))
    roomState.value = 'disconnected'
    activePlatform.value = ''
    onlineCount.value = null
    onlineText.value = ''
    likeTotal.value = null
    likeText.value = ''
    return true
  }

  onMounted(connectCore)
  onUnmounted(() => {
    disposed = true
    if (retryTimer) clearTimeout(retryTimer)
    ws?.close()
  })

  return {
    coreOnline,
    roomState,
    error,
    events,
    lastEvent,
    activePlatform,
    chatTotal,
    giftTotal,
    enterTotal,
    onlineCount,
    onlineText,
    likeTotal,
    likeText,
    clearEvents,
    restoreSessionTotals,
    connectRoom,
    disconnectRoom,
  }
}
