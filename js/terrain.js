// terrain.js
// 島の地面を「連続したハイトマップメッシュ」として作る。
// 頂点を上げ下げして起伏を作り、なめらかな陰影（法線の解析計算）と
// 高さに応じた色（砂浜→緑→岩）を持つ。
//
// 軽量化の要：編集のたびに全頂点を作り直さず、ブラシが触れたグリッド範囲
// だけを更新する（位置・色・法線のローカル更新）。

import * as THREE from 'three';

// メッシュの大きさと分割数。SEG は重くなりすぎない上限（最大 128 程度）。
const SIZE = 24;
const SEG = 128;

// 高さに対応する色（0..1）。砂浜・緑・岩。
const SAND = { r: 0.91, g: 0.847, b: 0.627 };
const GRASS = { r: 0.435, g: 0.69, b: 0.29 };
const ROCK = { r: 0.541, g: 0.521, b: 0.49 };

/**
 * ハイトマップ地形を作って返す。
 * @returns {{ mesh: THREE.Mesh, applyBrush: Function, cell: number, size: number }}
 */
export function createTerrain() {
  const verts = SEG + 1; // 1辺の頂点数
  const cell = SIZE / SEG; // グリッド1マスの幅（ワールド単位）
  const half = SIZE / 2;

  // 平面を作り、XZ 平面（Y が高さ）になるよう寝かせて焼き込む。
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const posAttr = geo.attributes.position;
  const normAttr = geo.attributes.normal;
  const colorArr = new Float32Array(verts * verts * 3);
  const colorAttr = new THREE.BufferAttribute(colorArr, 3);
  geo.setAttribute('color', colorAttr);

  // 高さの真実の値（編集・ならし・法線計算の元データ）
  const heights = new Float32Array(verts * verts);

  const idx = (ix, iz) => iz * verts + ix;

  // 初期の島の形を高さに書き込む
  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const wx = -half + ix * cell;
      const wz = -half + iz * cell;
      const i = idx(ix, iz);
      heights[i] = baseHeight(wx, wz);
      posAttr.setY(i, heights[i]);
    }
  }

  // --- ローカル更新ヘルパー ---------------------------------------------

  function writeColor(i) {
    const h = heights[i];
    // 砂浜→緑→岩 の2段ブレンド
    const t1 = smoothstep(0.2, 0.6, h);
    let r = lerp(SAND.r, GRASS.r, t1);
    let g = lerp(SAND.g, GRASS.g, t1);
    let b = lerp(SAND.b, GRASS.b, t1);
    const t2 = smoothstep(2.2, 3.6, h);
    r = lerp(r, ROCK.r, t2);
    g = lerp(g, ROCK.g, t2);
    b = lerp(b, ROCK.b, t2);
    const o = i * 3;
    colorArr[o] = r;
    colorArr[o + 1] = g;
    colorArr[o + 2] = b;
  }

  // ハイトマップ用の法線を中心差分で解析的に求める（グリッドなので軽くて滑らか）
  function writeNormal(ix, iz) {
    const hl = heights[idx(Math.max(ix - 1, 0), iz)];
    const hr = heights[idx(Math.min(ix + 1, SEG), iz)];
    const hd = heights[idx(ix, Math.max(iz - 1, 0))];
    const hu = heights[idx(ix, Math.min(iz + 1, SEG))];
    let nx = hl - hr;
    let ny = 2 * cell;
    let nz = hd - hu;
    const len = Math.hypot(nx, ny, nz) || 1;
    normAttr.setXYZ(idx(ix, iz), nx / len, ny / len, nz / len);
  }

  function updateColors(ix0, ix1, iz0, iz1) {
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) writeColor(idx(ix, iz));
    }
  }

  function updateNormals(ix0, ix1, iz0, iz1) {
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) writeNormal(ix, iz);
    }
  }

  // 初期の色と法線を全体に対して一度だけ計算
  updateColors(0, SEG, 0, SEG);
  updateNormals(0, SEG, 0, SEG);
  posAttr.needsUpdate = true;
  normAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;

  // 編集で山が高くなっても見切れないよう、境界球は大きめ固定＆カリング無効
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SIZE * 1.5);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.0,
    flatShading: false, // なめらかな起伏（スムースシェーディング）
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'terrain';

  /**
   * ブラシを1回適用する。影響範囲のグリッドだけを更新する。
   * @param {number} cx ワールド X（ブラシ中心）
   * @param {number} cz ワールド Z（ブラシ中心）
   * @param {'raise'|'lower'|'smooth'} tool
   * @param {number} radius ブラシ半径（ワールド単位）
   * @param {number} strength 1回の変化量
   */
  function applyBrush(cx, cz, tool, radius, strength) {
    const gx = (cx + half) / cell;
    const gz = (cz + half) / cell;
    const rC = radius / cell;

    const ix0 = Math.max(0, Math.floor(gx - rC));
    const ix1 = Math.min(SEG, Math.ceil(gx + rC));
    const iz0 = Math.max(0, Math.floor(gz - rC));
    const iz1 = Math.min(SEG, Math.ceil(gz + rC));
    if (ix0 > ix1 || iz0 > iz1) return;

    const r2 = radius * radius;

    if (tool === 'smooth') {
      // 周辺の平均に近づけて平らにする
      let sum = 0;
      let cnt = 0;
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const dx = -half + ix * cell - cx;
          const dz = -half + iz * cell - cz;
          if (dx * dx + dz * dz <= r2) {
            sum += heights[idx(ix, iz)];
            cnt++;
          }
        }
      }
      if (!cnt) return;
      const mean = sum / cnt;
      const k = Math.min(1, strength * 4);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const dx = -half + ix * cell - cx;
          const dz = -half + iz * cell - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > r2) continue;
          const w = falloff(Math.sqrt(d2), radius);
          const i = idx(ix, iz);
          heights[i] += (mean - heights[i]) * w * k;
          posAttr.setY(i, heights[i]);
        }
      }
    } else {
      // 盛る / 掘る
      const dir = tool === 'lower' ? -1 : 1;
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const dx = -half + ix * cell - cx;
          const dz = -half + iz * cell - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > r2) continue;
          const w = falloff(Math.sqrt(d2), radius);
          const i = idx(ix, iz);
          heights[i] += dir * strength * w;
          posAttr.setY(i, heights[i]);
        }
      }
    }

    // 色は変更した範囲だけ、法線は隣に影響するので1リング広げて更新
    updateColors(ix0, ix1, iz0, iz1);
    updateNormals(
      Math.max(0, ix0 - 1),
      Math.min(SEG, ix1 + 1),
      Math.max(0, iz0 - 1),
      Math.min(SEG, iz1 + 1)
    );

    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  return { mesh, applyBrush, cell, size: SIZE };
}

