// waveTexture.js
// さざ波用の法線マップを手続き的に生成する（タイル可能・一度だけ生成）。
// 海と内陸の水で共有する。

import * as THREE from 'three';

export function makeWaveNormalMap(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  // 周期関数で高さ場を作る（端で連続＝シームレス）。複数の波を重ねて豊かに。
  const H = (x, y) => {
    const fx = (x / size) * Math.PI * 2;
    const fy = (y / size) * Math.PI * 2;
    return (
      Math.sin(fx * 2 + Math.cos(fy * 3)) * 0.5 +
      Math.sin(fy * 3 + Math.cos(fx * 2)) * 0.5 +
      Math.sin((fx + fy) * 4) * 0.25 +
      Math.sin((fx - fy) * 6 + 1.7) * 0.18 +
      Math.sin(fx * 5 + fy * 2) * 0.12
    );
  };

  const wrap = (v) => (v + size) % size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hl = H(wrap(x - 1), y);
      const hr = H(wrap(x + 1), y);
      const hd = H(x, wrap(y - 1));
      const hu = H(x, wrap(y + 1));
      const nx = hl - hr;
      const ny = hd - hu;
      const nz = 2.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      const i = (y * size + x) * 4;
      img.data[i] = (nx / len) * 0.5 * 255 + 127.5;
      img.data[i + 1] = (ny / len) * 0.5 * 255 + 127.5;
      img.data[i + 2] = (nz / len) * 0.5 * 255 + 127.5;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
