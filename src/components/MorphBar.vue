<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  morph: { type: Number, default: 0 },
  playing: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['input', 'play'])

const pct = computed(() => Math.round(props.morph * 1000) / 10)
const fill = computed(() => `${props.morph * 100}%`)

function onInput(e) {
  emit('input', Number(e.target.value) / 1000)
}
</script>

<template>
  <div class="bar panel">
    <button
      class="play"
      type="button"
      :disabled="disabled"
      :aria-label="playing ? '暂停' : '播放转换'"
      @click="emit('play')"
    >
      <Icon v-if="!playing" name="play" :size="17" />
      <Icon v-else name="pause" :size="16" />
    </button>

    <div class="track">
      <div class="ends">
        <span class="end" :class="{ on: morph < 0.5 }">模型</span>
        <span class="mid num">{{ pct.toFixed(1) }}<i>%</i></span>
        <span class="end right" :class="{ on: morph >= 0.5 }">点云</span>
      </div>
      <div class="rail">
        <input
          type="range"
          min="0"
          max="1000"
          step="1"
          :value="Math.round(morph * 1000)"
          :style="{ '--p': fill }"
          :disabled="disabled"
          @input="onInput"
        />
        <div class="ticks" aria-hidden="true">
          <span v-for="i in 20" :key="i" :class="{ past: i / 20 <= morph }" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 18px 10px 14px;
  border-radius: 16px;
}

.play {
  flex: none;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid rgba(220, 255, 77, 0.35);
  background: radial-gradient(circle at 50% 40%, rgba(220, 255, 77, 0.16), rgba(220, 255, 77, 0.03));
  color: var(--accent);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.22s ease;
  padding: 0; /* 不置零的话浏览器默认的 1px 6px 1px 1px 会把图标挤到左边 */
}
.play:hover {
  background: rgba(220, 255, 77, 0.18);
  box-shadow: 0 0 24px -4px rgba(220, 255, 77, 0.45);
  transform: scale(1.04);
}
.play:disabled {
  opacity: 0.35;
  pointer-events: none;
}

.track {
  flex: 1;
  min-width: 0;
}

.ends {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: baseline;
  margin-bottom: 2px;
}
.end {
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--ink-3);
  transition: color 0.25s ease;
  font-family: var(--mono);
}
.end.on {
  color: var(--accent);
}
.end.right {
  text-align: right;
}
.mid {
  font-size: 13px;
  color: var(--ink);
  letter-spacing: 0.02em;
  padding: 0 10px;
}
.mid i {
  font-style: normal;
  font-size: 12px;
  color: var(--ink-3);
  margin-left: 1px;
}

.rail {
  position: relative;
  padding: 2px 0 8px;
}
.ticks {
  display: flex;
  justify-content: space-between;
  padding: 0 5px;
  margin-top: 1px;
}
.ticks span {
  width: 1px;
  height: 4px;
  background: rgba(232, 236, 228, 0.13);
  transition: background 0.2s ease;
}
.ticks span.past {
  background: rgba(220, 255, 77, 0.45);
}

input[type="range"]::-webkit-slider-thumb {
  width: 15px;
  height: 15px;
  margin-top: -6.5px;
  background: #0a0c10;
  border: 1.5px solid var(--accent);
  box-shadow:
    0 0 0 5px rgba(220, 255, 77, 0.07),
    0 0 14px rgba(220, 255, 77, 0.45);
}
input[type="range"]::-webkit-slider-runnable-track {
  height: 3px;
}
input[type="range"]::-moz-range-track,
input[type="range"]::-moz-range-progress {
  height: 3px;
}
</style>
