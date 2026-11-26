// 生成 favicon：SVG（矢量主用）+ PNG（32 传统兜底 / 180 apple-touch）
// 几何与站点品牌标记一致：黄金角螺旋点场 —— 中心密、边缘疏、透明度沿半径衰减
const fs = require('fs')
const zlib = require('zlib')
const path = require('path')

const OUT = path.join(__dirname, '..', 'public')

// ---------------------------------------------------------------- 几何
const CX = 16
const CY = 16
// 一圈八点 + 中心一点：16px 下就是一圈能认出的小点，不会糊成一团
const DOTS = []
const RING = 8.6
const NR = 8
for (let i = 0; i < NR; i++) {
  const th = -Math.PI / 2 + (i * Math.PI * 2) / NR
  DOTS.push({
    x: CX + RING * Math.cos(th),
    y: CY + RING * Math.sin(th),
    rad: 1.55,
    a: i === 0 ? 0.95 : 0.6 // 正上方那颗点亮一点，像被照射
  })
}
DOTS.push({ x: CX, y: CY, rad: 2.5, a: 1 })

const BG = '#0d131a'
const ACCENT = '#dcff4d'

// ---------------------------------------------------------------- SVG
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect x="0" y="0" width="32" height="32" rx="7.5" fill="${BG}" />
  <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="6.9" fill="none"
        stroke="${ACCENT}" stroke-opacity="0.28" stroke-width="1.5" />
  <g fill="${ACCENT}">
${DOTS.map(
  (d) =>
    `    <circle cx="${d.x.toFixed(2)}" cy="${d.y.toFixed(2)}" r="${d.rad.toFixed(
      2
    )}" opacity="${d.a.toFixed(2)}" />`
).join('\n')}
  </g>
</svg>
`
fs.writeFileSync(path.join(OUT, 'favicon.svg'), svg)

// ---------------------------------------------------------------- PNG 光栅化
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16)
]
const cBg = hex(BG)
const cAcc = hex(ACCENT)

function render(size) {
  const SS = 4 // 超采样倍数
  const S = size * SS
  const k = S / 32
  const px = new Uint8ClampedArray(size * size * 4) // rgba 8bit

  // 圆角矩形覆盖判断（超采样坐标）
  const R = 7.5 * k
  const inTile = (x, y) => {
    const cx = Math.min(Math.max(x, R), S - R)
    const cy = Math.min(Math.max(y, R), S - R)
    const dx = x - cx
    const dy = y - cy
    return dx * dx + dy * dy <= R * R
  }
  // 描边：距边 1.5 宽的一圈
  const inStroke = (x, y) => {
    const outer = R
    const inner = R - 1.5 * k
    const d = (rr) => {
      const cx = Math.min(Math.max(x, rr), S - rr)
      const cy = Math.min(Math.max(y, rr), S - rr)
      const dx = x - cx
      const dy = y - cy
      return dx * dx + dy * dy <= rr * rr
    }
    return d(outer) && !d(Math.max(inner, 0.001))
  }
  const inDot = (x, y, d) => {
    const dx = x - d.x * k
    const dy = y - d.y * k
    const rr = d.rad * k
    return dx * dx + dy * dy <= rr * rr
  }

  for (let py = 0; py < size; py++) {
    for (let pxx = 0; pxx < size; pxx++) {
      let tile = 0
      let stroke = 0
      const dotAcc = DOTS.map(() => 0)
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = pxx * SS + sx + 0.5
          const y = py * SS + sy + 0.5
          if (inTile(x, y)) tile++
          if (inStroke(x, y)) stroke++
          for (let i = 0; i < DOTS.length; i++) if (inDot(x, y, DOTS[i])) dotAcc[i]++
        }
      }
      const total = SS * SS
      const i4 = (py * size + pxx) * 4
      // 底色
      let r = cBg[0] / 255
      let g = cBg[1] / 255
      let b = cBg[2] / 255
      let a = tile / total
      // 描边（叠在底色上）
      const sa = (stroke / total) * 0.22
      r = r * (1 - sa) + (cAcc[0] / 255) * sa
      g = g * (1 - sa) + (cAcc[1] / 255) * sa
      b = b * (1 - sa) + (cAcc[2] / 255) * sa
      // 点：从中心往外交叠，越靠外越先画（中心最亮）
      for (let i = DOTS.length - 1; i >= 0; i--) {
        const cov = dotAcc[i] / total
        if (!cov) continue
        const al = cov * DOTS[i].a
        r = r * (1 - al) + (cAcc[0] / 255) * al
        g = g * (1 - al) + (cAcc[1] / 255) * al
        b = b * (1 - al) + (cAcc[2] / 255) * al
        a = a + al * (1 - a)
      }
      px[i4] = Math.round(r * 255)
      px[i4 + 1] = Math.round(g * 255)
      px[i4 + 2] = Math.round(b * 255)
      px[i4 + 3] = Math.round(a * 255)
    }
  }
  return px
}

// ---------------------------------------------------------------- PNG 编码
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// 被 require 时只导出渲染函数（make-icon.cjs 拿来生成 .ico）
module.exports = { render, encodePNG }

if (require.main === module) {
  for (const size of [32, 180, 512]) {
    const png = encodePNG(size, render(size))
    const name = size === 180 ? 'apple-touch-icon.png' : `favicon-${size}.png`
    fs.writeFileSync(path.join(OUT, name), png)
    console.log('wrote', name, png.length, 'bytes')
  }
  console.log('wrote favicon.svg', Buffer.byteLength(svg), 'bytes')
}
