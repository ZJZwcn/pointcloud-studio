<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Studio } from './three/Studio.js'
import { ui, say } from './store.js'
import ModelPanel from './components/ModelPanel.vue'
import ControlPanel from './components/ControlPanel.vue'
import MorphBar from './components/MorphBar.vue'
import LoadingVeil from './components/LoadingVeil.vue'
import GeneratePanel from './components/GeneratePanel.vue'
import GenOverlay from './components/GenOverlay.vue'
import Icon from './components/Icon.vue'
import { loadKey, submitJob, waitForJob, pickModelFile, fetchModelBuffer } from './api/hunyuan.js'

const stage = ref(null)
const fileInput = ref(null)

let studio = null
let introToken = 0
let dragDepth = 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitTween = () =>
  new Promise((res) => {
    const t = setInterval(() => {
      if (!studio || !studio.tween) {
        clearInterval(t)
        res()
      }
    }, 50)
  })

/* ------------------------------------------------------------ 生命周期 */
onMounted(async () => {
  studio = new Studio(stage.value, {
    onProgress: (p, label) => {
      ui.progress = p
      if (label) ui.progressLabel = label
    },
    onStats: ({ fps }) => {
      ui.fps = fps
    },
    onMorph: (m) => {
      ui.morph = m
      ui.playing = !!studio?.tween
    }
  })
  studio.init()
  syncAll()

  window.addEventListener('keydown', onKey)
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)

  await boot()
})

onBeforeUnmount(() => {
  introToken++
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
  studio?.dispose()
  studio = null
})

/* ------------------------------------------------------------ 载入 */
function applyInfo(info, origin = 'default') {
  ui.origin = origin
  ui.triangles = info.triangles
  ui.vertices = info.vertices
  ui.meshes = info.meshes
  ui.hasTexture = info.hasTexture
  ui.points = info.points
  const [name, file] = String(info.label || '').split(' · ')
  ui.name = name || '模型'
  ui.file = file || name || '—'
}

async function boot() {
  ui.ready = false
  ui.error = ''
  try {
    const info = await studio.loadDefault('/models/battery.glb')
    applyInfo(info)
    ui.progress = 1
    ui.progressLabel = '完成'
    await sleep(120)
    ui.ready = true
    syncAll()
    await bootIntro()
  } catch (err) {
    console.error(err)
    ui.progress = 1
    ui.ready = true
    // 仓库不带 78 MB 的默认模型：没有它也能用，拖一个模型进来即可
    const msg = String(err?.message || err || '')
    if (/40[34]|not found|Failed to fetch|Unexpected token/i.test(msg)) {
      say('默认模型不在仓库里：把任意模型拖进窗口即可（或放到 public/models/battery.glb）', 7000)
    } else {
      say('默认模型载入失败：' + msg, 6000)
    }
  }
}

/** 首屏自动演示一次「模型 → 点云 → 模型」，让柔转换被看见 */
async function bootIntro() {
  const my = ++introToken
  const d = Math.max(1200, ui.duration * 1000)
  await sleep(680)
  if (my !== introToken) return
  studio.morphTo(1, d)
  await waitTween()
  if (my !== introToken) return
  await sleep(1000)
  if (my !== introToken) return
  studio.morphTo(0, d * 0.92)
  await waitTween()
}

/* ------------------------------------------------------------ 控制 */
function syncAll() {
  if (!studio) return
  studio.setPointSize(ui.pointSize)
  studio.setDisperse(ui.disperse)
  studio.setColorMode(ui.colorMode)
  studio.setGlow(ui.glow)
  studio.setAutoRotate(ui.autoRotate)
  studio.setStagger(ui.stagger)
  studio.setMorph(ui.morph)
}

watch(() => ui.pointSize, (v) => studio?.setPointSize(v))
watch(() => ui.disperse, (v) => studio?.setDisperse(v))
watch(() => ui.colorMode, (v) => studio?.setColorMode(v))
watch(() => ui.glow, (v) => studio?.setGlow(v))
watch(() => ui.autoRotate, (v) => studio?.setAutoRotate(v))
watch(() => ui.stagger, (v) => studio?.setStagger(v))

