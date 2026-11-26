/**
 * 腾讯混元生 3D —— OpenAI 兼容接口的本地中转
 *
 * 浏览器直连 api.ai3d.cloud.tencent.com 会被 CORS 拦掉，并且 API Key 不该出现在前端
 * 打包产物里（用户可随时在自己的界面上更换）。所以：
 *   - Key 由前端每次请求带在 X-Hunyuan-Key 头里，只存在浏览器 localStorage
 *   - 这里只做转发，不落盘、不记日志
 *   - 生成结果 COS 链接同样跨域，也由这里流式转发（白名单限定腾讯云域名，避免变成开放代理）
 *
 * 兼容接口文档：https://cloud.tencent.com/document/product/1804/126189
 */
import { Readable } from 'node:stream'

const BASE = process.env.HUNYUAN_BASE || 'https://api.ai3d.cloud.tencent.com'
// 假任务模式：没有 Key 也能走通「提交 → 轮询 → 下载 → 建模」全流程
let MOCK = process.env.HUNYUAN_MOCK === '1'

// 只允许转发到腾讯云的存储域名，避免成为开放代理
const FILE_HOST_SUFFIX = ['tencentcos.cn', 'myqcloud.com', 'tencent.com', 'qcloud.com']

const PREFIX = '/api/hunyuan'

// ---------------------------------------------------------------- 小工具

function sendJSON(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj))
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'access-control-allow-origin': '*',
    'cache-control': 'no-store'
  })
  res.end(body)
}

function readBody(req, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('请求体过大（图片请压缩到 6MB 以内）'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function apiKey(req) {
  const raw = req.headers['x-hunyuan-key'] || req.headers.authorization || ''
  return String(raw).replace(/^Bearer\s+/i, '').trim()
}

// ---------------------------------------------------------------- 上游调用

/**
 * 文档示例给的是裸 key：Authorization: sk-xxxxx
 * 个别账号/网关会要求 Bearer 前缀，所以 401 时自动再试一次。
 */
async function callUpstream(path, body, key) {
  const url = BASE + path
  const attempt = async (auth) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000)
    })
    const text = await r.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 上游返回非 JSON，下面按纯文本报错 */
    }
    return { status: r.status, json, text }
  }

  let out = await attempt(key)
  if (out.status === 401 || out.status === 403) {
    const retry = await attempt(`Bearer ${key}`)
    if (retry.status !== 401 && retry.status !== 403) out = retry
  }
  return out
}

function upstreamError(out) {
  const j = out.json || {}
  const msg =
    j.Error?.Message ||
    j.error?.message ||
    j.message ||
    j.Response?.Error?.Message ||
    (out.text || '').slice(0, 300) ||
    '未知错误'
  const code = j.Error?.Code || j.error?.code || j.Response?.Error?.Code || out.status
  return { code, message: msg, status: out.status }
}

// ---------------------------------------------------------------- mock（本地联调用）

const mockJobs = new Map()

function mockSubmit() {
  const id = 'mock-' + Date.now()
  mockJobs.set(id, Date.now())
  return id
}

function mockQuery(id) {
  const t = (Date.now() - (mockJobs.get(id) || Date.now())) / 1000
  if (t < 5) return { Status: 'WAIT' }
  if (t < 18) return { Status: 'RUN' }
  return {
    Status: 'DONE',
    ResultFile3Ds: [{ Type: 'GLB', Url: '/models/battery.glb', PreviewImageUrl: '' }],
    ResultCreditConsumed: 20,
    ResultCreditDetails: '{"GenerateType-Normal":20}'
  }
}

// ---------------------------------------------------------------- 生成结果下载

