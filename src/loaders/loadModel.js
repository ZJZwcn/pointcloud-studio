import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'

export const SUPPORTED = ['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply']

export function extOf(name = '') {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

function makeManager(files) {
  const map = new Map()
  for (const f of files) {
    const key = f.name.toLowerCase()
    map.set(key, URL.createObjectURL(f))
  }
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url
    let base = url.split('/').pop() || ''
    try { base = decodeURIComponent(base) } catch { /* ignore */ }
    const hit = map.get(base.toLowerCase())
    return hit || url
  })
  return manager
}

function pickEntry(files) {
  const supported = files.filter((f) => SUPPORTED.includes(extOf(f.name)))
  if (!supported.length) return null
  // 优先主模型文件
  const order = ['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply']
  supported.sort((a, b) => order.indexOf(extOf(a.name)) - order.indexOf(extOf(b.name)))
  return supported[0]
}

function loadWith(loader, url, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      resolve,
      (e) => {
        if (onProgress && e && e.lengthComputable) onProgress(e.loaded / e.total)
      },
      reject
    )
  })
}

/** 统一入口：从 URL 载入 */
export async function loadFromURL(url, onProgress) {
  const ext = extOf(url)
  const manager = new THREE.LoadingManager()
  return loadSingle(ext, url, manager, onProgress, '模型')
}

/** 统一入口：从本地文件（可多选，含贴图 / .bin / .mtl 等伴随文件）载入 */
export async function loadFromFiles(files, onProgress) {
  const list = Array.from(files)
  const entry = pickEntry(list)
  if (!entry) throw new Error('不支持的文件类型，请使用 glb / gltf / fbx / obj / stl / ply')
  const manager = makeManager(list)
  const url = URL.createObjectURL(entry)
  return loadSingle(extOf(entry.name), url, manager, onProgress, entry.name)
}

/** 统一入口：从内存字节载入（AI 生成的模型走这里） */
export async function loadFromBuffer(buffer, filename = 'model.glb', onProgress) {
  const ext = extOf(filename) || 'glb'
  if (!SUPPORTED.includes(ext)) throw new Error('不支持的文件类型：' + ext)
  const manager = new THREE.LoadingManager()
  const url = URL.createObjectURL(new Blob([buffer]))
  try {
    return await loadSingle(ext, url, manager, onProgress, filename)
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 15000)
  }
}

async function loadSingle(ext, url, manager, onProgress, label) {
  let object
  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader(manager)
    const gltf = await loadWith(loader, url, onProgress)
    object = gltf.scene || gltf.scenes[0]
  } else if (ext === 'fbx') {
    const loader = new FBXLoader(manager)
    object = await loadWith(loader, url, onProgress)
  } else if (ext === 'obj') {
    const loader = new OBJLoader(manager)
    object = await loadWith(loader, url, onProgress)
    // OBJ 没有材质时给一个中性材质
    object.traverse((o) => {
      if (o.isMesh && (!o.material || o.material.type === 'MeshBasicMaterial')) {
        o.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#8fa3ad'),
          metalness: 0.35,
          roughness: 0.45
        })
      }
    })
  } else if (ext === 'stl') {
    const loader = new STLLoader(manager)
    const geo = await loadWith(loader, url, onProgress)
    object = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#a8b8c0'), metalness: 0.3, roughness: 0.42 })
    )
  } else if (ext === 'ply') {
    const loader = new PLYLoader(manager)
    const geo = await loadWith(loader, url, onProgress)
    geo.computeVertexNormals()
    object = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#a8b8c0'), metalness: 0.3, roughness: 0.42 })
    )
  } else {
    throw new Error('不支持的文件类型：' + ext)
  }

  if (!object) throw new Error('模型解析失败')

  object.updateWorldMatrix(true, true)
  object.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false
      o.receiveShadow = false
      if (o.material && o.material.side === undefined) o.material.side = THREE.FrontSide
    }
  })

  const stats = analyse(object)
  return { root: object, name: label, ...stats }
}

