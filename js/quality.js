// quality.js
// 画質設定（高/中/低）。影の解像度・ピクセル比・AO・水のディテール・露出を
// まとめて切り替える。設定は端末内に保存し、次回も維持する。

const KEY = 'island-builder-quality';

export const LEVELS = ['low', 'medium', 'high'];
export const LABELS = { low: '低', medium: '中', high: '高' };

const PRESETS = {
  high: { pixelRatio: 2.0, shadow: true, shadowSize: 2048, ao: true, waterDetail: 0.7, waterEnv: true, exposure: 1.15 },
  medium: { pixelRatio: 1.5, shadow: true, shadowSize: 1024, ao: true, waterDetail: 0.5, waterEnv: true, exposure: 1.12 },
  low: { pixelRatio: 1.0, shadow: false, shadowSize: 512, ao: false, waterDetail: 0.3, waterEnv: false, exposure: 1.1 },
};

// アンチエイリアスはレンダラー生成時にしか決められないので別途
export function antialiasFor(level) {
  return level !== 'low';
}

export function loadQuality() {
  try {
    const v = localStorage.getItem(KEY);
    return LEVELS.includes(v) ? v : null;
  } catch (_) {
    return null;
  }
}

export function saveQuality(level) {
  try {
    localStorage.setItem(KEY, level);
  } catch (_) {
    /* noop */
  }
}

// 端末性能から初期値を推定（保存があればそれを優先）
export function getInitialQuality() {
  const saved = loadQuality();
  if (saved) return saved;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  if (!mobile && cores >= 8) return 'high';
  if (mem >= 4 && cores >= 6) return 'high';
  if (cores <= 4 || mem <= 2) return 'low';
  return 'medium';
}

/**
 * 画質を適用する。
 * @param {string} level
 * @param {object} refs - { renderer, scene, sun, terrain, sea }
 */
export function applyQuality(level, refs) {
  const p = PRESETS[level] || PRESETS.medium;
  const { renderer, scene, sun, terrain, sea, env } = refs;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatio));
  renderer.toneMappingExposure = p.exposure;

  const shadowChanged = renderer.shadowMap.enabled !== p.shadow;
  renderer.shadowMap.enabled = p.shadow;
  sun.castShadow = p.shadow;
  if (p.shadow) {
    sun.shadow.mapSize.set(p.shadowSize, p.shadowSize);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null; // 解像度変更を反映するため作り直す
    }
  }

  terrain.setAO(p.ao);
  terrain.setWaterDetail(p.waterDetail);
  sea.setDetail(p.waterDetail);

  // 水面の空反射（envMap）。低画質では無効化して軽く。
  const waterEnv = p.waterEnv ? env || null : null;
  terrain.setWaterEnv(waterEnv);
  sea.setEnv(waterEnv);

  // 影の有効/無効を切り替えたらシェーダの再コンパイルが必要
  if (shadowChanged && scene) {
    scene.traverse((o) => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.needsUpdate = true;
    });
  }
}
