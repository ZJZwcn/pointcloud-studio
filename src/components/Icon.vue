<script setup>
/**
 * 统一图标：24×24 网格、1.6 描边、圆头圆角、颜色走 currentColor。
 * 用法：<Icon name="upload" :size="15" />
 */
const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 16 },
  stroke: { type: [Number, String], default: 1.6 }
})
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    :stroke="'currentColor'"
    :stroke-width="props.stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="ico"
  >
    <!-- 导入：箭头朝下进入托盘（导入 = 进，不是出） -->
    <g v-if="props.name === 'upload'">
      <path d="M12 4.4v11.2" />
      <path d="M7.7 11.4 12 15.7l4.3-4.3" />
      <path d="M4.6 15.2v2.2a2.4 2.4 0 0 0 2.4 2.4h10a2.4 2.4 0 0 0 2.4-2.4v-2.2" />
    </g>

    <!-- AI：四角星 -->
    <path
      v-else-if="props.name === 'sparkle'"
      d="M12 2.8C12.9 8.9 15.1 11.1 21.2 12 15.1 12.9 12.9 15.1 12 21.2 11.1 15.1 8.9 12.9 2.8 12 8.9 11.1 11.1 8.9 12 2.8Z"
      fill="currentColor"
      stroke="none"
    />

    <!-- 播放：圆角实心三角。描边与填充同色，只用来把三个角磨圆；
         重心（底边 1/3 处）落在 12，右侧再留一点光学余量 -->
    <path
      v-else-if="props.name === 'play'"
      d="M9.4 6.8 18.2 12 9.4 17.2Z"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="2.5"
    />

    <!-- 暂停 -->
    <g v-else-if="props.name === 'pause'" :fill="'currentColor'" stroke="none">
      <rect x="7.6" y="5.8" width="3.6" height="12.4" rx="1.3" />
      <rect x="12.8" y="5.8" width="3.6" height="12.4" rx="1.3" />
    </g>

    <!-- 关闭 -->
    <g v-else-if="props.name === 'close'">
      <path d="M6.6 6.6 17.4 17.4" />
      <path d="M17.4 6.6 6.6 17.4" />
    </g>

    <!-- 图片 -->
    <g v-else-if="props.name === 'image'">
      <rect x="3.7" y="4.9" width="16.6" height="14.2" rx="2.3" />
      <circle cx="8.7" cy="9.7" r="1.35" />
      <path d="M4.2 16.9 10.3 10.4l3.7 3.7" />
    </g>

    <!-- 视频：摄像机 -->
    <g v-else-if="props.name === 'video'">
      <rect x="3.3" y="6" width="12.4" height="12" rx="2.4" />
      <path d="M15.7 10.6 20.7 7.8v8.4l-5-2.8z" />
    </g>

    <!-- 文字 -->
    <g v-else-if="props.name === 'type'">
      <path d="M5.4 7h13.2" />
      <path d="M12 7v10.2" />
    </g>

    <!-- 兜底：圆点，避免拼错名字时整块空白 -->
    <circle v-else cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" />
  </svg>
</template>

<style scoped>
.ico {
  display: block;
  flex: none;
}
</style>
