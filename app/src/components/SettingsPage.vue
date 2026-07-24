<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AnnounceSettingsPanel from './AnnounceSettingsPanel.vue'
import {
  loadTtsSettings,
  saveTtsSettings,
  type TtsSettings,
  type VoiceSampleMeta,
} from '../lib/tts/settings'
import { speakText } from '../lib/tts/speak'

type SettingsMenuId = 'tts' | 'voice-clone' | 'announce' | 'general' | 'about'

const MENUS: { id: SettingsMenuId; label: string; desc: string; ready: boolean }[] = [
  { id: 'tts', label: 'TTS 语音', desc: 'MeloTTS / 本机', ready: true },
  { id: 'voice-clone', label: '语音克隆', desc: '录音样本管理', ready: true },
  { id: 'announce', label: '语音播报', desc: '点赞聚合 / 模板', ready: true },
  { id: 'general', label: '通用', desc: '权限 / 数据目录', ready: true },
  { id: 'about', label: '关于', desc: '版本与说明', ready: true },
]

const menu = ref<SettingsMenuId>('tts')
const form = reactive<TtsSettings>(loadTtsSettings())
const hint = ref('')
const testing = ref(false)
const testText = ref('欢迎来到直播间，这是内置语音试听。')

const samples = ref<VoiceSampleMeta[]>([])
const recording = ref(false)
const recordSec = ref(0)
const recError = ref('')
let mediaRecorder: MediaRecorder | null = null
let chunks: BlobPart[] = []
let recTimer: ReturnType<typeof setInterval> | null = null
let recStartedAt = 0
let stream: MediaStream | null = null

const canElectron = computed(() => !!window.liveAssistant?.getDataRoot)
const dataRoot = ref('')
const isAdmin = ref<boolean | null>(null)
const currentMenu = computed(() => MENUS.find((m) => m.id === menu.value) || MENUS[0])

async function refreshDataRoot() {
  if (!window.liveAssistant?.getDataRoot) {
    dataRoot.value = ''
    return
  }
  dataRoot.value = await window.liveAssistant.getDataRoot()
}

async function refreshAdmin() {
  if (!window.liveAssistant?.isAdmin) {
    isAdmin.value = null
    return
  }
  try {
    isAdmin.value = await window.liveAssistant.isAdmin()
  } catch {
    isAdmin.value = null
  }
}

async function relaunchAdmin() {
  try {
    await window.liveAssistant?.relaunchAsAdmin?.()
  } catch (e) {
    hint.value = e instanceof Error ? e.message : '提权失败'
  }
}
function persist() {
  saveTtsSettings({ ...form })
  hint.value = '已保存'
}

async function refreshSamples() {
  const api = window.liveAssistant
  if (!api?.listVoiceSamples) {
    samples.value = []
    return
  }
  samples.value = await api.listVoiceSamples()
}

watch(menu, (id) => {
  hint.value = ''
  if (id === 'voice-clone') void refreshSamples()
  if (id === 'general') {
    void refreshDataRoot()
    void refreshAdmin()
  }
})

onMounted(() => {
  void refreshSamples()
  void refreshDataRoot()
  void refreshAdmin()
})

onBeforeUnmount(() => {
  stopTracks()
  if (recTimer) clearInterval(recTimer)
})

function stopTracks() {
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
}

async function onTestSpeak() {
  testing.value = true
  hint.value = ''
  try {
    persist()
    // 试听不走排队，失败要直接抛出提示
    await speakText(testText.value, {
      rate: form.defaultRate,
      volume: form.defaultVolume,
      queue: false,
    })
    hint.value = form.provider === 'melo' ? 'MeloTTS 试听完成' : '本机 TTS 试听完成'
  } catch (e) {
    hint.value = e instanceof Error ? e.message : '试听失败'
  } finally {
    testing.value = false
  }
}

async function startRecord() {
  recError.value = ''
  const api = window.liveAssistant
  if (!api?.saveVoiceSample) {
    recError.value = '请在 Electron 桌面端录音（浏览器模式不支持落盘）'
    return
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunks = []
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime })
    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data)
    }
    mediaRecorder.onstop = () => {
      void finalizeRecord(mime)
    }
    mediaRecorder.start(200)
    recording.value = true
    recStartedAt = Date.now()
    recordSec.value = 0
    recTimer = setInterval(() => {
      recordSec.value = Math.floor((Date.now() - recStartedAt) / 1000)
    }, 200)
  } catch (e) {
    stopTracks()
    recError.value = e instanceof Error ? e.message : '无法打开麦克风'
  }
}

