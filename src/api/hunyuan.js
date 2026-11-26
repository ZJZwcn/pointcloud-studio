/**
 * 腾讯混元生 3D —— 前端调用层
 *
 * 走 OpenAI 兼容接口（用户自己填 API Key）：
 *   https://api.ai3d.cloud.tencent.com/v1/ai3d/submit | query
 * 真实请求由本地 /api/hunyuan/* 中转（CORS + Key 不前后端硬编码），见 server/hunyuan.mjs
 *
 * 文档：https://cloud.tencent.com/document/product/1804/126189
 */

const KEY_STORE = 'pcs.hunyuan.key'
const ENDPOINT_STORE = 'pcs.hunyuan.endpoint'

// ---------------------------------------------------------------- Key

export function loadKey() {
  try {
    return localStorage.getItem(KEY_STORE) || ''
  } catch {
    return ''
  }
}

export function saveKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORE, key.trim())
    else localStorage.removeItem(KEY_STORE)
  } catch {
    /* 隐私模式下写不进去，忽略 */
  }
}

export function maskKey(key) {
  if (!key) return ''
  if (key.length <= 10) return key[0] + '***' + key.slice(-2)
  return key.slice(0, 6) + '••••••' + key.slice(-5)
}

// ---------------------------------------------------------------- 请求

async function post(path, body, key) {
  const res = await fetch(`/api/hunyuan/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hunyuan-Key': key || '' },
    body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = data.error || {}
    const e = new Error(err.message || err || `接口返回 ${res.status}`)
    e.code = err.code || res.status
    e.raw = data
    throw e
  }
  return data
}

/**
 * 提交生成任务
 * @param {object} o
 * @param {string} [o.imageBase64] 纯 base64（不带 data: 前缀）
 * @param {string} [o.prompt]      文生 3D 的提示词
 */
export async function submitJob(o, key) {
  const body = {
    Model: o.model || '3.0',
    GenerateType: o.generateType || 'Normal',
    FaceCount: o.faceCount ?? 500000,
    EnablePBR: !!o.enablePBR
  }
  if (o.prompt) body.Prompt = o.prompt
  if (o.imageBase64) body.ImageBase64 = o.imageBase64
  if (o.generateType === 'LowPoly' && o.polygonType) body.PolygonType = o.polygonType

  // 多视角：MultiViewImages 是 ViewImage 数组，每个视角一张
  // （视角取值见文档：left/right/back 三版本通用，top/bottom/left_front/right_front 仅 3.1）
  const views = Array.isArray(o.multiView) ? o.multiView.filter((v) => v && v.base64) : []
  if (views.length) body.MultiViewImages = views.map((v) => ({ ViewType: v.view, ViewImageBase64: v.base64 }))

  try {
    return await post('submit', body, key)
  } catch (e) {
    const msg = e.message || ''
    const looksLikeFormat = /image|base64|参数|格式|图片/i.test(msg)
    // 少数网关要 data URL 形式，失败后再试一次
    if (looksLikeFormat && o.imageBase64) {
      try {
        return await post('submit', { ...body, ImageBase64: 'data:image/jpeg;base64,' + o.imageBase64 }, key)
      } catch (e2) {
        throw e2
      }
    }
    if (looksLikeFormat && views.length) {
      try {
        return await post(
          'submit',
          {
            ...body,
            MultiViewImages: views.map((v) => ({
              ViewType: v.view,
              ViewImageBase64: 'data:image/jpeg;base64,' + v.base64
            }))
          },
          key
        )
      } catch (e2) {
        throw e2
      }
    }
    throw e
  }
}

export async function queryJob(jobId, key) {
  return await post('query', { JobId: jobId }, key)
}

/** 轮询到 DONE / FAIL，或超时。onTick({status, seconds}) 用于推进进度条 */
export async function waitForJob(jobId, key, { onTick, timeoutMs = 15 * 60 * 1000, signal } = {}) {
  const t0 = Date.now()
  let interval = 2000
  for (;;) {
    if (signal?.aborted) throw new Error('已取消')
    const r = await queryJob(jobId, key)
    const status = String(r.Status || 'UNKNOWN').toUpperCase()
    const seconds = (Date.now() - t0) / 1000
    onTick?.({ status, seconds, raw: r })

    if (status === 'DONE') return r
    if (status === 'FAIL' || status === 'FAILED') {
      const e = new Error(r.ErrorMessage || r.ErrorCode || '生成失败')
      e.code = r.ErrorCode
      e.raw = r
      throw e
    }
    if (Date.now() - t0 > timeoutMs) throw new Error('生成超时（15 分钟），可稍后用任务 ID 重试')

    await new Promise((res) => setTimeout(res, interval))
    interval = Math.min(4000, interval + 400)
  }
}

// ---------------------------------------------------------------- 结果

const FORMAT_RANK = { GLB: 0, GLTF: 1, FBX: 2, OBJ: 3, STL: 4, USDZ: 9 }

/** 从 ResultFile3Ds 里挑一个能直接加载的模型（优先 GLB） */
export function pickModelFile(result) {
  const list = (result?.ResultFile3Ds || []).filter((f) => f && f.Url)
  if (!list.length) return null
  return list
    .slice()
    .sort((a, b) => (FORMAT_RANK[(a.Type || '').toUpperCase()] ?? 5) - (FORMAT_RANK[(b.Type || '').toUpperCase()] ?? 5))[0]
}

/** 下载模型文件（cos 链接跨域，走本地中转） */
export async function fetchModelBuffer(url, onProgress) {
  const r = await fetch(`/api/hunyuan/file?url=${encodeURIComponent(url)}`)
  if (!r.ok) {
    const t = await r.json().catch(() => ({}))
    throw new Error(t.error || `下载模型失败 HTTP ${r.status}`)
  }
  const total = Number(r.headers.get('content-length') || 0)
  if (!r.body || !total) {
    const buf = await r.arrayBuffer()
    onProgress?.(1)
    return buf
  }
  const reader = r.body.getReader()
  const chunks = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    onProgress?.(Math.min(0.999, got / total))
  }
  const out = new Uint8Array(got)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  onProgress?.(1)
  return out.buffer
}

// ---------------------------------------------------------------- 图片预处理

/**
 * 压到最长边 2048、JPEG 0.92，返回纯 base64（混元要求 ≤6MB、单边 128~5000）
 * @param {File|Blob} file
 */
export async function prepareImage(file, { maxSide = 2048, quality = 0.92 } = {}) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const base64 = dataUrl.split(',')[1]
  return { base64, dataUrl, width: w, height: h, bytes: Math.round((base64.length * 3) / 4) }
}

export const MODEL_OPTIONS = [
  { value: '3.0', label: '3.0', hint: '稳定通用' },
  { value: '3.1', label: '3.1', hint: '更细节 / 支持多视图' }
]

export const FACE_OPTIONS = [
  { value: 20000, label: '低', hint: '2 万面' },
  { value: 150000, label: '中', hint: '15 万面' },
  { value: 500000, label: '高', hint: '50 万面（默认）' },
  { value: 1500000, label: '极高', hint: '150 万面' }
]

export const TYPE_OPTIONS = [
  { value: 'Normal', label: '标准', hint: '带贴图几何体' },
  { value: 'Geometry', label: '白模', hint: '不带贴图' },
  { value: 'LowPoly', label: '低模', hint: '智能拓扑（3.0）' },
  { value: 'Sketch', label: '草图', hint: '线稿 / 草图建模' }
]
