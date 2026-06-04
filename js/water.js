// water.js
// 軽量な「水位より低い場所は水」表現。流体シミュはせず、水位の高さに
// 半透明の青い面を1枚置くだけ。地形がその面より低い場所（掘った溝・窪地）は
// 水面板の下に隠れ、半透明越しに地形が透けて水に沈んで見える。
// 内陸の窪地でも水位より低ければ自動で池・湖になる（面が全体を覆うため）。
//
// さざ波はスクロールする法線マップ（手続き生成）で表現。軽い。

import * as THREE from 'three';

export const WATER_LEVEL = 0; // 水位＝海面の基準高さ（1つだけ）

export function createWater(level = WATER_LEVEL) {
  const geometry = new THREE.PlaneGeometry(400, 400);
  geometry.rotateX(-Math.PI / 2); // 水平

  const normalMap = makeWaveNormalMap(128);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(34, 34);

  const material = new THREE.MeshStandardMaterial({
    color: 0x2b87a6, // 自然なターコイズ寄りの青
    transparent: true,
    // 半透明：浅い所は砂底が透けて明るく、深い所は暗く見える（深さで色が変わる）
    opacity: 0.66,
    roughness: 0.14, // 低めで水面のきらめき（太陽光の映り込み）
    metalness: 0.0, // 環境マップが無いので 0（>0 だと暗くなる）
    normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    depthWrite: false, // 透明面なので深度は書かない（下の地形を見せる）
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = level;
  mesh.renderOrder = 1; // 不透明描画のあと
  mesh.name = 'water';

  // さざ波：2方向に法線マップをゆっくりスクロール
  let t = 0;
  let last = performance.now();
  function update() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    // 斜め方向へ流す＝川のように流れて見える
    normalMap.offset.x = (t * 0.03) % 1;
    normalMap.offset.y = (t * 0.022) % 1;
  }

  return { mesh, update, level };
}

// 手続き的に波の法線マップを作る（タイル可能）。一度だけ生成。
function makeWaveNormalMap(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  // 周期関数で高さ場を作る（端で連続＝シームレス）
  const H = (x, y) => {
    const fx = (x / size) * Math.PI * 2;
    const fy = (y / size) * Math.PI * 2;
    // 複数の波を重ねて豊かなさざ波に（周期関数なのでタイル可能）
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
  return new THREE.CanvasTexture(canvas);
}
