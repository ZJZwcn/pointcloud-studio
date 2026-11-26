<script setup>
import { computed } from 'vue'

const props = defineProps({
  label: String,
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  format: { type: Function, default: null },
  suffix: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'commit'])

const pct = computed(() => {
  const v = ((props.modelValue - props.min) / (props.max - props.min)) * 100
  return Math.max(0, Math.min(100, v))
})

const display = computed(() => {
  const v = props.format ? props.format(props.modelValue) : props.modelValue
  return `${v}${props.suffix}`
})

function onInput(e) {
  emit('update:modelValue', Number(e.target.value))
}
function onCommit(e) {
  emit('commit', Number(e.target.value))
}
</script>

<template>
  <div class="row">
    <div class="top">
      <span class="lbl">{{ label }}</span>
      <span class="val num">{{ display }}</span>
    </div>
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :style="{ '--p': pct + '%' }"
      @input="onInput"
      @change="onCommit"
    />
  </div>
</template>

<style scoped>
.row {
  margin-bottom: 7px;
}
.row:last-child {
  margin-bottom: 0;
}
.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 5px;
}
.lbl {
  font-size: 12px;
  color: var(--ink-2);
  letter-spacing: 0.01em;
}
.val {
  font-size: 12px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid var(--line-soft);
  padding: 1px 6px;
  border-radius: 5px;
}
</style>
