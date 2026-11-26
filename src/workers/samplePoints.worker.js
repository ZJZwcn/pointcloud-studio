/**
 * 表面采样 Worker
 * 输入：网格 positions / normals / uv / index + 目标点数
 * 输出：点云属性（表面点、法线、颜色、散开位置、错峰参数）
 *
 * 采样策略：按三角形面积做累积分布（CDF）+ 二分查找，
 * 保证点在模型表面上的密度均匀（不是按顶点均匀，那样大面会变稀）。
 */

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** 在降采样后的贴图上做双线性采样，返回线性空间颜色 0..1 */
function sampleTexture(tex, u, v, out) {
  if (!tex) return false
  let x = u
  let y = tex.flipV ? 1 - v : v
  x = x - Math.floor(x)
  y = y - Math.floor(y)
  const w = tex.width
  const h = tex.height
  const fx = x * (w - 1)
  const fy = y * (h - 1)
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(x0 + 1, w - 1)
  const y1 = Math.min(y0 + 1, h - 1)
  const tx = fx - x0
  const ty = fy - y0
  const d = tex.data
  const i00 = (y0 * w + x0) * 4
  const i10 = (y0 * w + x1) * 4
  const i01 = (y1 * w + x0) * 4
  const i11 = (y1 * w + x1) * 4
  for (let k = 0; k < 3; k++) {
    const a = d[i00 + k] + (d[i10 + k] - d[i00 + k]) * tx
    const b = d[i01 + k] + (d[i11 + k] - d[i01 + k]) * tx
    out[k] = srgbToLinear((a + (b - a) * ty) / 255)
  }
  return true
}