// --- 形・補助関数 --------------------------------------------------------

/**
 * 初期の島の高さ。水面は y=0。中央が陸（+）、外周は海面下（-）に沈み、
 * その間に砂浜のラインができる。海岸線は少しいびつにする。
 */
function baseHeight(wx, wz) {
  const r = Math.hypot(wx, wz);
  const ang = Math.atan2(wz, wx);
  // 海岸線の半径を角度で少し揺らして自然な形に
  const coast = 7.5 + 0.7 * Math.sin(3 * ang) + 0.5 * Math.sin(5 * ang + 1.3);

  const landTop = 0.8; // 陸の標準高さ（水面より上）
  const seaFloor = -1.8; // 海底
  const t = smoothstep(coast - 1.6, coast + 1.6, r); // 内陸0→沖1
  let h = lerp(landTop, seaFloor, t);

  // 中央をほんの少し盛り上げる + 陸地だけ控えめな起伏
  const land = 1 - t;
  h += land * 0.25 * (1 - smoothstep(0, coast, r));
  h +=
    land *
    (0.08 * Math.sin(wx * 0.9) * Math.cos(wz * 0.8) +
      0.05 * Math.sin(wx * 1.7 + wz * 1.3));
  return h;
}

// 中心1・縁0のなめらかな釣鐘状の重み
function falloff(d, R) {
  return 0.5 * (Math.cos(Math.PI * Math.min(d / R, 1)) + 1);
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
