// objects.js
// 設置オブジェクトの管理。
//  - 岩・木：種類ごとに InstancedMesh（1ドローコール）で軽量に。
//  - 家：建物キット(glTF)のプレハブをクローン配置（複数バリアント・実モデル）。
//
// 各レコードは { x, z, rotY (, variant) } のみ保持し、地面の高さは terrain から
// 都度求めて接地する。家の土台（基礎）は家の footprint に合わせて自動生成。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TYPES = ['rock', 'tree', 'house'];
const INSTANCED = ['rock', 'tree']; // InstancedMesh で描く種類
export const MAX_OBJECTS = 300;

const DEFS = {
  rock: { tiltK: 0.7, scale: 1.0 },
  tree: { tiltK: 0.0, scale: 1.0 },
};

/**
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {object} deps.terrain
 * @param {object} deps.buildingKit - createBuildingKit() の戻り値（家のプレハブ供給）
 */
export function createObjects({ scene, terrain, buildingKit }) {
  const geoms = { rock: makeRock(), tree: makeTree() };

  const meshes = {};
  const records = { rock: [], tree: [], house: [] };
  for (const type of INSTANCED) {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true,
    });
    const inst = new THREE.InstancedMesh(geoms[type], mat, MAX_OBJECTS);
    inst.count = 0;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.name = `obj-${type}`;
    meshes[type] = inst;
    scene.add(inst);
  }

  // 家：クローンを入れるコンテナ
  const houseContainer = new THREE.Group();
  houseContainer.name = 'houses';
  scene.add(houseContainer);

  // 家の土台（基礎）：灰色の四角い柱を InstancedMesh で
  const FOUND_CAP = MAX_OBJECTS * 4;
  const pillarGeo = paint(new THREE.BoxGeometry(1, 1, 1), 0x9a9a9a);
  const foundationMesh = new THREE.InstancedMesh(
    pillarGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
    FOUND_CAP
  );
  foundationMesh.count = 0;
  foundationMesh.castShadow = true;
  foundationMesh.receiveShadow = true;
  foundationMesh.frustumCulled = false;
  foundationMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  foundationMesh.name = 'foundations';
  scene.add(foundationMesh);

  let total = 0;
  const cb = { onChange: null };
  const emit = () => cb.onChange && cb.onChange();

  const _pos = new THREE.Vector3();
  const _scl = new THREE.Vector3();
  const _qY = new THREE.Quaternion();
  const _qTilt = new THREE.Quaternion();
  const _qFull = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _up = new THREE.Vector3(0, 1, 0);

  // --- 岩・木（インスタンス） ---
  function composeInto(type, rec, m) {
    const def = DEFS[type];
    const y = terrain.heightAt(rec.x, rec.z);
    _pos.set(rec.x, y, rec.z);
    _qY.setFromAxisAngle(_up, rec.rotY);
    if (def.tiltK > 0) {
      const n = terrain.normalAt(rec.x, rec.z);
      _qFull.setFromUnitVectors(_up, n);
      _qTilt.identity().slerp(_qFull, def.tiltK);
      _qTilt.multiply(_qY);
    } else {
      _qTilt.copy(_qY);
    }
    _scl.setScalar(def.scale);
    m.compose(_pos, _qTilt, _scl);
  }

  function rebuildInstanced(type) {
    const recs = records[type];
    const mesh = meshes[type];
    for (let i = 0; i < recs.length; i++) {
      composeInto(type, recs[i], _m);
      mesh.setMatrixAt(i, _m);
    }
    mesh.count = recs.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  // --- 家（プレハブのクローン） ---
  function rebuildHouses() {
    // 既存クローンを外す（ジオメトリ/マテリアルは共有なので dispose 不要）
    while (houseContainer.children.length) houseContainer.remove(houseContainer.children[0]);
    const recs = records.house;
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      const clone = buildingKit.getPrefab(rec.variant || 0).clone(true);
      clone.position.set(rec.x, terrain.heightAt(rec.x, rec.z), rec.z);
      clone.rotation.y = rec.rotY; // 家は常に垂直
      clone.userData.recordIndex = i;
      houseContainer.add(clone);
    }
    rebuildFoundations();
  }

  // 家の四隅と真下の地面の隙間を、灰色の柱で埋める（footprint はバリアント依存）
  function rebuildFoundations() {
    const recs = records.house;
    let p = 0;
    for (const rec of recs) {
      const fp = buildingKit.getFootprint(rec.variant || 0);
      const hx = fp.hx * 0.82;
      const hz = fp.hz * 0.82;
      const pw = Math.min(hx, hz) * 0.6;
      const corners = [
        [hx, hz],
        [hx, -hz],
        [-hx, hz],
        [-hx, -hz],
      ];
      const baseY = terrain.heightAt(rec.x, rec.z);
      const cos = Math.cos(rec.rotY);
      const sin = Math.sin(rec.rotY);
      for (const [lx, lz] of corners) {
        const wx = rec.x + lx * cos - lz * sin;
        const wz = rec.z + lx * sin + lz * cos;
        const gap = baseY - terrain.heightAt(wx, wz);
        if (gap <= 0.05) continue;
        const h = gap + 0.06;
        _qY.setFromAxisAngle(_up, rec.rotY);
        _pos.set(wx, baseY - h / 2, wz);
        _scl.set(pw, h, pw);
        _m.compose(_pos, _qY, _scl);
        foundationMesh.setMatrixAt(p++, _m);
        if (p >= FOUND_CAP) break;
      }
      if (p >= FOUND_CAP) break;
    }
    foundationMesh.count = p;
    foundationMesh.instanceMatrix.needsUpdate = true;
  }

  function rebuild(type) {
    if (type === 'house') rebuildHouses();
    else rebuildInstanced(type);
  }

  function rebuildAll() {
    rebuildInstanced('rock');
    rebuildInstanced('tree');
    rebuildHouses();
  }

  // --- 公開API ---
  function place(type, x, z, variant = 0) {
    if (total >= MAX_OBJECTS) return false;
    const rec = { x, z, rotY: 0 };
    if (type === 'house') rec.variant = variant | 0;
    records[type].push(rec);
    total++;
    rebuild(type);
    emit();
    return true;
  }

  function pick(raycaster) {
    let best = null;
    for (const type of INSTANCED) {
      const mesh = meshes[type];
      if (mesh.count === 0) continue;
      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length && hits[0].instanceId != null) {
        if (!best || hits[0].distance < best.distance) {
          best = { type, index: hits[0].instanceId, distance: hits[0].distance };
        }
      }
    }
    // 家（コンテナ内のクローン）
    const hh = raycaster.intersectObject(houseContainer, true);
    if (hh.length) {
      let o = hh[0].object;
      while (o && o.userData.recordIndex === undefined) o = o.parent;
      if (o && (!best || hh[0].distance < best.distance)) {
        best = { type: 'house', index: o.userData.recordIndex, distance: hh[0].distance };
      }
    }
    return best;
  }

  function positionOf(sel) {
    const rec = records[sel.type][sel.index];
    if (!rec) return null;
    return { x: rec.x, y: terrain.heightAt(rec.x, rec.z), z: rec.z };
  }

  function rotate(sel, delta) {
    const rec = records[sel.type][sel.index];
    if (!rec) return;
    rec.rotY += delta;
    rebuild(sel.type);
    emit();
  }

  function remove(sel) {
    const recs = records[sel.type];
    if (sel.index < 0 || sel.index >= recs.length) return;
    recs.splice(sel.index, 1);
    total--;
    rebuild(sel.type);
    emit();
  }

  function serialize() {
    const out = [];
    for (const type of TYPES) {
      for (const rec of records[type]) {
        const o = { type, x: round(rec.x), z: round(rec.z), rotY: round(rec.rotY) };
        if (type === 'house') o.variant = rec.variant || 0;
        out.push(o);
      }
    }
    return out;
  }

  function load(list) {
    for (const type of TYPES) records[type] = [];
    total = 0;
    if (Array.isArray(list)) {
      for (const o of list) {
        if (!TYPES.includes(o.type) || total >= MAX_OBJECTS) continue;
        const rec = { x: o.x, z: o.z, rotY: o.rotY || 0 };
        if (o.type === 'house') rec.variant = o.variant || 0;
        records[o.type].push(rec);
        total++;
      }
    }
    rebuildAll();
  }

  function clear() {
    for (const type of TYPES) records[type] = [];
    total = 0;
    rebuildAll();
    emit();
  }

  function reground() {
    rebuildAll();
  }

  return {
    place,
    pick,
    positionOf,
    rotate,
    remove,
    serialize,
    load,
    clear,
    reground,
    count: () => total,
    MAX: MAX_OBJECTS,
    setOnChange: (fn) => (cb.onChange = fn),
  };
}