function stopRecord() {
  if (!recording.value) return
  recording.value = false
  if (recTimer) {
    clearInterval(recTimer)
    recTimer = null
  }
  mediaRecorder?.stop()
  mediaRecorder = null
  stopTracks()
}

async function finalizeRecord(mime: string) {
  try {
    const blob = new Blob(chunks, { type: mime })
    chunks = []
    if (blob.size < 500) {
      recError.value = '录音太短，请至少录几秒'
      return
    }
    const durationSec = Math.max(1, Math.round((Date.now() - recStartedAt) / 1000))
    if (durationSec < 3) {
      recError.value = '建议至少录 3 秒'
    }
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)
    const api = window.liveAssistant!
    const item = await api.saveVoiceSample({
      name: `克隆样本 ${new Date().toLocaleString()}`,
      base64,
      mime,
      durationSec,
    })
    await refreshSamples()
    hint.value = `已保存录音：${item.name}（${durationSec}s）`
  } catch (e) {
    recError.value = e instanceof Error ? e.message : '保存录音失败'
  }
}

async function playSample(id: string) {
  const api = window.liveAssistant
  if (!api?.readVoiceSample) return
  try {
    const url = await api.readVoiceSample(id)
    // webm 录音优先渲染进程；wav/mp3 走主进程更稳
    const isWebm = url.startsWith('data:audio/webm')
    if (!isWebm && api.playAudioDataUrl) {
      try {
        const res = await api.playAudioDataUrl(url, form.defaultVolume)
        if (res?.ok !== false) return
      } catch {
        // fallback below
      }
    }
    const audio = new Audio(url)
    audio.volume = Math.min(1, Math.max(0, form.defaultVolume || 1))
    await audio.play()
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error('样本播放失败'))
    })
  } catch (e) {
    hint.value = e instanceof Error ? e.message : '播放失败'
  }
}

async function removeSample(id: string) {
  const api = window.liveAssistant
  if (!api?.deleteVoiceSample) return
  await api.deleteVoiceSample(id)
  await refreshSamples()
}

function openClonesFolderHint() {
  hint.value = '录音保存在数据目录 voice-clones 下，可随时点「播」回听。'
}

async function openDataFolder() {
  const api = window.liveAssistant
  if (!api?.openDataFolder) {
    hint.value = '请使用桌面客户端打开数据目录'
    return
  }
  await api.openDataFolder()
  await refreshDataRoot()
  hint.value = '已打开数据目录'
}

async function exportZip() {
  const api = window.liveAssistant
  if (!api?.exportDataZip) {
    hint.value = '请使用桌面客户端导出 zip'
    return
  }
  const { flushAllToDisk } = await import('../lib/diskSync')
  await flushAllToDisk()
  const res = await api.exportDataZip()
  if (res.canceled) return
  if (!res.ok) {
    hint.value = res.error || '导出失败'
    return
  }
  hint.value = `已导出：${res.path}`
}

async function importZip() {
  const api = window.liveAssistant
  if (!api?.importDataZip) {
    hint.value = '请使用桌面客户端导入 zip'
    return
  }
  const res = await api.importDataZip()
  if (res.canceled) return
  if (!res.ok) {
    hint.value = res.error || '导入失败'
    return
  }
  const { bootstrapFromDisk } = await import('../lib/diskSync')
  await bootstrapFromDisk()
  Object.assign(form, loadTtsSettings())
  await refreshSamples()
  const ow = res.overwritten?.length || 0
  const sk = res.skipped?.length || 0
  const ad = res.added?.length || 0
  hint.value = `导入完成：覆盖配置 ${ow}，新增 ${ad}，跳过已有媒体 ${sk}（部分设置需刷新页面生效）`
}
</script>

