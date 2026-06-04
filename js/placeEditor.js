// placeEditor.js
// 設置モードの入力処理。地面タップで設置、既存オブジェクトのタップで選択。
//
// 設置モード中もカメラ操作（回転・ズーム）はそのまま使えるようにし、
// 「タップ（ほぼ動かさずに離す）」だけを設置/選択として扱う。
// ドラッグはカメラ操作に渡すため preventDefault しない。

import * as THREE from 'three';

const TAP_MOVE = 14; // これ以上動いたらドラッグ扱い(px)
const TAP_TIME = 600; // これ以上長押しならタップ扱いにしない(ms)
const WATER_LEVEL = 0; // 水面の高さ。これより下（海）には設置しない
const PLACE_MIN_Y = -0.15; // 砂浜ぎりぎりまでは許可（少しだけ水際を含める）

/**
 * @param {object} deps
 * @param {THREE.Camera} deps.camera
 * @param {HTMLElement} deps.dom
 * @param {object} deps.terrain
 * @param {object} deps.objects
 * @param {THREE.Scene} deps.scene
 * @param {object} deps.ui - createUI() の戻り値（setSelected/toast を使う）
 */
export function createPlaceEditor({ camera, dom, terrain, objects, scene, ui }) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  let mode = 'camera';
  let palette = 'tree';
  let selected = null; // {type,index}

  let down = null; // {id,x,y,t,moved}
  let multi = false;

  // 選択中オブジェクトを示すリング
  const ringGeo = new THREE.RingGeometry(0.62, 0.78, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffe066,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.renderOrder = 999;
  ring.frustumCulled = false;
  ring.visible = false;
  scene.add(ring);

  function setNDCFrom(clientX, clientY) {
    const r = dom.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
  }

  function showRingAt(sel) {
    const p = objects.positionOf(sel);
    if (!p) {
      ring.visible = false;
      return;
    }
    ring.position.set(p.x, p.y + 0.06, p.z);
    ring.visible = true;
  }

  function clearSelection() {
    selected = null;
    ring.visible = false;
    ui.setSelected(false);
  }

  function handleTap(clientX, clientY) {
    setNDCFrom(clientX, clientY);
    ray.setFromCamera(ndc, camera);

    try {
      // まず既存オブジェクトを拾う → 選択
      const hit = objects.pick(ray);
      if (hit) {
        console.log('[place] オブジェクトを選択:', hit.type, 'index=', hit.index);
        selected = { type: hit.type, index: hit.index };
        showRingAt(selected);
        ui.setSelected(true);
        return;
      }

      // 地面へのレイキャスト
      const groundHits = ray.intersectObject(terrain.mesh, false);
      if (!groundHits.length) {
        console.log('[place] 地形にヒットなし（何も置けません）');
        return;
      }

      const p = groundHits[0].point;
      console.log(
        '[place] 地形ヒット: x=%s y=%s z=%s（選択中=%s）',
        p.x.toFixed(2),
        p.y.toFixed(2),
        p.z.toFixed(2),
        palette
      );

      // 海（水面下）には置かない＝置いても水面板に隠れて見えないため
      if (p.y < PLACE_MIN_Y) {
        console.log('[place] 海の上なので設置しません (y < %s)', PLACE_MIN_Y);
        ui.toast('海の上には置けません（陸地をタップ）');
        return;
      }

      const ok = objects.place(palette, p.x, p.z);
      if (!ok) {
        ui.toast(`設置できる数の上限（${objects.MAX}個）に達しました`);
        return;
      }
      console.log('[place] 設置しました。合計 %d 個', objects.count());
      clearSelection();
    } catch (err) {
      console.error('[place] handleTap でエラー:', err);
    }
  }

  function onDown(e) {
    if (mode !== 'place') return;
    if (down) {
      multi = true; // 2本目以降＝ピンチ等。タップ扱いにしない
      return;
    }
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
  }

  function onMove(e) {
    if (mode !== 'place' || !down || e.pointerId !== down.id) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_MOVE) {
      down.moved = true;
    }
  }

  function onUp(e) {
    if (mode !== 'place') return;
    if (!down || e.pointerId !== down.id) return;
    const dt = performance.now() - down.t;
    const moved = down.moved;
    const x = down.x;
    const y = down.y;
    const wasMulti = multi;
    down = null;
    multi = false;
    if (wasMulti || moved || dt > TAP_TIME) {
      console.log(
        '[place] タップ無効（カメラ操作扱い） moved=%s 複数指=%s 時間=%dms',
        moved,
        wasMulti,
        Math.round(dt)
      );
      return;
    }
    handleTap(x, y);
  }

  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onUp);

  // --- 公開API ---

  function setMode(m) {
    mode = m;
    if (m === 'place') {
      console.log('[place] 設置モードに切り替え。地面（陸地）をタップしてください');
    } else {
      down = null;
      multi = false;
      clearSelection();
    }
  }

  function setPalette(type) {
    palette = type;
  }

  function rotateSelected() {
    if (!selected) return;
    objects.rotate(selected, Math.PI / 6);
    showRingAt(selected);
  }

  function deleteSelected() {
    if (!selected) return;
    objects.remove(selected);
    clearSelection();
  }

  return { setMode, setPalette, rotateSelected, deleteSelected, clearSelection };
}
