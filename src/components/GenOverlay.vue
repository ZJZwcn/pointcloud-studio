<script setup>
import { computed } from 'vue'
import { ui } from '../store.js'

const emit = defineEmits(['cancel'])
const g = ui.gen

const pct = computed(() => Math.round((g.progress || 0) * 100))
const width = computed(() => Math.max(0, Math.min(100, (g.progress || 0) * 100)))

const STATUS_TEXT = {
  preparing: '正在准备素材…',
  submitting: '正在提交生成任务…',
  running: '正在生成模型，预计需要 1–2 分钟…',
  downloading: '正在下载生成结果…',
  done: '生成完成，正在载入…'
}

const statusText = computed(() => g.status || STATUS_TEXT[g.phase] || '正在生成…')

const elapsed = computed(() => {
  const s = Math.max(0, Math.round(g.seconds || 0))
  const m = Math.floor(s / 60)
  return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`
})

const jobId = computed(() => {
  const id = g.jobId || ''
  return id.length > 18 ? id.slice(0, 8) + '…' + id.slice(-6) : id
})

const canCancel = computed(() => ['preparing', 'submitting', 'running', 'downloading'].includes(g.phase))
</script>

<template>
  <div class="veil">
    <div class="core">
      <p class="status">
        <i class="spin" aria-hidden="true" />
        {{ statusText }}
      </p>

      <div class="pct num">
        {{ pct }}<em>%</em>
      </div>

      <div class="track">
        <i class="fill" :style="{ width: width + '%' }" />
        <i class="head" :style="{ left: width + '%' }" />
      </div>

      <div class="sub">
        <span class="num">已用 {{ elapsed }}</span>
        <span v-if="jobId" class="sep">·</span>
        <span v-if="jobId" class="num">任务 {{ jobId }}</span>
        <span class="sep">·</span>
        <span class="mono-ink">{{ g.faceCount?.toLocaleString('en-US') }} 面</span>
        <button v-if="canCancel" class="cancel" type="button" @click="emit('cancel')">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.veil {
  position: fixed;
  inset: 0;
  z-index: 30;
  pointer-events: none;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: clamp(26px, 6vh, 60px);
  animation: veil-in 0.5s ease both;
}
@keyframes veil-in {
  from {
    opacity: 0;
  }
}

.core {
  width: min(520px, calc(100vw - 48px));
  text-align: center;
  animation: core-in 0.6s cubic-bezier(0.2, 0.9, 0.2, 1) both;
}
@keyframes core-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}

.status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: 0 0 6px;
  font-size: 12px;
  color: #b6e06a;
  letter-spacing: 0.02em;
  text-shadow: 0 0 18px rgba(180, 224, 106, 0.35);
}

.spin {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid rgba(182, 224, 106, 0.28);
  border-top-color: #b6e06a;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.pct {
  font-size: clamp(46px, 6.4vw, 68px);
  line-height: 1;
  font-weight: 300;
  letter-spacing: -0.03em;
  color: var(--ink);
  text-shadow:
    0 0 40px rgba(232, 236, 228, 0.18),
    0 0 90px rgba(220, 255, 77, 0.12);
  transition: color 0.3s ease;
}
.pct em {
  font-style: normal;
  font-size: 0.42em;
  color: var(--ink-3);
  margin-left: 2px;
  letter-spacing: 0;
}

.track {
  position: relative;
  height: 2px;
  margin: 14px auto 10px;
  width: 100%;
  border-radius: 2px;
  background: rgba(232, 236, 228, 0.1);
  overflow: visible;
}
.fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: linear-gradient(90deg, rgba(220, 255, 77, 0.55), var(--accent));
  box-shadow: 0 0 14px rgba(220, 255, 77, 0.55);
  transition: width 0.36s cubic-bezier(0.3, 0.8, 0.3, 1);
}
.head {
  position: absolute;
  top: 50%;
  width: 7px;
  height: 7px;
  margin-left: -3.5px;
  border-radius: 50%;
  background: #f4ffd0;
  box-shadow: 0 0 12px 2px rgba(220, 255, 77, 0.85);
  transform: translateY(-50%);
  transition: left 0.36s cubic-bezier(0.3, 0.8, 0.3, 1);
}

.sub {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 12px;
  color: var(--ink-3);
  letter-spacing: 0.04em;
}
.sub .sep {
  opacity: 0.45;
}
.mono-ink {
  font-family: var(--mono);
}
.cancel {
  pointer-events: auto;
  margin-left: 4px;
  padding: 2px 8px;
  border: 1px solid var(--line-soft);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--ink-2);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.18s ease;
}
.cancel:hover {
  color: var(--ink);
  border-color: rgba(232, 236, 228, 0.28);
}
</style>