self.onmessage = (e) => {
  const t0 = performance.now()
  const job = e.data
  const { positions, normals, uvs, index, count, texture, seed = 1337 } = job

  const rnd = mulberry32(seed)
  const vertCount = positions.length / 3
  const triCount = index ? index.length / 3 : Math.floor(vertCount / 3)

  // ---- 1. 包围盒 ----
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const cx = (minX + maxX) * 0.5
  const cy = (minY + maxY) * 0.5
  const cz = (minZ + maxZ) * 0.5
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ)
  const R = diag * 0.5 || 1

  // ---- 2. 面积 CDF ----
  const cdf = new Float64Array(triCount)
  let acc = 0
  const vx = new Float32Array(9)
  for (let t = 0; t < triCount; t++) {
    let i0, i1, i2
    if (index) {
      i0 = index[t * 3] * 3; i1 = index[t * 3 + 1] * 3; i2 = index[t * 3 + 2] * 3
    } else {
      i0 = t * 9; i1 = t * 9 + 3; i2 = t * 9 + 6
    }
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2]
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2]
    const qx = positions[i2], qy = positions[i2 + 1], qz = positions[i2 + 2]
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = qx - ax, e2y = qy - ay, e2z = qz - az
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    acc += Math.hypot(nx, ny, nz) * 0.5
    cdf[t] = acc
  }
  const totalArea = acc || 1

  // ---- 3. 分配输出缓冲 ----
  const outPos = new Float32Array(count * 3)
  const outNor = new Float32Array(count * 3)
  const outCol = new Float32Array(count * 3)
  const outScatter = new Float32Array(count * 3)
  const outSeed = new Float32Array(count)
  const outDelay = new Float32Array(count)
  const outSize = new Float32Array(count)
  const outHeight = new Float32Array(count)

  const col = [0.55, 0.62, 0.6]
  const hasNormals = !!normals && normals.length === positions.length
  let textured = 0

  for (let s = 0; s < count; s++) {
    // --- 面积加权选一个三角形 ---
    const r = rnd() * totalArea
    let lo = 0, hi = triCount - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid] < r) lo = mid + 1
      else hi = mid
    }
    let i0, i1, i2
    if (index) {
      i0 = index[lo * 3] * 3; i1 = index[lo * 3 + 1] * 3; i2 = index[lo * 3 + 2] * 3
    } else {
      i0 = lo * 9; i1 = lo * 9 + 3; i2 = lo * 9 + 6
    }

    // --- 重心坐标（开根号保证三角形内均匀）---
    const r1 = Math.sqrt(rnd())
    const r2 = rnd()
    const w0 = 1 - r1
    const w1 = r1 * (1 - r2)
    const w2 = r1 * r2

    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2]
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2]
    const qx = positions[i2], qy = positions[i2 + 1], qz = positions[i2 + 2]

    const px = ax * w0 + bx * w1 + qx * w2
    const py = ay * w0 + by * w1 + qy * w2
    const pz = az * w0 + bz * w1 + qz * w2

    // --- 法线 ---
    let nx, ny, nz
    if (hasNormals) {
      nx = normals[i0] * w0 + normals[i1] * w1 + normals[i2] * w2
      ny = normals[i0 + 1] * w0 + normals[i1 + 1] * w1 + normals[i2 + 1] * w2
      nz = normals[i0 + 2] * w0 + normals[i1 + 2] * w1 + normals[i2 + 2] * w2
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len; ny /= len; nz /= len
    } else {
      // 面法线兜底
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az
      const e2x = qx - ax, e2y = qy - ay, e2z = qz - az
      nx = e1y * e2z - e1z * e2y
      ny = e1z * e2x - e1x * e2z
      nz = e1x * e2y - e1y * e2x
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len; ny /= len; nz /= len
    }
    outNor[s * 3] = nx; outNor[s * 3 + 1] = ny; outNor[s * 3 + 2] = nz
    outPos[s * 3] = px; outPos[s * 3 + 1] = py; outPos[s * 3 + 2] = pz

    // --- 颜色：优先取贴图 ---
    if (texture && uvs) {
      let u, v
      if (index) {
        u = uvs[i0 / 3 * 2] * w0 + uvs[i1 / 3 * 2] * w1 + uvs[i2 / 3 * 2] * w2
        v = uvs[i0 / 3 * 2 + 1] * w0 + uvs[i1 / 3 * 2 + 1] * w1 + uvs[i2 / 3 * 2 + 1] * w2
      } else {
        u = uvs[(i0 / 3) * 2] * w0 + uvs[(i1 / 3) * 2] * w1 + uvs[(i2 / 3) * 2] * w2
        v = uvs[(i0 / 3) * 2 + 1] * w0 + uvs[(i1 / 3) * 2 + 1] * w1 + uvs[(i2 / 3) * 2 + 1] * w2
      }
      if (sampleTexture(texture, u, v, col)) textured++
    }
    outCol[s * 3] = col[0]; outCol[s * 3 + 1] = col[1]; outCol[s * 3 + 2] = col[2]

    // --- 散开位置：沿法线抬升 + 径向膨胀 + 绕 Y 漩涡 ---
    const ox = px - cx, oy = py - cy, oz = pz - cz
    const distN = Math.min(1, Math.hypot(ox, oy, oz) / R)
    const e1 = rnd(), e2 = rnd(), e3 = rnd()
    const expand = (0.10 + 0.85 * Math.pow(e1, 1.7)) * (0.55 + 0.7 * distN)
    const swirl = (e2 - 0.5) * 2.1 * expand
    const cs = Math.cos(swirl), sn = Math.sin(swirl)
    const ix = ox * (1 + expand)
    const ixr = ix * cs - oz * (1 + expand) * sn
    const izr = ix * sn + oz * (1 + expand) * cs
    const iy = oy * (1 + expand * 0.75) + (e3 - 0.5) * R * 0.38 * expand
    const nPush = (0.03 + 0.30 * e1) * R
    outScatter[s * 3] = cx + ixr + nx * nPush
    outScatter[s * 3 + 1] = cy + iy + ny * nPush
    outScatter[s * 3 + 2] = cz + izr + nz * nPush

    // --- 错峰 / 尺寸 / 高度 ---
    const hN = Math.max(0, Math.min(1, (py - minY) / (maxY - minY || 1)))
    outHeight[s] = hN
    outDelay[s] = Math.min(1, 0.58 * hN + 0.42 * rnd())
    outSeed[s] = rnd()
    outSize[s] = 0.65 + rnd() * 0.95
  }

  self.postMessage(
    {
      positions: outPos,
      normals: outNor,
      colors: outCol,
      scatter: outScatter,
      seeds: outSeed,
      delays: outDelay,
      sizes: outSize,
      heights: outHeight,
      textureHits: textured,
      triangles: triCount,
      bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], center: [cx, cy, cz], radius: R },
      ms: performance.now() - t0
    },
    [
      outPos.buffer, outNor.buffer, outCol.buffer, outScatter.buffer,
      outSeed.buffer, outDelay.buffer, outSize.buffer, outHeight.buffer
    ]
  )
}
