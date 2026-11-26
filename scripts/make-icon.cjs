// 生成 Windows 图标 public/app.ico（多尺寸，PNG 压缩的 ICO，Vista+ 原生支持）
// 复用 make-favicon.cjs 的程序化渲染，保证 exe 图标与浏览器标签图标是同一个东西
const fs = require('fs')
const path = require('path')
const { render, encodePNG } = require('./make-favicon.cjs')

const SIZES = [256, 48, 32, 16]
const OUT = path.join(__dirname, '..', 'public', 'app.ico')

const pngs = SIZES.map((s) => encodePNG(s, render(s)))

// ICONDIR(6) + ICONDIRENTRY(16) * n + 各 PNG 数据
const head = Buffer.alloc(6)
head.writeUInt16LE(0, 0) // reserved
head.writeUInt16LE(1, 2) // type = 1 (icon)
head.writeUInt16LE(pngs.length, 4)

let offset = 6 + 16 * pngs.length
const entries = pngs.map((png, i) => {
  const size = SIZES[i]
  const e = Buffer.alloc(16)
  e[0] = size >= 256 ? 0 : size // 0 表示 256
  e[1] = size >= 256 ? 0 : size
  e[2] = 0 // 调色板数
  e[3] = 0 // reserved
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bpp
  e.writeUInt32LE(png.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += png.length
  return e
})

const ico = Buffer.concat([head, ...entries, ...pngs])
fs.writeFileSync(OUT, ico)
console.log('wrote', path.relative(process.cwd(), OUT), ico.length, 'bytes ·', SIZES.join('/'))