// --- 仮の3D素材（岩・木は当面ローポリのまま） -----------------------------

function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function makeRock() {
  const g = new THREE.IcosahedronGeometry(0.55, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 9.1 + y * 4.7) * 0.5 +
      Math.sin(y * 7.3 + z * 5.9) * 0.5 +
      Math.sin(z * 8.5 + x * 3.3) * 0.5;
    const s = 1 + n * 0.22;
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  g.scale(1, 0.82, 1);
  g.translate(0, 0.3, 0);
  g.computeVertexNormals();

  const base = new THREE.Color(0x8a857d);
  const dark = new THREE.Color(0x595550);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const m = 0.5 + 0.5 * Math.sin(pos.getX(i) * 11.0 + pos.getZ(i) * 7.0);
    const t = Math.min(1, Math.max(0, m * 0.7 + y * 0.3));
    arr[i * 3] = lerpN(dark.r, base.r, t);
    arr[i * 3 + 1] = lerpN(dark.g, base.g, t);
    arr[i * 3 + 2] = lerpN(dark.b, base.b, t);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function lerpN(a, b, t) {
  return a + (b - a) * t;
}

function makeTree() {
  const trunk = paint(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 6), 0x6b4a2b);
  trunk.translate(0, 0.4, 0);
  const leaves = paint(new THREE.ConeGeometry(0.6, 1.3, 7), 0x4f9e3a);
  leaves.translate(0, 1.35, 0);
  return mergeGeometries([trunk, leaves]);
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}
