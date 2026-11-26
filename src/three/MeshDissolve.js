import * as THREE from 'three'

/**
 * 溶解材质：把任意标准材质改造成「可以从表面剥落」的材质。
 * - 顶点：沿法线轻微膨胀 + 抖动（模型先「鼓」一下再散开）
 * - 片元：按 高度 + 3D 噪声 的阈值剔除，和点云的错峰顺序一致（由下往上）
 */

const VERT_DECL = /* glsl */ `
  uniform float uMorph;
  uniform float uRadius;
  uniform float uBoxMin;
  uniform float uRange;
  varying float vDissolveH;
  varying vec3  vWorldDissolvePos;
`

const FRAG_DECL = /* glsl */ `
  uniform float uMorph;
  varying float vDissolveH;
  varying vec3  vWorldDissolvePos;
  float dHash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }
`

export function createDissolveUniforms() {
  return {
    uMorph: { value: 0 },
    uRadius: { value: 1 },
    uBoxMin: { value: 0 },
    uRange: { value: 1 }
  }
}

/**
 * @param {THREE.Material} material
 * @param {object} uniforms createDissolveUniforms() 的共享对象
 */
export function patchMaterialForDissolve(material, uniforms) {
  if (!material || material.userData.__dissolve) return
  material.userData.__dissolve = true

  const hasNormals =
    !!material.isMeshStandardMaterial ||
    !!material.isMeshPhysicalMaterial ||
    !!material.isMeshPhongMaterial ||
    !!material.isMeshLambertMaterial

  const vertexDisplace = hasNormals
    ? /* glsl */ `
      float dH = fract(sin(dot(position.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      transformed += objectNormal * (uMorph * uMorph * uRadius * 0.055 * (0.35 + dH));
    `
    : ''

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMorph = uniforms.uMorph
    shader.uniforms.uRadius = uniforms.uRadius
    shader.uniforms.uBoxMin = uniforms.uBoxMin
    shader.uniforms.uRange = uniforms.uRange

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vDissolveH = clamp((position.y - uBoxMin) / max(uRange, 1e-4), 0.0, 1.0);
        ${vertexDisplace}
        `
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        vWorldDissolvePos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      )

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace(
        '#include <tonemapping_fragment>',
        /* glsl */ `
        if (uMorph > 0.001) {
          float n = dHash(floor(vWorldDissolvePos * 46.0));
          if (vDissolveH * 0.55 + n * 0.45 < uMorph * 1.04) discard;
        }
        #include <tonemapping_fragment>
        `
      )
  }

  material.customProgramCacheKey = () => 'dissolve-v3'
  material.needsUpdate = true
}

/** 给整个场景里所有材质打上溶解补丁 */
export function patchSceneForDissolve(root, uniforms) {
  const seen = new Set()
  root.traverse((o) => {
    if (!o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (!m || seen.has(m)) continue
      seen.add(m)
      patchMaterialForDissolve(m, uniforms)
    }
  })
  return seen
}

/** 释放场景资源 */
export function disposeObject(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose?.()
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (!m) continue
        for (const k of Object.keys(m)) {
          const v = m[k]
          if (v && v.isTexture) v.dispose()
        }
        m.dispose?.()
      }
    }
  })
}

export { THREE }
