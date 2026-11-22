<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { giftFallbackIcon, resolveChatParts } from '../lib/douyinEmoji'
import type { LiveEvent } from '../types'
import FontGear from './FontGear.vue'
import { usePanelFonts } from '../composables/usePanelFonts'

const props = defineProps<{
  events: LiveEvent[]
  roomState?: 'disconnected' | 'connecting' | 'connected'
}>()
const listRef = ref<HTMLElement | null>(null)
const stickBottom = ref(true)
const { fonts } = usePanelFonts()

function onScroll() {
  const el = listRef.value
  if (!el) return
  stickBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

async function scrollToBottom(force = false) {
  await nextTick()
  const el = listRef.value
  if (!el) return
  if (!force && !stickBottom.value) return
  el.scrollTop = el.scrollHeight
}

/** 切回监听页重建时强制滚底（数据仍在、组件已销毁重建） */
onMounted(() => {
  stickBottom.value = true
  void scrollToBottom(true)
})

watch(
  () => props.events.length,
  () => {
    void scrollToBottom()
  },
)

watch(
  () => {
    const last = props.events[props.events.length - 1]
    return last
      ? `${last.uid}-${last.repeat}-${last.gift_count}-${last.extra?.count}`
      : ''
  },
  () => {
    void scrollToBottom()
  },
)

function label(type: string) {
  const map: Record<string, string> = {
    chat: '弹',
    gift: '礼',
    enter: '进',
    like: '赞',
    follow: '关',
    notice: '喜',
  }
  return map[type] ?? type.slice(0, 1)
}

function giftIcon(e: LiveEvent) {
  return e.gift_icon || giftFallbackIcon(e.gift_name)
}

function chatParts(e: LiveEvent) {
  return resolveChatParts(e.content, e.content_parts as { type: 'text' | 'emoji' | 'image'; value: string }[] | undefined)
}

/** 系统恭喜文案里已含昵称时，不再重复显示 user 列 */
function noticeHideUser(e: LiveEvent) {
  const c = e.content || ''
  return c.includes(e.user) || e.user === '系统'
}
</script>

<template>
  <section class="panel" :style="{ '--row-font': fonts.feed + 'px' }">
    <header>
      <h2>实时互动</h2>
      <div class="head-right">
        <span>{{ events.length }} 行</span>
        <FontGear panel="feed" />
      </div>
    </header>
    <div ref="listRef" class="list scroll" @scroll="onScroll">
      <div
        v-for="e in events"
        :key="e.uid || `${e.ts}-${e.user}-${e.content}-${e.gift_name}`"
        class="row"
        :data-type="e.type"
        :class="{ 'notice-full': e.type === 'notice' && noticeHideUser(e) }"
      >
        <img
          v-if="e.type === 'gift'"
          class="gift-icon"
          :src="giftIcon(e)"
          :alt="e.gift_name || 'gift'"
          referrerpolicy="no-referrer"
          loading="lazy"
        />
        <span v-else-if="e.type === 'notice'" class="tag notice-tag">喜</span>
        <span v-else-if="e.type !== 'enter' && e.type !== 'like'" class="tag">{{ label(e.type) }}</span>

        <span v-if="!(e.type === 'notice' && noticeHideUser(e))" class="user">{{ e.user }}</span>

        <span v-if="e.type === 'gift'" class="text gift-text">
          送出了 <b>{{ e.gift_name }}</b>
        </span>
        <span v-else-if="e.type === 'notice'" class="text notice-text">{{ e.content }}</span>
        <span v-else-if="e.type === 'like'" class="text">点赞</span>
        <span v-else-if="e.type === 'enter'" class="text">来了</span>
        <span v-else-if="e.type === 'follow'" class="text">关注了主播</span>
        <span v-else class="text emoji-line">
          <template v-for="(part, i) in chatParts(e)" :key="i">
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

        <span v-if="e.type === 'gift'" class="count">x{{ e.gift_count || 1 }}</span>
        <span v-else-if="e.type === 'like'" class="count">x{{ Number(e.extra?.count ?? 1) }}</span>
        <span v-else-if="e.type === 'chat' && (e.repeat || 1) > 1" class="count">x{{ e.repeat }}</span>
      </div>
      <p v-if="!events.length" class="empty">
        <template v-if="roomState === 'connected'">暂无互动</template>
        <template v-else-if="roomState === 'connecting'">正在连接直播间…</template>
        <template v-else>填写直播号后点「连接」</template>
      </p>
    </div>
  </section>
</template>

<style scoped>
.panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 8px;
  border-bottom: 1px solid var(--line);
}

h2 {
  margin: 0;
  font-size: 15px;
}

.head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.head-right > span {
  color: var(--muted);
  font-size: 12px;
}

.list {
  flex: 1;
  padding: 8px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row {
  display: grid;
  grid-template-columns: 22px auto 1fr auto;
  align-items: center;
  column-gap: 8px;
  min-height: 28px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: var(--row-font, 13px);
  line-height: 1.25;
  animation: in 0.18s ease;
}

.row.notice-full {
  grid-template-columns: 22px 1fr;
}

.row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.row[data-type='enter'] {
  grid-template-columns: auto 1fr;
  min-height: 22px;
  padding: 1px 6px;
  column-gap: 6px;
}

.row[data-type='enter'] .user {
  color: var(--enter-dim);
  font-weight: 500;
  max-width: 9em;
}

.row[data-type='enter'] .text {
  color: var(--enter-text);
}

.row[data-type='like'] {
  grid-template-columns: auto 1fr auto;
  min-height: 24px;
  font-size: 12px;
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

.row[data-type='follow'] .tag {
  background: rgba(212, 180, 90, 0.22);
  color: #ffe9a8;
  font-weight: 700;
}

/* 系统恭喜：整行金色 */
.row[data-type='notice'] .notice-text,
.row[data-type='notice'] .user {
  color: #f0d078;
}

.row[data-type='notice'] .notice-tag {
  background: rgba(240, 208, 120, 0.2);
  color: #ffe9a8;
  font-weight: 700;
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
  overflow: hidden;
  white-space: nowrap;
}

.gift-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
}

.user {
  color: var(--name-chat);
  font-weight: 600;
  max-width: 10em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row[data-type='gift'] .user {
  color: var(--name-gift);
}

.text {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gift-text {
  color: #e8c98a;
}

.gift-text b {
  font-weight: 600;
  color: var(--name-gift);
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
  vertical-align: middle;
}

.emoji {
  font-size: 14px;
}

.count {
  color: var(--gift-label);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.empty {
  margin: auto;
  color: var(--muted);
  font-size: 13px;
}

@keyframes in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
