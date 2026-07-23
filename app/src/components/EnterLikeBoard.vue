<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { Splitpanes, Pane } from 'splitpanes'
import type { SplitpanesResizedPayload } from 'splitpanes'
import type { LiveEvent } from '../types'
import FontGear from './FontGear.vue'
import { usePanelFonts } from '../composables/usePanelFonts'

const props = defineProps<{
  enters: LiveEvent[]
  likes: LiveEvent[]
  /** 进场 / 点赞 高度百分比 */
  rowSizes: [number, number]
}>()

const emit = defineEmits<{
  'update:rowSizes': [[number, number]]
}>()

const { fonts } = usePanelFonts()

/** 按用户聚合点赞总数，按点赞量降序 */
const likeRows = computed(() => {
  const map = new Map<string, { user: string; count: number; ts: number }>()
  for (const e of props.likes) {
    const add = Number(e.extra?.count ?? 1) || 1
    const prev = map.get(e.user)
    const ts = e.ts ?? Date.now()
    if (prev) {
      prev.count += add
      if (ts > prev.ts) prev.ts = ts
    } else {
      map.set(e.user, { user: e.user, count: add, ts })
    }
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || b.ts - a.ts)
    .slice(0, 100)
})

const enterList = computed(() => props.enters.slice(-120))

const enterRef = ref<HTMLElement | null>(null)
const likeRef = ref<HTMLElement | null>(null)

/** 刚点赞的用户淡橙高亮 3 秒 */
const flashMap = reactive<Record<string, boolean>>({})
const flashTimers = new Map<string, ReturnType<typeof setTimeout>>()

function flashUser(user: string) {
  if (!user) return
  flashMap[user] = true
  const prev = flashTimers.get(user)
  if (prev) clearTimeout(prev)
  flashTimers.set(
    user,
    setTimeout(() => {
      delete flashMap[user]
      flashTimers.delete(user)
    }, 3000),
  )
}

async function stick(el: HTMLElement | null) {
  await nextTick()
  if (!el) return
  el.scrollTop = el.scrollHeight
}

watch(
  () => props.enters.length,
  () => {
    void stick(enterRef.value)
  },
)

watch(
  () => props.likes.length,
  (len, prevLen) => {
    if (prevLen == null || len <= prevLen) return
    const newest = props.likes.slice(prevLen)
    for (const e of newest) {
      if (e.user) flashUser(e.user)
    }
    // 高亮行滚进可视区（按点赞量排序，不一定在底部）
    void nextTick(() => {
      const el = likeRef.value
      if (!el) return
      const user = newest[newest.length - 1]?.user
      if (!user) return
      const row = el.querySelector(`[data-user="${CSS.escape(user)}"]`) as HTMLElement | null
      row?.scrollIntoView({ block: 'nearest' })
    })
  },
)

onBeforeUnmount(() => {
  for (const t of flashTimers.values()) clearTimeout(t)
  flashTimers.clear()
})

function onResized(payload: SplitpanesResizedPayload) {
  const panes = payload.panes
  if (panes.length < 2) return
  emit('update:rowSizes', [panes[0].size, panes[1].size])
}
</script>

<template>
  <Splitpanes class="mid-split" horizontal @resized="onResized">
    <Pane :size="rowSizes[0]" :min-size="18">
      <section class="panel" :style="{ '--row-font': fonts.enter + 'px' }">
        <header>
          <h2>进场</h2>
          <div class="head-right">
            <span>{{ enters.length }}</span>
            <FontGear panel="enter" />
          </div>
        </header>
        <div ref="enterRef" class="list scroll">
          <div v-for="(e, i) in enterList" :key="e.uid || `${e.ts}-e-${i}`" class="row enter">
            <span class="user">{{ e.user }}</span>
            <span class="text">来了</span>
          </div>
          <p v-if="!enters.length" class="empty">还没有人进场</p>
        </div>
      </section>
    </Pane>
    <Pane :size="rowSizes[1]" :min-size="18">
      <section class="panel" :style="{ '--row-font': fonts.like + 'px' }">
        <header>
          <h2>点赞</h2>
          <div class="head-right">
            <span>{{ likeRows.length }} 人</span>
            <FontGear panel="like" />
          </div>
        </header>
        <div ref="likeRef" class="list scroll">
          <div
            v-for="row in likeRows"
            :key="row.user"
            class="row like"
            :class="{ flash: !!flashMap[row.user] }"
            :data-user="row.user"
          >
            <span class="user">{{ row.user }}</span>
            <span class="text">点赞</span>
            <span class="count">x{{ row.count }}</span>
          </div>
          <p v-if="!likeRows.length" class="empty">还没有点赞</p>
        </div>
      </section>
    </Pane>
  </Splitpanes>
</template>

<style scoped>
.mid-split {
  height: 100%;
  min-height: 0;
}

.mid-split :deep(.splitpanes__pane) {
  background: transparent;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.mid-split.splitpanes--horizontal > :deep(.splitpanes__splitter) {
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

.mid-split.splitpanes--horizontal > :deep(.splitpanes__splitter::before) {
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

.mid-split.splitpanes--horizontal > :deep(.splitpanes__splitter:hover::before),
.mid-split.splitpanes--horizontal.splitpanes--dragging > :deep(.splitpanes__splitter::before) {
  background: rgba(232, 201, 138, 0.7);
}

.panel {
  flex: 1;
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
  padding: 6px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  padding: 2px 4px;
  border-radius: 4px;
  font-size: var(--row-font, 12px);
  transition: background-color 0.35s ease;
}

.row.enter {
  grid-template-columns: auto 1fr;
  min-height: 22px;
}

.row.enter .user {
  color: var(--enter-dim);
  font-weight: 500;
  max-width: 9em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row.enter .text {
  color: var(--enter-text);
}

.row.like .user,
.row.like .text,
.row.like .count {
  color: var(--like-yellow);
  font-weight: 500;
}

.row.like .user {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row.like.flash {
  background: rgba(255, 168, 80, 0.22);
}

.count {
  font-variant-numeric: tabular-nums;
}

.empty {
  margin: auto;
  color: var(--muted);
  font-size: 12px;
}
</style>
