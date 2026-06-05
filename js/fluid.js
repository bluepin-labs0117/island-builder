// fluid.js
// 簡易リアルタイム流体（高さマップのセル法）。本格的な流体ではなく、
// 「各セルから、より低い隣セルへ水を分配する」方式で downhill に流す。
//
// 軽量化：地形(128)とは別の粗い格子(48/64/96)で、描画と切り離して低頻度更新。
// 水源から水を出し続け、海面以下・格子の端では排水（海へ流れて消える）。

import * as THREE from 'three';
import { makeWaveNormalMap } from './waveTexture.js';

const SEA = 0; // 海面。これより低い地形では水は排水される
const FLOW = 0.7; // 1ステップで動かす水の割合（安定化のため <1。低いほど水が溜まり見やすい）
const SRC_RATE = 1.4; // 水源の湧き出し速度（深さ/秒）
const SRC_MAX = 2.2; // 水源セルの最大深さ
const MAX_SOURCES = 48;

const SHALLOW = new THREE.Color(0x4fb0c8);
const DEEP = new THREE.Color(0x12537a);

export function createFluid({ scene, terrain }) {
  const SIZE = terrain.size;
  const half = SIZE / 2;

  let N = 64; // 1辺のセル数
  let res = N + 1; // 1辺の頂点数
  let cell = SIZE / N;
  let stepsPerSec = 16;

  let terr = new Float32Array(res * res);
  let depth = new Float32Array(res * res);
  let depth2 = new Float32Array(res * res);
  let rdepth = new Float32Array(res * res); // 時間平滑した水深（ちらつき防止）
  let ddisp = new Float32Array(res * res); // さらに空間平滑した描画用の水深（フチをなめらかに）

  const sources = []; // ワールド座標 {x,z}
  const strokeCells = new Set(); // 1ストローク内の重複トグル防止
  const cb = { onChange: null };
  const emitChange = () => cb.onChange && cb.onChange();

  let geo, mesh, posAttr, colorAttr, colorArr, normalMap, material;
  let env = null;
  let detail = 0.6;

  const idx = (ix, iz) => iz * res + ix;
  const clampCell = (v) => Math.min(res - 1, Math.max(0, Math.round(v)));

  function sampleTerrain() {
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        terr[idx(ix, iz)] = terrain.heightAt(-half + ix * cell, -half + iz * cell);
      }
    }
  }

  function buildMesh() {
    geo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
    geo.rotateX(-Math.PI / 2);
    posAttr = geo.attributes.position;
    colorArr = new Float32Array(res * res * 4);
    geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 4));
    colorAttr = geo.attributes.color;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SIZE * 1.2);

    normalMap = makeWaveNormalMap(128);
    normalMap.repeat.set(12, 12);
    material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      alphaTest: 0.012,
      roughness: 0.09,
      metalness: 0.0,
      normalMap,
      normalScale: new THREE.Vector2(detail, detail),
      envMapIntensity: 0.7,
      depthWrite: false,
      // 地面と水面が近い所での Z-fighting（点滅）を防ぐ：水を深度的に手前へ寄せる
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    if (env) material.envMap = env;

    mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3; // 海・内陸静水より上
    mesh.name = 'fluid';
    scene.add(mesh);
  }

  function disposeMesh() {
    if (!mesh) return;
    scene.remove(mesh);
    geo.dispose();
    material.dispose();
    normalMap.dispose();
    mesh = null;
  }

  function allocate() {
    res = N + 1;
    cell = SIZE / N;
    terr = new Float32Array(res * res);
    depth = new Float32Array(res * res);
    depth2 = new Float32Array(res * res);
    rdepth = new Float32Array(res * res);
    ddisp = new Float32Array(res * res);
    sampleTerrain();
  }

  allocate();
  buildMesh();
  updateMesh();

  // --- シミュ本体 ---
  function emit(dt) {
    for (const s of sources) {
      const i = idx(clampCell((s.x + half) / cell), clampCell((s.z + half) / cell));
      if (terr[i] < SEA) continue; // 水源が海中なら無視
      depth[i] = Math.min(depth[i] + SRC_RATE * dt, SRC_MAX);
    }
  }

  function step(dt) {
    sampleTerrain(); // 地形編集に追従（溝を彫ると流路が変わる）
    emit(dt);

    depth2.set(depth);
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const i = iz * res + ix;
        const d = depth[i];
        if (d <= 1e-4) continue;
        const Hc = terr[i] + d;
        const iL = ix > 0 ? i - 1 : i;
        const iR = ix < res - 1 ? i + 1 : i;
        const iD = iz > 0 ? i - res : i;
        const iU = iz < res - 1 ? i + res : i;
        const dL = Hc - (terr[iL] + depth[iL]);
        const dR = Hc - (terr[iR] + depth[iR]);
        const dD = Hc - (terr[iD] + depth[iD]);
        const dU = Hc - (terr[iU] + depth[iU]);
        let sum = 0;
        if (dL > 0) sum += dL;
        if (dR > 0) sum += dR;
        if (dD > 0) sum += dD;
        if (dU > 0) sum += dU;
        if (sum <= 0) continue;
        const out = Math.min(d, 0.5 * sum) * FLOW;
        if (dL > 0) depth2[iL] += (out * dL) / sum;
        if (dR > 0) depth2[iR] += (out * dR) / sum;
        if (dD > 0) depth2[iD] += (out * dD) / sum;
        if (dU > 0) depth2[iU] += (out * dU) / sum;
        depth2[i] -= out;
      }
    }
    const tmp = depth;
    depth = depth2;
    depth2 = tmp;

    // 排水・掃除：端と海面下は水を消す
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const i = iz * res + ix;
        if (ix === 0 || iz === 0 || ix === res - 1 || iz === res - 1) {
          depth[i] = 0;
        } else if (terr[i] < SEA - 0.05) {
          depth[i] = 0;
        } else if (depth[i] < 1e-4) {
          depth[i] = 0;
        } else if (depth[i] < 0.02) {
          depth[i] *= 0.985; // ごく薄い膜だけ徐々に消す（窪地に溜まる池は残る）
        }
      }
    }
    updateMesh();
  }

  function updateMesh() {
    // 1) 時間平滑：水深の急な振動を抑える
    for (let i = 0; i < res * res; i++) {
      let rd = rdepth[i] + (depth[i] - rdepth[i]) * 0.5;
      if (rd < 0.003) rd = 0;
      rdepth[i] = rd;
    }
    // 2) 空間平滑：フチのガタつきをならし、単一セルの点滅を抑える
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const i = iz * res + ix;
        const l = rdepth[ix > 0 ? i - 1 : i];
        const r = rdepth[ix < res - 1 ? i + 1 : i];
        const d = rdepth[iz > 0 ? i - res : i];
        const u = rdepth[iz < res - 1 ? i + res : i];
        ddisp[i] = rdepth[i] * 0.5 + (l + r + d + u) * 0.125;
      }
    }
    // 3) 描画：水面を地形より少し上げ、深さで色と透明度を変える
    for (let i = 0; i < res * res; i++) {
      const dd = ddisp[i];
      const o = i * 4;
      if (dd > 0.008) {
        posAttr.setY(i, terr[i] + dd + 0.025);
        const t = smoothstep(0.05, 0.9, dd);
        colorArr[o] = lerp(SHALLOW.r, DEEP.r, t);
        colorArr[o + 1] = lerp(SHALLOW.g, DEEP.g, t);
        colorArr[o + 2] = lerp(SHALLOW.b, DEEP.b, t);
        // 浅い所は透明寄り、深い所は濃く不透明（下限を確保して消えかかりを防ぐ）
        colorArr[o + 3] = 0.32 + smoothstep(0.03, 0.6, dd) * 0.6;
      } else {
        posAttr.setY(i, terr[i]);
        colorArr[o + 3] = 0;
      }
    }
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  // --- 更新ループ（描画フレームから呼ぶ） ---
  let acc = 0;
  let last = performance.now();
  let wt = 0;
  function update() {
    const now = performance.now();
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    const stepDt = 1 / stepsPerSec;
    acc += dt;
    let n = 0;
    while (acc >= stepDt && n < 3) {
      step(stepDt);
      acc -= stepDt;
      n++;
    }
    // さざ波スクロール（毎フレーム）
    wt += dt;
    normalMap.offset.x = (wt * 0.06) % 1;
    normalMap.offset.y = (wt * 0.05) % 1;
  }

  // --- 水源 ---
  function beginStroke() {
    strokeCells.clear();
  }
  function toggleSource(x, z) {
    const ix = clampCell((x + half) / cell);
    const iz = clampCell((z + half) / cell);
    const key = ix + ',' + iz;
    if (strokeCells.has(key)) return; // 同ストローク内は1回だけ
    strokeCells.add(key);
    // 近くの既存水源を探す
    const r = cell * 0.75;
    let found = -1;
    for (let k = 0; k < sources.length; k++) {
      if (Math.abs(sources[k].x - x) <= r && Math.abs(sources[k].z - z) <= r) {
        found = k;
        break;
      }
    }
    if (found >= 0) {
      sources.splice(found, 1); // 再タップで削除
    } else if (sources.length < MAX_SOURCES) {
      // セル中心に置く
      sources.push({ x: -half + ix * cell, z: -half + iz * cell });
    }
    emitChange();
  }
  function clearSources() {
    if (!sources.length) return;
    sources.length = 0;
    emitChange();
  }

  // --- 画質・反射 ---
  function setEnv(e) {
    env = e || null;
    if (material) {
      material.envMap = env;
      material.needsUpdate = true;
    }
  }
  function setDetail(scale) {
    detail = scale;
    if (material) material.normalScale.set(scale, scale);
  }
  function setResolution(newN, hz) {
    if (hz) stepsPerSec = hz;
    if (newN === N) return;
    // 水源(ワールド座標)は保持、深さはリセット（数秒で再形成）
    disposeMesh();
    N = newN;
    allocate();
    buildMesh();
    updateMesh();
  }

  // --- セーブ／ロード ---
  function serialize() {
    const dsp = [];
    for (let i = 0; i < res * res; i++) {
      if (depth[i] > 0.02) dsp.push(i, Math.round(depth[i] * 100) / 100);
    }
    return {
      n: N,
      sources: sources.map((s) => ({ x: round2(s.x), z: round2(s.z) })),
      depth: dsp,
    };
  }
  function load(data) {
    if (!data) return;
    sources.length = 0;
    if (Array.isArray(data.sources)) {
      for (const s of data.sources) {
        if (sources.length < MAX_SOURCES) sources.push({ x: s.x, z: s.z });
      }
    }
    depth.fill(0);
    rdepth.fill(0);
    if (data.n === N && Array.isArray(data.depth)) {
      for (let i = 0; i + 1 < data.depth.length; i += 2) {
        const k = data.depth[i];
        if (k >= 0 && k < depth.length) depth[k] = data.depth[i + 1];
      }
    }
    updateMesh();
  }

  function clear() {
    sources.length = 0;
    depth.fill(0);
    rdepth.fill(0);
    updateMesh();
  }

  return {
    update,
    beginStroke,
    toggleSource,
    clearSources,
    setEnv,
    setDetail,
    setResolution,
    serialize,
    load,
    clear,
    setOnChange: (fn) => (cb.onChange = fn),
    sourceCount: () => sources.length,
  };
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function round2(v) {
  return Math.round(v * 100) / 100;
}
