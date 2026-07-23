<script setup lang="ts">
import { computed } from 'vue'
import type { FiredAction, PrankRule } from '../types'
import FontGear from './FontGear.vue'
import { usePanelFonts } from '../composables/usePanelFonts'

const props = defineProps<{
  actions: FiredAction[]
  rules: PrankRule[]
}>()

const { fonts } = usePanelFonts()

/** 按规则汇总本场触发次数 */
const rows = computed(() => {
  const map = new Map<string, { ruleId: string; name: string; count: number; lastAt: number }>()
  for (const a of props.actions) {
    const key = a.ruleId || a.ruleName
    const prev = map.get(key)
    if (prev) {
      prev.count += 1
      if (a.at > prev.lastAt) prev.lastAt = a.at
    } else {
      map.set(key, {
        ruleId: a.ruleId,
        name: a.ruleName || '未命名',
        count: 1,
        lastAt: a.at || 0,
      })
    }
  }
  for (const r of props.rules) {
    if (!r.enabled) continue
    if (!map.has(r.id)) {
      map.set(r.id, { ruleId: r.id, name: r.name, count: 0, lastAt: 0 })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
})

const total = computed(() => props.actions.length)
const hitRules = computed(() => rows.value.filter((r) => r.count > 0).length)
</script>

<template>
  <section class="panel" :style="{ '--row-font': fonts.prankStats + 'px' }">
    <header>
      <h2>整蛊统计</h2>
      <div class="head-right">
        <span>共 {{ total }} 次 · {{ hitRules }} 条规则</span>
        <FontGear panel="prankStats" />
      </div>
    </header>
    <div class="list scroll">
      <div v-for="row in rows" :key="row.ruleId" class="row">
        <span class="name" :title="row.name">{{ row.name }}</span>
        <span class="count" :class="{ zero: !row.count }">{{ row.count }}</span>
      </div>
      <p v-if="!rows.length" class="empty">暂无规则，去「整蛊规则」页添加</p>
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
  gap: 8px;
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
  min-width: 0;
}

.head-right > span {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}

.list {
  flex: 1;
  padding: 6px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 28px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: var(--row-font, 13px);
}

.row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.count {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--accent-2);
  min-width: 1.6em;
  text-align: right;
}

.count.zero {
  color: var(--muted);
  font-weight: 500;
}

.empty {
  margin: auto;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}
</style>
