<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  deleteReplaySession,
  listReplaySessions,
  loadReplaySession,
} from '../lib/replay/persist'
import { compareTotals } from '../lib/replay/recorder'
import type { ReplayEvent, ReplaySession, ReplaySessionSummary } from '../lib/replay/types'
import { giftFallbackIcon, resolveChatParts } from '../lib/douyinEmoji'
import DarkSelect from './DarkSelect.vue'

/** 选中场次后，右侧切换复盘 / 统计 */
type ViewTab = 'review' | 'stats'

const viewTab = ref<ViewTab>('review')
const list = ref<ReplaySessionSummary[]>([])
const selectedId = ref('')
const current = ref<ReplaySession | null>(null)
const loading = ref(false)
const hint = ref('')
const filterKind = ref('all')
const feedRef = ref<HTMLElement | null>(null)

const filterOptions = [
  { value: 'all', label: '全部' },
  { value: 'chat', label: '弹幕' },
  { value: 'gift', label: '礼物' },
  { value: 'enter', label: '进场' },
  { value: 'like', label: '点赞' },
  { value: 'follow', label: '关注' },
  { value: 'fansclub_join', label: '加粉丝团' },
  { value: 'fansclub_upgrade', label: '粉丝团升级' },
  { value: 'prank', label: '整蛊' },
  { value: 'room', label: '房间' },
]

const selectedSummary = computed(() => list.value.find((x) => x.id === selectedId.value) || null)

const historyForCompare = computed(() =>
  list.value.filter((x) => x.id !== selectedId.value).slice(0, 20),
)

const compare = computed(() => {
  const cur = current.value?.totals
  if (!cur) return null
  return compareTotals(
    cur,
    historyForCompare.value.map((x) => x.totals),
  )
})

/** 与监听一致：旧→新，最多 400 条，滚底看最新 */
const feedEvents = computed(() => {
  const ev = current.value?.events || []
  const filtered =
    filterKind.value === 'all' ? ev : ev.filter((e) => e.kind === filterKind.value)
  return filtered.slice(-400)
})

const prankRows = computed(() => {
  const m = current.value?.totals.prankByRule || {}
  return Object.entries(m)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
})

function fmtDur(sec: number) {
  const s = Math.max(0, sec || 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h) return `${h}时${m}分`
  if (m) return `${m}分${r}秒`
  return `${r}秒`
}

function fmtTime(ts: number) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

function fmtClock(ts: number) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

function deltaText(n: number) {
  if (!n) return '持平'
  return n > 0 ? `+${n}` : `${n}`
}

function deltaClass(n: number) {
  if (n > 0) return 'up'
  if (n < 0) return 'down'
  return 'flat'
}

function tagLabel(kind: string) {
  const map: Record<string, string> = {
    chat: '弹',
    gift: '礼',
    enter: '进',
    like: '赞',
    follow: '关',
    fansclub_join: '粉',
    fansclub_upgrade: '升',
    prank: '蛊',
    room: '房',
    status: '态',
  }
  return map[kind] ?? kind.slice(0, 1)
}

function giftIconOf(e: ReplayEvent) {
  return e.giftIcon || giftFallbackIcon(e.giftName)
}

function chatPartsOf(e: ReplayEvent) {
  return resolveChatParts(e.content)
}

async function scrollFeedBottom() {
  await nextTick()
  const el = feedRef.value
  if (el) el.scrollTop = el.scrollHeight
}

async function refreshList() {
  list.value = await listReplaySessions()
  if (!selectedId.value && list.value[0]) selectedId.value = list.value[0].id
}

async function openSession(id: string) {
  selectedId.value = id
  loading.value = true
  try {
    current.value = await loadReplaySession(id)
    if (!current.value) hint.value = '读取场次失败'
    else void scrollFeedBottom()
  } finally {
    loading.value = false
  }
}

async function onDelete(id: string) {
  if (!confirm('删除这场复盘？不可恢复。')) return
  await deleteReplaySession(id)
  if (selectedId.value === id) {
    selectedId.value = ''
    current.value = null
  }
  await refreshList()
  hint.value = '已删除'
}

watch(selectedId, (id) => {
  if (id) void openSession(id)
})

watch([filterKind, feedEvents], () => {
  void scrollFeedBottom()
})

onMounted(() => {
  void refreshList()
})
</script>

