<script setup lang="ts">
defineProps<{
  chatCount: number
  giftCount: number
  enterCount: number
  onlineCount: number | null
  likeTotal: number | null
  onlineText?: string
  likeText?: string
  showClear?: boolean
}>()

defineEmits<{ clear: []; exportConfig: [] }>()

function fmt(n: number | null) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 10000) {
    const w = n / 10000
    return `${w >= 100 ? w.toFixed(0) : w.toFixed(1).replace(/\.0$/, '')}万`
  }
  return String(n)
}
</script>

<template>
  <div class="stats">
    <span class="item"><em>弹幕总量</em><b>{{ chatCount }}</b></span>
    <span class="item"><em>礼物数量</em><b>{{ giftCount }}</b></span>
    <span class="item"><em>进场数量</em><b>{{ enterCount }}</b></span>
    <span class="item"><em>当前人数</em><b>{{ onlineText || fmt(onlineCount) }}</b></span>
    <span class="item"><em>点赞总数</em><b>{{ likeText ? likeText.replace(/本场点赞/g, '').trim() || fmt(likeTotal) : fmt(likeTotal) }}</b></span>
    <div v-if="showClear" class="actions">
      <button type="button" class="clear" title="导出整夹数据包 zip（配置+录音）" @click="$emit('exportConfig')">
        导出数据包
      </button>
      <button type="button" class="clear" @click="$emit('clear')">清空列表</button>
    </div>
  </div>
</template>

<style scoped>
.stats {
  display: flex;
  align-items: center;
  gap: 18px;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow-x: auto;
  font-size: 13px;
}

.item {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  flex-shrink: 0;
}

.item em {
  font-style: normal;
  color: var(--muted);
}

.item b {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.clear {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.clear:hover {
  color: var(--text);
  border-color: rgba(255, 214, 170, 0.3);
}
</style>
