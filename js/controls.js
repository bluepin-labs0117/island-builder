// controls.js
// タッチ／マウスでのカメラ操作を担当する。
// OrbitControls をスマホ向けに設定して使う：
//   - 1本指ドラッグ  → 視点回転
//   - 2本指ピンチ    → ズーム（＋平行移動）
//   - PC: 左ドラッグ回転 / ホイールズーム

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';

/**
 * カメラ操作を作成する。
 * @param {THREE.Camera} camera
 * @param {HTMLElement} domElement - レンダラーの canvas
 */
export function createControls(camera, domElement) {
  const controls = new OrbitControls(camera, domElement);

  // 操作の慣性で「ぬるっと」止まるようにする（スマホでの心地よさ重視）
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // 真上・真下に回り込みすぎないよう角度を制限
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;

  // ズームの距離制限
  controls.minDistance = 6;
  controls.maxDistance = 60;

  // 島（原点）を中心に見る
  controls.target.set(0, 0, 0);

  // タッチ操作の割り当て：1本指=回転 / 2本指=ピンチでズーム＋移動
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  // フェーズ1では右ドラッグ等の平行移動は無効にしてシンプルに
  controls.enablePan = false;

  controls.update();
  return controls;
}
