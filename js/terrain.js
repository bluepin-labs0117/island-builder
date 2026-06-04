// terrain.js
// 島の地面を「連続したハイトマップメッシュ」として作る。
// 頂点を上げ下げして起伏を作り、なめらかな陰影（法線の解析計算）と、
// 標高＋傾斜に応じた色（砂浜→草→岩肌→雪）を持つ。
// さらに手動ペイント（草/砂/岩/雪）で上書きでき、塗った場所は自動色より優先。
//
// 軽量化の要：
//  - 分割数(SEG)は上限を守り、範囲(SIZE)拡大は1マスを大きくして頂点数据え置き。
//  - 編集のたびブラシが触れたグリッド範囲だけ更新する。
//
// 縁の扱い：外周ほど高さを海面下(SEA_EDGE)へなめらかに戻し、島が海に浮く。

import * as THREE from 'three';

const SIZE = 60;
const SEG = 128;
const SEA_EDGE = -3.0;

// 水位（海面）。これより低い場所は水に沈んで見える。
export const WATER_LEVEL = 0;
// 「水」ツールで掘り下げる目標の高さ（水位より少し下＝水で満たす）
const WATER_TARGET = -0.8;

// 標高カラー（sRGB を THREE.Color が線形に変換して保持＝トーンマッピング前提で正しい）
const SAND = new THREE.Color(0xe8d8a0);
const GRASS = new THREE.Color(0x6fb04a);
const ROCK = new THREE.Color(0x8a7b63); // 土・岩肌（茶〜灰）
const SNOW = new THREE.Color(0xeef2f6);

// 手動ペイントの材質ID → 色
const PAINT = { 1: GRASS, 2: SAND, 3: ROCK, 4: SNOW };
export const PAINT_IDS = { grass: 1, sand: 2, rock: 3, snow: 4 };

