// scene.js
// シーン・カメラ・レンダラー・ライト・海など「土台」の構築を担当する。
// 後から要素を足しやすいよう、生成したオブジェクトをまとめて返す。

import * as THREE from 'three';
import { createWater } from './water.js';

/**
 * レンダラーを作成する。
 * @param {HTMLElement} container - canvas を追加する親要素
 */
export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // スマホの高解像度対応。負荷を抑えるため最大 2 に制限。
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // 影を有効化。PCFSoft（やわらかい輪郭）。
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // フィルミックなトーンマッピングで階調を自然に（のっぺり感を低減）
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);
  return renderer;
}

/**
 * 斜め見下ろしのカメラを作成する。
 */
export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  // 島（原点）を斜め上から見下ろす位置（初期の島が大きく見える距離）
  camera.position.set(21, 17, 21);
  camera.lookAt(0, 0, 0);
  return camera;
}

/**
 * シーン本体を作成し、海とライトを配置する。
 */
export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // 空の色（水色）
  scene.fog = new THREE.Fog(0x87ceeb, 80, 240); // 遠景をやわらかく溶かす

  addLights(scene);
  const water = createWater();
  scene.add(water.mesh);

  return { scene, water };
}

/**
 * やわらかい光（半球光 + 太陽光1つ）を当てる。
 * 半球光で空＝やや寒色 / 地面の照り返し＝暖色 を表現し、陰影に自然なメリハリを出す。
 * 太陽光は斜め上から当てて、島と地面にやわらかい影を落とす。
 */
function addLights(scene) {
  // 半球光：空（やや寒色）と地面の照り返し（暖色）。やや弱めにして
  // 太陽光とのコントラストを残し、立体感（のっぺり感の低減）を出す。
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0xb59a6a, 0.65);
  scene.add(hemi);

  // 太陽光：暖色で斜め上から。やや低めの角度にして陰影に奥行きを出す。
  const sun = new THREE.DirectionalLight(0xfff0d2, 2.0);
  sun.position.set(34, 40, 20);
  sun.castShadow = true;

  // 影：解像度を上げつつ PCFSoft で輪郭をやわらかく
  sun.shadow.mapSize.set(2048, 2048);
  const d = 34; // 編集できる地形の広さに合わせる
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 170;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;

  scene.add(sun);

  // 弱い補助光（影側の黒つぶれを防ぎ、奥行きを保つ）
  const fill = new THREE.DirectionalLight(0xdce6ff, 0.25);
  fill.position.set(-26, 18, -16);
  scene.add(fill);
}

/**
 * ウィンドウリサイズ時にカメラとレンダラーを追従させる。
 */
export function handleResize(camera, renderer) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });
}
