// buildingKit.js
// Quaternius "Medieval Village MegaKit"(CC0) のパーツを使い、
// データ駆動で「完成した家プレハブ」を組み立てる。
//
// 設計方針（将来の建築システムの土台）：
//  - 家は「部品(file) + 配置(pos,rotY,scale)」のリスト＝プレハブ仕様で定義する。
//  - 仕様→配置データ→合成 の流れにして、後でユーザーが自由に組めるよう拡張しやすく。
//  - 同じマテリアルの部品はジオメトリをマージして1メッシュにし、描画を軽く保つ。
//  - 読み込みは非同期。失敗時はコンソールにエラーを出し、簡易な箱でフォールバック。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DIR = './assets/buildings/glTF/';
const WALL_H = 3.12; // 計測した壁の高さ（モジュール）
const MAX_TEX = 512; // テクスチャはこのサイズへ縮小（元は2048＝スマホに過大）

// 1x1 透明PNG（重いマップの代わりに読み込ませてダウンロードを省く）
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

// 家の仕様（データ駆動。数値を変えるだけで形を調整できる）
// hx,hz: footprint の半サイズ（ワールド単位、床タイルは2x2）
const SPECS = [
  {
    id: 'cottage',
    scale: 0.34,
    hx: 1,
    hz: 1,
    floor: 'Floor_UnevenBrick',
    wall: 'Wall_Plaster_Straight',
    door: 'Wall_Plaster_Door_Flat',
    window: 'Wall_Plaster_Window_Wide_Flat',
    roof: 'Roof_RoundTiles_4x4',
    roofScale: 0.5,
    roofY: WALL_H,
  },
  {
    id: 'brick_house',
    scale: 0.28,
    hx: 2,
    hz: 2,
    floor: 'Floor_UnevenBrick',
    wall: 'Wall_UnevenBrick_Straight',
    door: 'Wall_UnevenBrick_Door_Flat',
    window: 'Wall_UnevenBrick_Window_Wide_Flat',
    roof: 'Roof_RoundTiles_4x4',
    roofScale: 1.0,
    roofY: WALL_H,
  },
  {
    id: 'plaster_house',
    scale: 0.28,
    hx: 2,
    hz: 2,
    floor: 'Floor_UnevenBrick',
    wall: 'Wall_Plaster_Straight',
    door: 'Wall_Plaster_Door_Flat',
    window: 'Wall_Plaster_Window_Wide_Flat',
    roof: 'Roof_RoundTiles_4x4',
    roofScale: 1.0,
    roofY: WALL_H,
  },
];

export const HOUSE_VARIANTS = SPECS.map((s, i) => ({ index: i, id: s.id }));

// エッジ上の壁/床タイルの中心座標（半サイズ h、2幅モジュール）
function centers(h) {
  const a = [];
  for (let c = -h + 1; c <= h - 1; c += 2) a.push(c);
  return a;
}

// 仕様 → 部品の配置リスト
function buildPlacements(spec) {
  const { hx, hz, floor, wall, door, window: win, roof, roofScale, roofY } = spec;
  const P = [];
  const sx = centers(hx);
  const sz = centers(hz);

  // 床タイル
  for (const cz of sz) for (const cx of sx) P.push({ file: floor, pos: [cx, 0, cz], rotY: 0 });

  // 周囲の壁（南=ドア、北/側面=窓を中心に配置）
  sx.forEach((cx, i) => P.push({ file: i === 0 ? door : wall, pos: [cx, 0, -hz], rotY: 0 }));
  sx.forEach((cx) => P.push({ file: win, pos: [cx, 0, hz], rotY: Math.PI }));
  sz.forEach((cz, i) => P.push({ file: i === 0 ? win : wall, pos: [-hx, 0, cz], rotY: Math.PI / 2 }));
  sz.forEach((cz, i) => P.push({ file: i === 0 ? win : wall, pos: [hx, 0, cz], rotY: -Math.PI / 2 }));

  // 屋根（壁の上に乗せる。サイズは footprint に合わせてスケール）
  P.push({ file: roof, pos: [0, roofY, 0], rotY: 0, scale: roofScale });
  return P;
}

// 必要な部品ファイル名の一覧
function neededFiles() {
  const set = new Set();
  for (const s of SPECS) {
    for (const k of ['floor', 'wall', 'door', 'window', 'roof']) set.add(s[k]);
  }
  return [...set];
}

// テクスチャを縮小（元画像をcanvasへ描き直してGPUメモリを大幅削減）。
// flipY/colorSpace/wrap などの設定はそのまま保持。
function downscaleInPlace(tex) {
  const img = tex && tex.image;
  if (!img || !img.width || !img.height) return;
  if (img.width <= MAX_TEX && img.height <= MAX_TEX) return;
  const w = Math.min(MAX_TEX, img.width);
  const h = Math.max(1, Math.round((img.height * w) / img.width));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  tex.image = cv;
  tex.needsUpdate = true;
}

