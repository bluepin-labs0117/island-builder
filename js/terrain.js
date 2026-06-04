// terrain.js
// 島の地面を「連続したハイトマップメッシュ」として作る。
// 頂点を上げ下げして起伏を作り、なめらかな陰影（法線の解析計算）と
// 高さに応じた色（砂浜→緑→岩）を持つ。
//
// 軽量化の要：
//  - メッシュの分割数(SEG)は上限を守り、編集範囲(SIZE)を広げる時は
//    1マスを大きくして頂点数を増やさない。
//  - 編集のたびに全頂点を作り直さず、ブラシが触れたグリッド範囲だけ更新する。
//
// 縁の扱い：外周に近づくほど高さを海面下(SEA_EDGE)へなめらかに戻す
// （edgeMask）。これで島の端を盛っても破片が浮かず、常に海に浮かんで見える。

import * as THREE from 'three';

// 編集範囲の広さと分割数。SEG は重くなりすぎない上限。
// SIZE を大きくして広い地形を作れるようにし、cell を大きくして頂点数は据え置き。
const SIZE = 60;
const SEG = 128;

// 縁で戻る海面下の高さ（水面 y=0 より十分下）
const SEA_EDGE = -3.0;

// 高さに対応する色（0..1）。砂浜・緑・岩。
const SAND = { r: 0.91, g: 0.847, b: 0.627 };
const GRASS = { r: 0.435, g: 0.69, b: 0.29 };
const ROCK = { r: 0.541, g: 0.521, b: 0.49 };

/**
 * ハイトマップ地形を作って返す。
 */
