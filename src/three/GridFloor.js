import * as THREE from 'three'

/**
 * 地面网格
 * - 双层网格（1m 细格 / 5m 主格），用 fwidth 做屏幕空间抗锯齿，远处不会糊成一片摩尔纹
 * - 径向渐隐 + 中心微光
 * - 过渡时从中心扩散一圈波纹，作为形态切换的「冲击反馈」
 */

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec3  uAccent;
  uniform vec3  uLine;
  uniform float uRippleAmp;
  uniform float uRippleRadius;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform float uOpacity;

  varying vec3 vWorld;

  float gridMask(vec2 p, float spacing, float width) {
    vec2 q = p / spacing;
    vec2 d = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-5));
    float l = min(d.x, d.y);
    return 1.0 - min(l / width, 1.0);
  }

  float axisMask(vec2 p, vec2 dir, float width) {
    vec2 q = p / 1.0;
    vec2 d = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-5));
    return 1.0 - min(d.x / width, 1.0);
  }

  void main() {
    vec2 p = vWorld.xz;
    vec2 pAbs = abs(p);

    float fine  = gridMask(p, 1.0, 1.0);
    float major = gridMask(p, 5.0, 1.4);

    float r = length(p);
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, r);

    // 轴向：贴得更亮一点，给空间一个明确的原点
    float axisX = (1.0 - min(pAbs.y / max(fwidth(pAbs.y) * 1.6, 1e-4), 1.0));
    float axisZ = (1.0 - min(pAbs.x / max(fwidth(pAbs.x) * 1.6, 1e-4), 1.0));
    float axis = max(axisX, axisZ) * step(r, 60.0) * smoothstep(64.0, 10.0, r);

    // 波纹
    float ring = 0.0;
    if (uRippleAmp > 0.001) {
      float d = abs(r - uRippleRadius);
      ring = exp(-d * 0.55) * uRippleAmp;
    }

    // 中心微光，让模型看起来「站」在某个东西上
    float halo = exp(-r * 0.09) * 0.09;

    float cov = fine * 0.26 + major * 0.60 + axis * 0.40 + ring * 0.55 + halo;
    cov = clamp(cov, 0.0, 1.0) * fade * uOpacity;
    if (cov < 0.004) discard;

    vec3 col = mix(uLine, uAccent, clamp(axis * 0.5 + ring * 0.8 + major * 0.1 + halo * 0.7, 0.0, 1.0));
    gl_FragColor = vec4(col, cov);
  }
`

export class GridFloor {
  constructor({ size = 260 } = {}) {
    this.uniforms = {
      uTime: { value: 0 },
      uAccent: { value: new THREE.Color('#dcff4d') },
      uLine: { value: new THREE.Color('#7fa7bb') },
      uRippleAmp: { value: 0 },
      uRippleRadius: { value: 0 },
      uFadeStart: { value: 26 },
      uFadeEnd: { value: 120 },
      uOpacity: { value: 1 }
    }

    const geo = new THREE.PlaneGeometry(size, size, 1, 1)
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    })

    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.position.y = 0
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1

    this.rippleStart = -999
    this.rippleActive = false
  }

  /** 触发一圈扩散波纹 */
  ripple() {
    this.rippleStart = this.uniforms.uTime.value
    this.rippleActive = true
  }

  update(dt, elapsed) {
    this.uniforms.uTime.value = elapsed
    if (this.rippleActive) {
      const t = elapsed - this.rippleStart
      if (t > 3.2) {
        this.rippleActive = false
        this.uniforms.uRippleAmp.value = 0
      } else {
        this.uniforms.uRippleRadius.value = t * 26
        this.uniforms.uRippleAmp.value = Math.max(0, 1 - t / 3.2) * 0.9
      }
    }
  }

  setY(y) {
    this.mesh.position.y = y
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
