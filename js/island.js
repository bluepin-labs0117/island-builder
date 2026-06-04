// island.js
// 中央に置くローポリ風の平らな島を生成する。
// フェーズ1では起伏なし。砂浜（土台）＋緑（上面）の2層構成。
// 後で地形編集を足しやすいよう、生成処理を関数に分けておく。

import * as THREE from 'three';

/**
 * 島（THREE.Group）を作って返す。
 * @param {object} [opts]
 * @param {number} [opts.radius=6]   島のおおよその半径
 * @param {number} [opts.segments=16] 円周の分割数（少ないほどローポリ）
 */
export function createIsland(opts = {}) {
  const radius = opts.radius ?? 6;
  const segments = opts.segments ?? 16;

  const island = new THREE.Group();
  island.name = 'island';

  // 砂浜（土台）：少し背が低く、緑より一回り大きい円柱
  const beach = createLandLayer({
    radius: radius,
    height: 0.6,
    segments,
    color: 0xe8d8a0, // 砂色
    irregularity: 0.5,
    seed: 1,
  });
  beach.position.y = 0.3; // 水面に少し沈んで見えるくらい
  island.add(beach);

  // 緑（上面）：砂浜より少し小さく、少し上に乗せる
  const grass = createLandLayer({
    radius: radius - 1.1,
    height: 0.5,
    segments,
    color: 0x6fb04a, // 緑
    irregularity: 0.45,
    seed: 2,
  });
  grass.position.y = 0.85;
  island.add(grass);

  return island;
}

/**
 * いびつな円形の低い陸地（1層）をローポリで作る。
 * 円柱の側面リング頂点を少しずらして自然な海岸線にする。
 */
function createLandLayer({ radius, height, segments, color, irregularity, seed }) {
  const geometry = new THREE.CylinderGeometry(
    radius, // 上面半径
    radius, // 底面半径
    height,
    segments,
    1,
    false
  );

  // リング状の頂点を半径方向にゆらして「少しいびつ」にする。
  // XZ が同じ頂点（上下リング）は同じだけ動かして側面を保つ。
  const pos = geometry.attributes.position;
  const rand = makeRandom(seed);
  const offsetMap = new Map();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const dist = Math.sqrt(x * x + z * z);
    if (dist < 0.001) continue; // 中心（上面/底面の中央）は動かさない

    const key = `${x.toFixed(3)}_${z.toFixed(3)}`;
    let scale = offsetMap.get(key);
    if (scale === undefined) {
      scale = 1 + (rand() - 0.5) * irregularity;
      offsetMap.set(key, scale);
    }
    pos.setX(i, x * scale);
    pos.setZ(i, z * scale);
  }

  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true, // ローポリらしい面の陰影
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; // 太陽光で影を落とす
  mesh.receiveShadow = true; // 別の層（緑→砂浜）の影を受ける
  return mesh;
}

/**
 * シード付きの簡易乱数（毎回同じ島の形になるように）。
 */
function makeRandom(seed) {
  let s = seed >>> 0;
  return function () {
    // mulberry32
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
