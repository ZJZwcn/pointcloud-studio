<script setup>
import { computed } from 'vue'
import { ui } from '../store.js'

const pct = computed(() => Math.round((ui.progress || 0) * 100))
const gone = computed(() => ui.ready && !ui.error)
</script>

<template>
  <transition name="veil">
    <div v-if="!gone" class="veil">
      <div class="inner">
        <div class="brand">
          <span class="sq" />
          <span class="micro">POINT&nbsp;CLOUD&nbsp;STUDIO</span>
        </div>

        <div class="big num">
          {{ pct }}<i>%</i>
        </div>

        <div class="track">
          <div class="fill" :style="{ width: pct + '%' }" />
          <div class="glow" :style="{ left: pct + '%' }" />
        </div>

        <p class="label">{{ ui.progressLabel || '准备中' }}</p>

        <p v-if="ui.error" class="err">{{ ui.error }}</p>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.veil {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 50% 46%, rgba(220, 255, 77, 0.05), transparent 55%),
    #05060a;
}
.inner {
  width: min(340px, 76vw);
  text-align: center;
}
.brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  margin-bottom: 26px;
}
.sq {
  width: 7px;
  height: 7px;
  background: var(--accent);
  box-shadow: 0 0 12px rgba(220, 255, 77, 0.8);
  animation: blink 1.6s ease-in-out infinite;
}
.big {
  font-size: 46px;
  line-height: 1;
  letter-spacing: -0.03em;
  color: var(--ink);
}
.big i {
  font-style: normal;
  font-size: 13px;
  color: var(--ink-3);
  margin-left: 3px;
  vertical-align: super;
}
.track {
  position: relative;
  height: 1px;
  margin: 20px 0 0;
  background: rgba(232, 236, 228, 0.1);
}
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent);
  box-shadow: 0 0 14px rgba(220, 255, 77, 0.5);
  transition: width 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.glow {
  position: absolute;
  top: -2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 14px 3px rgba(220, 255, 77, 0.75);
  transform: translateX(-50%);
  transition: left 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.label {
  margin: 16px 0 0;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}
.err {
  margin: 14px 0 0;
  font-size: 12px;
  color: #ff8080;
  line-height: 1.6;
}

.veil-leave-active {
  transition: opacity 0.7s ease 0.1s;
}
.veil-leave-to {
  opacity: 0;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
</style>
