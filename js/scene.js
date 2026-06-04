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
  // 影を有効化。スマホ負荷を抑えるため PCFSoft（やわらかめ）＋低解像度マップ。
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
  // 半球光：空の色（上）と地面の照り返し（下）でふんわり満たす
  const hemi = new THREE.HemisphereLight(
    0xeaf3ff, // 空側：わずかに寒色
    0xcdb892, // 地面側：暖かい砂の照り返し
    0.55
  );
  scene.add(hemi);

  // 太陽光：暖色（やや低い色温度）で斜め上から
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.05);
  sun.position.set(38, 54, 22); // 斜め上から（広い地形をカバー）
  sun.castShadow = true;

  // シャドウマップは軽め（低解像度）でスマホ負荷を抑える
  sun.shadow.mapSize.set(1024, 1024);
  // 影が落ちる範囲を編集できる地形の広さに合わせる
  const d = 34;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  // flatShading でのシャドウアクネ（縞）を抑える
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;

  scene.add(sun);
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
