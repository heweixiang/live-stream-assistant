<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { FiredAction } from '../types'
import FontGear from './FontGear.vue'
import { usePanelFonts } from '../composables/usePanelFonts'

const props = defineProps<{
  actions: FiredAction[]
}>()

const { fonts } = usePanelFonts()
const listRef = ref<HTMLElement | null>(null)
/** 新触发条目淡橙高亮（约 5 秒） */
const flashMap = reactive<Record<string, boolean>>({})
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function timeText(ts?: number) {
  if (!ts) return ''
  const d = new Date(ts > 1e12 ? ts : ts * 1000)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

function flash(id: string) {
  if (!id) return
  flashMap[id] = true
  const prev = timers.get(id)
  if (prev) clearTimeout(prev)
  timers.set(
    id,
    setTimeout(() => {
      delete flashMap[id]
      timers.delete(id)
    }, 5000),
  )
}

async function scrollToBottom() {
  await nextTick()
  const el = listRef.value
  if (el) el.scrollTop = el.scrollHeight
}

onMounted(() => {
  void scrollToBottom()
})

watch(
  () => props.actions.map((a) => a.id).join(','),
  (ids, prev) => {
    // 首次挂载不刷高亮，只处理后续新增
    if (prev == null) return
    if (!ids) return
    const prevSet = new Set(prev.split(',').filter(Boolean))
    for (const a of props.actions) {
      if (!prevSet.has(a.id)) flash(a.id)
    }
    void scrollToBottom()
  },
)

onBeforeUnmount(() => {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
})
</script>

<template>
  <section class="panel" :style="{ '--row-font': fonts.prankLog + 'px' }">
    <header>
      <h2>整蛊日志</h2>
      <div class="head-right">
        <span>{{ actions.length }}</span>
        <FontGear panel="prankLog" />
      </div>
    </header>
    <div ref="listRef" class="list scroll">
      <article
        v-for="a in actions"
        :key="a.id"
        class="action"
        :class="{ flash: !!flashMap[a.id] }"
      >
        <strong>{{ a.ruleName }}</strong>
        <span class="msg">{{ a.message }}</span>
        <span class="time">{{ timeText(a.at) }}</span>
      </article>
      <p v-if="!actions.length" class="empty">规则命中后会出现在这里</p>
    </div>
  </section>
</template>

<style scoped>
.panel {
  min-height: 0;
  height: 100%;
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

.action {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: var(--row-font, 13px);
  line-height: 1.25;
  border: 1px solid transparent;
  transition: background-color 0.45s ease, border-color 0.45s ease;
}

.action:hover {
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--line);
}

.action.flash {
  background: rgba(255, 168, 80, 0.22);
  border-color: rgba(255, 168, 80, 0.35);
}

.action strong {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--accent-2);
  max-width: 5.5em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.msg {
  flex: 1;
  min-width: 0;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  color: var(--muted);
  font-size: 0.85em;
  white-space: nowrap;
  flex-shrink: 0;
}

.empty {
  color: var(--muted);
  text-align: center;
  margin: auto;
  font-size: 13px;
}
</style>