function analyse(object) {
  let triangles = 0
  let vertices = 0
  let meshes = 0
  let textureHits = 0
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry) return
    meshes++
    const g = o.geometry
    const pos = g.attributes.position
    if (pos) vertices += pos.count
    triangles += g.index ? g.index.count / 3 : (pos ? pos.count / 3 : 0)
    const m = Array.isArray(o.material) ? o.material[0] : o.material
    if (m && m.map) textureHits++
  })
  return {
    triangles: Math.round(triangles),
    vertices,
    meshes,
    hasTexture: textureHits > 0,
    texture: textureHits > 0 ? extractTexture(object) : null
  }
}

/**
 * 把颜色贴图降到 512px 以内，转成像素数组给 worker 采样
 * （1.5M 面 / 十几 MB 的原图直接在 CPU 上采太慢，降采样对点色完全够用）
 */
function extractTexture(object, size = 512) {
  let tex = null
  object.traverse((o) => {
    if (tex || !o.isMesh) return
    const m = Array.isArray(o.material) ? o.material[0] : o.material
    if (m && m.map && m.map.image) tex = m.map
  })
  if (!tex) return null
  const img = tex.image
  const w = img.width || img.naturalWidth || 0
  const h = img.height || img.naturalHeight || 0
  if (!w || !h) return null
  try {
    const scale = Math.min(1, size / Math.max(w, h))
    const cw = Math.max(1, Math.round(w * scale))
    const ch = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, cw, ch)
    const data = ctx.getImageData(0, 0, cw, ch).data
    return { data, width: cw, height: ch, flipV: tex.flipY === true }
  } catch (err) {
    console.warn('贴图采样失败，退回纯色点云', err)
    return null
  }
}

/**
 * 把整个场景合并成一份「世界坐标」下的几何数据，供 worker 采样。
 * 只保留 position / normal / uv + index，避免各网格属性不一致导致合并失败。
 */
export function mergeForSampling(root, matrix) {
  const posList = []
  const norList = []
  const uvList = []
  const idxList = []
  let vertexOffset = 0

  root.updateWorldMatrix(true, true)

  const v = new THREE.Vector3()
  const n = new THREE.Vector3()

  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return
    const g = o.geometry
    const pos = g.attributes.position
    if (!pos) return

    const m = new THREE.Matrix4().multiplyMatrices(matrix, o.matrixWorld)
    const normalMat = new THREE.Matrix3().getNormalMatrix(m)

    const nCount = pos.count
    const hasN = !!g.attributes.normal
    const uv = g.attributes.uv

    for (let i = 0; i < nCount; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m)
      posList.push(v.x, v.y, v.z)
      if (hasN) {
        n.fromBufferAttribute(g.attributes.normal, i).applyMatrix3(normalMat).normalize()
        norList.push(n.x, n.y, n.z)
      } else {
        norList.push(0, 1, 0)
      }
      if (uv) {
        uvList.push(uv.getX(i), uv.getY(i))
      } else {
        uvList.push(0, 0)
      }
    }

    const idx = g.index
    if (idx) {
      for (let i = 0; i < idx.count; i++) idxList.push(idx.getX(i) + vertexOffset)
    } else {
      for (let i = 0; i < nCount; i++) idxList.push(i + vertexOffset)
    }
    vertexOffset += nCount
  })

  return {
    positions: new Float32Array(posList),
    normals: new Float32Array(norList),
    uvs: new Float32Array(uvList),
    index: new Uint32Array(idxList)
  }
}

/** 计算归一化矩阵：等比缩放到目标尺寸，XZ 居中，底面贴地 */
export function normalizeMatrix(root, targetMax = 2.6) {
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const scale = targetMax / maxDim

  const m = new THREE.Matrix4()
  m.makeTranslation(-center.x, -box.min.y, -center.z)
  const s = new THREE.Matrix4().makeScale(scale, scale, scale)
  m.premultiply(s)
  return { matrix: m, scale, size: size.clone().multiplyScalar(scale), box }
}