<template>
  <section class="replay">
    <aside class="side">
      <div class="side-title">场次列表</div>
      <div class="sessions scroll">
        <button
          v-for="s in list"
          :key="s.id"
          type="button"
          class="sess"
          :class="{ on: s.id === selectedId }"
          @click="selectedId = s.id"
        >
          <strong>{{ s.liveId || '未知直播间' }}</strong>
          <span>{{ fmtTime(s.startedAt) }} · {{ fmtDur(s.durationSec) }}</span>
          <span class="mini"
            >弹幕{{ s.totals?.chat || 0 }} · 礼物{{ s.totals?.gift || 0 }} · 整蛊{{
              s.totals?.prank || 0
            }}</span
          >
        </button>
        <p v-if="!list.length" class="empty">
          还没有复盘。停止监听后，断线超过 20 分钟或更换房号会自动生成场次。
        </p>
      </div>
    </aside>

    <div class="main">
      <header class="head">
        <div>
          <h1>{{ selectedSummary ? selectedSummary.liveId || '本场' : '复盘' }}</h1>
          <p v-if="selectedSummary">
            {{ fmtTime(selectedSummary.startedAt) }} ~
            {{ fmtTime(selectedSummary.endedAt) }} · {{ fmtDur(selectedSummary.durationSec) }}
          </p>
          <p v-else>从左侧选择一场直播</p>
        </div>
        <div class="acts" v-if="selectedId">
          <button type="button" class="ghost danger" @click="onDelete(selectedId)">删除本场</button>
        </div>
      </header>

      <div v-if="current" class="tabs">
        <button type="button" :class="{ on: viewTab === 'review' }" @click="viewTab = 'review'">
          复盘
        </button>
        <button type="button" :class="{ on: viewTab === 'stats' }" @click="viewTab = 'stats'">
          统计
        </button>
      </div>

      <p v-if="hint" class="banner">{{ hint }}</p>
      <p v-if="loading" class="banner">加载中…</p>

      <template v-if="current && viewTab === 'review'">
        <div class="review-body">
          <div class="stats-row">
            <span>弹幕 <b>{{ current.totals.chat }}</b></span>
            <span>礼物 <b>{{ current.totals.gift }}</b></span>
            <span>抖钻 <b>{{ current.totals.giftValue }}</b></span>
            <span>进场 <b>{{ current.totals.enter }}</b></span>
            <span>点赞 <b>{{ current.totals.like }}</b></span>
            <span>关注 <b>{{ current.totals.follow }}</b></span>
            <span>粉丝团 <b>{{ current.totals.fansclubJoin + current.totals.fansclubUpgrade }}</b></span>
            <span>整蛊 <b>{{ current.totals.prank }}</b></span>
            <span>峰值在线 <b>{{ current.totals.peakOnline }}</b></span>
          </div>

          <div class="panels">
            <div class="panel">
              <header>
                <strong>事件流</strong>
                <DarkSelect v-model="filterKind" :options="filterOptions" />
              </header>
              <div ref="feedRef" class="feed scroll">
                <template v-for="(e, i) in feedEvents" :key="i">
                  <!-- 整蛊：对齐监听页整蛊日志 -->
                  <article v-if="e.kind === 'prank'" class="action">
                    <strong>{{ e.ruleName || '整蛊' }}</strong>
                    <span class="msg">{{ e.message || '' }}</span>
                    <span class="time">{{ fmtClock(e.at) }}</span>
                  </article>
                  <!-- 礼物：对齐监听礼物行 -->
                  <article v-else-if="e.kind === 'gift'" class="gift-row">
                    <span class="user">{{ e.user }}</span>
                    <span class="text">送出了</span>
                    <img
                      class="icon"
                      :src="giftIconOf(e)"
                      :alt="e.giftName || 'gift'"
                      referrerpolicy="no-referrer"
                      loading="lazy"
                    />
                    <span class="name">{{ e.giftName }}</span>
                    <span class="count">x{{ e.giftCount || 1 }}</span>
                    <b v-if="e.giftValue">{{ e.giftValue }}</b>
                    <span class="time">{{ fmtClock(e.at) }}</span>
                  </article>
                  <!-- 其它：对齐实时互动行 -->
                  <div v-else class="row" :data-type="e.kind">
                    <span class="tag">{{ tagLabel(e.kind) }}</span>
                    <span v-if="e.kind !== 'room'" class="user">{{ e.user }}</span>
                    <span v-if="e.kind === 'enter'" class="text">来了</span>
                    <span v-else-if="e.kind === 'like'" class="text">点赞</span>
                    <span v-else-if="e.kind === 'follow'" class="text">关注了主播</span>
                    <span v-else-if="e.kind === 'fansclub_join'" class="text">加入粉丝团</span>
                    <span v-else-if="e.kind === 'fansclub_upgrade'" class="text">粉丝团升级</span>
                    <span v-else-if="e.kind === 'room'" class="text"
                      >在线 {{ e.online ?? '—' }} · 点赞总量 {{ e.likeTotal ?? '—' }}</span
                    >
                    <span v-else class="text emoji-line">
                      <template v-for="(part, pi) in chatPartsOf(e)" :key="pi">
                        <img
                          v-if="part.type === 'image'"
                          class="emoji-img"
                          :src="part.value"
                          alt=""
                          referrerpolicy="no-referrer"
                          loading="lazy"
                        />
                        <span v-else-if="part.type === 'emoji'" class="emoji">{{ part.value }}</span>
                        <span v-else>{{ part.value }}</span>
                      </template>
                    </span>
                    <span v-if="e.kind === 'like'" class="count">x{{ e.likeCount || 1 }}</span>
                    <span class="time">{{ fmtClock(e.at) }}</span>
                  </div>
                </template>
                <p v-if="!feedEvents.length" class="empty">本场没有此类事件（或未开启录制）</p>
              </div>
            </div>

            <div class="panel">
              <header>
                <strong>整蛊统计</strong>
                <span>共 {{ current.totals.prank }} 次</span>
              </header>
              <ul class="stat-list scroll">
                <li v-for="r in prankRows" :key="r.name">
                  <span>{{ r.name }}</span>
                  <b>{{ r.count }}</b>
                </li>
                <li v-if="!prankRows.length" class="empty">本场无整蛊触发</li>
              </ul>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="current && viewTab === 'stats'">
        <div class="stats-body scroll">
        <p class="tip">
          与最近 {{ historyForCompare.length }} 场历史均值对比（不含本场）。正数=高于均值。
        </p>
        <div class="cards" v-if="compare">
          <div
            class="card"
            v-for="row in [
              { k: '弹幕', cur: current.totals.chat, avg: compare.avg.chat, d: compare.deltas.chat },
              { k: '礼物件数', cur: current.totals.gift, avg: compare.avg.gift, d: compare.deltas.gift },
              {
                k: '礼物抖钻',
                cur: current.totals.giftValue,
                avg: compare.avg.giftValue,
                d: compare.deltas.giftValue,
              },
              { k: '进场', cur: current.totals.enter, avg: compare.avg.enter, d: compare.deltas.enter },
              { k: '点赞次数', cur: current.totals.like, avg: compare.avg.like, d: compare.deltas.like },
              { k: '关注', cur: current.totals.follow, avg: compare.avg.follow, d: compare.deltas.follow },
              {
                k: '加粉丝团',
                cur: current.totals.fansclubJoin,
                avg: compare.avg.fansclubJoin,
                d: compare.deltas.fansclubJoin,
              },
              { k: '整蛊触发', cur: current.totals.prank, avg: compare.avg.prank, d: compare.deltas.prank },
              {
                k: '峰值在线',
                cur: current.totals.peakOnline,
                avg: compare.avg.peakOnline,
                d: compare.deltas.peakOnline,
              },
            ]"
            :key="row.k"
          >
            <div class="k">{{ row.k }}</div>
            <div class="v">{{ row.cur }}</div>
            <div class="a">历史均值 {{ row.avg }}</div>
            <div class="d" :class="deltaClass(row.d)">{{ deltaText(row.d) }}</div>
          </div>
        </div>
        <p v-if="!historyForCompare.length" class="empty">需要至少 2 场复盘才能做对比。</p>

        <div class="panel" style="margin-top: 12px">
          <header><strong>本场整蛊分布</strong></header>
          <ul class="stat-list scroll" style="max-height: 240px">
            <li v-for="r in prankRows" :key="r.name">
              <span>{{ r.name }}</span>
              <b>{{ r.count }}</b>
            </li>
            <li v-if="!prankRows.length" class="empty">无整蛊数据</li>
          </ul>
        </div>
        </div>
      </template>

      <p v-else-if="!current && !loading" class="empty big">选择左侧场次开始复盘</p>
    </div>
  </section>
