// water.js
// 海（世界共通の海面 y=0）の大きな半透明の板。広い外洋を安価に描く。
// 内陸の川・池は terrain.js 側の「場所ごとの水面メッシュ」が担当する。

import * as THREE from 'three';
import { makeWaveNormalMap } from './waveTexture.js';

export const WATER_LEVEL = 0;

export function createWater(level = WATER_LEVEL) {
  const geometry = new THREE.PlaneGeometry(400, 400);
  geometry.rotateX(-Math.PI / 2);

  const normalMap = makeWaveNormalMap(128);
  normalMap.repeat.set(34, 34);

  const material = new THREE.MeshStandardMaterial({
    color: 0x2b87a6,
    transparent: true,
    opacity: 0.66, // 半透明：浅い所は明るく、深い所は暗く見える
    roughness: 0.14,
    metalness: 0.0,
    normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = level;
  mesh.renderOrder = 1;
  mesh.name = 'sea';

  let t = 0;
  let last = performance.now();
  function update() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    normalMap.offset.x = (t * 0.03) % 1;
    normalMap.offset.y = (t * 0.022) % 1;
  }

  function setDetail(scale) {
    material.normalScale.set(scale, scale);
  }

  return { mesh, update, setDetail, level };
}
