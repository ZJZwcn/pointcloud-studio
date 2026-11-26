<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { ui, say } from '../store.js'
import {
  MODEL_OPTIONS,
  TYPE_OPTIONS,
  loadKey,
  saveKey,
  maskKey,
  prepareImage
} from '../api/hunyuan.js'
import { extractFrames, dataUrlToBlob, fmtTime } from '../utils/videoFrames.js'
import Icon from './Icon.vue'

const emit = defineEmits(['close', 'start'])
const g = ui.gen

// 多视角槽位：3×3 排布，中心是计数 hub
// 依据腾讯云文档：left / right / back 通用；top / bottom / left_front / right_front 仅 3.1
const VIEW_SLOTS = [
  { key: 'left_front', label: '左前 45°', need31: true },
  { key: 'top', label: '顶视', need31: true },
  { key: 'right_front', label: '右前 45°', need31: true },
  { key: 'left', label: '左视', need31: false },
  { hub: true },
  { key: 'right', label: '右视', need31: false },
  { key: 'back', label: '背视', need31: false },
  { key: 'front', label: '正视', need31: false },
  { key: 'bottom', label: '底视', need31: true }
]

const FACE_STEPS = [
  { value: 20000, label: '低' },
  { value: 150000, label: '中' },
  { value: 500000, label: '高' },
  { value: 1500000, label: '极高' }
]

const keyInput = ref(loadKey())
const keyEditing = ref(!loadKey())
const fileInput = ref(null)
const busy = ref(false)
const hover = ref(false)
const fileInputKey = ref(0)

const pendingView = ref('')
const hoverKey = ref('')
const viewCount = computed(() => VIEW_SLOTS.filter((v) => !v.hub && g.views[v.key]).length)
const viewsNeed31 = computed(() => VIEW_SLOTS.some((v) => v.need31 && g.views[v.key]))

const hasInput = computed(() => !!g.input.kind)
const keyReady = computed(() => !!keyInput.value.trim())
const canStart = computed(() => {
  if (g.phase !== 'idle' && g.phase !== 'done' && g.phase !== 'error') return false
  if (!keyReady.value) return false
  if (g.mode === 'text') return g.prompt.trim().length > 0
  if (g.mode === 'image' && g.imgMode === 'multi') return viewCount.value >= 2
  return hasInput.value
})

const keyMasked = computed(() => maskKey(keyInput.value.trim()))

function saveCurrentKey() {
  const k = keyInput.value.trim()
  saveKey(k)
  g.hasKey = !!k
  keyEditing.value = false
  say(k ? 'API Key 已保存在本机浏览器' : '已清除 API Key')
}

function clearKey() {
  keyInput.value = ''
  saveKey('')
  g.hasKey = false
  keyEditing.value = true
  say('已清除 API Key')
}

// ---------------------------------------------------------------- 素材

function clearInput() {
  if (g.input.previewUrl && g.input.previewUrl.startsWith('blob:')) URL.revokeObjectURL(g.input.previewUrl)
  g.input = { kind: '', name: '', previewUrl: '', width: 0, height: 0, bytes: 0, base64: '' }
  g.video = { duration: 0, frames: [], pick: 0, loading: false }
}

function pickFile() {
  pendingView.value = ''
  openFilePicker()
}

function openFilePicker() {
  fileInputKey.value += 1
  nextTick(() => fileInput.value?.click())
}

// 点某个视角格子 → 选图填进这个视角
function pickView(key) {
  pendingView.value = key
  openFilePicker()
}

async function putView(key, file) {
  if (!file) return
  const ok = /^image\//i.test(file.type) || /\.(png|jpe?g|webp|bmp)$/i.test(file.name)
  if (!ok) {
    say('视角图只收 jpg / png')
    return
  }
  busy.value = true
  try {
    const img = await prepareImage(file, { maxSide: 1600 })
    g.views[key] = { name: file.name, ...img }
    // 顶 / 底 / 45° 只有 3.1 支持，选了就自动切版本
    if (viewsNeed31.value && g.model !== '3.1') {
      g.model = '3.1'
      say('含顶 / 底 / 45° 视角，已切到 3.1 版本')
    }
  } catch (e) {
    say(e?.message || '这张图读不出来')
  } finally {
    busy.value = false
  }
}

