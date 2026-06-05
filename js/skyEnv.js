// skyEnv.js
// 水面の反射用に、軽い「空のグラデーション環境マップ」を作る。
// PMREM 処理して MeshStandardMaterial.envMap に使う（空や光が水面に映る）。

import * as THREE from 'three';

export function createSkyEnv(renderer) {
  // 縦方向グラデーションの equirect テクスチャ（上空→地平線→地面）
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0.0, '#8fc0ec'); // 上空
  grd.addColorStop(0.45, '#cfe6f7');
  grd.addColorStop(0.5, '#f2f8fc'); // 地平線（明るい）
  grd.addColorStop(0.56, '#bcd9cf');
  grd.addColorStop(1.0, '#6f8f7c'); // 下（地面っぽい）
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 16, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}