export function createTerrain() {
  const verts = SEG + 1; // 1辺の頂点数
  const cell = SIZE / SEG; // グリッド1マスの幅（ワールド単位）
  const half = SIZE / 2;

  // 縁の減衰開始/終了半径（この外周で海面へ沈める）
  const R_START = half * 0.62; // ここまでは自由に編集できる
  const R_END = half * 0.97; // ここで完全に海面下へ

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2); // XZ平面（Yが高さ）に寝かせる

  const posAttr = geo.attributes.position;
  const normAttr = geo.attributes.normal;
  const colorArr = new Float32Array(verts * verts * 3);
  const colorAttr = new THREE.BufferAttribute(colorArr, 3);
  geo.setAttribute('color', colorAttr);

  // 高さの真実の値（ユーザーが彫った生データ）と、縁マスク
  const heights = new Float32Array(verts * verts);
  const mask = new Float32Array(verts * verts);

  const idx = (ix, iz) => iz * verts + ix;

  // マスクと初期の島の形を作る
  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const wx = -half + ix * cell;
      const wz = -half + iz * cell;
      const i = idx(ix, iz);
      const r = Math.hypot(wx, wz);
      mask[i] = 1 - smoothstep(R_START, R_END, r);
      heights[i] = baseHeight(wx, wz);
    }
  }

  // 表示する高さ＝縁で海面下へ寄せた値（生データに縁マスクを適用）
  const dispH = (i) => SEA_EDGE + (heights[i] - SEA_EDGE) * mask[i];

  // --- ローカル更新ヘルパー ---------------------------------------------

  function writeY(i) {
    posAttr.setY(i, dispH(i));
  }

  function writeColor(i) {
    const h = dispH(i);
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

  // 中心差分で法線を解析計算（表示高さを使う）
  function writeNormal(ix, iz) {
    const hl = dispH(idx(Math.max(ix - 1, 0), iz));
    const hr = dispH(idx(Math.min(ix + 1, SEG), iz));
    const hd = dispH(idx(ix, Math.max(iz - 1, 0)));
    const hu = dispH(idx(ix, Math.min(iz + 1, SEG)));
    const nx = hl - hr;
    const ny = 2 * cell;
    const nz = hd - hu;
    const len = Math.hypot(nx, ny, nz) || 1;
    normAttr.setXYZ(idx(ix, iz), nx / len, ny / len, nz / len);
  }

  function updateRegion(ix0, ix1, iz0, iz1) {
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = idx(ix, iz);
        writeY(i);
        writeColor(i);
      }
    }
    // 法線は隣に影響するので1リング広げて更新
    const nx0 = Math.max(0, ix0 - 1);
    const nx1 = Math.min(SEG, ix1 + 1);
    const nz0 = Math.max(0, iz0 - 1);
    const nz1 = Math.min(SEG, iz1 + 1);
    for (let iz = nz0; iz <= nz1; iz++) {
      for (let ix = nx0; ix <= nx1; ix++) writeNormal(ix, iz);
    }
    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  function rebuildAll() {
    updateRegion(0, SEG, 0, SEG);
  }

  rebuildAll();

  // 山が高くなっても見切れないよう境界球は大きめ固定＆カリング無効
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SIZE * 1.2);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.0,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'terrain';

  // 編集時に呼ぶコールバック（自動保存などに使う）
  const api = { onChange: null };

  /**
   * ブラシを1回適用する。影響範囲のグリッドだけを更新する。
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
        }
      }
    } else {
      const dir = tool === 'lower' ? -1 : 1;
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const dx = -half + ix * cell - cx;
          const dz = -half + iz * cell - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > r2) continue;
          const w = falloff(Math.sqrt(d2), radius);
          heights[idx(ix, iz)] += dir * strength * w;
        }
      }
    }

    updateRegion(ix0, ix1, iz0, iz1);
    if (api.onChange) api.onChange();
  }

  // --- 設置・セーブ向けの問い合わせ ---------------------------------------

  // 表示面の高さ（バイリニア補間）
  function heightAt(x, z) {
    let gx = clamp((x + half) / cell, 0, SEG);
    let gz = clamp((z + half) / cell, 0, SEG);
    const ix = Math.min(Math.floor(gx), SEG - 1);
    const iz = Math.min(Math.floor(gz), SEG - 1);
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = dispH(idx(ix, iz));
    const h10 = dispH(idx(ix + 1, iz));
    const h01 = dispH(idx(ix, iz + 1));
    const h11 = dispH(idx(ix + 1, iz + 1));
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  }

  // 表示面の法線（接地物の傾き用）
  const _n = new THREE.Vector3();
  function normalAt(x, z) {
    const e = cell;
    const hl = heightAt(x - e, z);
    const hr = heightAt(x + e, z);
    const hd = heightAt(x, z - e);
    const hu = heightAt(x, z + e);
    return _n.set(hl - hr, 2 * e, hd - hu).normalize().clone();
  }

  // セーブ用：生の高さ配列
  function getHeights() {
    return heights;
  }

  // ロード用：高さ配列を差し替える（長さが合わない場合は無視）
  function setHeights(arr) {
    if (!arr || arr.length !== heights.length) return false;
    heights.set(arr);
    rebuildAll();
    return true;
  }

  // 初期状態へ戻す
  function reset() {
    for (let iz = 0; iz < verts; iz++) {
      for (let ix = 0; ix < verts; ix++) {
        const wx = -half + ix * cell;
        const wz = -half + iz * cell;
        heights[idx(ix, iz)] = baseHeight(wx, wz);
      }
    }
    rebuildAll();
  }

  return {
    mesh,
    applyBrush,
    heightAt,
    normalAt,
    getHeights,
    setHeights,
    reset,
    cell,
    size: SIZE,
    api,
  };
}

// --- 形・補助関数 --------------------------------------------------------

/**
 * 初期の島の高さ。水面は y=0。中央が陸（+）、外周は海面下（-）。
 * 海岸線は少しいびつにする。
 */
function baseHeight(wx, wz) {
  const r = Math.hypot(wx, wz);
  const ang = Math.atan2(wz, wx);
  const coast = 10 + 0.9 * Math.sin(3 * ang) + 0.6 * Math.sin(5 * ang + 1.3);

  const landTop = 0.85;
  const seaFloor = -1.8;
  const t = smoothstep(coast - 2.0, coast + 2.0, r);
  let h = lerp(landTop, seaFloor, t);

  const land = 1 - t;
  h += land * 0.3 * (1 - smoothstep(0, coast, r));
  h +=
    land *
    (0.08 * Math.sin(wx * 0.7) * Math.cos(wz * 0.6) +
      0.05 * Math.sin(wx * 1.3 + wz * 1.1));
  return h;
}

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

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