function dropView(key, e) {
  hoverKey.value = ''
  pendingView.value = ''
  putView(key, Array.from(e.dataTransfer?.files || [])[0])
}

function clearView(key) {
  delete g.views[key]
}

// 示例：给多视角填两张，方便不选文件也能跑通
async function useSampleViews() {
  g.mode = 'image'
  g.imgMode = 'multi'
  const c = document.createElement('canvas')
  c.width = c.height = 768
  const x = c.getContext('2d')
  const bg = x.createLinearGradient(0, 0, 768, 768)
  bg.addColorStop(0, '#10161c')
  bg.addColorStop(1, '#26313a')
  x.fillStyle = bg
  x.fillRect(0, 0, 768, 768)
  x.save()
  x.translate(384, 400)
  x.fillStyle = '#dcff4d'
  x.beginPath()
  x.roundRect(-150, -190, 300, 320, 54)
  x.fill()
  x.restore()
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.94))
  const f = new File([blob], 'sample.jpg', { type: 'image/jpeg' })
  await putView('front', f)
  await putView('left', f)
  say('已填正视 + 左视两张示例')
}

async function onFiles(list) {
  const file = Array.from(list || [])[0]
  if (!file) return
  const isVideo = /^video\//i.test(file.type) || /\.(mp4|webm|mov|m4v)$/i.test(file.name)
  const isImage = /^image\//i.test(file.type) || /\.(png|jpe?g|webp|bmp)$/i.test(file.name)
  if (!isVideo && !isImage) {
    say('请选择图片（png / jpg / webp）或视频（mp4 / webm）')
    return
  }

  clearInput()
  busy.value = true
  try {
    if (isImage) {
      g.mode = 'image'
      const r = await prepareImage(file)
      g.input = {
        kind: 'image',
        name: file.name,
        previewUrl: r.dataUrl,
        width: r.width,
        height: r.height,
        bytes: r.bytes,
        base64: r.base64
      }
    } else {
      g.mode = 'video'
      g.video.loading = true
      const v = await extractFrames(file, 6)
      g.video = { duration: v.duration, frames: v.frames, pick: v.best ?? 0, loading: false }
      await useFrame(v.best ?? 0)
    }
  } catch (e) {
    clearInput()
    say(e?.message || '读不出这个文件')
  } finally {
    busy.value = false
    fileInputKey.value++
  }
}

/** 没素材时用的示例图：画一张 768×768 的渐变 + 几何体，走和真实图片一样的预处理链路 */
async function useSample() {
  const c = document.createElement('canvas')
  c.width = c.height = 768
  const x = c.getContext('2d')
  const bg = x.createLinearGradient(0, 0, 768, 768)
  bg.addColorStop(0, '#10161c')
  bg.addColorStop(1, '#26313a')
  x.fillStyle = bg
  x.fillRect(0, 0, 768, 768)

  x.save()
  x.translate(384, 400)
  x.fillStyle = '#dcff4d'
  x.beginPath()
  x.roundRect(-150, -190, 300, 320, 54)
  x.fill()
  x.fillStyle = 'rgba(0,0,0,.35)'
  x.beginPath()
  x.roundRect(-104, -252, 208, 72, 26)
  x.fill()
  x.fillStyle = 'rgba(255,255,255,.5)'
  x.beginPath()
  x.arc(-64, -40, 34, 0, Math.PI * 2)
  x.fill()
  x.restore()

  g.mode = 'image'
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.94))
  await onFiles([new File([blob], 'sample.jpg', { type: 'image/jpeg' })])
}

