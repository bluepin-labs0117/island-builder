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
const OV = 0.3; // 屋根の張り出し（軒）
const MAX_TEX = 512; // テクスチャはこのサイズへ縮小（元は2048＝スマホに過大）

// 1x1 透明PNG（重いマップの代わりに読み込ませてダウンロードを省く）
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

// 家の仕様（データ駆動）。3種をコンセプトから作り分ける。
//  hx,hz=footprint半サイズ / stories=階数 / ridgeAlong=棟の向き / pitch=屋根勾配
//  chimneys=妻側(±x)の煙突 / porch=玄関ポーチ / upperWall=2階の壁(任意)
const SPECS = [
  // 家1：小さく素朴な平屋のコテージ（コンパクト・煙突1本）
  {
    id: 'cottage',
    scale: 0.36,
    hx: 1,
    hz: 1,
    stories: 1,
    ridgeAlong: 'x',
    pitch: 0.95,
    floor: 'Floor_UnevenBrick',
    wall: 'Wall_Plaster_Straight',
    door: 'Wall_Plaster_Door_Flat',
    window: 'Wall_Plaster_Window_Wide_Flat',
    chimneys: [1],
  },
  // 家2：横長の平屋＋玄関ポーチ（箱っぽさを崩す・レンガ）
  {
    id: 'longhouse',
    scale: 0.28,
    hx: 2,
    hz: 1,
    stories: 1,
    ridgeAlong: 'x',
    pitch: 1.0,
    floor: 'Floor_UnevenBrick',
    wall: 'Wall_UnevenBrick_Straight',
    door: 'Wall_UnevenBrick_Door_Flat',
    window: 'Wall_UnevenBrick_Window_Wide_Flat',
    chimneys: [-1],
    porch: true,
  },
  // 家3：2階建ての立派な家（下=レンガ／上=木組み・煙突2本）
  {
    id: 'manor',
    scale: 0.24,
    hx: 2,
    hz: 2,
    stories: 2,
    ridgeAlong: 'x',
    pitch: 1.0,
    floor: 'Floor_UnevenBrick',
    wall: 'Wall_UnevenBrick_Straight',
    door: 'Wall_UnevenBrick_Door_Flat',
    window: 'Wall_UnevenBrick_Window_Wide_Flat',
    upperWall: 'Wall_Plaster_WoodGrid',
    upperWindow: 'Wall_Plaster_Window_Wide_Flat',
    chimneys: [1, -1],
  },
];

// 全プレハブ共通のディテール部品。原点が壁と共通なので壁と同じ pos/rotY で嵌る。
const DETAIL = {
  windowInsert: 'Window_Wide_Flat1',
  corner: 'Corner_Exterior_Wood',
  bottomCover: 'Wall_BottomCover',
  doorFrame: 'DoorFrame_Flat_WoodDark',
  doorLeaf: 'Door_2_Flat',
  chimney: 'Prop_Chimney',
};
// 手続き屋根のタイル質感を借りるための部品（配置はしない）
const MAT_DONORS = ['Roof_RoundTiles_4x4'];

export const HOUSE_VARIANTS = SPECS.map((s, i) => ({ index: i, id: s.id }));

// 内部コアの素材（暗い不透明箱。開口から向こうが透けるのを防ぐ backdrop）
const PRIM_MATS = {
  interior: new THREE.MeshStandardMaterial({ color: 0x231f18, roughness: 1.0, metalness: 0.0 }),
};

// エッジ上の壁/床タイルの中心座標（半サイズ h、2幅モジュール）
function centers(h) {
  const a = [];
  for (let c = -h + 1; c <= h - 1; c += 2) a.push(c);
  return a;
}

