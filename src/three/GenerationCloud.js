/**
 * 生成中的「假点云」——AI 生成任务还在跑的时候，画面中央是一团持续重组的点云雕塑。
 * 参考视觉：Triple3D 的生成等待动画（缓慢漂移的灰尘雕塑 + 百分比）。
 *
 * 这里不加载任何外部模型：形状由程序化采样生成，五种轮流变形（环面结 → 双螺旋 → 球壳 →
 * 星系盘 → 圆角立方），每次变形都是逐点错峰飞行，和真实的「模型 → 点云」用同一套语法。
 */
import * as THREE from 'three'

const COUNT = 90000

// ---------------------------------------------------------------- 形状采样

function rand(a, b) {
  return a + Math.random() * (b - a)
}

/** 环面结 p=2 q=3 */
function torusKnot(n) {
  const out = new Float32Array(n * 3)
  const R = 1.0
  const r = 0.26
  for (let i = 0; i < n; i++) {
    const t = Math.random() * Math.PI * 2
    const p = 2
    const q = 3
    const cu = Math.cos(p * t)
    const cq = Math.cos(q * t)
    const su = Math.sin(p * t)
    const sq = Math.sin(q * t)
    const cx = (2 + cu) * 0.5 * cq
    const cy = (2 + cu) * 0.5 * sq
    const cz = su * 0.5
    // 沿切线附近抖动
    const th = Math.random() * Math.PI * 2
    const ph = Math.acos(rand(-1, 1))
    const rr = r * Math.cbrt(Math.random())
    out[i * 3] = cx * R + rr * Math.sin(ph) * Math.cos(th)
    out[i * 3 + 1] = cz * R + rr * Math.cos(ph)
    out[i * 3 + 2] = cy * R + rr * Math.sin(ph) * Math.sin(th)
  }
  return out
}

/** 双螺旋 + 横档 */
function helix(n) {
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const along = rand(-1.25, 1.25)
    const branch = i % 3 === 0 ? 2 : i % 2
    const ang = along * 5.2 + branch * Math.PI
    if (branch === 2) {
      // 横档：两点之间
      const k = Math.random()
      out[i * 3] = Math.cos(ang) * 0.52 * (1 - 2 * k) * 0.5
      out[i * 3 + 1] = along
      out[i * 3 + 2] = Math.sin(ang) * 0.52 * (1 - 2 * k) * 0.5
    } else {
      const rr = 0.05 * Math.cbrt(Math.random())
      out[i * 3] = Math.cos(ang) * 0.52 + rand(-rr, rr)
      out[i * 3 + 1] = along + rand(-0.02, 0.02)
      out[i * 3 + 2] = Math.sin(ang) * 0.52 + rand(-rr, rr)
    }
  }
  return out
}

/** 球壳（斐波那契球 + 少量内层） */
function shell(n) {
  const out = new Float32Array(n * 3)
  const ga = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const rad = Math.sqrt(Math.max(0, 1 - y * y))
    const th = ga * i
    const shrink = i % 7 === 0 ? rand(0.55, 0.92) : 1
    out[i * 3] = Math.cos(th) * rad * shrink
    out[i * 3 + 1] = y * shrink
    out[i * 3 + 2] = Math.sin(th) * rad * shrink
  }
  return out
}

/** 星系盘（悬臂 + 核球） */
function galaxy(n) {
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const arm = i % 3
    const r = Math.pow(Math.random(), 0.65) * 1.3
    const spin = r * 2.2 + (arm * Math.PI * 2) / 3
    const spread = 0.16 * (1.3 - r) * rand(-1, 1)
    const core = Math.random() < 0.18
    const y = core ? rand(-0.1, 0.1) * (1.3 - r) : rand(-0.035, 0.035) * (1.5 - r)
    out[i * 3] = Math.cos(spin) * r + spread
    out[i * 3 + 1] = y
    out[i * 3 + 2] = Math.sin(spin) * r + spread
  }
  return out
}

