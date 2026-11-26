import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GridFloor } from './GridFloor.js'
import { createPointCloudMaterial, buildPointGeometry } from './pointCloudMaterial.js'
import { createDissolveUniforms, patchSceneForDissolve, disposeObject } from './MeshDissolve.js'
import { loadFromURL, loadFromFiles, loadFromBuffer, mergeForSampling, normalizeMatrix } from '../loaders/loadModel.js'
import { GenerationCloud } from './GenerationCloud.js'

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** 触发一次浏览器下载 */
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

const BACKDROP_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const BACKDROP_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uTop;
  uniform vec3 uBottom;
  void main() {
    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 c = mix(uBottom, uTop, pow(h, 0.85));
    gl_FragColor = vec4(c, 1.0);
  }
`

export class Studio {
  constructor(container, callbacks = {}) {
    this.container = container
    this.cb = callbacks

    this.morph = 0
    this.tween = null
    this.clockwise = 0

    this.pointCount = 320000
    this.pointSizeScale = 1
    this.disperse = 1
    this.colorMode = 0
    this.glow = 1

    this.dissolveUniforms = createDissolveUniforms()
    this.pointMaterial = createPointCloudMaterial()
    this.hasTexture = false

    this.frames = 0
    this.lastStats = performance.now()
    this.fps = 60
  }

  // ---------------------------------------------------------------- 初始化
  init() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(w, h, false)
    this.renderer.setClearColor(0x05060a, 1)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.9
    this.renderer.domElement.style.display = 'block'
    this.container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0x05060a, 0.012)

    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 600)
    this.camera.position.set(3.6, 2.4, 5.2)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.rotateSpeed = 0.72
    this.controls.zoomSpeed = 0.8
    this.controls.minDistance = 1.4
    this.controls.maxDistance = 24
    this.controls.maxPolarAngle = Math.PI * 0.497
    this.controls.minPolarAngle = Math.PI * 0.06
    this.controls.autoRotate = true
    this.controls.autoRotateSpeed = 0.55
    this.controls.target.set(0, 0.9, 0)

    // 背景：一个反向球，给空间一点纵向渐变
    const backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(300, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: BACKDROP_VERT,
        fragmentShader: BACKDROP_FRAG,
        uniforms: {
          uTop: { value: new THREE.Color('#0b1116') },
          uBottom: { value: new THREE.Color('#03040a') }
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false
      })
    )
    backdrop.renderOrder = -3
    backdrop.frustumCulled = false
    this.scene.add(backdrop)
    this.backdrop = backdrop

    // 环境光照（PBR 反射）
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.05)
    this.scene.environment = env.texture
    this.scene.environmentIntensity = 0.62
    pmrem.dispose()

    const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x0a0f14, 0.42)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xffffff, 0.8)
    key.position.set(4, 7, 5)
    this.scene.add(key)

    const rim = new THREE.DirectionalLight(0xdcff4d, 0.6)
    rim.position.set(-6, 2.5, -4)
    this.scene.add(rim)

    const rim2 = new THREE.DirectionalLight(0x2f7d8c, 0.4)
    rim2.position.set(-3, -2, 6)
    this.scene.add(rim2)

    // 地面
    this.grid = new GridFloor({ size: 300 })
    this.scene.add(this.grid.mesh)

    // 模型 / 点云容器
    this.modelGroup = new THREE.Group()
    this.pointsGroup = new THREE.Group()
    this.scene.add(this.modelGroup, this.pointsGroup)

    // AI 生成等待时的假点云（不参与模型/点云的切换）
    this.genCloud = new GenerationCloud()
    this.genCloud.setFraming({ scale: 0.62, y: 0.78 })
    this.scene.add(this.genCloud.points)

    // 后期
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.48, 0.62, 0.72)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.clock = new THREE.Clock()
    this.resize()
    // 窗口/容器尺寸变化：合并到一帧里处理，拖动窗口时逐帧跟随
    this.onResize = () => {
      if (this.resizeRaf) return
      this.resizeRaf = requestAnimationFrame(() => {
        this.resizeRaf = 0
        this.resize()
      })
    }
    window.addEventListener('resize', this.onResize)
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(this.onResize)
      this.ro.observe(this.container)
    }

    this.animate()
  }

  resize() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    // 换了显示器 / 缩放比变化时同步像素比，否则会糊或者白烧性能
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (this.renderer.getPixelRatio() !== dpr) this.renderer.setPixelRatio(dpr)
    // updateStyle = false：canvas 的 CSS 尺寸交给样式表（100%），
    // 这里只改绘制缓冲，避免把首帧的像素尺寸写死成内联样式
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.composer.setSize(w, h)
    this.bloom.setSize(w, h)
    const bufH = this.renderer.domElement.height
    this.pointMaterial.uniforms.uScale.value =
      bufH / (2 * Math.tan((this.camera.fov * Math.PI) / 360))
    this.genCloud?.setPixelScale(bufH / (2 * Math.tan((35 * Math.PI) / 360)))
  }

  animate = () => {
    this.raf = requestAnimationFrame(this.animate)
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    this.updateMorph(dt)
    this.grid.update(dt, t)
    this.genCloud?.points.visible && this.genCloud.update(dt, t)

    this.pointMaterial.uniforms.uTime.value = t
    this.pointMaterial.uniforms.uMorph.value = this.morph
    this.dissolveUniforms.uMorph.value = this.morph

    // 过渡时相机轻微推近（fov 呼吸），末端回到原位
    const breath = Math.sin(Math.PI * Math.min(1, Math.max(0, this.morph)))
    this.camera.fov = 35 - breath * 1.8
    this.camera.updateProjectionMatrix()

    if (this.modelGroup.children.length) {
      this.modelGroup.visible = !this.generating && this.morph < 0.998
    }
    this.pointsGroup.visible = !this.generating && this.morph > 0.002

    this.controls.update()
    this.composer.render()

    // FPS
    this.frames++
    const now = performance.now()
    if (now - this.lastStats > 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastStats))
      this.frames = 0
      this.lastStats = now
      this.cb.onStats?.({ fps: this.fps })
    }
  }

  updateMorph() {
    if (!this.tween) return
    const { from, to, start, dur } = this.tween
    const now = performance.now()
    const p = Math.min(1, (now - start) / dur)
    this.morph = from + (to - from) * easeInOutCubic(p)
    if (p >= 1) this.tween = null
    this.cb.onMorph?.(this.morph)
  }

  // ---------------------------------------------------------------- 模型
  async loadDefault(url = '/models/battery.glb') {
    const data = await loadFromURL(url, (p) => this.cb.onProgress?.(p, '下载模型'))
    return this.applyModel(data, '电池 · battery.glb')
  }

  async loadUserFiles(files) {
    const data = await loadFromFiles(files, (p) => this.cb.onProgress?.(p, '下载模型'))
    const name = files[0]?.name || '导入模型'
    return this.applyModel(data, name)
  }

  /** 载入 AI 生成的结果（内存里的字节，不落盘） */
  async loadBuffer(buffer, name = 'hunyuan.glb') {
    const data = await loadFromBuffer(buffer, name, (p) => this.cb.onProgress?.(p, '解析生成结果'))
    const info = await this.applyModel(data, name)
    // 留着原始字节，导出时能原样下载（不做任何重编码）
    this.sourceBuffer = buffer
    this.sourceName = name
    return info
  }

  // ---------------------------------------------------------------- AI 生成等待动画

  /** 进入「生成中」：藏起现有模型，换成持续变形的假点云 */
  beginGenerating() {
    this.generating = true
    this.tween = null
    if (this.morph !== 0) {
      this.morph = 0
      this.cb.onMorph?.(0)
    }
    this.genCloud.start()
    this.grid.ripple?.()
  }

  setGeneratingProgress(p) {
    this.genCloud.setProgress(p)
  }

  /** 生成结束：假点云炸散退场 */
  finishGenerating() {
    this.generating = false
    this.genCloud.burst()
    this.grid.ripple?.()
  }

  /** 中途放弃 */
  cancelGenerating() {
    this.generating = false
    this.genCloud.stop()
  }

  async applyModel(data, label) {
    const { root, triangles, hasTexture, texture, vertices, meshes } = data

    this.clearModel()
    this.sourceBuffer = null
    this.sourceName = ''

    // 归一化：等比缩放到 2.6，XZ 居中，底面贴地
    const { matrix, size, box } = normalizeMatrix(root, 2.6)
    root.applyMatrix4(matrix)
    root.updateMatrixWorld(true)

    this.modelGroup.add(root)
    this.modelRoot = root
    this.modelSize = size
    this.modelBox = box

    // 溶解材质
    const mats = patchSceneForDissolve(root, this.dissolveUniforms)

    const finalBox = new THREE.Box3().setFromObject(root)
    this.dissolveUniforms.uRadius.value = Math.max(size.x, size.y, size.z) * 0.5
    this.dissolveUniforms.uBoxMin.value = finalBox.min.y
    this.dissolveUniforms.uRange.value = Math.max(0.001, finalBox.max.y - finalBox.min.y)

    this.hasTexture = !!hasTexture && !!texture
    this.pointMaterial.uniforms.uHasTexture.value = this.hasTexture ? 1 : 0
    this.textureData = texture

    // 相机
    const center = new THREE.Vector3()
    finalBox.getCenter(center)
    const radius = finalBox.getSize(new THREE.Vector3()).length() * 0.5
    this.frameRadius = radius
    const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.12
    this.controls.target.set(0, Math.max(0.25, center.y * 0.92), 0)
    this.camera.position.set(dist * 0.46, dist * 0.30 + center.y * 0.35, dist * 0.86)
    this.controls.minDistance = radius * 0.9
    this.controls.maxDistance = radius * 9
    this.grid.setY(0)

    // 采样点云
    const sampled = await this.samplePoints(root, this.pointCount)
    this.buildPoints(sampled)

    this.morph = 0
    this.tween = null
    this.generating = false
    this.cb.onMorph?.(0)

    return { label, triangles, vertices, meshes, points: this.pointCount, hasTexture: this.hasTexture, materials: mats.size }
  }

  /** 用 worker 在表面采样 */
  samplePoints(root, count) {
    return new Promise((resolve, reject) => {
      this.cb.onProgress?.(0, '合并网格')
      const merged = mergeForSampling(root, new THREE.Matrix4())
      this.cb.onProgress?.(0, `表面采样 ${count.toLocaleString()} 点`)

      const worker = new Worker(new URL('../workers/samplePoints.worker.js', import.meta.url), {
        type: 'module'
      })
      this.worker = worker
      worker.onmessage = (e) => {
        worker.terminate()
        this.worker = null
        resolve(e.data)
      }
      worker.onerror = (e) => {
        worker.terminate()
        this.worker = null
        reject(new Error(e.message || '采样失败'))
      }
      const tex = this.textureData
      const transfer = [merged.positions.buffer, merged.normals.buffer, merged.uvs.buffer, merged.index.buffer]
      // 贴图数据是缓存的：transfer 会把它的 ArrayBuffer 移交（detach）给 worker，
      // 第二次采样（改点数）再 postMessage 就会抛 “An ArrayBuffer is detached”，
      // 所以每次都复制一份再移交，缓存本身永远保持可用。
      const texData = tex?.data?.byteLength ? tex.data.slice() : null
      if (texData) transfer.push(texData.buffer)
      worker.postMessage(
        {
          positions: merged.positions,
          normals: merged.normals,
          uvs: merged.uvs,
          index: merged.index,
          count,
          texture: texData ? { data: texData, width: tex.width, height: tex.height, flipV: tex.flipV } : null,
          seed: 20251126
        },
        transfer
      )
    })
  }

  buildPoints(sampled) {
    this.disposePoints()
    const geo = buildPointGeometry(sampled)
    this.points = new THREE.Points(geo, this.pointMaterial)
    this.points.frustumCulled = false
    this.points.renderOrder = 2
    this.pointsGroup.add(this.points)
    this.sampleStats = sampled
  }

  disposePoints() {
    if (this.points) {
      this.pointsGroup.remove(this.points)
      this.points.geometry.dispose()
      this.points = null
    }
  }

  clearModel() {
    this.disposePoints()
    if (this.modelRoot) {
      this.modelGroup.remove(this.modelRoot)
      disposeObject(this.modelRoot)
      this.modelRoot = null
    }
    while (this.modelGroup.children.length) this.modelGroup.remove(this.modelGroup.children[0])
  }

  /** 改点数：重新采样，保持当前形态 */
  async resample(count) {
    if (!this.modelRoot) return
    const keep = this.morph
    const sampled = await this.samplePoints(this.modelRoot, count)
    // 采样成功后才认这个点数：失败时 pointCount 仍是场景里实际的数量，界面不会说谎
    this.pointCount = count
    this.buildPoints(sampled)
    this.morph = keep
    return { points: count, ms: sampled.ms }
  }

  // ---------------------------------------------------------------- 控制
  setMorph(v) {
    this.tween = null
    this.morph = Math.min(1, Math.max(0, v))
    this.cb.onMorph?.(this.morph)
  }

  morphTo(target, duration = 2200) {
    if (Math.abs(this.morph - target) < 0.001 && !this.tween) return
    this.tween = {
      from: this.morph,
      to: target,
      start: performance.now(),
      dur: duration
    }
    this.grid.ripple()
  }

  setPointSize(v) {
    this.pointSizeScale = v
    this.pointMaterial.uniforms.uSize.value = 0.0095 * v
  }

  setDisperse(v) {
    this.disperse = v
    this.pointMaterial.uniforms.uDisperse.value = v
  }

  setColorMode(m) {
    this.colorMode = m
    this.pointMaterial.uniforms.uColorMode.value = m
  }

  setGlow(v) {
    this.glow = v
    this.bloom.strength = v
    this.pointMaterial.uniforms.uGlow.value = 0.4 + v
  }

  setAutoRotate(on) {
    this.controls.autoRotate = !!on
  }

  setStagger(v) {
    this.pointMaterial.uniforms.uStagger.value = v
  }

  /**
   * 把当前采样点云导出成 binary little-endian PLY
   * （x y z · nx ny nz · red green blue），文件名取自当前模型
   */
  exportPLY(filename = 'pointcloud.ply') {
    const s = this.sampleStats
    if (!s) throw new Error('还没有点云可导出')

    const n = s.positions.length / 3
    const HEAD = [
      'ply',
      'format binary_little_endian 1.0',
      `comment generated by Point Cloud Studio`,
      `element vertex ${n}`,
      'property float x',
      'property float y',
      'property float z',
      'property float nx',
      'property float ny',
      'property float nz',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
      'end_header\n'
    ].join('\n')

    const stride = 6 * 4 + 3
    const body = new ArrayBuffer(HEAD.length + n * stride)
    const head = new Uint8Array(body, 0, HEAD.length)
    for (let i = 0; i < HEAD.length; i++) head[i] = HEAD.charCodeAt(i) & 0xff

    const view = new DataView(body, HEAD.length)
    // 线性色 → sRGB（PLY 查看器基本按 sRGB 显示）
    const toSRGB = (c) => {
      const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
      return Math.max(0, Math.min(255, Math.round(v * 255)))
    }

    let o = 0
    for (let i = 0; i < n; i++) {
      const p = i * 3
      view.setFloat32(o, s.positions[p], true)
      view.setFloat32(o + 4, s.positions[p + 1], true)
      view.setFloat32(o + 8, s.positions[p + 2], true)
      view.setFloat32(o + 12, s.normals[p], true)
      view.setFloat32(o + 16, s.normals[p + 1], true)
      view.setFloat32(o + 20, s.normals[p + 2], true)
      view.setUint8(o + 24, toSRGB(s.colors[p]))
      view.setUint8(o + 25, toSRGB(s.colors[p + 1]))
      view.setUint8(o + 26, toSRGB(s.colors[p + 2]))
      o += stride
    }

    saveBlob(new Blob([body], { type: 'application/octet-stream' }), filename)
    return { points: n, bytes: body.byteLength }
  }

  // ---------------------------------------------------------------- 导出

  /** 复制当前模型，去掉溶解着色器注入，得到一个干净的、可直接导出的对象 */
  cleanClone() {
    const src = this.modelRoot
    if (!src) throw new Error('还没有模型可导出')

    const clone = src.clone(true)
    const strip = (mat) => {
      const m = mat.clone()
      m.onBeforeCompile = () => {}
      m.customProgramCacheKey = () => ''
      m.userData = {}
      return m
    }
    clone.traverse((o) => {
      if (!o.isMesh) return
      o.material = Array.isArray(o.material) ? o.material.map(strip) : strip(o.material)
    })
    return clone
  }

  /** 导出 glb（二进制、含贴图），最通用 */
  async exportModelGLB(filename = 'model.glb') {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
    const root = this.cleanClone()

    const result = await new Promise((resolve, reject) => {
      new GLTFExporter().parse(root, resolve, reject, {
        binary: true,
        onlyVisible: false,
        maxTextureSize: 2048
      })
    })

    const blob = new Blob([result], { type: 'model/gltf-binary' })
    saveBlob(blob, filename)
    return { bytes: blob.size, filename }
  }

  /** 导出 stl（只有几何，适合拿去切片/继续建模） */
  async exportModelSTL(filename = 'model.stl') {
    const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js')
    const data = new STLExporter().parse(this.cleanClone(), { binary: true })

    const blob = new Blob([data], { type: 'model/stl' })
    saveBlob(blob, filename)
    return { bytes: blob.size, filename }
  }

  /** 原样导出混元接口返回的文件（不重新编码，尺寸/贴图/材质与云端一致） */
  exportSource(filename) {
    if (!this.sourceBuffer) throw new Error('当前模型不是 AI 生成的，没有原始文件')
    const name = filename || this.sourceName || 'model.glb'
    const blob = new Blob([this.sourceBuffer], { type: 'application/octet-stream' })
    saveBlob(blob, name)
    return { bytes: blob.size, filename: name }
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf)
    window.removeEventListener('resize', this.onResize)
    this.ro?.disconnect()
    this.worker?.terminate()
    this.clearModel()
    this.grid.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
