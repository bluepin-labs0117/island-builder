// main.js
// アプリのエントリポイント。各モジュールを組み立てて描画ループを回す。

import {
  createRenderer,
  createCamera,
  createScene,
  handleResize,
} from './scene.js';
import { createTerrain, PAINT_IDS } from './terrain.js';
import { createControls } from './controls.js';
import { createTerrainEditor } from './terrainEditor.js';
import { createObjects } from './objects.js';
import { createPlaceEditor } from './placeEditor.js';
import { createUI } from './ui.js';
import { loadState, clearState, createAutoSaver } from './storage.js';

const RADIUS_RANGE = [0.6, 8];
const STRENGTH_RANGE = [0.02, 0.4];

function init() {
  const container = document.getElementById('app');

  // 土台
  const renderer = createRenderer(container);
  const camera = createCamera();
  const { scene, water } = createScene();

  // 編集できる地形（広い島）
  const terrain = createTerrain();
  scene.add(terrain.mesh);

  // 設置オブジェクト（種類ごとにインスタンシング）
  const objects = createObjects({ scene, terrain });

  // カメラ操作
  const controls = createControls(camera, renderer.domElement);

  // 地形編集
  const editor = createTerrainEditor({
    camera,
    dom: renderer.domElement,
    terrain,
    scene,
  });

  // 自動保存（地形の高さ＋手動ペイント＋設置物）
  const getState = () => ({
    v: 2,
    terrain: {
      heights: roundedHeights(terrain.getHeights()),
      paint: encodePaint(terrain.getPaint()), // 塗った所だけ疎に保存
    },
    objects: objects.serialize(),
  });
  const scheduleSave = createAutoSaver(getState, 600);
  // 地形を編集したら：保存予約＋設置物/土台を新しい地面に接地し直す（throttle）
  const scheduleReground = debounce(() => objects.reground(), 200);
  terrain.api.onChange = () => {
    scheduleSave();
    scheduleReground();
  };
  objects.setOnChange(scheduleSave);

  // UI（先に作り、設置エディタへ渡す）
  const ui = createUI({
    radius: 2.5,
    strength: 0.12,
    radiusRange: RADIUS_RANGE,
    strengthRange: STRENGTH_RANGE,
    onMode: (m) => applyMode(m),
    onTool: (t) => editor.setTool(t),
    onRadius: (v) => editor.setRadius(v),
    onStrength: (v) => editor.setStrength(v),
    onPaintMaterial: (name) => terrain.setPaintMaterial(PAINT_IDS[name]),
    onPalette: (t) => place.setPalette(t),
    onRotate: () => place.rotateSelected(),
    onDelete: () => place.deleteSelected(),
    onReset: () => doReset(),
  });

  // 設置入力
  const place = createPlaceEditor({
    camera,
    dom: renderer.domElement,
    terrain,
    objects,
    scene,
    ui,
  });

  // モードを一元管理（操作の干渉を防ぐ）
  function applyMode(m) {
    controls.enabled = m !== 'edit'; // 地形編集中だけカメラ操作を止める
    editor.setMode(m);
    place.setMode(m);
  }
  applyMode('camera');

  // リセット
  function doReset() {
    if (!confirm('新しい島を作り直します。設置物もすべて消えます。よろしいですか？')) {
      return;
    }
    terrain.reset();
    objects.clear();
    place.clearSelection();
    clearState();
    scheduleSave();
    ui.toast('新しい島を作りました');
  }

  // 前回の島を復元
  const saved = loadState();
  if (saved) {
    if (saved.terrain?.heights) {
      terrain.setHeights(Float32Array.from(saved.terrain.heights));
    }
    if (saved.terrain?.paint) {
      terrain.setPaint(decodePaint(saved.terrain.paint, terrain.getPaint().length));
    }
    if (saved.objects) {
      objects.load(saved.objects);
    }
  }

  handleResize(camera, renderer);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    editor.update();
    water.update(); // さざ波のスクロール
    renderer.render(scene, camera);
  }
  animate();
}

// 単純なデバウンス
function debounce(fn, ms) {
  let t = null;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

// 高さ配列を丸めて保存サイズを抑える
function roundedHeights(arr) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = Math.round(arr[i] * 1000) / 1000;
  return out;
}

// 手動ペイントは塗った所だけ疎に保存（[index, materialId, ...]）
function encodePaint(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) out.push(i, arr[i]);
  }
  return out;
}

function decodePaint(sparse, len) {
  const a = new Uint8Array(len);
  if (Array.isArray(sparse)) {
    for (let i = 0; i + 1 < sparse.length; i += 2) {
      const idx = sparse[i];
      if (idx >= 0 && idx < len) a[idx] = sparse[i + 1];
    }
  }
  return a;
}

init();