/** 圆角立方（超椭球表面） */
function cube(n) {
  const out = new Float32Array(n * 3)
  const p = 5.5
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1
    const v = Math.random() * 2 - 1
    const w = Math.random() * 2 - 1
    const len = Math.hypot(u, v, w) || 1
    const x = u / len
    const y = v / len
    const z = w / len
    const d = Math.pow(Math.pow(Math.abs(x), p) + Math.pow(Math.abs(y), p) + Math.pow(Math.abs(z), p), 1 / p)
    const s = 1.16 / d
    out[i * 3] = x * s
    out[i * 3 + 1] = y * s
    out[i * 3 + 2] = z * s
  }
  return out
}

const SHAPES = [torusKnot, helix, shell, galaxy, cube]

// ---------------------------------------------------------------- 着色器

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uMix;
  uniform float uProgress;
  uniform float uSize;
  uniform float uPx;
  uniform float uDisperse;
  uniform float uOpacity;

  attribute vec3 aA;
  attribute vec3 aB;
  attribute float aSeed;
  attribute float aDelay;
  attribute float aSize;

  varying float vAlpha;
  varying vec3 vColor;
  varying float vSeed;

  void main() {
    float t = smoothstep(aDelay * 0.72, aDelay * 0.72 + 0.28, uMix);
    vec3 base = mix(aA, aB, t);

    // 变形中途向外炸开成弧线，落点回到目标形状
    vec3 dir = normalize(mix(aA, aB, 0.5) + vec3(0.0001));
    base += dir * (sin(3.14159265 * t) * 0.42 + 0.05) * uDisperse;

    // 持续湍流：越接近完成越安静
    float k = 1.0 - uProgress * 0.6;
    base += vec3(
      sin(aSeed * 31.7 + uTime * 0.85),
      cos(aSeed * 17.3 + uTime * 0.62),
      sin(aSeed * 53.1 + uTime * 1.05)
    ) * 0.055 * k;

    vec4 mv = modelViewMatrix * vec4(base, 1.0);
    gl_Position = projectionMatrix * mv;

    gl_PointSize = uSize * uPx * aSize / max(-mv.z, 0.05);

    vAlpha = uOpacity * (0.35 + 0.65 * aSize);
    vSeed = aSeed;

    // 主体灰白，约三成带荧光柠檬
    float pick = step(0.68, aSeed);
    vColor = mix(vec3(0.80, 0.84, 0.84), vec3(0.86, 1.0, 0.30), pick) * (0.55 + 0.7 * aSeed);
  }
`

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float edge = smoothstep(0.5, 0.08, d);
    gl_FragColor = vec4(vColor, edge * vAlpha * 0.5);
  }
`

// ---------------------------------------------------------------- 类

export class GenerationCloud {
  constructor({ count = COUNT } = {}) {
    this.count = count
    this.morphing = false
    this.mix = 1
    this.morphSpeed = 1 / 3.4
    this.shapeIndex = 0
    this.opacity = 0
    this.targetOpacity = 0
    this.progress = 0
    this.bursting = false
    this.disperse = 0.5

    const g = new THREE.BufferGeometry()
    const a = new Float32Array(count * 3)
    const b = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    const delay = new Float32Array(count * 4) // 4 份相位，变形时轮流出场
    const size = new Float32Array(count)

    // 初始形状 A → B
    const shapes = [SHAPES[0](count), SHAPES[1](count)]
    a.set(shapes[0])
    b.set(shapes[1])

    for (let i = 0; i < count; i++) {
      seed[i] = Math.random()
      delay[i] = Math.random()
      size[i] = 0.55 + Math.pow(Math.random(), 2.2) * 1.35
    }

    g.setAttribute('position', new THREE.BufferAttribute(a.slice(), 3)) // 只是占位，真实位置在着色器
    g.setAttribute('aA', new THREE.BufferAttribute(a, 3))
    g.setAttribute('aB', new THREE.BufferAttribute(b, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    g.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4)

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uMix: { value: 1 },
        uProgress: { value: 0 },
        uSize: { value: 0.006 },
        uPx: { value: 900 },
        uDisperse: { value: 0.5 },
        uOpacity: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    })

