<script setup>
import { computed, ref } from 'vue'
import { ui } from '../store.js'
import Icon from './Icon.vue'

defineProps({ busy: { type: Boolean, default: false } })
const emit = defineEmits(['pick', 'reload', 'export'])

const open = ref(false)
const n = (v) => (v || 0).toLocaleString('en-US')
const ext = computed(() => (ui.file.match(/\.([a-z0-9]+)$/i)?.[1] || 'glb').toLowerCase())
</script>

<template>
  <section class="panel wrap">
    <div class="panel-head">
      <span class="micro">当前模型 / 资产</span>
      <span class="tag" :class="{ live: ui.ready }">
        <i class="dot" />{{ ui.ready ? '已就绪' : '载入中' }}
      </span>
    </div>

    <div class="identity">
      <h2>{{ ui.name }}</h2>
      <p class="file num">{{ ui.file }}</p>
    </div>

    <div class="stats">
      <div class="cell">
        <span class="micro">三角面</span>
        <span class="v num">{{ n(ui.triangles) }}</span>
      </div>
      <div class="cell">
        <span class="micro">顶点</span>
        <span class="v num">{{ n(ui.vertices) }}</span>
      </div>
      <div class="cell">
        <span class="micro">点云</span>
        <span class="v num accent">{{ n(ui.points) }}</span>
      </div>
      <div class="cell">
        <span class="micro">贴图</span>
        <span class="v num">{{ ui.hasTexture ? 'PBR' : '无' }}</span>
      </div>
    </div>

    <button class="drop" :class="{ busy }" type="button" @click="emit('pick')">
      <Icon name="upload" :size="15" />
      <span>{{ busy ? '处理中…' : '导入其它模型' }}</span>
    </button>
    <p class="hint">
      拖文件到画面任意位置即可 · 支持
      <b>glb / gltf / fbx / obj / stl / ply</b>
      <br />
      obj 请连同 .mtl 与贴图一起选中
    </p>

    <div class="foot">
      <div class="acts">
        <button class="btn btn--wide" type="button" @click="emit('reload')">重新载入默认</button>
        <button class="btn btn--wide" :class="{ on: open }" type="button" @click="open = !open">
          导出<span class="caret">{{ open ? '▴' : '▾' }}</span>
        </button>
      </div>

      <div v-if="open" class="expo">
        <button
          v-if="ui.origin === 'hunyuan'"
          class="chip chip--src"
          type="button"
          @click="emit('export', 'source')"
        >
          原文件
          <b>.{{ ext }}</b>
        </button>
        <button class="chip" type="button" @click="emit('export', 'glb')">模型 <b>.glb</b></button>
        <button class="chip" type="button" @click="emit('export', 'stl')">模型 <b>.stl</b></button>
        <button class="chip chip--ply" type="button" @click="emit('export', 'ply')">点云 <b>.ply</b></button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wrap {
  width: 292px;
  overflow: hidden;
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
  animation: pulse-dot 2s ease-in-out infinite;
}

.identity {
  padding: 14px 14px 12px;
}
.identity h2 {
  margin: 0;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.2;
}
.file {
  margin: 5px 0 0;
  font-size: 12px;
  color: var(--ink-3);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 1px solid var(--line-soft);
}
.cell {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-right: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
}
.cell:nth-child(2n) {
  border-right: none;
}
.cell:nth-child(n + 3) {
  border-bottom: none;
}
.cell .v {
  font-size: 13px;
  color: var(--ink);
  letter-spacing: -0.01em;
}
.cell .v.accent {
  color: var(--accent);
}

.drop {
  margin: 12px 14px 8px;
  width: calc(100% - 28px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 10px;
  border: 1px dashed rgba(232, 236, 228, 0.18);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.015);
  color: var(--ink-2);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.drop:hover {
  border-color: rgba(220, 255, 77, 0.5);
  color: var(--accent);
  background: rgba(220, 255, 77, 0.05);
}
.drop.busy {
  opacity: 0.5;
  pointer-events: none;
}

.hint {
  margin: 0 14px 12px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--ink-3);
}
.hint b {
  color: var(--ink-2);
  font-weight: 500;
}

.foot {
  padding: 12px 14px 14px;
  border-top: 1px solid var(--line-soft);
}
.acts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.acts .btn {
  font-size: 12px;
  padding: 8px 6px;
}
.acts .btn.on {
  color: var(--accent);
  border-color: rgba(220, 255, 77, 0.34);
  background: rgba(220, 255, 77, 0.08);
}
.caret {
  margin-left: 5px;
  font-size: 12px;
  opacity: 0.7;
}

.expo {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 8px;
  animation: expo-in 0.18s ease both;
}
.chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.018);
  color: var(--ink-2);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.16s ease;
}
.chip b {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 400;
  color: var(--ink-3);
  letter-spacing: 0.02em;
}
.chip:hover {
  color: var(--accent);
  border-color: rgba(220, 255, 77, 0.4);
  background: rgba(220, 255, 77, 0.06);
}
.chip:hover b {
  color: var(--accent);
}
.chip--src,
.chip--ply {
  grid-column: 1 / -1;
}
.chip--src b {
  color: var(--accent);
}

@keyframes expo-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
</style>