// マテリアルを軽量化：BaseColorのみ縮小して使い、法線/粗さ等の重いマップは外す。
function lightenMaterial(m) {
  if (!m || m.userData.__lit) return;
  m.userData.__lit = true;
  if (m.map) downscaleInPlace(m.map);
  m.normalMap = null;
  m.roughnessMap = null;
  m.metalnessMap = null;
  m.aoMap = null;
  if (m.metalness !== undefined) m.metalness = 0;
  if (m.roughness === undefined || m.roughness < 0.4) m.roughness = 0.85;
  m.needsUpdate = true;
}

function lightenScene(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) lightenMaterial(m);
  });
}

// ジオメトリを position/normal/uv だけに整える（マージ可能にする）
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

// 仕様 + ロード済み部品 → 1つのプレハブ Group（マテリアル単位でマージ）
function assemble(spec, cache) {
  const groups = new Map(); // materialName -> { material, geoms:[] }
  const partM = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _t = new THREE.Vector3();
  const _s = new THREE.Vector3();

  for (const pl of buildPlacements(spec)) {
    const part = cache[pl.file];
    if (!part) continue;
    const sc = pl.scale || 1;
    _t.set(pl.pos[0], pl.pos[1], pl.pos[2]);
    _q.setFromEuler(_e.set(0, pl.rotY, 0));
    _s.set(sc, sc, sc);
    partM.compose(_t, _q, _s);

    part.updateMatrixWorld(true);
    part.traverse((o) => {
      if (!o.isMesh) return;
      const geo = sanitize(o.geometry.clone());
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(partM, o.matrixWorld));
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const key = mat.name || mat.uuid;
      let g = groups.get(key);
      if (!g) {
        g = { material: mat, geoms: [] };
        groups.set(key, g);
      }
      g.geoms.push(geo);
    });
  }

  const inner = new THREE.Group();
  for (const { material, geoms } of groups.values()) {
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    inner.add(mesh);
  }

  // 中心(XZ)を原点に、底面を y=0 に揃える
  const box = new THREE.Box3().setFromObject(inner);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  for (const ch of inner.children) ch.geometry.translate(-cx, -box.min.y, -cz);

  const outer = new THREE.Group();
  outer.add(inner);
  outer.scale.setScalar(spec.scale);

  const fb = new THREE.Box3().setFromObject(outer);
  const footprint = {
    hx: Math.max(0.2, (fb.max.x - fb.min.x) / 2),
    hz: Math.max(0.2, (fb.max.z - fb.min.z) / 2),
  };
  return { group: outer, footprint };
}

// 簡易フォールバック（実モデル読込前/失敗時の家）
function makeFallback() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.7, 0.85),
    new THREE.MeshStandardMaterial({ color: 0xece7dc, roughness: 0.9 })
  );
  body.position.y = 0.35;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.78, 0.55, 4),
    new THREE.MeshStandardMaterial({ color: 0xb24a3a, roughness: 0.9, flatShading: true })
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 0.98;
  body.castShadow = roof.castShadow = true;
  body.receiveShadow = roof.receiveShadow = true;
  g.add(body, roof);
  const outer = new THREE.Group();
  outer.add(g);
  return { group: outer, footprint: { hx: 0.42, hz: 0.36 } };
}

/**
 * 建物キットを作る。ready は全プレハブの組み立て完了で解決。
 * @returns {{ ready: Promise, getPrefab(i):THREE.Group, getFootprint(i):object, count:number, variants:Array }}
 */
export function createBuildingKit() {
  const fallback = makeFallback();
  const prefabs = SPECS.map(() => fallback); // 読込前はフォールバック
  const footprints = SPECS.map(() => fallback.footprint);

  // 重いマップ（Normal/Roughness/ORM等）はダウンロードを省く
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) =>
    /(_Normal|_Roughness|_ORM|_Metallic|_Metal|_AO)\.png(\?|$)/i.test(url) ? TINY_PNG : url
  );
  const loader = new GLTFLoader(manager);

  const ready = (async () => {
    const cache = {};
    await Promise.all(
      neededFiles().map(async (f) => {
        try {
          const gltf = await loader.loadAsync(DIR + f + '.gltf');
          lightenScene(gltf.scene); // テクスチャ縮小＋重いマップ除去
          cache[f] = gltf.scene;
        } catch (e) {
          console.error('[buildingKit] 読み込み失敗:', f, e);
          cache[f] = null;
        }
      })
    );
    SPECS.forEach((spec, i) => {
      try {
        const built = assemble(spec, cache);
        if (built.group.children.length) {
          prefabs[i] = built;
          footprints[i] = built.footprint;
        }
      } catch (e) {
        console.error('[buildingKit] 組み立て失敗:', spec.id, e);
      }
    });
    return true;
  })();

  return {
    ready,
    count: SPECS.length,
    variants: HOUSE_VARIANTS,
    getPrefab: (i) => prefabs[Math.max(0, Math.min(prefabs.length - 1, i | 0))].group,
    getFootprint: (i) => footprints[Math.max(0, Math.min(footprints.length - 1, i | 0))],
  };
}
