// ui.js
// 画面上の操作UIを組み立てる：
//  - モード切替ボタン（カメラ操作 / 地形編集）
//  - ツール（盛る / 掘る / ならす）
//  - スライダー2つ（ブラシの幅・強さ）
// スタイルは index.html の CSS（クラス名）を使う。

const TOOLS = [
  { id: 'raise', label: '⛰ 盛る' },
  { id: 'lower', label: '⛏ 掘る' },
  { id: 'smooth', label: '🪵 ならす' },
];

/**
 * @param {object} opts
 * @param {number} opts.radius 初期ブラシ半径
 * @param {number} opts.strength 初期ブラシ強さ
 * @param {[number,number]} opts.radiusRange [min,max]
 * @param {[number,number]} opts.strengthRange [min,max]
 * @param {(mode:'camera'|'edit')=>void} opts.onMode
 * @param {(tool:string)=>void} opts.onTool
 * @param {(v:number)=>void} opts.onRadius
 * @param {(v:number)=>void} opts.onStrength
 */
export function createUI(opts) {
  const root = document.createElement('div');
  root.id = 'ui';

  // --- モード切替ボタン（常に表示） ---
  let mode = 'camera';
  const modeBtn = document.createElement('button');
  modeBtn.className = 'ui-btn mode-btn';

  // --- 編集パネル（編集モード中だけ表示） ---
  const panel = document.createElement('div');
  panel.className = 'edit-panel hidden';

  // ツール
  const toolRow = document.createElement('div');
  toolRow.className = 'tool-row';
  const toolBtns = TOOLS.map((t) => {
    const b = document.createElement('button');
    b.className = 'ui-btn tool-btn';
    b.textContent = t.label;
    b.dataset.tool = t.id;
    b.addEventListener('click', () => {
      setTool(t.id);
      opts.onTool(t.id);
    });
    toolRow.appendChild(b);
    return b;
  });

  function setTool(id) {
    toolBtns.forEach((b) => b.classList.toggle('active', b.dataset.tool === id));
  }
  setTool('raise');

  // スライダー作成ヘルパー
  function makeSlider(labelText, [min, max], value, step, onInput, fmt) {
    const wrap = document.createElement('div');
    wrap.className = 'slider-row';

    const label = document.createElement('span');
    label.className = 'slider-label';
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    const val = document.createElement('span');
    val.className = 'slider-val';
    val.textContent = fmt(value);

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      val.textContent = fmt(v);
      onInput(v);
    });

    wrap.append(label, input, val);
    return wrap;
  }

  const sliders = document.createElement('div');
  sliders.className = 'sliders';
  sliders.appendChild(
    makeSlider(
      'ブラシの幅',
      opts.radiusRange,
      opts.radius,
      0.1,
      opts.onRadius,
      (v) => v.toFixed(1)
    )
  );
  sliders.appendChild(
    makeSlider(
      'ブラシの強さ',
      opts.strengthRange,
      opts.strength,
      0.01,
      opts.onStrength,
      (v) => v.toFixed(2)
    )
  );

  panel.append(toolRow, sliders);

  // モード切替
  function setMode(m) {
    mode = m;
    if (m === 'edit') {
      modeBtn.textContent = '🎥 カメラに戻る';
      modeBtn.classList.add('editing');
      panel.classList.remove('hidden');
    } else {
      modeBtn.textContent = '✏️ 地形を編集';
      modeBtn.classList.remove('editing');
      panel.classList.add('hidden');
    }
    opts.onMode(m);
  }
  modeBtn.addEventListener('click', () => {
    setMode(mode === 'edit' ? 'camera' : 'edit');
  });
  setMode('camera');

  root.append(modeBtn, panel);
  document.body.appendChild(root);

  return { setMode, setTool };
}