// 仕様 → 配置データ（kitパーツ / 屋根 / ポーチ / 内部コア）
function buildPlacements(spec) {
  const { hx, hz, floor, door, window: win, wall, stories = 1, ridgeAlong = 'x', pitch = 1.0 } = spec;
  const parts = [];
  const interiors = [];
  const sx = centers(hx);
  const sz = centers(hz);
  const addWall = (file, pos, rotY) => {
    parts.push({ file, pos, rotY });
    parts.push({ file: DETAIL.bottomCover, pos, rotY }); // 足元/階境の木ビーム
  };

  // 床（1階のみ）
  for (const cz of sz) for (const cx of sx) parts.push({ file: floor, pos: [cx, 0, cz], rotY: 0 });

  for (let s = 0; s < stories; s++) {
    const y = s * WALL_H;
    const ground = s === 0;
    const W = s > 0 && spec.upperWall ? spec.upperWall : wall;
    const WIN = s > 0 && spec.upperWindow ? spec.upperWindow : win;
    // 南：1階の端セグメントはドア、それ以外は窓
    sx.forEach((cx, i) => {
      if (ground && i === 0) {
        addWall(door, [cx, y, -hz], 0);
        parts.push({ file: DETAIL.doorFrame, pos: [cx, y, -hz], rotY: 0 });
        parts.push({ file: DETAIL.doorLeaf, pos: [cx - 0.515, y, -hz - 0.05], rotY: 0 });
      } else {
        addWall(WIN, [cx, y, -hz], 0);
        parts.push({ file: DETAIL.windowInsert, pos: [cx, y, -hz], rotY: 0 });
      }
    });
    // 北：窓
    sx.forEach((cx) => {
      addWall(WIN, [cx, y, hz], Math.PI);
      parts.push({ file: DETAIL.windowInsert, pos: [cx, y, hz], rotY: Math.PI });
    });
    // 西/東：端は窓、それ以外は無地壁
    sz.forEach((cz, i) => {
      const isWin = i === 0;
      addWall(isWin ? WIN : W, [-hx, y, cz], Math.PI / 2);
      if (isWin) parts.push({ file: DETAIL.windowInsert, pos: [-hx, y, cz], rotY: Math.PI / 2 });
    });
    sz.forEach((cz, i) => {
      const isWin = i === 0;
      addWall(isWin ? WIN : W, [hx, y, cz], -Math.PI / 2);
      if (isWin) parts.push({ file: DETAIL.windowInsert, pos: [hx, y, cz], rotY: -Math.PI / 2 });
    });
    // 四隅の木柱
    for (const cxx of [-hx, hx]) for (const czz of [-hz, hz]) {
      parts.push({ file: DETAIL.corner, pos: [cxx, y, czz], rotY: 0 });
    }
  }

  // 内部コア（全階を1つの背の高い箱で塞ぐ）
  interiors.push({ size: [hx, hz], y0: 0.05, y1: stories * WALL_H - 0.07 });

  // 屋根
  const eaveY = stories * WALL_H;
  const roofs = [{ hx, hz, cx: 0, cz: 0, eaveY, ridgeAlong, pitch }];

  // 煙突（棟付近を貫いて少し上に出す）。引き伸ばさず、煙突の天端が棟+0.9に来るよう
  // 下げて置く（下部は壁/コアに隠れる）。Prop_Chimney は y0..3.18。
  const ridgeY = eaveY + pitch * ((ridgeAlong === 'x' ? hz : hx) + OV);
  for (const sgn of spec.chimneys || []) {
    const baseY = Math.max(0, ridgeY + 0.9 - 3.18);
    const px = ridgeAlong === 'x' ? sgn * hx * 0.5 : 0;
    const pz = ridgeAlong === 'x' ? 0 : sgn * hz * 0.5;
    parts.push({ file: DETAIL.chimney, pos: [px, baseY, pz], rotY: 0, scale: [0.9, 1, 0.9] });
  }

  // ポーチ（玄関の下屋）
  const porch = spec.porch ? { cx: sx[0], z: -hz } : null;

  return { parts, interiors, roofs, porch };
}

// 必要な部品ファイル名の一覧
function neededFiles() {
  const set = new Set();
  for (const s of SPECS) {
    for (const k of ['floor', 'wall', 'door', 'window', 'upperWall', 'upperWindow']) {
      if (s[k]) set.add(s[k]);
    }
  }
  for (const f of Object.values(DETAIL)) set.add(f);
  for (const f of MAT_DONORS) set.add(f);
  return [...set];
}

// --- 手続きジオメトリ（閉じた切妻屋根・ポーチ・内部コア） ---

