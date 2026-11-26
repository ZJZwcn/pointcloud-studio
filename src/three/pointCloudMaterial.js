import * as THREE from 'three'

/**
 * 点云着色器
 * 每个点都有自己的一份 morph 进度（由 aDelay 错峰），
 * 所以「模型 ↔ 点云」不是整体淡入淡出，而是从头到尾逐点流动地剥落 / 归位。
 */

const vertexShader = /* glsl */ `
  uniform float uMorph;
  uniform float uTime;
  uniform float uSize;
  uniform float uScale;
  uniform float uStagger;
  uniform float uDisperse;

  attribute vec3 aScatter;
  attribute vec3 aColor;
  attribute float aSeed;
  attribute float aDelay;
  attribute float aSize;
  attribute float aHeight;

  varying vec3  vColor;
  varying float vGrad;
  varying float vSeed;
  varying float vAlpha;
  varying float vLift;

  void main() {
    // 每个点有自己的起跑时间：整体看起来像一波从下往上的流动
    float S = uStagger * 0.88;
    float t = smoothstep(aDelay * S, aDelay * S + (1.0 - S), uMorph);

    vec3 surface = position;
    vec3 flow = aScatter - surface;

    // 飞行中途向外炸开到最大，落点精确回到表面：
    // morph=0 时点云与实体完全重合（被网格盖住），morph=1 时就是这颗模型的表面点云
    float arc = sin(3.14159265 * t);
    vec3 pos = surface + flow * (0.30 * uDisperse * arc + 0.012 * uDisperse);

    // 摆动：只在飞行中途最大，落点处收敛（两端为 0）
    vec3 wob = vec3(
      sin(aSeed * 41.3 + uTime * 1.35),
      cos(aSeed * 27.1 + uTime * 0.95),
      sin(aSeed * 63.7 + uTime * 1.15)
    );
    pos += wob * (0.018 * arc * uDisperse + 0.0035 * t);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float pixel = uSize * uScale * mix(1.0, 1.25, t) * aSize / max(-mv.z, 0.02);
    gl_PointSize = clamp(pixel, 1.0, 34.0);

    // 出现：跟随剥落进度，而不是整体
    float birth = smoothstep(aDelay * S * 0.65, aDelay * S * 0.65 + 0.22, uMorph);
    float twinkle = 0.86 + 0.14 * sin(uTime * 2.6 + aSeed * 53.0);
    vAlpha = birth * twinkle;
    vGrad = aHeight;
    vSeed = aSeed;
    vColor = aColor;
    vLift = t;
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform int   uColorMode;
  uniform vec3  uAccent;
  uniform vec3  uDeep;
  uniform float uHasTexture;
  uniform float uGlow;

  varying vec3  vColor;
  varying float vGrad;
  varying float vSeed;
  varying float vAlpha;
  varying float vLift;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;

    float edge = smoothstep(0.5, 0.04, d);

    vec3 col;
    if (uColorMode == 0) {
      col = mix(uDeep * 1.15 + vec3(0.05), vColor * 1.25 + 0.02, uHasTexture);
    } else if (uColorMode == 1) {
      float g = smoothstep(0.0, 1.0, vGrad);
      col = mix(uDeep, uAccent, g) * 1.25;
    } else {
      col = uAccent * 1.2;
    }

    col *= 0.62 + 0.72 * vSeed;
    // 中心加一点高光，让每颗点像一粒发光尘埃
    col += uAccent * pow(edge, 7.0) * 0.14 * uGlow * (1.0 - uHasTexture * 0.5);

    gl_FragColor = vec4(col, edge * vAlpha * 0.16);
  }
`

export function createPointCloudMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uMorph: { value: 0 },
      uTime: { value: 0 },
      uSize: { value: 0.0095 },
      uScale: { value: 1000 },
      uStagger: { value: 0.62 },
      uDisperse: { value: 1 },
      uColorMode: { value: 0 },
      uAccent: { value: new THREE.Color('#dcff4d') },
      uDeep: { value: new THREE.Color('#17808c') },
      uHasTexture: { value: 0 },
      uGlow: { value: 1 }
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  })
}

/** 把 worker 采样结果塞进 BufferGeometry */
export function buildPointGeometry(data) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  g.setAttribute('aScatter', new THREE.BufferAttribute(data.scatter, 3))
  g.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(data.seeds, 1))
  g.setAttribute('aDelay', new THREE.BufferAttribute(data.delays, 1))
  g.setAttribute('aSize', new THREE.BufferAttribute(data.sizes, 1))
  g.setAttribute('aHeight', new THREE.BufferAttribute(data.heights, 1))
  g.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(...data.bbox.center),
    data.bbox.radius * 2
  )
  return g
}