async function proxyFile(req, res, query) {
  const target = query.get('url')
  if (!target) return sendJSON(res, 400, { error: '缺少 url 参数' })

  // 本地路径（mock 模式）直接交给静态服务
  if (target.startsWith('/')) {
    res.writeHead(302, { location: target })
    return res.end()
  }

  let u
  try {
    u = new URL(target)
  } catch {
    return sendJSON(res, 400, { error: 'url 不合法' })
  }
  if (u.protocol !== 'https:' || !FILE_HOST_SUFFIX.some((s) => u.hostname.endsWith(s))) {
    return sendJSON(res, 403, { error: '只允许下载腾讯云存储的链接' })
  }

  try {
    const up = await fetch(u, { signal: AbortSignal.timeout(300000) })
    if (!up.ok || !up.body) return sendJSON(res, 502, { error: `下载失败 HTTP ${up.status}` })
    const headers = {
      'content-type': up.headers.get('content-type') || 'application/octet-stream',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store'
    }
    const len = up.headers.get('content-length')
    if (len) headers['content-length'] = len
    res.writeHead(200, headers)
    Readable.fromWeb(up.body).pipe(res)
  } catch (e) {
    if (!res.headersSent) sendJSON(res, 502, { error: '下载失败：' + e.message })
    else res.end()
  }
}

// ---------------------------------------------------------------- 中间件

export function hunyuanMiddleware(req, res, next, opts = {}) {
  if (opts && opts.mock) MOCK = true
  let pathname
  try {
    pathname = new URL(req.url, 'http://local').pathname
  } catch {
    return next ? next() : sendJSON(res, 400, { error: 'bad url' })
  }
  if (!pathname.startsWith(PREFIX)) return next ? next() : sendJSON(res, 404, { error: 'not found' })

  const action = pathname.slice(PREFIX.length).replace(/^\//, '')
  const query = new URL(req.url, 'http://local').searchParams

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-hunyuan-key, authorization',
      'access-control-allow-methods': 'GET, POST, OPTIONS'
    })
    return res.end()
  }

  handle(action, req, res, query).catch((e) => {
    if (!res.headersSent) sendJSON(res, 500, { error: e.message })
    else res.end()
  })
}

async function handle(action, req, res, query) {
  if (action === 'file' && req.method === 'GET') return proxyFile(req, res, query)

  if (req.method !== 'POST') return sendJSON(res, 405, { error: '只支持 POST' })

  if (action === 'submit') {
    const key = apiKey(req)
    if (!MOCK && !key) return sendJSON(res, 401, { error: '缺少 API Key' })

    const body = JSON.parse((await readBody(req)) || '{}')

    if (MOCK) {
      return sendJSON(res, 200, { JobId: mockSubmit(), RequestId: 'mock', mock: true })
    }

    const out = await callUpstream('/v1/ai3d/submit', body, key)
    if (out.status >= 400 || !out.json) return sendJSON(res, 502, { error: upstreamError(out) })

    const j = out.json
    const jobId =
      j.JobId || j.jobId || j.job_id || j.id || j.data?.JobId || j.data?.job_id || j.Response?.JobId
    if (!jobId) return sendJSON(res, 502, { error: { message: '上游没有返回 JobId', raw: j } })
    return sendJSON(res, 200, { JobId: String(jobId), raw: j })
  }

  if (action === 'query') {
    const key = apiKey(req)
    if (!MOCK && !key) return sendJSON(res, 401, { error: '缺少 API Key' })

    const body = JSON.parse((await readBody(req)) || '{}')
    const jobId = body.JobId || body.jobId
    if (!jobId) return sendJSON(res, 400, { error: '缺少 JobId' })

    if (MOCK) return sendJSON(res, 200, mockQuery(String(jobId)))

    const out = await callUpstream('/v1/ai3d/query', { JobId: jobId }, key)
    if (out.status >= 400 || !out.json) return sendJSON(res, 502, { error: upstreamError(out) })

    const j = out.json
    const d = j.data || j.Response || j
    const files = d.ResultFile3Ds || d.ResultFile3D || j.ResultFile3Ds || []
    return sendJSON(res, 200, {
      Status: d.Status || d.status || j.Status || 'UNKNOWN',
      ErrorCode: d.ErrorCode || '',
      ErrorMessage: d.ErrorMessage || '',
      ResultFile3Ds: Array.isArray(files) ? files : [files].filter(Boolean),
      ResultCreditConsumed: d.ResultCreditConsumed,
      ResultCreditDetails: d.ResultCreditDetails,
      raw: j
    })
  }

  return sendJSON(res, 404, { error: 'unknown action: ' + action })
}