export function createTerrain() {
  const verts = SEG + 1;
  const cell = SIZE / SEG;
  const half = SIZE / 2;

  const R_START = half * 0.62;
  const R_END = half * 0.97;

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const posAttr = geo.attributes.position;
  const normAttr = geo.attributes.normal;
  const colorArr = new Float32Array(verts * verts * 3);
  const colorAttr = new THREE.BufferAttribute(colorArr, 3);
  geo.setAttribute('color', colorAttr);

  const heights = new Float32Array(verts * verts);
  const mask = new Float32Array(verts * verts);
  const paint = new Uint8Array(verts * verts); // 0=自動, それ以外=材質ID

  let paintMaterial = PAINT_IDS.grass; // 「ペイント」ツールで塗る材質

  const idx = (ix, iz) => iz * verts + ix;

  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const wx = -half + ix * cell;
      const wz = -half + iz * cell;
      const i = idx(ix, iz);
      mask[i] = 1 - smoothstep(R_START, R_END, Math.hypot(wx, wz));
      heights[i] = baseHeight(wx, wz);
    }
  }

  const dispH = (i) => SEA_EDGE + (heights[i] - SEA_EDGE) * mask[i];

  function writeY(i) {
    posAttr.setY(i, dispH(i));
  }

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

  // 標高＋傾斜から自動色を決める（くっきりさせず標高でなだらかに混ぜる）
  const _c = { r: 0, g: 0, b: 0 };
  function autoColor(h, ny) {
    let r = SAND.r;
    let g = SAND.g;
    let b = SAND.b;
    // 砂浜 → 草
    const tg = smoothstep(0.12, 0.7, h);
    r = lerp(r, GRASS.r, tg);
    g = lerp(g, GRASS.g, tg);
    b = lerp(b, GRASS.b, tg);
    // 草 → 岩肌（標高 or 急斜面）
    let tr = smoothstep(2.6, 5.0, h);
    const steep = 1 - ny; // 0=平ら, 1=垂直
    const slopeRock = smoothstep(0.45, 0.85, steep) * smoothstep(0.4, 1.4, h);
    tr = Math.max(tr, slopeRock);
    r = lerp(r, ROCK.r, tr);
    g = lerp(g, ROCK.g, tr);
    b = lerp(b, ROCK.b, tr);
    // 岩肌 → 雪
    const ts = smoothstep(5.8, 8.0, h);
    r = lerp(r, SNOW.r, ts);
    g = lerp(g, SNOW.g, ts);
    b = lerp(b, SNOW.b, ts);
    _c.r = r;
    _c.g = g;
    _c.b = b;
  }

  function writeColor(i) {
    const o = i * 3;
    const pid = paint[i];
    if (pid) {
      const c = PAINT[pid]; // 手動ペイントは自動色より優先（固定表示）
      colorArr[o] = c.r;
      colorArr[o + 1] = c.g;
      colorArr[o + 2] = c.b;
      return;
    }
    autoColor(dispH(i), normAttr.getY(i));
    colorArr[o] = _c.r;
    colorArr[o + 1] = _c.g;
    colorArr[o + 2] = _c.b;
  }

  // 高さ→法線→色 の順（色は傾斜＝法線を参照するため）
  function updateRegion(ix0, ix1, iz0, iz1) {
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) writeY(idx(ix, iz));
    }
    const nx0 = Math.max(0, ix0 - 1);
    const nx1 = Math.min(SEG, ix1 + 1);
    const nz0 = Math.max(0, iz0 - 1);
    const nz1 = Math.min(SEG, iz1 + 1);
    for (let iz = nz0; iz <= nz1; iz++) {
      for (let ix = nx0; ix <= nx1; ix++) writeNormal(ix, iz);
    }
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) writeColor(idx(ix, iz));
    }
    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  function rebuildAll() {
    updateRegion(0, SEG, 0, SEG);
  }

  rebuildAll();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SIZE * 1.2);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'terrain';

  const api = { onChange: null };

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

    if (tool === 'paint') {
      // なぞった所を選択中の材質で塗る（自動色を上書き）
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const dx = -half + ix * cell - cx;
          const dz = -half + iz * cell - cz;
          if (dx * dx + dz * dz > r2) continue;
          const w = falloff(Math.sqrt(dx * dx + dz * dz), radius);
          if (w > 0.3) paint[idx(ix, iz)] = paintMaterial;
        }
      }
    } else if (tool === 'water') {
      // 水位より少し下まで掘り下げて水で満たす（上げはしない＝既存の水を消さない）
      const k = Math.min(1, strength * 5);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const dx = -half + ix * cell - cx;
          const dz = -half + iz * cell - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > r2) continue;
          const w = falloff(Math.sqrt(d2), radius);
          const i = idx(ix, iz);
          if (heights[i] > WATER_TARGET) {
            heights[i] += (WATER_TARGET - heights[i]) * w * k;
          }
        }
      }
    } else if (tool === 'smooth') {
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

  // --- 設置・セーブ向け ---------------------------------------------------

  function heightAt(x, z) {
    const gx = clamp((x + half) / cell, 0, SEG);
    const gz = clamp((z + half) / cell, 0, SEG);
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

  const _n = new THREE.Vector3();
  function normalAt(x, z) {
    const e = cell;
    const hl = heightAt(x - e, z);
    const hr = heightAt(x + e, z);
    const hd = heightAt(x, z - e);
    const hu = heightAt(x, z + e);
    return _n.set(hl - hr, 2 * e, hd - hu).normalize().clone();
  }

  function getHeights() {
    return heights;
  }
  function setHeights(arr) {
    if (!arr || arr.length !== heights.length) return false;
    heights.set(arr);
    rebuildAll();
    return true;
  }
  function getPaint() {
    return paint;
  }
  function setPaint(arr) {
    if (!arr || arr.length !== paint.length) return false;
    paint.set(arr);
    rebuildAll();
    return true;
  }
  function setPaintMaterial(id) {
    paintMaterial = id;
  }

  function reset() {
    for (let iz = 0; iz < verts; iz++) {
      for (let ix = 0; ix < verts; ix++) {
        const wx = -half + ix * cell;
        const wz = -half + iz * cell;
        heights[idx(ix, iz)] = baseHeight(wx, wz);
      }
    }
    paint.fill(0);
    rebuildAll();
  }

  return {
    mesh,
    applyBrush,
    heightAt,
    normalAt,
    getHeights,
    setHeights,
    getPaint,
    setPaint,
    setPaintMaterial,
    reset,
    cell,
    size: SIZE,
    api,
  };
}

// --- 形・補助関数 --------------------------------------------------------

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