async function useFrame(i) {
  const f = g.video.frames[i]
  if (!f) return
  g.video.pick = i
  try {
    const r = await prepareImage(dataUrlToBlob(f.dataUrl))
    g.input = {
      kind: 'video',
      name: `视频抽帧 · ${fmtTime(f.time)}`,
      previewUrl: r.dataUrl,
      width: r.width,
      height: r.height,
      bytes: r.bytes,
      base64: r.base64
    }
  } catch {
    say('这一帧读取失败，换一帧试试')
  }
}

// ---------------------------------------------------------------- 拖拽

function onDrop(e) {
  hover.value = false
  onFiles(e.dataTransfer?.files)
}

// 文件选择器是共用的：给某个视角选图时走 putView，否则走原来的单图/视频流程
function onPick(e) {
  const files = e.target.files
  const key = pendingView.value
  pendingView.value = ''
  if (key) putView(key, Array.from(files || [])[0])
  else onFiles(files)
}

onMounted(() => {
  g.hasKey = !!loadKey()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})

function onKey(e) {
  if (e.key === 'Escape' && !document.querySelector('.gen-busy')) emit('close')
}

watch(
  () => g.mode,
  (m) => {
    if (m === 'text') clearInput()
  }
)
</script>

<template>
  <div class="mask" @mousedown.self="emit('close')">
    <section class="sheet panel">
      <header class="panel-head">
        <div class="head-l">
          <span class="micro">AI 生成 / 腾讯混元生 3D</span>
          <span class="tag" :class="{ live: g.hasKey }"><i class="dot" />{{ g.hasKey ? 'Key 已配置' : '未配置 Key' }}</span>
        </div>
        <button class="x" type="button" aria-label="关闭" @click="emit('close')">
          <Icon name="close" :size="14" />
        </button>
      </header>

      <div class="body">
        <div v-if="g.error" class="err">
          <b>生成失败</b>
          <span>{{ g.error }}</span>
          <button type="button" @click="g.error = ''">知道了</button>
        </div>
        <!-- 输入 -->
        <div class="sect">
          <div class="sect-title">输入素材</div>
          <div class="seg seg--3">
            <button type="button" :class="{ on: g.mode === 'image' }" @click="g.mode = 'image'">
              <Icon name="image" :size="14" />图片
            </button>
            <button type="button" :class="{ on: g.mode === 'video' }" @click="g.mode = 'video'">
              <Icon name="video" :size="14" />视频
            </button>
            <button type="button" :class="{ on: g.mode === 'text' }" @click="g.mode = 'text'">
              <Icon name="type" :size="14" />文字
            </button>
          </div>

          <!-- 图片：单张 / 多视角 -->
          <div v-if="g.mode === 'image'" class="seg seg--2 imgmode">
            <button type="button" :class="{ on: g.imgMode === 'single' }" @click="g.imgMode = 'single'">
              单张图片
            </button>
            <button type="button" :class="{ on: g.imgMode === 'multi' }" @click="g.imgMode = 'multi'">
              多视角 <span class="num">2–8</span>
            </button>
          </div>

          <!-- 多视角：3×3，中间是计数 hub -->
          <div v-if="g.mode === 'image' && g.imgMode === 'multi'" class="views">
            <div
              v-for="(s, i) in VIEW_SLOTS"
              :key="s.hub ? 'hub' : s.key"
              class="vcell"
              :class="{ hub: s.hub, filled: !s.hub && g.views[s.key], hover: hoverKey === (s.key || '') }"
              :style="{ animationDelay: i * 22 + 'ms' }"
              @click="s.hub ? null : pickView(s.key)"
              @dragover.prevent="s.hub ? null : (hoverKey = s.key)"
              @dragleave.prevent="hoverKey = ''"
              @drop.prevent.stop="s.hub ? null : dropView(s.key, $event)"
            >
              <template v-if="s.hub">
                <b class="num">{{ viewCount }}<i>/8</i></b>
                <span>{{ viewCount < 2 ? '至少 2 张' : '可以生成' }}</span>
              </template>
              <template v-else-if="g.views[s.key]">
                <img :src="g.views[s.key].dataUrl" :alt="s.label" />
                <em>{{ s.label }}</em>
                <button class="vrm" type="button" aria-label="移除" @click.stop="clearView(s.key)">✕</button>
              </template>
              <template v-else>
                <Icon name="upload" :size="15" />
                <em>{{ s.label }}<i v-if="s.need31" class="tag31">3.1</i></em>
              </template>
            </div>
          </div>

          <div v-if="g.mode === 'image' && g.imgMode === 'multi'" class="vhint">
            <span>每个视角一张 · 顶 / 底 / 45° 需要 3.1 版本</span>
            <button class="sample" type="button" @click.stop="useSampleViews">没有素材？填两张示例</button>
          </div>

          <template v-if="g.mode !== 'text' && !(g.mode === 'image' && g.imgMode === 'multi')">
            <div
              v-if="!hasInput"
              class="drop"
              :class="{ hover, busy }"
              @click="pickFile"
              @dragover.prevent="hover = true"
              @dragleave.prevent="hover = false"
              @drop.prevent.stop="onDrop"
            >
              <Icon name="upload" :size="18" />
              <span>{{ busy ? '正在读取…' : g.mode === 'video' ? '拖入视频，或点击选择' : '拖入图片，或点击选择' }}</span>
              <em>{{ g.mode === 'video' ? 'mp4 / webm · 会自动抽 6 帧' : 'png / jpg / webp · 单边 ≥128' }}</em>
              <button class="sample" type="button" @click.stop="useSample">没有素材？用示例图试试</button>
            </div>

            <div v-else class="asset">
              <img :src="g.input.previewUrl" :alt="g.input.name" />
              <div class="meta">
                <b>{{ g.input.name }}</b>
                <span class="num">{{ g.input.width }} × {{ g.input.height }} · {{ Math.round(g.input.bytes / 1024) }} KB</span>
                <button class="mini" type="button" @click="pickFile">换一个</button>
              </div>
              <button class="rm" type="button" aria-label="移除" @click="clearInput">✕</button>
            </div>

            <div v-if="g.mode === 'video' && g.video.frames.length" class="frames">
              <div class="frames-head">
                <span class="micro">抽取的帧 · 选一张</span>
                <span class="num hint">{{ g.video.frames.length }} 帧 / {{ fmtTime(g.video.duration) }}</span>
              </div>
              <div class="strip">
                <button
                  v-for="(f, i) in g.video.frames"
                  :key="i"
                  type="button"
                  class="frame"
                  :class="{ on: g.video.pick === i }"
                  :title="'第 ' + fmtTime(f.time) + ' 秒'"
                  @click="useFrame(i)"
                >
                  <img :src="f.dataUrl" :alt="'帧 ' + (i + 1)" />
                  <em>{{ fmtTime(f.time) }}</em>
                </button>
              </div>
            </div>
          </template>

          <template v-else-if="g.mode === 'text'">
            <textarea
              v-model="g.prompt"
              class="area"
              rows="3"
              maxlength="1024"
              placeholder="用一句话描述想要的模型，例如：一把复古木椅，四腿，做旧质感"
            />
            <p class="hint">文字与图片互斥（草图模式除外），留空就走图片。</p>
          </template>
        </div>

        <!-- 参数 -->
        <div class="sect">
          <div class="sect-title">生成参数</div>

          <div class="field">
            <span class="lbl">模型版本</span>
            <div class="seg">
              <button
                v-for="m in MODEL_OPTIONS"
                :key="m.value"
                type="button"
                :class="{ on: g.model === m.value }"
                :title="m.hint"
                @click="g.model = m.value"
              >
                {{ m.label }}
              </button>
            </div>
          </div>

          <div class="field">
            <span class="lbl">面数</span>
            <div class="seg seg--4">
              <button
                v-for="f in FACE_STEPS"
                :key="f.value"
                type="button"
                :class="{ on: g.faceCount === f.value }"
                :disabled="g.generateType === 'LowPoly'"
                @click="g.faceCount = f.value"
              >
                {{ f.label }}
              </button>
            </div>
          </div>

          <div class="field">
            <span class="lbl">生成类型</span>
            <div class="seg seg--4">
              <button
                v-for="t in TYPE_OPTIONS"
                :key="t.value"
                type="button"
                :class="{ on: g.generateType === t.value }"
                :title="t.hint"
                @click="g.generateType = t.value"
              >
                {{ t.label }}
              </button>
            </div>
          </div>

          <div class="line">
            <span class="lbl">PBR 材质贴图</span>
            <button class="switch" :class="{ on: g.enablePBR }" @click="g.enablePBR = !g.enablePBR" />
          </div>
        </div>

        <!-- Key -->
        <div class="sect">
          <div class="sect-title">API Key</div>
          <div class="keyrow">
            <input
              v-if="keyEditing || !keyReady"
              v-model="keyInput"
              class="input num"
              type="password"
              spellcheck="false"
              autocomplete="off"
              placeholder="sk-..."
              @keydown.enter="saveCurrentKey"
            />
            <button v-else class="keyview num" type="button" title="点击修改" @click="keyEditing = true">
              {{ keyMasked }}
            </button>
            <button class="btn" type="button" @click="saveCurrentKey">{{ keyEditing || !keyReady ? '保存' : '更换' }}</button>
            <button v-if="keyReady" class="btn" type="button" @click="clearKey">清除</button>
          </div>
          <p class="hint">
            只存在本机浏览器（localStorage），不写进代码；请求经本地 <b>/api/hunyuan</b> 中转再发往腾讯云。
            没有 Key 先去
            <a href="https://console.cloud.tencent.com/hunyuan/start" target="_blank" rel="noreferrer">控制台开通</a>
            获取。
          </p>
        </div>
      </div>

      <footer class="foot">
        <div class="foot-l">
          <span class="num">{{ g.faceCount.toLocaleString('en-US') }} 面</span>
          <span class="dot-sep">·</span>
          <span class="num">v{{ g.model }}</span>
          <span class="dot-sep">·</span>
          <span>{{ g.generateType }}</span>
        </div>
        <div class="foot-r">
          <button class="btn" type="button" @click="emit('close')">取消</button>
          <button class="btn btn--accent" type="button" :disabled="!canStart" @click="emit('start')">
            开始生成
          </button>
        </div>
      </footer>

      <input
        :key="fileInputKey"
        ref="fileInput"
        class="hidden-file"
        type="file"
        :accept="g.mode === 'video' ? 'video/*' : 'image/*'"
        @change="onPick"
      />
    </section>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(3, 4, 7, 0.62);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: mask-in 0.24s ease both;
}
@keyframes mask-in {
  from {
    opacity: 0;
  }
}

