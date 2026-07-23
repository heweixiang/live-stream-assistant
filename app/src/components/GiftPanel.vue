<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { giftFallbackIcon } from '../lib/douyinEmoji'
import type { LiveEvent } from '../types'
import FontGear from './FontGear.vue'
import { usePanelFonts } from '../composables/usePanelFonts'

const props = defineProps<{
  gifts: LiveEvent[]
  /** 未登录 Cookie 时提示 */
  needCookie?: boolean
}>()

const listRef = ref<HTMLElement | null>(null)
const { fonts } = usePanelFonts()

function iconOf(g: LiveEvent) {
  return g.gift_icon || giftFallbackIcon(g.gift_name)
}

watch(
  () => props.gifts.length,
  async () => {
    await nextTick()
    const el = listRef.value
    if (el) el.scrollTop = el.scrollHeight
  },
)
</script>

<template>
  <section class="panel" :style="{ '--row-font': fonts.gift + 'px' }">
    <header>
      <h2>收到的礼物</h2>
      <div class="head-right">
        <span>{{ gifts.length }}</span>
        <FontGear panel="gift" />
      </div>
    </header>
    <div ref="listRef" class="list scroll">
      <article
        v-for="(g, i) in gifts"
        :key="g.uid || `${g.ts}-g-${i}`"
        class="gift"
      >
        <span class="user">{{ g.user }}</span>
        <span class="text">送出了</span>
        <img
          class="icon"
          :src="iconOf(g)"
          :alt="g.gift_name || 'gift'"
          referrerpolicy="no-referrer"
          loading="lazy"
        />
        <span class="name">{{ g.gift_name }}</span>
        <span class="count">x{{ g.gift_count || 1 }}</span>
        <b v-if="g.gift_value">{{ g.gift_value }}</b>
      </article>
      <p v-if="!gifts.length" class="empty">
        <template v-if="needCookie">点「扫码/手机登录」后重连，才能稳定收到礼物</template>
        <template v-else>还没有礼物</template>
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
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--line);
}

h2 {
  margin: 0;
  font-size: 14px;
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
  padding: 4px 8px 8px;
}

.gift {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 3px 4px;
  border-radius: 6px;
  font-size: var(--row-font, 13px);
}

.gift:hover {
  background: rgba(255, 255, 255, 0.03);
}

.icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
  border-radius: 6px;
  flex-shrink: 0;
}

.user {
  color: var(--name-gift);
  font-weight: 600;
  max-width: 6em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.text {
  color: #e8c98a;
  flex-shrink: 0;
}

.name {
  color: #ffd59a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.count {
  color: var(--gift);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.gift b {
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.empty {
  color: var(--muted);
  text-align: center;
  margin: 20px 12px;
  font-size: 12px;
  line-height: 1.5;
}
</style>
