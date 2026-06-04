// terrain.js
// ハイトマップの地形＋「場所ごとの水面」を持つ内陸水メッシュを管理する。
//
// 水の仕組み（流体シミュなし）:
//  - 海は別途 water.js の大きな板（固定 y=0）。
//  - 内陸の水は pool[i]（その地点の水面の高さ）を持ち、海面より高い標高にも
//    水を置ける。pool[i] > 地表 なら水が見える。
//  - 「水」ツールでなぞった所に、その地点の地表＋少しの深さで水面を作る。
//    斜面に沿って掘った溝をなぞれば、水面が下流へ段々に下って川に見える。
//
// 色は標高＋傾斜で自動変化（砂→草→岩→雪）。手動ペイントが優先。
// 谷を暗くする簡易AO・岩肌のムラで、のっぺり感を低減。

import * as THREE from 'three';
import { makeWaveNormalMap } from './waveTexture.js';

const SIZE = 60;
const SEG = 128;
const SEA_EDGE = -3.0;

export const WATER_LEVEL = 0; // 海面（固定）
const WATER_FILL = 0.5; // 「水」ツールが地表より上に張る水の深さ
const POOL_NONE = -1e9; // 内陸水なしを表す番兵

// 標高カラー（THREE.Color は sRGB→線形に変換して保持＝トーンマッピングで正しい）
const SAND = new THREE.Color(0xe8d8a0);
const GRASS = new THREE.Color(0x6fb04a);
const ROCK = new THREE.Color(0x8a7b63);
const ROCK_DARK = new THREE.Color(0x5f564a);
const SNOW = new THREE.Color(0xeef2f6);