.sheet {
  width: min(600px, 100%);
  max-height: min(88vh, 780px);
  display: flex;
  flex-direction: column;
  background: var(--panel-solid);
  animation: sheet-in 0.3s cubic-bezier(0.2, 0.9, 0.2, 1) both;
}
@keyframes sheet-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.985);
  }
}

.head-l {
  display: flex;
  align-items: center;
  gap: 10px;
}
.x {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-right: -4px;
  background: none;
  border: none;
  border-radius: 7px;
  color: var(--ink-3);
  cursor: pointer;
  transition: color 0.18s ease, background 0.18s ease;
}
.x:hover {
  color: var(--ink);
  background: rgba(255, 255, 255, 0.06);
}
.x:hover {
  color: var(--ink);
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--ink-3);
  border: 1px solid var(--line-soft);
  padding: 2px 7px 2px 6px;
  border-radius: 20px;
}
.tag.live {
  color: #d8ee9c;
  border-color: rgba(220, 255, 77, 0.22);
  background: rgba(220, 255, 77, 0.06);
}
.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

.body {
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.err {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 12px 14px 0;
  padding: 10px 12px;
  border: 1px solid rgba(255, 110, 90, 0.28);
  border-radius: 10px;
  background: rgba(255, 90, 70, 0.08);
  font-size: 12px;
  line-height: 1.6;
  color: #ffb3a3;
}
.err b {
  flex: none;
  font-weight: 600;
  color: #ff8a72;
}
.err span {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.err button {
  flex: none;
  align-self: flex-start;
  background: none;
  border: none;
  padding: 0;
  color: #ffb3a3;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}

.seg {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--line-soft);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.02);
}
.seg--3 {
  grid-template-columns: repeat(3, 1fr);
}
.seg--2 {
  grid-template-columns: repeat(2, 1fr);
}
.seg--4 {
  grid-template-columns: repeat(4, 1fr);
}
.seg button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--ink-3);
  font-size: 12px;
  padding: 6px 0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.18s ease;
}
/* 图标与文字同色（--ink-3），不再额外压暗，否则小尺寸下几乎看不见 */
.seg button .ico {
  opacity: 1;
}
.seg button:hover:not(:disabled) {
  color: var(--ink);
}
.seg button.on {
  background: rgba(220, 255, 77, 0.12);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(220, 255, 77, 0.24);
}
.seg button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* 单张 / 多视角 切换 */
.imgmode {
  margin-top: 10px;
}
.imgmode .num {
  color: var(--ink-3);
}