function play() {
  if (!studio || !ui.ready) return
  introToken++
  if (studio.tween) {
    studio.setMorph(studio.morph)
    ui.playing = false
    return
  }
  const target = studio.morph > 0.5 ? 0 : 1
  studio.morphTo(target, Math.max(500, ui.duration * 1000))
  ui.playing = true
}

function onMorphInput(v) {
  if (!studio) return
  introToken++
  studio.setMorph(v)
  ui.playing = false
}

async function onResample(count) {
  if (!studio) return
  if (ui.resampling) {
    // 上一次还在采样，这次被吞掉：把数字拉回场景里的真实点数，别让标签撒谎
    ui.points = studio.pointCount
    return
  }
  ui.resampling = true
  const t0 = performance.now()
  try {
    await studio.resample(Number(count))
    ui.points = studio.pointCount
    say(`点云已重采样 ${studio.pointCount.toLocaleString()} 点 · ${Math.round(performance.now() - t0)}ms`)
  } catch (e) {
    ui.points = studio.pointCount
    say('重采样失败：' + (e?.message || e), 4000)
  } finally {
    ui.resampling = false
  }
}

/* ------------------------------------------------------------ 导入 / 导出 */
const MODEL_EXT = /\.(glb|gltf|fbx|obj|stl|ply)$/i

function pick() {
  fileInput.value?.click()
}

function onPick(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  if (files.length) importFiles(files)
}

async function importFiles(files) {
  const list = Array.from(files)
  if (!list.some((f) => MODEL_EXT.test(f.name))) {
    say('未找到模型文件，支持 glb / gltf / fbx / obj / stl / ply', 4000)
    return
  }
  introToken++
  ui.loading = true
  ui.ready = false
  ui.progress = 0
  ui.progressLabel = '读取文件'
  try {
    const info = await studio.loadUserFiles(list)
    applyInfo(info, 'file')
    ui.progress = 1
    ui.progressLabel = '完成'
    await sleep(120)
    ui.ready = true
    syncAll()
    say(`已导入 ${info.file} · ${info.triangles.toLocaleString()} 面`, 3600)
    await sleep(160)
    onMorphInput(0)
    studio.morphTo(1, Math.max(700, ui.duration * 1000))
  } catch (err) {
    console.error(err)
    ui.ready = true
    say('导入失败：' + (err?.message || err), 5200)
  }
}

async function onExport(kind = 'ply') {
  if (!studio) return

  const base = (ui.file || ui.name || 'model').replace(/\.[^.]+$/, '') || 'model'
  const mb = (b) => `${(b / 1048576).toFixed(1)} MB`

  try {
    if (kind === 'source') {
      const r = studio.exportSource()
      say(`已导出原文件 ${r.filename} · ${mb(r.bytes)}`, 4200)
      return
    }
    if (kind === 'glb') {
      say('正在打包 glb…')
      const r = await studio.exportModelGLB(`${base}.glb`)
      say(`已导出模型 ${r.filename} · ${mb(r.bytes)}`, 4200)
      return
    }
    if (kind === 'stl') {
      say('正在打包 stl…')
      const r = await studio.exportModelSTL(`${base}.stl`)
      say(`已导出模型 ${r.filename} · ${mb(r.bytes)}`, 4200)
      return
    }

    const r = studio.exportPLY(`${base}.ply`)
    say(`已导出 ${r.points.toLocaleString()} 点 · ${mb(r.bytes)}`, 4200)
  } catch (e) {
    say(e?.message || '导出失败', 4200)
  }
}

