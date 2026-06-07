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
import { createBuildingKit } from './buildingKit.js';
import { createNatureKit, NATURE_KINDS } from './natureKit.js';
import { createFluid } from './fluid.js';
import { createPlaceEditor } from './placeEditor.js';
import { createUI } from './ui.js';
import { loadState, clearState, createAutoSaver } from './storage.js';
import {
  getInitialQuality,
  antialiasFor,
  applyQuality,
  saveQuality,
} from './quality.js';
import { createSkyEnv } from './skyEnv.js';

const RADIUS_RANGE = [0.6, 8];
const STRENGTH_RANGE = [0.02, 0.4];

function init() {
  const container = document.getElementById('app');

  // 画質はレンダラー生成前に決める（アンチエイリアスは生成時のみ設定可能）
  const quality = getInitialQuality();

  // 土台
  const renderer = createRenderer(container, { antialias: antialiasFor(quality) });
  const camera = createCamera();
  const { scene, water, sun } = createScene();

  // 編集できる地形（広い島）＋ 内陸の水面メッシュ
  const terrain = createTerrain();
  scene.add(terrain.mesh);
  scene.add(terrain.waterMesh);

  // 建物キット（glTFの家プレハブ）。非同期ロード、完了したら実モデルへ差し替え。
  const buildingKit = createBuildingKit();
  // 自然キット（木・岩。共有アトラス1枚で軽量）。遅延ロード。
  const natureKit = createNatureKit();

  // 設置オブジェクト
  const objects = createObjects({ scene, terrain, buildingKit, natureKit });

  buildingKit.ready
    .then(() => objects.reground()) // ロード完了でフォールバックの箱を実モデルへ
    .catch((e) => console.error('[buildingKit] 準備に失敗:', e));
  natureKit.ready
    .then(() => objects.reground()) // 木・岩のジオメトリ準備後に描画
    .catch((e) => console.error('[natureKit] 準備に失敗:', e));

  // 流体（水源から流れる水）
  const fluid = createFluid({ scene, terrain });

  // カメラ操作
  const controls = createControls(camera, renderer.domElement);

  // 地形編集（水源ツールは流体へ）
  const editor = createTerrainEditor({
    camera,
    dom: renderer.domElement,
    terrain,
    fluid,
    scene,
  });

  // 自動保存（地形の高さ＋手動ペイント＋設置物＋水源/水）
  const getState = () => ({
    v: 4,
    terrain: {
      heights: roundedHeights(terrain.getHeights()),
      paint: encodePaint(terrain.getPaint()),
      pool: encodePool(terrain.getPool(), terrain.poolNone),
    },
    objects: objects.serialize(),
    water: fluid.serialize(),
  });
  const scheduleSave = createAutoSaver(getState, 600);
  const scheduleReground = debounce(() => objects.reground(), 200);
  terrain.api.onChange = () => {
    scheduleSave();
    scheduleReground();
  };
  objects.setOnChange(scheduleSave);
  fluid.setOnChange(scheduleSave); // 水源の増減で保存

  // 水面の反射用の空環境マップ（一度だけ生成）
  const skyEnv = createSkyEnv(renderer);

  // 画質適用に必要な参照
  const qualityRefs = { renderer, scene, sun, terrain, sea: water, env: skyEnv, fluid };

  // UI
  const ui = createUI({
    radius: 2.5,
    strength: 0.12,
    radiusRange: RADIUS_RANGE,
    strengthRange: STRENGTH_RANGE,
    quality,
    onMode: (m) => applyMode(m),
    onTool: (t) => editor.setTool(t),
    onRadius: (v) => editor.setRadius(v),
    onStrength: (v) => editor.setStrength(v),
    onPaintMaterial: (name) => terrain.setPaintMaterial(PAINT_IDS[name]),
    natureKinds: NATURE_KINDS,
    onPalette: (t) => place.setPalette(t),
    onVariant: (cat, i) => place.setVariant(cat, i),
    onRotateHouse: () => place.rotatePlacement(),
    onRotate: () => place.rotateSelected(),
    onDelete: () => place.deleteSelected(),
    onClearSources: () => fluid.clearSources(),
    onReset: () => doReset(),
    onQuality: (level) => {
      applyQuality(level, qualityRefs);
      saveQuality(level);
    },
  });

  // 設置入力
  const place = createPlaceEditor({
    camera,
    dom: renderer.domElement,
    terrain,
    objects,
    scene,
    ui,
    natureKit,
  });

  function applyMode(m) {
    controls.enabled = m !== 'edit';
    editor.setMode(m);
    place.setMode(m);
  }
  applyMode('camera');

  function doReset() {
    if (!confirm('新しい島を作り直します。設置物もすべて消えます。よろしいですか？')) {
      return;
    }
    terrain.reset();
    objects.clear();
    fluid.clear();
    place.clearSelection();
    clearState();
    scheduleSave();
    ui.toast('新しい島を作りました');
  }

  // 画質を適用（流体の格子サイズ等が決まる）→ その後で保存データを復元
  applyQuality(quality, qualityRefs);

  // 前回の島を復元
  const saved = loadState();
  if (saved) {
    if (saved.terrain?.heights) {
      terrain.setHeights(Float32Array.from(saved.terrain.heights));
    }
    if (saved.terrain?.paint) {
      terrain.setPaint(decodePaint(saved.terrain.paint, terrain.getPaint().length));
    }
    if (saved.terrain?.pool) {
      terrain.setPool(decodePool(saved.terrain.pool, terrain.getPool().length, terrain.poolNone));
    }
    if (saved.objects) {
      objects.load(saved.objects);
    }
    if (saved.water) {
      fluid.load(saved.water);
    }
  }

  handleResize(camera, renderer);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    editor.update();
    water.update(); // 海のさざ波
    terrain.updateWater(); // 内陸の静水（海まわり）
    fluid.update(); // 水源から流れる水のシミュ
    renderer.render(scene, camera);
  }
  animate();
}

function debounce(fn, ms) {
  let t = null;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

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

// 内陸水も水のある所だけ疎に保存（[index, 水面の高さ, ...]）
function encodePool(arr, none) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > none) out.push(i, Math.round(arr[i] * 1000) / 1000);
  }
  return out;
}

function decodePool(sparse, len, none) {
  const a = new Float32Array(len).fill(none);
  if (Array.isArray(sparse)) {
    for (let i = 0; i + 1 < sparse.length; i += 2) {
      const idx = sparse[i];
      if (idx >= 0 && idx < len) a[idx] = sparse[i + 1];
    }
  }
  return a;
}

init();
