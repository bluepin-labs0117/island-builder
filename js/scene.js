// scene.js
// シーン・カメラ・レンダラー・ライト・海など「土台」の構築を担当する。
// 後から要素を足しやすいよう、生成したオブジェクトをまとめて返す。

import * as THREE from 'three';

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
  renderer.shadowMap.enabled = false; // フェーズ1では影なしで軽量に
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
  // 島（原点）を斜め上から見下ろす位置
  camera.position.set(14, 12, 14);
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
  scene.add(water);

  return { scene, water };
}

/**
 * やわらかい光（環境光 + 平行光1つ）を当てる。
 */
function addLights(scene) {
  // 環境光：全体をふんわり明るく
  const ambient = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambient);

  // 平行光：太陽光のように一方向から。やわらかめの強さ。
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
  sun.position.set(20, 30, 10);
  scene.add(sun);
}

/**
 * 広い平らな水面の板を1枚作る。
 */
function createWater() {
  const geometry = new THREE.PlaneGeometry(400, 400);
  const material = new THREE.MeshStandardMaterial({
    color: 0x2f7fd6, // 青い海
    roughness: 0.6,
    metalness: 0.1,
    flatShading: true,
  });
  const water = new THREE.Mesh(geometry, material);
  water.rotation.x = -Math.PI / 2; // 水平に倒す
  water.position.y = 0;
  water.name = 'water';
  return water;
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