<template>
  <section class="settings">
    <aside class="side">
      <div class="side-title">设置菜单</div>
      <button
        v-for="m in MENUS"
        :key="m.id"
        type="button"
        class="menu-item"
        :class="{ on: menu === m.id, soon: !m.ready }"
        @click="menu = m.id"
      >
        <strong>{{ m.label }}</strong>
        <span>{{ m.desc }}{{ m.ready ? '' : ' · 待扩展' }}</span>
      </button>
    </aside>

    <div class="main">
      <header class="head">
        <div>
          <h1>{{ currentMenu.label }}</h1>
          <p>{{ currentMenu.desc }}</p>
        </div>
        <div v-if="menu === 'tts' || menu === 'voice-clone'" class="head-acts">
          <button type="button" class="ghost" @click="persist">保存</button>
          <button
            v-if="menu === 'tts'"
            type="button"
            class="primary"
            :disabled="testing"
            @click="onTestSpeak"
          >
            {{ testing ? '试听中…' : '试听朗读' }}
          </button>
        </div>
      </header>

      <p v-if="hint" class="banner">{{ hint }}</p>

      <div v-if="menu === 'tts'" class="panel">
        <fieldset class="box">
          <legend>引擎</legend>
          <div class="modes">
            <label class="tg" :class="{ on: form.provider === 'melo' }">
              <input v-model="form.provider" type="radio" value="melo" @change="persist" />
              内置 MeloTTS（推荐）
            </label>
            <label class="tg" :class="{ on: form.provider === 'system' }">
              <input v-model="form.provider" type="radio" value="system" @change="persist" />
              本机系统语音
            </label>
          </div>

          <template v-if="form.provider === 'melo'">
            <label>
              <span>服务地址</span>
              <input
                v-model="form.meloUrl"
                placeholder="http://127.0.0.1:8766"
                @change="persist"
              />
            </label>
            <p class="tip">
              先另开终端运行 <code>npm run tts</code> 启动本地语音服务（首次加载模型约十几秒）。中文音色，免密钥。
            </p>
          </template>
          <p v-else class="tip">使用 Windows / 浏览器内置语音，无需密钥。</p>

          <div class="row2">
            <label>
              <span>默认语速 (0.5~2)</span>
              <input
                v-model.number="form.defaultRate"
                type="number"
                min="0.5"
                max="2"
                step="0.1"
                @change="persist"
              />
            </label>
            <label>
              <span>默认音量 (0~3，&gt;1 更响)</span>
              <input
                v-model.number="form.defaultVolume"
                type="number"
                min="0"
                max="3"
                step="0.1"
                @change="persist"
              />
            </label>
          </div>
          <p class="tip">音量超过 1 会对合成音频做增益放大（相对系统音量可更响），建议先试 1.5～2。</p>
          <label>
            <span>试听文本</span>
            <textarea v-model="testText" rows="3" />
          </label>
        </fieldset>
      </div>

      <div v-else-if="menu === 'voice-clone'" class="panel">
        <fieldset class="box">
          <legend>录音样本</legend>
          <p class="tip">
            录制并保存人声样本，可随时回听。当前朗读使用内置 MeloTTS
            固定中文声线（本地变声后续再接）。
          </p>

          <div class="rec-bar" style="margin-bottom: 12px">
            <button type="button" class="primary" :disabled="testing" @click="onTestSpeak">
              {{ testing ? '试听中…' : '试听当前朗读音色' }}
            </button>
          </div>

          <div class="rec-bar">
            <button v-if="!recording" type="button" class="primary" @click="startRecord">
              开始录音
            </button>
            <button v-else type="button" class="danger" @click="stopRecord">
              停止（已录 {{ recordSec }}s）
            </button>
            <button type="button" class="ghost" @click="openClonesFolderHint">存放说明</button>
          </div>
          <p v-if="recError" class="banner warn">{{ recError }}</p>

          <ul class="samples">
            <li v-for="s in samples" :key="s.id">
              <div>
                <strong>{{ s.name }}</strong>
                <small>
                  {{ s.durationSec ? `${s.durationSec}s · ` : ''
                  }}{{ Math.round((s.bytes || 0) / 1024) }}KB
                </small>
              </div>
              <div class="s-acts">
                <button type="button" @click="playSample(s.id)">播</button>
                <button type="button" @click="removeSample(s.id)">删</button>
              </div>
            </li>
            <li v-if="!samples.length" class="empty">暂无录音，先录一段自己的声音样本</li>
          </ul>
        </fieldset>
      </div>

      <div v-else-if="menu === 'announce'" class="panel wide">
        <AnnounceSettingsPanel @hint="(m) => (hint = m)" />
      </div>

      <div v-else-if="menu === 'general'" class="panel">
        <fieldset class="box">
          <legend>运行权限</legend>
          <p class="tip">
            关闭进程、部分键鼠整蛊建议以管理员运行。打包版启动时会自动请求 UAC；开发态可用
            <code>npm run app</code>（会弹 UAC）。
          </p>
          <p class="tip">
            当前状态：
            <strong v-if="isAdmin === true" style="color: #8dffa0">已是管理员</strong>
            <strong v-else-if="isAdmin === false" style="color: #ffb15a">非管理员</strong>
            <strong v-else>检测中 / 非桌面端</strong>
          </p>
          <div class="rec-bar">
            <button
              type="button"
              class="primary"
              :disabled="!canElectron || isAdmin === true"
              @click="relaunchAdmin"
            >
              以管理员重新启动
            </button>
          </div>
        </fieldset>
        <fieldset class="box">
          <legend>数据目录</legend>
          <p class="tip">
            配置、录音样本统一放在本机文件夹（默认：文档\直播助手）。导出即打成 zip；导入时
            <strong>配置文件覆盖</strong>，录音等媒体<strong>已存在则跳过</strong>。
          </p>
          <label>
            <span>当前路径</span>
            <input :value="dataRoot || (canElectron ? '加载中…' : '仅桌面客户端可用')" readonly />
          </label>
          <div class="rec-bar">
            <button type="button" class="primary" :disabled="!canElectron" @click="openDataFolder">
              打开文件夹
            </button>
            <button type="button" class="ghost" :disabled="!canElectron" @click="exportZip">
              导出数据包 (zip)
            </button>
            <button type="button" class="ghost" :disabled="!canElectron" @click="importZip">
              导入数据包 (zip)
            </button>
          </div>
        </fieldset>
      </div>

      <div v-else class="panel">
        <div class="placeholder">
          <h2>直播助手</h2>
          <p>桌面端整蛊 / 监听工具。设置项会陆续往左侧菜单扩展。</p>
          <p class="muted">版本 0.1.0</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 200px 1fr;
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
  overflow: auto;
}

