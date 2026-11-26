/**
 * 生产环境小服务器：静态托管 dist/ + 混元 API 中转
 *   npm run build && npm start
 */
import { createServer } from 'node:http'
import { createReadStream, promises as fs } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hunyuanMiddleware } from './hunyuan.mjs'

const ROOT = fileURLToPath(new URL('../dist', import.meta.url))
const PORT = Number(process.env.PORT || 5183)
const HOST = process.env.HOST || '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.fbx': 'application/octet-stream',
  '.obj': 'text/plain; charset=utf-8',
  '.mtl': 'text/plain; charset=utf-8',
  '.ply': 'application/octet-stream',
  '.stl': 'application/octet-stream',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2'
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://local')
  let rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  const file = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden')
    return
  }
  try {
    const stat = await fs.stat(file)
    if (stat.isDirectory()) throw new Error('dir')
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600'
    })
    createReadStream(file).pipe(res)
  } catch {
    // SPA 回退
    try {
      const html = await fs.readFile(join(ROOT, 'index.html'))
      res.writeHead(200, { 'content-type': MIME['.html'], 'content-length': html.length })
      res.end(html)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('先 npm run build')
    }
  }
}

const server = createServer((req, res) => {
  if (req.url.startsWith('/api/hunyuan')) return hunyuanMiddleware(req, res)
  serveStatic(req, res)
})

server.listen(PORT, HOST, () => {
  console.log(`point cloud studio → http://${HOST}:${PORT}`)
  if (process.env.HUNYUAN_MOCK === '1') console.log('混元接口处于 mock 模式（HUNYUAN_MOCK=1）')
})
