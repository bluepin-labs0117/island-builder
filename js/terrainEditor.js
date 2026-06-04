// terrainEditor.js
// 指/マウス入力を地形編集につなぐ。カメラ操作モードと地形編集モードを
// 明確に分け、編集モード中だけ地面を変形する。
//
// 気持ちよさのための工夫：
//  - ブラシ位置を示すリングを表示
//  - なぞった軌跡が途切れないよう、フレーム間を線上に補間してスタンプ
//  - 処理は毎フレーム最新のポインタ位置で1回だけ（バックログでカクつかせない）

import * as THREE from 'three';

const TOOL_COLORS = {
  raise: 0x66ff99,
  lower: 0xff7766,
  smooth: 0x66ccff,
  water: 0x3aa0ff,
  paint: 0xffd166,
};

/**
 * @param {object} deps
 * @param {THREE.Camera} deps.camera
 * @param {HTMLElement} deps.dom - レンダラーの canvas
 * @param {object} deps.terrain - createTerrain() の戻り値
 * @param {THREE.Scene} deps.scene
 */
export function createTerrainEditor({ camera, dom, terrain, scene }) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const state = { mode: 'camera', tool: 'raise', radius: 2.5, strength: 0.12 };

  let isDown = false;
  let activeId = null; // 編集中の指（最初の1本だけ追う）
  let hasPointer = false; // リングを出してよいか
  let lastStamp = null; // 直前にスタンプした位置（線補間用）

  // ブラシ範囲を示すリング（地面の上に薄く重ねて常に見えるようにする）
  const ringGeo = new THREE.RingGeometry(0.86, 1.0, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: TOOL_COLORS.raise,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.renderOrder = 999;
  ring.frustumCulled = false;
  ring.visible = false;
  scene.add(ring);

  function setNDC(e) {
    const r = dom.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function onDown(e) {
    if (state.mode !== 'edit') return;
    if (activeId !== null) return; // すでに1本で編集中なら追加の指は無視
    activeId = e.pointerId;
    isDown = true;
    hasPointer = true;
    lastStamp = null;
    setNDC(e);
    e.preventDefault();
    try {
      dom.setPointerCapture(e.pointerId);
    } catch (_) {
      /* noop */
    }
  }

  function onMove(e) {
    if (state.mode !== 'edit') return;
    if (activeId !== null && e.pointerId !== activeId) return;
    hasPointer = true;
    setNDC(e);
    e.preventDefault();
  }

  function onUp(e) {
    if (e.pointerId !== activeId) return;
    isDown = false;
    activeId = null;
    lastStamp = null;
    if (e.pointerType === 'touch') hasPointer = false; // 指は離れたらリングを隠す
  }

  function onLeave() {
    hasPointer = false;
  }

  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onUp);
  dom.addEventListener('pointerleave', onLeave);

  function setMode(m) {
    state.mode = m;
    if (m !== 'edit') {
      isDown = false;
      activeId = null;
      lastStamp = null;
      hasPointer = false;
      ring.visible = false;
    }
  }

  function setTool(t) {
    state.tool = t;
    ringMat.color.setHex(TOOL_COLORS[t] ?? 0xffffff);
  }

  function setRadius(v) {
    state.radius = v;
    ring.scale.set(v, 1, v); // 単位リングをブラシ半径に合わせて拡大
  }

  function setStrength(v) {
    state.strength = v;
  }

  setRadius(state.radius);
  setTool(state.tool);

  // 毎フレーム呼ぶ：リング追従＋（押下中なら）ブラシ適用
  function update() {
    if (state.mode !== 'edit' || !hasPointer) {
      ring.visible = false;
      return;
    }

    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(terrain.mesh, false);
    if (!hits.length) {
      ring.visible = false;
      if (isDown) lastStamp = null; // 画面外に出たら線を切る
      return;
    }

    const p = hits[0].point;
    ring.visible = true;
    ring.position.set(p.x, p.y + 0.05, p.z);

    if (!isDown) return;

    if (lastStamp) {
      // 前回位置から今回位置までを等間隔にスタンプして軌跡を埋める
      const dx = p.x - lastStamp.x;
      const dz = p.z - lastStamp.z;
      const dist = Math.hypot(dx, dz);
      const spacing = Math.max(state.radius * 0.3, terrain.cell);
      const steps = Math.min(8, Math.floor(dist / spacing));
      for (let s = 1; s < steps; s++) {
        const f = s / steps;
        terrain.applyBrush(
          lastStamp.x + dx * f,
          lastStamp.z + dz * f,
          state.tool,
          state.radius,
          state.strength
        );
      }
    }
    terrain.applyBrush(p.x, p.z, state.tool, state.radius, state.strength);
    lastStamp = { x: p.x, z: p.z };
  }

  return { setMode, setTool, setRadius, setStrength, update, state };
}
