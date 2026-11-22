<script setup lang="ts">
import { reactive, ref } from 'vue'
import { loadReplayConfig, saveReplayConfig } from '../lib/replay/settings'
import type { ReplayConfig } from '../lib/replay/types'

const emit = defineEmits<{ hint: [string]; changed: [ReplayConfig] }>()

const form = reactive<ReplayConfig>({ ...loadReplayConfig() })
const saved = ref(false)

function persist() {
  saveReplayConfig({ ...form })
  saved.value = true
  emit('changed', { ...form })
  emit('hint', '复盘配置已保存')
  window.setTimeout(() => {
    saved.value = false
  }, 1500)
}
</script>

<template>
  <div class="replay-cfg">
    <fieldset class="box">
      <legend>自动录制</legend>
      <p class="tip">
        监听连接成功后自动开录，断开 / 直播结束时自动落盘到「文档\直播助手\replays」。用于整场复盘与对比。
      </p>
      <label class="chk">
        <input v-model="form.enabled" type="checkbox" @change="persist" />
        开启直播复盘录制
      </label>
    </fieldset>

    <fieldset class="box">
      <legend>记录内容</legend>
      <p class="tip">进场、点赞量通常很大，默认关闭；需要时再勾选。</p>
      <div class="grid">
        <label class="chk"><input v-model="form.recordChat" type="checkbox" @change="persist" /> 弹幕</label>
        <label class="chk"><input v-model="form.recordGift" type="checkbox" @change="persist" /> 礼物</label>
        <label class="chk"><input v-model="form.recordEnter" type="checkbox" @change="persist" /> 进入房间</label>
        <label class="chk"><input v-model="form.recordLike" type="checkbox" @change="persist" /> 点赞</label>
        <label class="chk"><input v-model="form.recordFollow" type="checkbox" @change="persist" /> 关注</label>
        <label class="chk"><input v-model="form.recordFansclub" type="checkbox" @change="persist" /> 粉丝团加入/升级</label>
        <label class="chk"><input v-model="form.recordPrank" type="checkbox" @change="persist" /> 整蛊触发</label>
        <label class="chk"><input v-model="form.recordRoom" type="checkbox" @change="persist" /> 在线人数峰值</label>
      </div>
    </fieldset>

    <fieldset class="box">
      <legend>容量</legend>
      <div class="row2">
        <label>
          <span>单场最多事件条数</span>
          <input v-model.number="form.maxEventsPerSession" type="number" min="500" max="50000" step="500" @change="persist" />
        </label>
        <label>
          <span>最多保留场次</span>
          <input v-model.number="form.maxSessions" type="number" min="5" max="200" step="1" @change="persist" />
        </label>
      </div>
      <p class="tip">超出后自动丢掉最早场次。改动即时保存{{ saved ? ' · 已写入' : '' }}。</p>
    </fieldset>
  </div>
</template>

<style scoped>
.replay-cfg {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 640px;
}

.box {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px 14px 16px;
}

.box legend {
  padding: 0 6px;
  color: var(--muted);
  font-size: 12px;
}

.tip {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}

.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}

.chk input {
  accent-color: var(--accent);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}

.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.row2 label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.row2 input {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 6px 8px;
}
</style>