/* 多视角 3×3 栅格：槽位 + 中心计数 */
.views {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
  /* 面板只有 600 宽，格子再大就会把参数区顶出屏幕 */
  width: 100%;
  max-width: 396px;
  margin: 10px auto 0;
}
.vcell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  aspect-ratio: 4 / 3;
  padding: 5px;
  border: 1px dashed rgba(232, 236, 228, 0.16);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.015);
  color: var(--ink-3);
  cursor: pointer;
  overflow: hidden;
  animation: vcell-in 0.26s ease both;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}
.vcell em {
  display: flex;
  align-items: center;
  gap: 4px;
  font-style: normal;
  font-size: 12px;
  letter-spacing: 0.02em;
  line-height: 1;
}
.vcell:hover,
.vcell.hover {
  border-color: rgba(220, 255, 77, 0.5);
  background: rgba(220, 255, 77, 0.06);
  color: var(--accent);
}
.vcell.filled {
  border-style: solid;
  border-color: rgba(220, 255, 77, 0.28);
  color: var(--ink-2);
}
.vcell.filled img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.62;
}
.vcell.filled em {
  position: relative;
  z-index: 1;
  padding: 2px 6px;
  border-radius: 20px;
  background: rgba(5, 6, 10, 0.72);
  color: var(--ink);
}
.vcell.hub {
  border-style: solid;
  border-color: rgba(220, 255, 77, 0.18);
  background: radial-gradient(120% 120% at 50% 120%, rgba(220, 255, 77, 0.16), transparent 70%);
  color: var(--ink-2);
  cursor: default;
}
.vcell.hub b {
  font-size: 22px;
  font-weight: 400;
  line-height: 1;
  color: var(--accent);
}
.vcell.hub b i {
  font-style: normal;
  font-size: 12px;
  color: var(--ink-3);
}
.vcell.hub span {
  font-size: 12px;
  letter-spacing: 0.04em;
}
.tag31 {
  padding: 0 3px;
  border-radius: 3px;
  border: 1px solid rgba(220, 255, 77, 0.28);
  font-size: 12px;
  font-style: normal;
  line-height: 1.4;
  color: var(--accent);
}
.vrm {
  position: absolute;
  top: 3px;
  right: 3px;
  z-index: 2;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid rgba(232, 236, 228, 0.18);
  background: rgba(5, 6, 10, 0.78);
  color: var(--ink-2);
  font-size: 9px;
  line-height: 1;
  cursor: pointer;
}
.vrm:hover {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.4);
}
.vhint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
  letter-spacing: 0.02em;
  color: var(--ink-3);
}
@keyframes vcell-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.drop {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 22px 14px;
  border: 1px dashed rgba(232, 236, 228, 0.16);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.015);
  color: var(--ink-2);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.drop em {
  font-style: normal;
  font-size: 12px;
  color: var(--ink-3);
  font-family: var(--mono);
}
.sample {
  margin-top: 6px;
  background: none;
  border: none;
  padding: 0;
  color: rgba(220, 255, 77, 0.72);
  font-size: 12px;
  cursor: pointer;
  border-bottom: 1px dashed rgba(220, 255, 77, 0.32);
}
.sample:hover {
  color: var(--accent);
}
.drop:hover,
.drop.hover {
  border-color: rgba(220, 255, 77, 0.45);
  color: var(--accent);
  background: rgba(220, 255, 77, 0.05);
}
.drop.busy {
  opacity: 0.6;
  pointer-events: none;
}

