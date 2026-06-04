// objects.js
// 設置オブジェクトの管理。種類ごとに InstancedMesh を使い、同じ種類は
// 1ドローコールにまとめて軽量に保つ。
//
// 各レコードは { x, z, rotY } のみ保持し、地面の高さ・傾きは terrain から
// 都度求めて接地する（地形が変わっても破綻しにくい）。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TYPES = ['rock', 'tree', 'house'];
export const MAX_OBJECTS = 300;

// 種類ごとの設定：tiltK=地形の傾きへ沿う度合い（家は0で常に垂直）
const DEFS = {
  rock: { tiltK: 0.7, scale: 1.0 },
  tree: { tiltK: 0.35, scale: 1.0 },
  house: { tiltK: 0.0, scale: 1.0 },
};

/**
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {object} deps.terrain - createTerrain() の戻り値
 */
export function createObjects({ scene, terrain }) {
  const geoms = {
    rock: makeRock(),
    tree: makeTree(),
    house: makeHouse(),
  };

  const meshes = {};
  const records = {}; // type -> [{x,z,rotY}]
  for (const type of TYPES) {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true, // ローポリらしい角張った陰影
    });
    const inst = new THREE.InstancedMesh(geoms[type], mat, MAX_OBJECTS);
    inst.count = 0;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.name = `obj-${type}`;
    meshes[type] = inst;
    records[type] = [];
    scene.add(inst);
  }

  let total = 0;
  const cb = { onChange: null };
  const emit = () => cb.onChange && cb.onChange();

  // 行列合成用の使い回しオブジェクト
  const _pos = new THREE.Vector3();
  const _scl = new THREE.Vector3();
  const _qY = new THREE.Quaternion();
  const _qTilt = new THREE.Quaternion();
  const _qFull = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _up = new THREE.Vector3(0, 1, 0);

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

  function rebuild(type) {
    const recs = records[type];
    const mesh = meshes[type];
    for (let i = 0; i < recs.length; i++) {
      composeInto(type, recs[i], _m);
      mesh.setMatrixAt(i, _m);
    }
    mesh.count = recs.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  function rebuildAll() {
    for (const type of TYPES) rebuild(type);
  }

  // --- 公開API ---

  function place(type, x, z) {
    if (total >= MAX_OBJECTS) return false;
    records[type].push({ x, z, rotY: 0 });
    total++;
    rebuild(type);
    emit();
    return true;
  }

  // レイキャストで最も手前のオブジェクトを拾う
  function pick(raycaster) {
    let best = null;
    for (const type of TYPES) {
      const mesh = meshes[type];
      if (mesh.count === 0) continue;
      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length && hits[0].instanceId != null) {
        if (!best || hits[0].distance < best.distance) {
          best = { type, index: hits[0].instanceId, distance: hits[0].distance };
        }
      }
    }
    return best;
  }

  // 選択オブジェクトのワールド座標（選択リング配置用）
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
        out.push({
          type,
          x: round(rec.x),
          z: round(rec.z),
          rotY: round(rec.rotY),
        });
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
        records[o.type].push({ x: o.x, z: o.z, rotY: o.rotY || 0 });
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

  // 地形が変わった時に接地し直す（必要なら）
  function reground() {
    rebuildAll();
  }

  return {
    meshes: TYPES.map((t) => meshes[t]),
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

// --- 仮の3D素材（ローポリ・頂点カラー） ---------------------------------

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

// 岩：灰色の角張った塊（少し埋まって見えるよう持ち上げる）
function makeRock() {
  const g = new THREE.IcosahedronGeometry(0.55, 0);
  g.scale(1, 0.8, 1);
  g.translate(0, 0.32, 0);
  return paint(g, 0x8a857d);
}

// 木：茶色い幹＋緑の円錐の葉
function makeTree() {
  const trunk = paint(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 6), 0x6b4a2b);
  trunk.translate(0, 0.4, 0);
  const leaves = paint(new THREE.ConeGeometry(0.6, 1.3, 7), 0x4f9e3a);
  leaves.translate(0, 1.35, 0);
  return mergeGeometries([trunk, leaves]);
}

// 家：白っぽい箱＋三角屋根
function makeHouse() {
  const body = paint(new THREE.BoxGeometry(1.0, 0.7, 0.85), 0xece7dc);
  body.translate(0, 0.35, 0);
  const roof = paint(new THREE.ConeGeometry(0.78, 0.55, 4), 0xb24a3a);
  roof.rotateY(Math.PI / 4); // 四角錐を箱に合わせる
  roof.translate(0, 0.98, 0);
  return mergeGeometries([body, roof]);
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}
