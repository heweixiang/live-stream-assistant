<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

defineProps<{
  chatCount: number
  giftCount: number
  enterCount: number
  onlineCount: number | null
  likeTotal: number | null
  onlineText?: string
  likeText?: string
  showClear?: boolean
  /** 非管理员时显示顶栏提示图标 */
  showAdminWarn?: boolean
}>()

defineEmits<{ clear: []; exportConfig: []; relaunchAdmin: [] }>()

const tipOpen = ref(false)
const tipStyle = ref<Record<string, string>>({})
const tipBtn = ref<HTMLElement | null>(null)
let hideTimer: ReturnType<typeof setTimeout> | null = null

function fmt(n: number | null) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 10000) {
    const w = n / 10000
    return `${w >= 100 ? w.toFixed(0) : w.toFixed(1).replace(/\.0$/, '')}万`
  }
  return String(n)
}

function placeTip() {
  const el = tipBtn.value
  if (!el) return
  const r = el.getBoundingClientRect()
  tipStyle.value = {
    position: 'fixed',
    top: `${Math.round(r.bottom + 8)}px`,
    left: `${Math.round(r.left + r.width / 2)}px`,
    transform: 'translateX(-50%)',
  }
}

function showTip() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  placeTip()
  tipOpen.value = true
}

function scheduleHide() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    tipOpen.value = false
    hideTimer = null
  }, 120)
}

onBeforeUnmount(() => {
  if (hideTimer) clearTimeout(hideTimer)
})
</script>

<template>
  <div class="stats">
    <div class="stats-scroll">
      <span class="item"><em>弹幕总量</em><b>{{ chatCount }}</b></span>
      <span class="item"><em>礼物数量</em><b>{{ giftCount }}</b></span>
      <span class="item"><em>进场数量</em><b>{{ enterCount }}</b></span>
      <span class="item"><em>当前人数</em><b>{{ onlineText || fmt(onlineCount) }}</b></span>
      <span class="item"><em>点赞总数</em><b>{{ likeText ? likeText.replace(/本场点赞/g, '').trim() || fmt(likeTotal) : fmt(likeTotal) }}</b></span>
      <button
        v-if="showAdminWarn"
        ref="tipBtn"
        type="button"
        class="admin-tip"
        aria-label="当前不是管理员权限"
        @mouseenter="showTip"
        @mouseleave="scheduleHide"
        @focus="showTip"
        @blur="scheduleHide"
      >
        ?
      </button>
    </div>
    <div class="actions">
      <button type="button" class="clear" title="导出整夹数据包 zip（配置+复盘+礼物+录音）" @click="$emit('exportConfig')">
        导出数据包
      </button>
      <button v-if="showClear" type="button" class="clear" @click="$emit('clear')">清空列表</button>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="showAdminWarn && tipOpen"
      class="admin-tip-pop"
      role="tooltip"
      :style="tipStyle"
      @mouseenter="showTip"
      @mouseleave="scheduleHide"
    >
      <p>当前不是管理员权限，关闭进程 / 部分整蛊可能失败。</p>
      <button type="button" class="admin-go" @click="$emit('relaunchAdmin')">以管理员重新启动</button>
    </div>
  </Teleport>
</template>

<style scoped>
.stats {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: visible;
}

.stats-scroll {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
  /* 避免裁切右侧 ? 图标的悬浮层锚点 */
  padding: 2px 0;
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

.admin-tip {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin: 0;
  padding: 0;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 180, 60, 0.9);
  background: transparent;
  color: #ffc978;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  flex-shrink: 0;
  cursor: help;
}

.admin-tip:hover,
.admin-tip:focus-visible {
  border-color: #ffc978;
  color: #ffe0b0;
  outline: none;
}
</style>

<style>
/* Teleport 到 body，不能用 scoped */
.admin-tip-pop {
  z-index: 9999;
  width: max-content;
  max-width: 280px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 180, 60, 0.45);
  background: #2a1f16;
  color: #ffd7a8;
  font-size: 12px;
  line-height: 1.45;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
}

.admin-tip-pop p {
  margin: 0 0 8px;
}

.admin-tip-pop .admin-go {
  display: block;
  width: 100%;
  border: 0;
  border-radius: 6px;
  padding: 6px 10px;
  background: linear-gradient(135deg, #ff8a3d, #ffb15a);
  color: #1a120c;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
</style>