function reloadDefault() {
  if (!studio) return
  boot()
}
/* ------------------------------------------------------------ 拖拽 */
function hasFiles(e) {
  const t = e.dataTransfer?.types
  return !!t && Array.from(t).includes('Files')
}
function onDragEnter(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth++
  ui.dragging = true
}
function onDragOver(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}
function onDragLeave(e) {
  if (!hasFiles(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) ui.dragging = false
}
function onDrop(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  ui.dragging = false
  importFiles(e.dataTransfer.files)
}

function onKey(e) {
  if (e.code !== 'Space' || e.repeat) return
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
  if (ui.gen.open || ui.gen.phase !== 'idle') return
  e.preventDefault()
  play()
}

/* ------------------------------------------------------------ AI 生成（腾讯混元生 3D） */
const g = ui.gen
let genAbort = null
let progTimer = null
let progT0 = 0

const GEN_ACTIVE = ['preparing', 'submitting', 'running', 'downloading', 'done']

function stopProgress() {
  clearInterval(progTimer)
  progTimer = null
}

/**
 * 进度条不跟真实进度走（混元只给状态不给百分比），而是按时间渐近 ——
 * 这样既不会假装知道进度，也永远是"在动"的。
 */
function startProgress() {
  stopProgress()
  progT0 = performance.now()
  progTimer = setInterval(() => {
    const el = (performance.now() - progT0) / 1000
    let target
    switch (g.phase) {
      case 'preparing':
        target = 0.035
        break
      case 'submitting':
        target = 0.085
        break
      case 'running':
        g.seconds = el
        target = 0.1 + 0.84 * (1 - Math.exp(-el / 42))
        break
      case 'downloading':
        target = 0.95 + 0.035 * (g.dl || 0)
        break
      case 'done':
        target = 1
        break
      default:
        target = g.progress
    }
    const d = target - g.progress
    g.progress = Math.abs(d) < 0.0005 ? target : g.progress + d * 0.075
    if (g.phase === 'done' && g.progress >= 0.999) {
      g.progress = 1
      stopProgress()
    }
  }, 110)
}

function extOfName(f) {
  const t = String(f?.Type || '').toLowerCase()
  if (t === 'obj') return 'zip'
  return t || 'glb'
}

async function startGenerate() {
  if (!studio || GEN_ACTIVE.includes(g.phase)) return
  const key = loadKey()
  if (!key) {
    say('先填写腾讯云 API Key', 3600)
    g.open = true
    return
  }

  g.open = false
  g.error = ''
  g.dl = 0
  g.progress = 0
  g.seconds = 0
  g.jobId = ''
  g.credits = null
  g.resultTag = ''
  g.phase = 'preparing'
  introToken++
  studio.beginGenerating()
  startProgress()

  const ctrl = new AbortController()
  genAbort = ctrl

  try {
    const payload = {
      model: g.model,
      generateType: g.generateType,
      faceCount: g.faceCount,
      enablePBR: g.enablePBR
    }
    if (g.mode === 'text') {
      const p = g.prompt.trim()
      if (!p) throw new Error('先写一句提示词')
      payload.prompt = p
    } else if (g.mode === 'image' && g.imgMode === 'multi') {
      // 多视角：至少 2 张，每张对应一个视角
      const views = Object.entries(g.views)
        .filter(([, v]) => v?.base64)
        .map(([view, v]) => ({ view, base64: v.base64 }))
      if (views.length < 2) throw new Error('多视角至少选 2 张')
      payload.multiView = views
      // 顶 / 底 / 45° 只有 3.1 支持
      const need31 = views.some((v) => ['top', 'bottom', 'left_front', 'right_front'].includes(v.view))
      if (need31 && payload.model !== '3.1') payload.model = '3.1'
    } else {
      if (!g.input.base64) throw new Error('还没有选图片或视频')
      payload.imageBase64 = g.input.base64
      if (g.generateType === 'Sketch' && g.prompt.trim()) payload.prompt = g.prompt.trim()
    }

    g.phase = 'submitting'
    const job = await submitJob(payload, key)
    const jobId = job?.JobId || job?.jobId
    if (!jobId) throw new Error('提交成功但没拿到任务 ID')
    g.jobId = jobId

    g.phase = 'running'
    g.status = '任务已提交，正在排队…'
    const result = await waitForJob(jobId, key, {
      signal: ctrl.signal,
      onTick: ({ status }) => {
        if (status === 'RUN') g.status = '正在生成模型，预计需要 1–2 分钟…'
      }
    })
    g.credits = result?.ResultCreditConsumed ?? null

    const file = pickModelFile(result)
    if (!file) throw new Error('任务完成但没有返回模型文件')

    g.phase = 'downloading'
    g.status = '正在下载生成结果…'
    const buf = await fetchModelBuffer(file.Url, (p) => {
      g.dl = p
    })

    g.phase = 'done'
    g.status = '生成完成，正在载入…'
    await sleep(420)

    const short = String(jobId).slice(0, 8)
    const fname = `hunyuan-${short}.${extOfName(file)}`
    const info = await studio.loadBuffer(buf, `混元生成 · ${fname}`)
    applyInfo(info, 'hunyuan')
    g.resultTag = `混元 ${g.model} · ${extOfName(file).toUpperCase()}`

    syncAll()
    studio.finishGenerating()
    // 先以点云形态出现，再柔顺地长成实体 —— 这就是「点云 → 3D 模型」
    studio.setMorph(1)
    ui.points = info.points
    ui.ready = true
    say(`生成完成 · ${info.triangles.toLocaleString()} 面`, 4200)

    await sleep(760)
    if (ctrl.signal.aborted) return
    studio.morphTo(0, 2800)
    await waitTween()
    g.phase = 'idle'
    g.status = ''
  } catch (err) {
    if (err?.name === 'AbortError' || /已取消/.test(err?.message || '')) {
      studio.cancelGenerating()
      g.phase = 'idle'
      g.status = ''
      say('已取消生成', 2400)
      return
    }
    console.error(err)
    g.phase = 'error'
    g.error = err?.message || String(err)
    g.status = ''
    studio.cancelGenerating()
    g.open = true
    say('生成失败：' + g.error, 6000)
  } finally {
    stopProgress()
    genAbort = null
  }
}

function cancelGenerate() {
  genAbort?.abort()
}

function openGenerate() {
  g.phase = 'idle'
  g.error = ''
  g.open = true
}
</script>

<template>
  <div class="app">
    <div ref="stage" class="stage" />

    <div class="vignette" />

    <header class="top">
      <div class="brand">
        <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
          <g fill="currentColor">
            <circle cx="13.10" cy="12.00" r="1.32" opacity="1.00" />
            <circle cx="10.12" cy="13.72" r="1.29" opacity="0.96" />
            <circle cx="12.29" cy="8.72" r="1.26" opacity="0.92" />
            <circle cx="14.37" cy="15.10" r="1.23" opacity="0.88" />
            <circle cx="7.64" cy="11.23" r="1.20" opacity="0.84" />
            <circle cx="16.14" cy="9.37" r="1.17" opacity="0.80" />
            <circle cx="10.61" cy="17.16" r="1.14" opacity="0.76" />
            <circle cx="9.35" cy="6.89" r="1.11" opacity="0.72" />
            <circle cx="17.77" cy="14.11" r="1.08" opacity="0.68" />
            <circle cx="5.98" cy="14.49" r="1.05" opacity="0.65" />
            <circle cx="14.91" cy="5.78" r="1.02" opacity="0.61" />
            <circle cx="14.16" cy="18.88" r="1.00" opacity="0.58" />
            <circle cx="5.48" cy="8.22" r="0.97" opacity="0.54" />
            <circle cx="19.67" cy="10.31" r="0.94" opacity="0.51" />
            <circle cx="7.31" cy="18.67" r="0.91" opacity="0.48" />
            <circle cx="10.91" cy="3.62" r="0.88" opacity="0.45" />
            <circle cx="18.69" cy="17.64" r="0.85" opacity="0.42" />
            <circle cx="2.98" cy="12.37" r="0.82" opacity="0.39" />
            <circle cx="18.60" cy="5.44" r="0.79" opacity="0.36" />
            <circle cx="11.56" cy="21.57" r="0.76" opacity="0.34" />
            <circle cx="5.70" cy="4.44" r="0.73" opacity="0.32" />
            <circle cx="22.01" cy="13.35" r="0.70" opacity="0.30" />
          </g>
        </svg>
        <div class="names">
          <div class="t1">POINT CLOUD STUDIO</div>
          <div class="t2">模型 <i>⇄</i> 点云 · 柔转换实验台</div>
        </div>
      </div>

      <div class="meta">
        <span class="chip"><b class="num">{{ ui.fps }}</b> FPS</span>
        <span class="chip num">{{ Math.round(ui.points / 1000) }}k 点</span>
        <span class="chip chip--key">空格 播放</span>
      </div>
    </header>

    <div class="side-wrap side-wrap--left" :class="{ open: ui.drawer === 'left' }">
      <ModelPanel :busy="!ui.ready" @pick="pick" @reload="reloadDefault" @export="onExport" />

      <!-- AI 生成入口：贴着左侧面板下沿，落在左下的空白区，不会像顶栏那样被挤没 -->
      <button class="ai-cta" type="button" @click="openGenerate">
        <span class="cta-ico"><Icon name="sparkle" :size="15" /></span>
        <span class="cta-tx">
          <b>AI 生成 3D 模型</b>
          <i>图片 / 视频 · 腾讯混元</i>
        </span>
      </button>
    </div>

    <div class="side-wrap side-wrap--right" :class="{ open: ui.drawer === 'right' }">
      <ControlPanel @resample="onResample" />
    </div>

    <MorphBar
      v-if="!GEN_ACTIVE.includes(ui.gen.phase)"
      class="bar"
      :morph="ui.morph"
      :playing="ui.playing"
      :disabled="!ui.ready"
      @input="onMorphInput"
      @play="play"
    />

    <GenOverlay v-if="GEN_ACTIVE.includes(ui.gen.phase)" @cancel="cancelGenerate" />

    <GeneratePanel v-if="ui.gen.open" @close="ui.gen.open = false" @start="startGenerate" />

    <nav class="dock">
      <button :class="{ on: ui.drawer === 'left' }" @click="ui.drawer = ui.drawer === 'left' ? '' : 'left'">
        模型
      </button>
      <button :class="{ on: ui.drawer === 'right' }" @click="ui.drawer = ui.drawer === 'right' ? '' : 'right'">
        参数
      </button>
      <button class="dock-ai" @click="openGenerate">AI 生成</button>
    </nav>

    <transition name="toast">
      <div v-if="ui.toast" :key="ui.toastKey" class="toast">{{ ui.toast }}</div>
    </transition>

    <transition name="fade">
      <div v-if="ui.dragging" class="dropveil">
        <div class="dv-inner">
          <Icon name="upload" :size="26" :stroke="1.4" />
          <strong>松手载入模型</strong>
          <span>glb · gltf · fbx · obj · stl · ply</span>
        </div>
      </div>
    </transition>

    <LoadingVeil />

    <input
      ref="fileInput"
      class="hidden"
      type="file"
      multiple
      accept=".glb,.gltf,.fbx,.obj,.stl,.ply,.mtl,.png,.jpg,.jpeg,.webp,.tga,.bin"
      @change="onPick"
    />
  </div>
</template>

<style scoped>
.stage {
  position: fixed;
  inset: 0;
  z-index: 0;
}

/* canvas 的 CSS 尺寸始终跟随容器，绘制缓冲由 Studio.resize() 按容器尺寸重设 */
.stage :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.vignette {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background:
    radial-gradient(ellipse 70% 60% at 50% 45%, transparent 40%, rgba(3, 4, 8, 0.55) 100%),
    linear-gradient(to bottom, rgba(3, 4, 8, 0.55) 0%, transparent 18%);
}

.hidden {
  display: none;
}

/* ---------------------------------------------------------------- 顶栏 */
.top {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 20px 0;
  pointer-events: none;
  animation: fade-up 0.7s ease both;
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
}
.mark {
  width: 26px;
  height: 26px;
  color: var(--accent);
  filter: drop-shadow(0 0 8px rgba(220, 255, 77, 0.45));
  animation: spin 26s linear infinite;
  transform-origin: 50% 50%;
}
.names .t1 {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.2em;
  color: var(--ink);
}
.names .t2 {
  margin-top: 3px;
  font-size: 12px;
  color: var(--ink-3);
  letter-spacing: 0.04em;
}
.names .t2 i {
  font-style: normal;
  color: var(--accent);
  padding: 0 2px;
}

.meta {
  display: flex;
  align-items: center;
  gap: 7px;
  pointer-events: auto;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: 20px;
  border: 1px solid var(--line-soft);
  background: rgba(10, 13, 18, 0.55);
  backdrop-filter: blur(10px);
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}
.chip b {
  font-weight: 500;
  color: var(--ink-2);
}
.chip--key {
  color: rgba(220, 255, 77, 0.62);
  border-color: rgba(220, 255, 77, 0.16);
}

/* AI 生成入口：左侧面板下方的一张卡，和面板同宽同圆角 */
.ai-cta {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 292px;
  padding: 11px 14px;
  border-radius: var(--radius);
  border: 1px solid rgba(220, 255, 77, 0.36);
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(220, 255, 77, 0.16), transparent 62%),
    rgba(12, 15, 19, 0.78);
  backdrop-filter: blur(24px) saturate(1.2);
  color: var(--accent);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.16s ease;
}
.ai-cta:hover {
  border-color: rgba(220, 255, 77, 0.66);
  box-shadow: 0 0 26px -6px var(--accent-glow);
}
.ai-cta:active {
  transform: translateY(1px);
}
.cta-ico {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid rgba(220, 255, 77, 0.3);
  background: rgba(220, 255, 77, 0.1);
}
.cta-tx {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cta-tx b {
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--ink);
}
.cta-tx i {
  font-style: normal;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--ink-2);
  font-family: var(--mono);
}

