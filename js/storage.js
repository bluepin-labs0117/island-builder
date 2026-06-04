// storage.js
// 島の状態を端末内（localStorage）に保存・復元する。
// 自動保存はデバウンスして、編集連打でも書き込み回数を抑える。

const KEY = 'island-builder-save-v1';

export function loadState() {
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) : null;
  } catch (_) {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (_) {
    /* 容量超過などは黙って無視 */
  }
}

export function clearState() {
  try {
    localStorage.removeItem(KEY);
  } catch (_) {
    /* noop */
  }
}

/**
 * デバウンス付きの自動保存関数を作る。
 * @param {() => object} getState 保存する状態を返す関数
 * @param {number} delay ミリ秒
 */
export function createAutoSaver(getState, delay = 600) {
  let timer = null;
  return function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => saveState(getState()), delay);
  };
}
