// main.js
// アプリのエントリポイント。各モジュールを組み立てて描画ループを回す。

import {
  createRenderer,
  createCamera,
  createScene,
  handleResize,
} from './scene.js';
import { createTerrain } from './terrain.js';
import { createControls } from './controls.js';
import { createTerrainEditor } from './terrainEditor.js';
import { createUI } from './ui.js';

// ブラシの可動範囲（UIとエディタで共有）
const RADIUS_RANGE = [0.6, 6];
const STRENGTH_RANGE = [0.02, 0.4];

function init() {
  const container = document.getElementById('app');

  // 土台（レンダラー・カメラ・シーン・海・ライト）
  const renderer = createRenderer(container);
  const camera = createCamera();
  const { scene } = createScene();

  // 中央に編集できる地形（ハイトマップの島）を置く
  const terrain = createTerrain();
  scene.add(terrain.mesh);

  // カメラ操作（タッチ対応）
  const controls = createControls(camera, renderer.domElement);

  // 地形編集（カメラ操作と排他のモード制）
  const editor = createTerrainEditor({
    camera,
    dom: renderer.domElement,
    terrain,
    controls,
    scene,
  });

  // 操作UI（モード切替・ツール・スライダー）
  createUI({
    radius: editor.state.radius,
    strength: editor.state.strength,
    radiusRange: RADIUS_RANGE,
    strengthRange: STRENGTH_RANGE,
    onMode: (m) => editor.setMode(m),
    onTool: (t) => editor.setTool(t),
    onRadius: (v) => editor.setRadius(v),
    onStrength: (v) => editor.setStrength(v),
  });

  // リサイズ追従
  handleResize(camera, renderer);

  // 描画ループ
  function animate() {
    requestAnimationFrame(animate);
    controls.update(); // damping を効かせるため毎フレーム呼ぶ
    editor.update(); // 編集モード時のブラシ処理・リング追従
    renderer.render(scene, camera);
  }
  animate();
}

init();
