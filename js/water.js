// water.js
// 海（世界共通の海面 y=0）の大きな半透明の板。広い外洋を安価に描く。
// 空の反射（envMap）＋うねる法線スクロールで水らしく見せる。
// 島まわりの浅瀬・川・池は terrain.js 側の「場所ごとの水面メッシュ」が担当する。

import * as THREE from 'three';
import { makeWaveNormalMap } from './waveTexture.js';

export const WATER_LEVEL = 0;

export function createWater(level = WATER_LEVEL) {
  const geometry = new THREE.PlaneGeometry(400, 400);
  geometry.rotateX(-Math.PI / 2);

  const normalMap = makeWaveNormalMap(128);
  normalMap.repeat.set(12, 12); // 大きめのうねり（動きが見えるように）

  const material = new THREE.MeshStandardMaterial({
    color: 0x21708f,
    transparent: true,
    opacity: 0.72,
    roughness: 0.08, // 低くして空の反射と太陽のきらめきを出す
    metalness: 0.0,
    normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    envMapIntensity: 0.7,
    depthWrite: false,
    polygonOffset: true, // 岸辺の Z-fighting 防止
    polygonOffsetFactor: -1.5,
    polygonOffsetUnits: -1.5,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // 少し沈めて遠景の海として使う。島まわりの浅瀬は terrain 側の水面が描くため、
  // 浅い海底（砂）は地形に隠れてこの板は見えず、深い所と遠景だけに出る。
  mesh.position.y = level - 0.2;
  mesh.renderOrder = 1;
  mesh.name = 'sea';

  let t = 0;
  let last = performance.now();
  function update() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    // 一定方向へスクロール＝流れているように見せる
    normalMap.offset.x = (t * 0.05) % 1;
    normalMap.offset.y = (t * 0.035) % 1;
  }

  function setDetail(scale) {
    material.normalScale.set(scale, scale);
  }

  function setEnv(env) {
    material.envMap = env;
    material.needsUpdate = true;
  }

  return { mesh, update, setDetail, setEnv, level };
}