// 四角形（2三角形, position/normal/uv, 非インデックス）
function quad(a, b, c, d, uMax, vMax) {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3)
  );
  g.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, uMax, 0, uMax, vMax, 0, 0, uMax, vMax, 0, vMax], 2)
  );
  g.computeVertexNormals();
  return g;
}
// 三角形（妻壁=ゲーブル用）
function tri(a, b, c, uw) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, uw / 1.6, 0, uw / 3.2, 1.1], 2));
  g.computeVertexNormals();
  return g;
}
function boxGeo(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// 閉じた切妻屋根：2枚の斜面(tile) + 両妻の三角壁(gable)。必ず塞がる。
function makeGableRoofGeo(r) {
  const tile = [];
  const gable = [];
  const eaveY = r.eaveY;
  if (r.ridgeAlong === 'x') {
    const HX = r.hx + OV;
    const HZ = r.hz + OV;
    const ridgeY = eaveY + r.pitch * HZ;
    const x0 = r.cx - HX;
    const x1 = r.cx + HX;
    const zc = r.cz;
    const zN = r.cz - HZ;
    const zP = r.cz + HZ;
    const u = (2 * HX) / 0.95;
    const v = Math.hypot(HZ, ridgeY - eaveY) / 0.95;
    tile.push(quad([x0, eaveY, zN], [x1, eaveY, zN], [x1, ridgeY, zc], [x0, ridgeY, zc], u, v));
    tile.push(quad([x1, eaveY, zP], [x0, eaveY, zP], [x0, ridgeY, zc], [x1, ridgeY, zc], u, v));
    gable.push(tri([x0, eaveY, zN], [x0, eaveY, zP], [x0, ridgeY, zc], 2 * HZ));
    gable.push(tri([x1, eaveY, zP], [x1, eaveY, zN], [x1, ridgeY, zc], 2 * HZ));
  } else {
    const HX = r.hx + OV;
    const HZ = r.hz + OV;
    const ridgeY = eaveY + r.pitch * HX;
    const z0 = r.cz - HZ;
    const z1 = r.cz + HZ;
    const xc = r.cx;
    const xN = r.cx - HX;
    const xP = r.cx + HX;
    const u = (2 * HZ) / 0.95;
    const v = Math.hypot(HX, ridgeY - eaveY) / 0.95;
    tile.push(quad([xN, eaveY, z0], [xN, eaveY, z1], [xc, ridgeY, z1], [xc, ridgeY, z0], u, v));
    tile.push(quad([xP, eaveY, z1], [xP, eaveY, z0], [xc, ridgeY, z0], [xc, ridgeY, z1], u, v));
    gable.push(tri([xN, eaveY, z0], [xP, eaveY, z0], [xc, ridgeY, z0], 2 * HX));
    gable.push(tri([xP, eaveY, z1], [xN, eaveY, z1], [xc, ridgeY, z1], 2 * HX));
  }
  return { tile, gable };
}

// 玄関ポーチ（片流れの下屋＋2本柱）
function makePorchGeo(porch) {
  const cx = porch.cx;
  const z = porch.z; // 前壁の線
  const projZ = z - 1.4;
  const postH = 2.2;
  const wood = [
    boxGeo(0.14, postH, 0.14, cx - 0.85, postH / 2, projZ),
    boxGeo(0.14, postH, 0.14, cx + 0.85, postH / 2, projZ),
  ];
  const x0 = cx - 1.05;
  const x1 = cx + 1.05;
  const tile = [
    quad([x0, 2.8, z], [x1, 2.8, z], [x1, 2.35, projZ], [x0, 2.35, projZ], 2.1 / 0.95, 1.6 / 0.95),
  ];
  return { wood, tile };
}

// 内部コア箱（窓枠の張り出しと干渉しないよう内側に収める）
function makeInteriorGeo(it) {
  const [hx, hz] = it.size;
  const h = Math.max(0.3, it.y1 - it.y0);
  const g = new THREE.BoxGeometry(
    Math.max(0.3, 2 * (hx - 0.5)),
    h,
    Math.max(0.3, 2 * (hz - 0.5))
  );
  g.translate(0, (it.y0 + it.y1) / 2, 0);
  return g;
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
  // 窓ガラスは見やすい薄青の半透明に（キット既定は alpha0.1 で見えづらい）
  if (/glass/i.test(m.name || '')) {
    m.map = null;
    m.color = new THREE.Color(0xa6cee0);
    m.transparent = true;
    m.opacity = 0.5;
    m.roughness = 0.1;
    m.metalness = 0.0;
    m.side = THREE.DoubleSide;
    m.depthWrite = false; // 透明の重なりを軽く
    m.needsUpdate = true;
    return;
  }
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

// ロード済みパーツから条件に合う最初のマテリアルを探す（手続き屋根の質感流用）
function findMat(cache, files, test) {
  for (const f of files) {
    const sc = cache[f];
    if (!sc) continue;
    let found = null;
    sc.traverse((o) => {
      if (found || !o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (test(m)) return (found = m);
    });
    if (found) return found;
  }
  return null;
}
function makeRoofTileMat(cache) {
  const src = findMat(cache, MAT_DONORS, (m) => /tile/i.test(m.name || ''));
  const m = src ? src.clone() : new THREE.MeshStandardMaterial({ color: 0x9a4b3b });
  m.name = 'ROOF_tile';
  m.side = THREE.DoubleSide;
  m.metalness = 0;
  if (m.roughness < 0.5) m.roughness = 0.9;
  if (m.map) {
    m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping; // 配置しない屋根原本のテクスチャなので変更可
    m.map.needsUpdate = true;
  }
  return m;
}
function makeGableMat(cache, spec) {
  const donors = spec.upperWall ? [spec.upperWall, spec.wall] : [spec.wall];
  const src = findMat(cache, donors, (m) => m.map && !/wood|glass|metal/i.test(m.name || ''));
  const m = src ? src.clone() : new THREE.MeshStandardMaterial({ color: 0xddd5c4 });
  m.name = 'ROOF_gable';
  m.side = THREE.DoubleSide;
  m.metalness = 0;
  return m;
}
function makeWoodMat(cache) {
  const src = findMat(cache, [DETAIL.corner, DETAIL.bottomCover], (m) => /wood/i.test(m.name || ''));
  const m = src ? src.clone() : new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.9 });
  m.name = 'PORCH_wood';
  m.metalness = 0;
  return m;
}

// 仕様 + ロード済み部品 → 1つのプレハブ Group（マテリアル単位でマージ）
function assemble(spec, cache) {
  const data = buildPlacements(spec);
  const groups = new Map(); // key -> { material, geoms:[] }
  const interiorGeoms = [];
  const partM = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _t = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const addGeom = (key, material, geo) => {
    let g = groups.get(key);
    if (!g) {
      g = { material, geoms: [] };
      groups.set(key, g);
    }
    g.geoms.push(geo);
  };

  // --- kit パーツ ---
  for (const pl of data.parts) {
    const part = cache[pl.file];
    if (!part) continue;
    const sc = Array.isArray(pl.scale) ? pl.scale : [pl.scale || 1, pl.scale || 1, pl.scale || 1];
    _t.set(pl.pos[0], pl.pos[1], pl.pos[2]);
    _q.setFromEuler(_e.set(0, pl.rotY, 0));
    _s.set(sc[0], sc[1], sc[2]);
    partM.compose(_t, _q, _s);
    part.updateMatrixWorld(true);
    part.traverse((o) => {
      if (!o.isMesh) return;
      const geo = sanitize(o.geometry.clone());
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(partM, o.matrixWorld));
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      addGeom(mat.name || mat.uuid, mat, geo);
    });
  }

  // --- 手続き屋根・ポーチ（質感はキットから流用クローン） ---
  const tileMat = makeRoofTileMat(cache);
  const gableMat = makeGableMat(cache, spec);
  for (const r of data.roofs) {
    const { tile, gable } = makeGableRoofGeo(r);
    for (const g of tile) addGeom('ROOF_tile', tileMat, g);
    for (const g of gable) addGeom('ROOF_gable', gableMat, g);
  }
  if (data.porch) {
    const woodMat = makeWoodMat(cache);
    const { wood, tile } = makePorchGeo(data.porch);
    for (const g of wood) addGeom('PORCH_wood', woodMat, sanitize(g));
    for (const g of tile) addGeom('ROOF_tile', tileMat, g);
  }
  for (const it of data.interiors) interiorGeoms.push(makeInteriorGeo(it));

  const inner = new THREE.Group();
  for (const { material, geoms } of groups.values()) {
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    inner.add(mesh);
  }
  if (interiorGeoms.length) {
    const g = interiorGeoms.length === 1 ? interiorGeoms[0] : mergeGeometries(interiorGeoms, false);
    if (g) {
      const mesh = new THREE.Mesh(g, PRIM_MATS.interior);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      inner.add(mesh);
    }
  }

  // 壁は設計上 原点中心なので XZ は動かさない（ポーチで重心がずれても家の中心を保つ）。
  // 底面だけ y=0 に揃える。
  const box = new THREE.Box3().setFromObject(inner);
  for (const ch of inner.children) ch.geometry.translate(0, -box.min.y, 0);

  const outer = new THREE.Group();
  outer.add(inner);
  outer.scale.setScalar(spec.scale);

  const fb = new THREE.Box3().setFromObject(outer);
  const footprint = {
    hx: Math.max(0.2, (fb.max.x - fb.min.x) / 2),
    hz: Math.max(0.2, (fb.max.z - fb.min.z) / 2),
  };
  // 基礎(プリンス)用：屋根の張り出しを含まない壁の外周サイズ
  const base = {
    hx: (spec.hx + 0.18) * spec.scale,
    hz: (spec.hz + 0.18) * spec.scale,
  };
  return { group: outer, footprint, base };
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
  const bases = SPECS.map(() => ({ hx: 0.4, hz: 0.34 })); // 基礎プリンスのサイズ

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
          bases[i] = built.base;
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
    getBaseFootprint: (i) => bases[Math.max(0, Math.min(bases.length - 1, i | 0))],
  };
}