</template>

<style scoped>
.replay {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 240px 1fr;
  background: var(--bg-panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}

.side {
  border-right: 1px solid var(--line);
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.side-title {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--muted);
}

.sessions {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sess {
  text-align: left;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sess.on {
  border-color: rgba(255, 138, 61, 0.45);
  background: rgba(255, 138, 61, 0.12);
}

.sess span {
  font-size: 11px;
  color: var(--muted);
}

.sess .mini {
  font-size: 10px;
}

.main {
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}

.head h1 {
  margin: 0;
  font-size: 18px;
}

.head p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.tabs {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.tabs button {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  border-radius: 8px;
  padding: 5px 14px;
  font-size: 13px;
  cursor: pointer;
}

.tabs button.on {
  border-color: rgba(255, 138, 61, 0.5);
  background: rgba(255, 138, 61, 0.16);
  color: var(--accent-2);
}

.banner {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 138, 61, 0.12);
  color: var(--accent-2);
  font-size: 13px;
}

.stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  font-size: 12px;
  color: var(--muted);
  flex-shrink: 0;
}

.stats-row b {
  color: var(--accent-2);
}

.review-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.stats-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.panels {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 10px;
  min-height: 0;
  flex: 1;
  height: 100%;
}

.panel {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.16);
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  gap: 8px;
}

.panel header :deep(.dark-select) {
  width: auto;
  min-width: 110px;
  font-size: 12px;
}

.feed {
  margin: 0;
  padding: 8px 10px 12px;
  overflow: auto;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-list {
  list-style: none;
  margin: 0;
  padding: 6px 8px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.stat-list li {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  padding: 5px 4px;
  font-size: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.row {
  display: grid;
  grid-template-columns: 22px auto 1fr auto auto;
  align-items: center;
  column-gap: 8px;
  min-height: 28px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.25;
}

.row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.row[data-type='enter'] {
  grid-template-columns: 22px auto 1fr auto;
}

.row[data-type='enter'] .user {
  color: var(--enter-dim);
  font-weight: 500;
}

.row[data-type='enter'] .text {
  color: var(--enter-text);
}

.row[data-type='like'] {
  grid-template-columns: 22px auto 1fr auto auto;
}

.row[data-type='like'] .user,
.row[data-type='like'] .text,
.row[data-type='like'] .count {
  color: var(--like-yellow);
  font-weight: 500;
}

.row[data-type='follow'] .user,
.row[data-type='follow'] .text {
  color: var(--follow-gold);
}

.row[data-type='room'] {
  grid-template-columns: 22px 1fr auto;
}

.tag {
  width: 22px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 10px;
  color: #1a120c;
  background: var(--chat);
}

.user {
  color: var(--name-chat);
  font-weight: 600;
  max-width: 10em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.emoji-line {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.emoji-img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.emoji {
  font-size: 14px;
}

.count {
  color: var(--gift-label);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.time {
  color: var(--muted);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}

.gift-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 13px;
}

.gift-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.gift-row .user {
  color: var(--name-gift);
}

.gift-row .text {
  color: #e8c98a;
}

.gift-row .icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  border-radius: 4px;
}

.gift-row .name {
  color: var(--name-gift);
  font-weight: 600;
}

.gift-row b {
  color: var(--accent-2);
  font-size: 12px;
  margin-left: auto;
}

.action {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.25;
}

.action:hover {
  background: rgba(255, 255, 255, 0.03);
}

.action strong {
  color: var(--accent-2);
  font-weight: 600;
  flex-shrink: 0;
}

.action .msg {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.feed .empty,
.stat-list .empty,
.empty {
  color: var(--muted);
  font-size: 12px;
  padding: 16px 8px;
  margin: 0;
}

.empty.big {
  text-align: center;
  padding: 48px 12px;
}

.ghost {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}

.ghost.danger:hover {
  color: #ff8f8f;
  border-color: rgba(255, 100, 100, 0.45);
}

.tip {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}

.card {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
}

.card .k {
  font-size: 12px;
  color: var(--muted);
}

.card .v {
  font-size: 22px;
  font-weight: 600;
  margin: 4px 0;
}

.card .a {
  font-size: 11px;
  color: var(--muted);
}

.card .d {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 600;
}

.card .d.up {
  color: #8dffa0;
}

.card .d.down {
  color: #ff8f8f;
}

.card .d.flat {
  color: var(--muted);
}
</style>