    this.points = new THREE.Points(g, this.material)
    this.points.frustumCulled = false
    this.points.visible = false
    this.points.renderOrder = 2
    this.baseY = 0
    this._t = 0
  }

  /** 摆位：整体缩小并抬高，给下方的百分比 / 进度条留出空间 */
  setFraming({ scale = 1, y = 0 } = {}) {
    this.points.scale.setScalar(scale)
    this.baseY = y
  }

  setPixelScale(px) {
    this.material.uniforms.uPx.value = px
  }

  /** 开始：淡入 + 从头变形 */
  start() {
    this.points.visible = true
    this.targetOpacity = 1
    this.progress = 0
    this.bursting = false
    this.disperse = 0.5
    this.material.uniforms.uDisperse.value = 0.5
    this._t = 0
    this._nextShape()
  }

  /** 进度推进：0..1，越大越"安静" */
  setProgress(p) {
    this.progress = Math.max(0, Math.min(1, p))
    this.material.uniforms.uProgress.value = this.progress
    this.disperse = 0.5 - this.progress * 0.22
  }

  /** 真模型到了：向外炸散并淡出 */
  burst() {
    this.bursting = true
    this.targetOpacity = 0
  }

  stop() {
    this.targetOpacity = 0
    this.bursting = true
  }

  hide() {
    this.points.visible = false
    this.opacity = 0
    this.targetOpacity = 0
    this.material.uniforms.uOpacity.value = 0
  }

  _nextShape() {
    const g = this.geometry || this.points.geometry
    const idx = (this.shapeIndex + 1) % SHAPES.length
    const next = SHAPES[idx](this.count)
    const aB = g.getAttribute('aB')
    // 当前 B 变成 A 的起点
    const aA = g.getAttribute('aA')
    aA.array.set(aB.array)
    aB.array.set(next)
    aA.needsUpdate = true
    aB.needsUpdate = true
    this.shapeIndex = idx
    this.mix = 0
    this.morphing = true
  }

  update(dt, elapsed) {
    this._t += dt
    this.material.uniforms.uTime.value = this._t
    this.opacity += (this.targetOpacity - this.opacity) * Math.min(1, dt * (this.bursting ? 2.6 : 3.4))
    this.material.uniforms.uOpacity.value = this.opacity

    if (this.bursting) {
      this.disperse += dt * 1.6
      this.material.uniforms.uDisperse.value = this.disperse
    } else {
      this.material.uniforms.uDisperse.value = this.disperse
    }

    if (this.opacity < 0.004 && this.targetOpacity === 0) {
      this.points.visible = false
      return
    }

    // 形状轮换
    if (this.morphing && !this.bursting) {
      this.mix = Math.min(1, this.mix + dt * this.morphSpeed)
      this.material.uniforms.uMix.value = this.mix
      if (this.mix >= 1) {
        this.morphing = false
        this._holdTimer = 0
      }
    } else if (!this.bursting && !this.morphing && this.points.visible) {
      this._holdTimer = (this._holdTimer || 0) + dt
      if (this._holdTimer > 1.1) {
        this._nextShape()
        this._holdTimer = 0
      }
    }

    // 缓慢自转 + 轻微上下漂
    this.points.rotation.y += dt * 0.22
    this.points.rotation.x = Math.sin(elapsed * 0.21) * 0.12
    this.points.position.y = this.baseY + Math.sin(elapsed * 0.55) * 0.05
  }

  dispose() {
    this.points.geometry.dispose()
    this.material.dispose()
  }
}