/* ---------------------------------------------------------------- 面板 */
.side-wrap {
  position: fixed;
  top: 76px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: fade-up 0.8s 0.08s ease both;
}
.side-wrap--left {
  left: 20px;
}
.side-wrap--right {
  right: 20px;
}

/* ---------------------------------------------------------------- 底栏 */
.bar {
  position: fixed;
  left: 0;
  right: 0;
  margin-inline: auto;
  bottom: 20px;
  z-index: 20;
  /* 左右各让出「外边距 + 面板 + 外边距」，与左右面板的内边缘对齐 */
  width: min(720px, calc(100vw - 664px));
  min-width: 420px;
  animation: fade-up 0.8s 0.16s ease both;
}

/* ---------------------------------------------------------------- 移动 */
.dock {
  display: none;
}
.dropveil {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgba(5, 7, 11, 0.82);
  backdrop-filter: blur(6px);
}
.dv-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  padding: 40px 56px;
  border: 1px dashed rgba(220, 255, 77, 0.45);
  border-radius: 18px;
  background: rgba(220, 255, 77, 0.04);
  color: var(--accent);
}
.dv-inner strong {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--ink);
}
.dv-inner span {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--ink-3);
}

/* ---------------------------------------------------------------- 提示 */
.toast {
  position: fixed;
  top: 76px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  padding: 9px 16px;
  border-radius: 10px;
  border: 1px solid rgba(220, 255, 77, 0.16);
  background: rgba(8, 11, 15, 0.9);
  backdrop-filter: blur(12px);
  color: var(--ink);
  font-size: 12px;
  letter-spacing: 0.01em;
  box-shadow: 0 12px 30px -12px rgba(0, 0, 0, 0.9);
  white-space: nowrap;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ---------------------------------------------------------------- 窄屏 */
@media (max-width: 1180px) {
  .bar {
    width: min(720px, calc(100vw - 640px));
    min-width: 360px;
  }
}
@media (max-width: 1080px) {
  .side-wrap {
    top: auto;
    bottom: 148px;
    left: 12px;
    right: 12px;
    display: none;
  }
  .side-wrap.open {
    display: flex;
    animation: fade-up 0.32s ease both;
  }
  .side-wrap--left,
  .side-wrap--right {
    left: 0;
    right: 0;
    margin-inline: auto;
    /* 抽屉里宽度写死，面板和下面的卡才能左右对齐 */
    width: min(360px, calc(100vw - 24px));
    align-items: stretch;
  }
  .ai-cta {
    width: 100%;
  }
  .side-wrap :deep(.wrap) {
    width: 100%;
    max-height: calc(100vh - 200px);
  }
  .bar {
    width: calc(100vw - 24px);
    min-width: 0;
    bottom: 16px;
  }
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    margin-inline: auto;
    width: max-content;
    bottom: 100px;
    z-index: 21;
    display: flex;
    gap: 6px;
  }
  .meta .chip:not(.chip--key) {
    display: none;
  }
  .dock button {
    height: 30px;
    padding: 0 14px;
    border-radius: 20px;
    border: 1px solid var(--line-soft);
    background: rgba(10, 13, 18, 0.75);
    backdrop-filter: blur(10px);
    color: var(--ink-2);
    font-size: 12px;
    cursor: pointer;
  }
  .dock .dock-ai {
    border-color: rgba(220, 255, 77, 0.34);
    background: rgba(220, 255, 77, 0.1);
    color: var(--accent);
  }
  .dock button.on {
    color: var(--accent);
    border-color: rgba(220, 255, 77, 0.35);
  }
}
</style>