.side-title {
  padding: 6px 10px 10px;
  font-size: 12px;
  color: var(--muted);
}

.menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text);
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
}

.menu-item strong {
  font-size: 13px;
  font-weight: 600;
}

.menu-item span {
  font-size: 11px;
  color: var(--muted);
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.menu-item.on {
  background: rgba(255, 138, 61, 0.16);
}

.menu-item.on strong {
  color: var(--accent-2);
}

.menu-item.soon {
  opacity: 0.55;
}

.main {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 16px 18px 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.head h1 {
  margin: 0;
  font-size: 18px;
}

.head p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.head-acts {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.banner {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 138, 61, 0.12);
  color: var(--accent-2);
  font-size: 13px;
}

.banner.warn {
  background: rgba(255, 100, 100, 0.12);
  color: #ffb4b4;
}

.panel {
  max-width: 720px;
}

.panel.wide {
  max-width: 780px;
}

.panel.stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.box {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.box legend {
  padding: 0 6px;
  color: var(--muted);
  font-size: 12px;
}

.modes {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.tg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}

.tg.on {
  border-color: rgba(255, 138, 61, 0.55);
  background: rgba(255, 138, 61, 0.12);
  color: var(--accent-2);
}

label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

label.check {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 13px;
}

label.check .ok {
  color: #8dffb0;
  font-style: normal;
  font-size: 12px;
}

label.check .muted {
  color: var(--muted);
  font-style: normal;
  font-size: 12px;
}

input,
textarea {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 10px;
  outline: none;
}

.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.tip {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}

.tip a {
  color: var(--accent-2);
}

.rec-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.samples {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
}

.samples li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.samples strong {
  display: block;
  color: var(--text);
  font-size: 13px;
}

.samples small {
  color: var(--muted);
  font-size: 11px;
}

.samples .empty {
  justify-content: center;
  color: var(--muted);
  font-size: 13px;
}

.s-acts {
  display: flex;
  gap: 6px;
}

.s-acts button {
  border: 0;
  border-radius: 6px;
  padding: 4px 10px;
  background: rgba(255, 138, 61, 0.18);
  color: var(--accent-2);
}

.placeholder {
  border: 1px dashed var(--line);
  border-radius: 12px;
  padding: 28px 22px;
}

.placeholder h2 {
  margin: 0 0 8px;
  font-size: 16px;
}

.placeholder p {
  margin: 0 0 6px;
  color: var(--text);
  font-size: 13px;
  line-height: 1.55;
}

.placeholder .muted {
  color: var(--muted);
}

.ghost,
.primary,
.danger {
  border: 0;
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
}

.ghost {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
}

.primary {
  background: linear-gradient(135deg, var(--accent), #ffb15a);
  color: #1a120c;
  font-weight: 600;
}

.danger {
  background: rgba(255, 90, 90, 0.25);
  color: #ffc9c9;
}
</style>
