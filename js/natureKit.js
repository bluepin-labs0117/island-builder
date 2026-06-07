// natureKit.js
// KayKit "Medieval Hexagon Pack"(CC0, Kay Lousberg) の自然デコレーションを使う。
//
// このパックは全モデルが1枚のアトラス(hexagons_medieval.png, 15KB)を共有し、
// 各モデルは単一メッシュ＝そのまま InstancedMesh 化できる（=モバイルで非常に軽い）。
// 1種類につき1ドローコール、テクスチャは全種で1枚だけ。
//
// メモリ方針：曲線の少ない小さなモデル群＋共有テクスチャ1枚に絞って読み込む。
// 全176モデルのような重い読み込みはしない。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DIR = './assets/nature/glTF/';

// 設置できる自然オブジェクトの種類（カテゴリ tree/rock、データ駆動で増やせる）
export const NATURE_KINDS = [
  { id: 'tree_A', file: 'tree_single_A', cat: 'tree', label: '🌲 木A', scale: 1.5, tiltK: 0 },
  { id: 'tree_B', file: 'tree_single_B', cat: 'tree', label: '🌳 木B', scale: 1.5, tiltK: 0 },
  { id: 'tree_C', file: 'trees_A_medium', cat: 'tree', label: '🌲 木立', scale: 1.3, tiltK: 0 },
  { id: 'bush', file: 'trees_A_small', cat: 'tree', label: '🌿 茂み', scale: 1.2, tiltK: 0 },
  { id: 'rock_A', file: 'rock_single_A', cat: 'rock', label: '🪨 岩A', scale: 3.0, tiltK: 0.6 },
  { id: 'rock_B', file: 'rock_single_C', cat: 'rock', label: '🪨 岩B', scale: 3.0, tiltK: 0.6 },
  { id: 'rock_C', file: 'rock_single_D', cat: 'rock', label: '🪨 岩C', scale: 3.2, tiltK: 0.6 },
];

// 旧セーブ（仮の木・岩）との互換マッピング
export const LEGACY_NATURE = { tree: 'tree_A', rock: 'rock_A' };

function sanitize(geo) {
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) {
    const c = geo.attributes.position.count;
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(c * 2), 2));
  }
  return geo;
}

// メッシュ→ベイク済みジオメトリ（底面 y=0、XZ中心）。InstancedMesh 用。
function prep(mesh) {
  mesh.updateWorldMatrix(true, false);
  const geo = sanitize(mesh.geometry.clone());
  geo.applyMatrix4(mesh.matrixWorld);
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  geo.translate(-cx, -b.min.y, -cz);
  return geo;
}

/**
 * 自然キットを作る。ready は全モデルの読み込み完了で解決。
 * 各種類は getGeometry(id) でジオメトリ、getMaterial() で共有アトラス素材を返す。
 */
export function createNatureKit() {
  const geoms = {}; // id -> BufferGeometry
  let atlasMat = null;
  let loaderPromise = null;

  async function loadAll() {
    const loader = new GLTFLoader();
    const files = [...new Set(NATURE_KINDS.map((k) => k.file))];
    await Promise.all(
      files.map(async (f) => {
        try {
          const g = await loader.loadAsync(DIR + f + '.gltf');
          let mesh = null;
          g.scene.traverse((o) => {
            if (!mesh && o.isMesh) mesh = o;
          });
          if (!mesh) return;
          if (!atlasMat) {
            const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            // 共有アトラスのみ使用。法線/粗さ等の重いマップは無いが念のため軽量化。
            m.normalMap = null;
            m.roughnessMap = null;
            m.metalnessMap = null;
            if (m.metalness !== undefined) m.metalness = 0;
            if (m.roughness === undefined || m.roughness < 0.5) m.roughness = 0.7;
            m.needsUpdate = true;
            atlasMat = m;
          }
          const geo = prep(mesh);
          for (const k of NATURE_KINDS) if (k.file === f) geoms[k.id] = geo;
        } catch (e) {
          console.error('[natureKit] 読み込み失敗:', f, e);
        }
      })
    );
    return true;
  }

  // 設置モードに入ったら読む（必要になるまで遅延）
  function ensureLoaded() {
    if (!loaderPromise) loaderPromise = loadAll();
    return loaderPromise;
  }

  return {
    kinds: NATURE_KINDS,
    ensureLoaded,
    get ready() {
      return ensureLoaded();
    },
    getGeometry: (id) => geoms[id] || null,
    getMaterial: () => atlasMat,
  };
}