.asset {
  position: relative;
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 12px;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.02);
}
.asset img {
  width: 76px;
  height: 76px;
  object-fit: cover;
  border-radius: 8px;
  background: #000;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.meta b {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 360px;
}
.meta span {
  font-size: 12px;
  color: var(--ink-3);
}
.mini {
  align-self: flex-start;
  margin-top: 2px;
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
}
.rm {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--line-soft);
  background: rgba(0, 0, 0, 0.4);
  color: var(--ink-3);
  font-size: 12px;
  cursor: pointer;
}
.rm:hover {
  color: var(--ink);
}

.frames {
  margin-top: 12px;
}
.frames-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 7px;
}
.frames-head .hint {
  font-size: 12px;
  color: var(--ink-3);
}
.strip {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}
.frame {
  position: relative;
  padding: 0;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  overflow: hidden;
  background: #000;
  cursor: pointer;
  transition: all 0.18s ease;
}
.frame img {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  opacity: 0.7;
  transition: opacity 0.18s ease;
}
.frame em {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-style: normal;
  font-family: var(--mono);
  font-size: 12px;
  color: #dfe6d8;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
  padding: 6px 3px 2px;
  text-align: center;
}
.frame:hover img {
  opacity: 0.95;
}
.frame.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 6px 18px -8px var(--accent-glow);
}
.frame.on img {
  opacity: 1;
}

