<script setup>
import { ui } from '../store.js'
import SliderRow from './SliderRow.vue'

const emit = defineEmits(['resample'])

const MODES = [
  { id: 0, name: '材质', hint: '取自模型贴图' },
  { id: 1, name: '渐变', hint: '按高度着色' },
  { id: 2, name: '荧光', hint: '单色能量' }
]

const fmtK = (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v)
const fmtX = (v) => v.toFixed(2) + '×'
const fmtS = (v) => v.toFixed(1) + 's'
</script>

<template>
  <section class="panel wrap">
    <div class="panel-head">
      <span class="micro">参数 / 形态</span>
      <button class="x" type="button" @click="ui.drawer = false" aria-label="关闭">✕</button>
    </div>

    <div class="sect">
      <div class="sect-title">点云</div>

      <SliderRow
        label="点数"
        v-model="ui.points"
        :min="20000"
        :max="900000"
        :step="10000"
        :format="fmtK"
        @commit="(v) => emit('resample', v)"
      />
      <SliderRow label="点大小" v-model="ui.pointSize" :min="0.35" :max="2.6" :step="0.05" :format="fmtX" />
      <SliderRow label="散开幅度" v-model="ui.disperse" :min="0.15" :max="2" :step="0.05" :format="fmtX" />

      <div class="mode">
        <span class="lbl">点云配色</span>
        <div class="seg">
          <button
            v-for="m in MODES"
            :key="m.id"
            type="button"
            :class="{ on: ui.colorMode === m.id }"
            :title="m.hint"
            @click="ui.colorMode = m.id"
          >
            {{ m.name }}
          </button>
        </div>
      </div>
    </div>

    <div class="sect">
      <div class="sect-title">过渡</div>
      <SliderRow label="转换时长" v-model="ui.duration" :min="0.8" :max="4.5" :step="0.1" :format="fmtS" />
      <SliderRow label="错峰流动" v-model="ui.stagger" :min="0" :max="0.95" :step="0.01" :format="fmtX" />
      <SliderRow label="辉光强度" v-model="ui.glow" :min="0" :max="1.6" :step="0.02" :format="fmtX" />
    </div>

    <div class="sect">
      <div class="sect-title">场景</div>
      <div class="line">
        <span class="lbl">自动旋转</span>
        <button class="switch" :class="{ on: ui.autoRotate }" @click="ui.autoRotate = !ui.autoRotate" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.wrap {
  width: 292px;
  max-height: calc(100vh - 186px);
  overflow-y: auto;
  overflow-x: hidden;
  /* 没有滚动条时左右内边距才是对称的（14/14），真正溢出时才出现细滚动条 */
  scrollbar-width: thin;
  scrollbar-color: rgba(232, 236, 228, 0.16) transparent;
}
.x {
  display: none;
  background: none;
  border: none;
  color: var(--ink-3);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
}

.sect .sect-title {
  margin-bottom: 12px;
}

.lbl {
  font-size: 12px;
  color: var(--ink-2);
}

.mode {
  margin-top: 14px;
}
.mode .lbl {
  display: block;
  margin-bottom: 7px;
}
.seg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--line-soft);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.02);
}
.seg button {
  border: none;
  background: transparent;
  color: var(--ink-3);
  font-size: 12px;
  padding: 6px 0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.18s ease;
}
.seg button:hover {
  color: var(--ink);
}
.seg button.on {
  background: rgba(220, 255, 77, 0.12);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(220, 255, 77, 0.24);
}

.line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
}
.line + .line {
  border-top: 1px solid var(--line-soft);
  margin-top: 4px;
  padding-top: 10px;
}
.v {
  font-size: 12px;
  color: var(--ink-3);
}

.foot {
  display: flex;
  gap: 10px;
  padding: 10px 14px 12px;
  border-top: 1px solid var(--line-soft);
  font-size: 12px;
  color: var(--ink-3);
  white-space: nowrap;
}
.foot b {
  color: var(--ink-2);
  font-weight: 500;
  font-family: var(--mono);
  font-size: 12px;
}
</style>
