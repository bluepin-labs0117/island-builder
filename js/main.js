// main.js
// アプリのエントリポイント。各モジュールを組み立てて描画ループを回す。

import {
  createRenderer,
  createCamera,
  createScene,
  handleResize,
} from './scene.js';
import { createIsland } from './island.js';
import { createControls } from './controls.js';

function init() {
  const container = document.getElementById('app');

  // 土台（レンダラー・カメラ・シーン・海・ライト）
  const renderer = createRenderer(container);
  const camera = createCamera();
  const { scene } = createScene();

  // 中央に島を置く
  const island = createIsland();
  scene.add(island);

  // カメラ操作（タッチ対応）
  const controls = createControls(camera, renderer.domElement);

  // リサイズ追従
  handleResize(camera, renderer);

  // 描画ループ
  function animate() {
    requestAnimationFrame(animate);
    controls.update(); // damping を効かせるため毎フレーム呼ぶ
    renderer.render(scene, camera);
  }
  animate();
}

init();
