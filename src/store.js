import { reactive } from 'vue'

export const ui = reactive({
  // 载入
  loading: true,
  progress: 0,
  progressLabel: '载入模型',
  ready: false,
  error: '',

  // 模型信息
  name: '电池',
  file: 'battery.glb',
  origin: 'default', // default | file | hunyuan（决定导出里是否出现「原文件」）
  triangles: 0,
  vertices: 0,
  meshes: 0,
  hasTexture: false,

  // 点云参数
  points: 320000,
  pointSize: 1,
  disperse: 1,
  colorMode: 0,
  stagger: 0.62,
  duration: 2.2,
  glow: 0.46,

  // 状态
  morph: 0,
  playing: false,
  autoRotate: true,
  fps: 0,
  resampling: false,
  dragging: false,
  drawer: false,
  toast: '',
  toastKey: 0,

  // AI 生成（腾讯混元生 3D）
  gen: {
    open: false, // 配置面板
    phase: 'idle', // idle | preparing | submitting | running | downloading | done | error
    progress: 0, // 0..1，展示用（会平滑推进）
    status: '',
    jobId: '',
    error: '',
    seconds: 0,
    credits: null,
    hasKey: false,
    mode: 'image', // image | video | text
    imgMode: 'single', // single | multi（多视角）
    prompt: '',
    // 输入素材
    input: {
      kind: '',
      name: '',
      previewUrl: '',
      width: 0,
      height: 0,
      bytes: 0,
      base64: ''
    },
    // 多视角：key 为视角名（top/left/right/back/front/left_front/right_front/bottom）
    views: {},
    // 视频帧
    video: {
      duration: 0,
      frames: [],
      pick: 0,
      loading: false
    },
    // 参数
    model: '3.0',
    faceCount: 500000,
    generateType: 'Normal',
    enablePBR: true,
    resultTag: ''
  }
})

let toastTimer = null
export function say(msg, ms = 2600) {
  ui.toast = msg
  ui.toastKey++
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (ui.toast = ''), ms)
}
