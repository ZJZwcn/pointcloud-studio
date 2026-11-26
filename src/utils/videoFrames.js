/**
 * 视频取帧：混元生 3D 只吃图片，所以视频要先在本地抽几帧让用户挑。
 * 全部在浏览器里做，不上传原视频。
 */

/**
 * @param {File} file 视频文件
 * @param {number} count 抽几帧
 * @returns {Promise<{duration:number, width:number, height:number, frames:Array}>}
 */
export async function extractFrames(file, count = 6) {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = url

  try {
    await once(video, 'loadedmetadata', 15000)
    // 有些容器首帧才能拿到尺寸
    if (!video.videoWidth) await once(video, 'loadeddata', 15000)

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    if (!duration) throw new Error('这个视频读不出时长，换一个格式试试（推荐 mp4）')

    const times = []
    // 掐头去尾，避免黑场/片尾
    const start = Math.min(duration * 0.08, 1.2)
    const end = Math.max(duration - Math.min(duration * 0.08, 1.2), start + 0.1)
    for (let i = 0; i < count; i++) {
      times.push(count === 1 ? (start + end) / 2 : start + ((end - start) * i) / (count - 1))
    }

    const frames = []
    for (const t of times) {
      await seek(video, t)
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight))
      canvas.width = Math.max(2, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(2, Math.round(video.videoHeight * scale))
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
      frames.push({
        time: t,
        dataUrl,
        width: canvas.width,
        height: canvas.height,
        sharpness: sharpness(ctx, canvas.width, canvas.height)
      })
    }

    return {
      duration,
      width: video.videoWidth,
      height: video.videoHeight,
      frames,
      best: pickBest(frames)
    }
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

function once(el, ev, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('读取视频超时'))
    }, ms)
    const ok = () => {
      cleanup()
      resolve()
    }
    const bad = () => {
      cleanup()
      reject(new Error('这个视频无法解码（推荐 mp4 / h264）'))
    }
    function cleanup() {
      clearTimeout(timer)
      el.removeEventListener(ev, ok)
      el.removeEventListener('error', bad)
    }
    el.addEventListener(ev, ok, { once: true })
    el.addEventListener('error', bad, { once: true })
  })
}

function seek(video, t) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve() // 超时就画当前帧，不卡流程
    }, 4000)
    const ok = () => {
      cleanup()
      resolve()
    }
    function cleanup() {
      clearTimeout(timer)
      video.removeEventListener('seeked', ok)
      video.removeEventListener('error', reject)
    }
    video.addEventListener('seeked', ok, { once: true })
    video.addEventListener('error', reject, { once: true })
    video.currentTime = Math.min(Math.max(0, t), Math.max(0, (video.duration || 0) - 0.05))
  })
}

/** 梯度能量当清晰度：越大越锐利，用来默认挑一帧 */
function sharpness(ctx, w, h) {
  const sw = Math.min(160, w)
  const sh = Math.max(1, Math.round((h / w) * sw))
  const tmp = document.createElement('canvas')
  tmp.width = sw
  tmp.height = sh
  const tctx = tmp.getContext('2d', { willReadFrequently: true })
  tctx.drawImage(ctx.canvas, 0, 0, sw, sh)
  const d = tctx.getImageData(0, 0, sw, sh).data
  const lum = new Float32Array(sw * sh)
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    lum[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  }
  let sum = 0
  for (let y = 1; y < sh; y++) {
    for (let x = 1; x < sw; x++) {
      const p = y * sw + x
      sum += Math.abs(lum[p] - lum[p - 1]) + Math.abs(lum[p] - lum[p - sw])
    }
  }
  return sum / ((sw - 1) * (sh - 1))
}

function pickBest(frames) {
  let best = 0
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].sharpness > frames[best].sharpness) best = i
  }
  return best
}

export function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] || 'image/jpeg'
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type: mime })
}

export function fmtTime(s) {
  if (!Number.isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}