const WATER_SHALLOW = new THREE.Color(0x7fd2e0);
const WATER_DEEP = new THREE.Color(0x16688f);

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
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  const colorAttr = geo.attributes.color;

  const heights = new Float32Array(verts * verts);
  const mask = new Float32Array(verts * verts);
  const paint = new Uint8Array(verts * verts);
  const pool = new Float32Array(verts * verts).fill(POOL_NONE);

  let paintMaterial = PAINT_IDS.grass;
  let aoEnabled = true;

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

  // --- 内陸水メッシュ（場所ごとの水面） ---
  const waterGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  waterGeo.rotateX(-Math.PI / 2);
  const wPos = waterGeo.attributes.position;
  const wColorArr = new Float32Array(verts * verts * 4); // RGBA
  waterGeo.setAttribute('color', new THREE.BufferAttribute(wColorArr, 4));
  const wColorAttr = waterGeo.attributes.color;
  waterGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SIZE * 1.2);

  const waterNormal = makeWaveNormalMap(128);
  waterNormal.repeat.set(26, 26);
  const waterMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    alphaTest: 0.02, // 水の無い所（alpha≈0）は破棄して軽く
    roughness: 0.13,
    metalness: 0.0,
    normalMap: waterNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    depthWrite: false,
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.frustumCulled = false;
  waterMesh.renderOrder = 2;
  waterMesh.name = 'inlandWater';

  // --- 書き込みヘルパー ---
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

  const _c = { r: 0, g: 0, b: 0 };
  function autoColor(h, ny, ix, iz) {
    let r = SAND.r;
    let g = SAND.g;
    let b = SAND.b;
    const tg = smoothstep(0.12, 0.7, h);
    r = lerp(r, GRASS.r, tg);
    g = lerp(g, GRASS.g, tg);
    b = lerp(b, GRASS.b, tg);
    // 岩肌：標高 or 急斜面。岩は明暗のムラ（ノイズ）でゴツゴツ感を出す。
    let tr = smoothstep(2.6, 5.0, h);
    const steep = 1 - ny;
    const slopeRock = smoothstep(0.42, 0.85, steep) * smoothstep(0.4, 1.4, h);
    tr = Math.max(tr, slopeRock);
    if (tr > 0) {
      const n = hash(ix, iz); // 0..1
      // 岩色自体に濃淡のムラ（暗い岩↔明るい岩）
      const rr = lerp(ROCK_DARK.r, ROCK.r, n);
      const rg = lerp(ROCK_DARK.g, ROCK.g, n);
      const rb = lerp(ROCK_DARK.b, ROCK.b, n);
      r = lerp(r, rr, tr);
      g = lerp(g, rg, tr);
      b = lerp(b, rb, tr);
    }
    // 雪
    const ts = smoothstep(5.8, 8.0, h);
    if (ts > 0) {
      const sn = 0.92 + hash(iz, ix) * 0.08;
      r = lerp(r, SNOW.r * sn, ts);
      g = lerp(g, SNOW.g * sn, ts);
      b = lerp(b, SNOW.b * sn, ts);
    }
    _c.r = r;
    _c.g = g;
    _c.b = b;
  }

  function writeColor(i) {
    const o = i * 3;
    const pid = paint[i];
    if (pid) {
      const c = PAINT[pid];
      colorArr[o] = c.r;
      colorArr[o + 1] = c.g;
      colorArr[o + 2] = c.b;
      return;
    }
    const ix = i % verts;
    const iz = (i / verts) | 0;
    const h = dispH(i);
    autoColor(h, normAttr.getY(i), ix, iz);
    // 簡易AO：周囲より低い谷を少し暗くして奥行きを出す
    let ao = 1;
    if (aoEnabled) {
      const hN =
        (dispH(idx(Math.max(ix - 1, 0), iz)) +
          dispH(idx(Math.min(ix + 1, SEG), iz)) +
          dispH(idx(ix, Math.max(iz - 1, 0))) +
          dispH(idx(ix, Math.min(iz + 1, SEG)))) *
        0.25;
      ao = 1 - clamp((hN - h) * 0.5, 0, 0.32);
    }
    colorArr[o] = _c.r * ao;
    colorArr[o + 1] = _c.g * ao;
    colorArr[o + 2] = _c.b * ao;
  }

  function writeWater(i) {
    const o = i * 4;
    const td = dispH(i);
    const surf = pool[i];
    const wet = surf > td + 0.04 && surf > WATER_LEVEL + 0.02;
    if (!wet) {
      if (surf <= td && surf > POOL_NONE) pool[i] = POOL_NONE; // 地形が上がったら掃除
      wPos.setY(i, td);
      wColorArr[o + 3] = 0;
      return;
    }
    wPos.setY(i, surf);
    const depth = surf - td;
    const tdp = smoothstep(0.15, 2.2, depth);
    wColorArr[o] = lerp(WATER_SHALLOW.r, WATER_DEEP.r, tdp);
    wColorArr[o + 1] = lerp(WATER_SHALLOW.g, WATER_DEEP.g, tdp);
    wColorArr[o + 2] = lerp(WATER_SHALLOW.b, WATER_DEEP.b, tdp);
    wColorArr[o + 3] = smoothstep(0.04, 0.3, depth) * 0.82;
  }

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
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = idx(ix, iz);
        writeColor(i);
        writeWater(i);
      }
    }
    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    wPos.needsUpdate = true;
    wColorAttr.needsUpdate = true;
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
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const dx = -half + ix * cell - cx;
          const dz = -half + iz * cell - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > r2) continue;
          if (falloff(Math.sqrt(d2), radius) > 0.3) paint[idx(ix, iz)] = paintMaterial;
        }
      }
    } else if (tool === 'water') {
      // なぞった所に水を発生させる。盛り上がって見えないよう浅い水底を彫り、
      // 水面はその地点の元の地表あたりに置く（海面より高い標高でもOK）。
      // 斜面をなぞれば水面が下流へ段々に下って川のように見える。
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const dx = -half + ix * cell - cx;
          const dz = -half + iz * cell - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > r2) continue;
          const w = falloff(Math.sqrt(d2), radius);
          if (w <= 0.25) continue;
          const i = idx(ix, iz);
          const before = dispH(i);
          heights[i] -= w * 0.3; // 浅い水底を彫る
          const target = before + WATER_FILL * 0.1; // 水面≒元の地面
          if (pool[i] < target) pool[i] = target;
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

  // --- 問い合わせ・セーブ ---
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
  function getPool() {
    return pool;
  }
  function setPool(arr) {
    if (!arr || arr.length !== pool.length) return false;
    pool.set(arr);
    rebuildAll();
    return true;
  }
  function setPaintMaterial(id) {
    paintMaterial = id;
  }
  function setAO(on) {
    if (aoEnabled === on) return;
    aoEnabled = on;
    rebuildAll();
  }
  function setWaterDetail(scale) {
    waterMat.normalScale.set(scale, scale);
  }

  let wt = 0;
  let wlast = performance.now();
  function updateWater() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - wlast) / 1000);
    wlast = now;
    wt += dt;
    waterNormal.offset.x = (wt * 0.04) % 1; // 上流→下流の流れ感
    waterNormal.offset.y = (wt * 0.05) % 1;
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
    pool.fill(POOL_NONE);
    rebuildAll();
  }

  return {
    mesh,
    waterMesh,
    applyBrush,
    heightAt,
    normalAt,
    getHeights,
    setHeights,
    getPaint,
    setPaint,
    getPool,
    setPool,
    setPaintMaterial,
    setAO,
    setWaterDetail,
    updateWater,
    reset,
    cell,
    size: SIZE,
    poolNone: POOL_NONE,
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

// 0..1 の擬似乱数（位置ハッシュ）。岩肌のムラ用。
function hash(ix, iz) {
  const s = Math.sin(ix * 12.9898 + iz * 78.233) * 43758.5453;
  return s - Math.floor(s);
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