.field {
  margin-bottom: 12px;
}
.field .lbl {
  display: block;
  margin-bottom: 7px;
  font-size: 12px;
  color: var(--ink-2);
}

.line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0 0;
}
.lbl {
  font-size: 12px;
  color: var(--ink-2);
}

.area {
  width: 100%;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--ink);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  min-height: 76px;
}
.area:focus {
  outline: none;
  border-color: rgba(220, 255, 77, 0.4);
}

.keyrow {
  display: flex;
  gap: 8px;
  align-items: center;
}
.input,
.keyview {
  flex: 1;
  min-width: 0;
  padding: 8px 11px;
  border: 1px solid var(--line-soft);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--ink);
  font-size: 12px;
  text-align: left;
}
.input:focus {
  outline: none;
  border-color: rgba(220, 255, 77, 0.4);
}
.keyview {
  cursor: pointer;
  color: var(--ink-2);
  letter-spacing: 0.04em;
}
.keyview:hover {
  border-color: rgba(220, 255, 77, 0.3);
}

.hint {
  margin: 9px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-3);
}
.hint b {
  color: var(--ink-2);
  font-weight: 500;
}
.hint a {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(220, 255, 77, 0.3);
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-top: 1px solid var(--line-soft);
}
.foot-l {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: var(--ink-3);
}
.dot-sep {
  opacity: 0.5;
}
.foot-r {
  display: flex;
  gap: 8px;
}

.hidden-file {
  display: none;
}
</style>
