// ui.js
// 画面上の操作UIを組み立てる：
//  - モード切替（カメラ操作 / 地形編集 / 設置）＋ リセット
//  - 地形編集パネル：ツール（盛る/掘る/ならす）＋ スライダー2つ
//  - 設置パネル：オブジェクトのパレット（岩/木/家）＋ 選択中の操作（回転/削除）
//  - 通知トースト
// スタイルは index.html の CSS（クラス名）を使う。

const MODES = [
  { id: 'camera', label: '🎥 カメラ' },
  { id: 'edit', label: '✏️ 地形' },
  { id: 'place', label: '🌲 設置' },
];

const TOOLS = [
  { id: 'raise', label: '⛰ 盛る' },
  { id: 'lower', label: '⛏ 掘る' },
  { id: 'smooth', label: '🪵 ならす' },
  { id: 'water', label: '💧 水' },
  { id: 'paint', label: '🎨 地表' },
];

const MATERIALS = [
  { id: 'grass', label: '🌱 草' },
  { id: 'sand', label: '🏖 砂' },
  { id: 'rock', label: '🪨 岩' },
  { id: 'snow', label: '❄️ 雪' },
];

const PALETTE = [
  { id: 'rock', label: '🪨 岩' },
  { id: 'tree', label: '🌳 木' },
  { id: 'house', label: '🏠 家' },
];

export function createUI(opts) {
  const root = document.createElement('div');
  root.id = 'ui';

  // ===== 上部バー：モード切替 ＋ リセット =====
  const topbar = document.createElement('div');
  topbar.className = 'topbar';

  const modeSeg = document.createElement('div');
  modeSeg.className = 'mode-seg';
  let mode = 'camera';
  const modeBtns = MODES.map((m) => {
    const b = document.createElement('button');
    b.className = 'ui-btn seg-btn';
    b.textContent = m.label;
    b.dataset.mode = m.id;
    b.addEventListener('click', () => setMode(m.id));
    modeSeg.appendChild(b);
    return b;
  });

  const resetBtn = document.createElement('button');
  resetBtn.className = 'ui-btn reset-btn';
  resetBtn.textContent = '🗑 リセット';
  resetBtn.addEventListener('click', () => opts.onReset());

  topbar.append(modeSeg, resetBtn);

  // ===== 地形編集パネル =====
  const editPanel = document.createElement('div');
  editPanel.className = 'panel edit-panel hidden';

  const toolRow = document.createElement('div');
  toolRow.className = 'btn-row';
  const toolBtns = TOOLS.map((t) => {
    const b = document.createElement('button');
    b.className = 'ui-btn chip-btn';
    b.textContent = t.label;
    b.dataset.tool = t.id;
    b.addEventListener('click', () => {
      setActive(toolBtns, 'tool', t.id);
      // 「地表」ツールのときだけ材質サブパレットを表示
      matRow.classList.toggle('hidden', t.id !== 'paint');
      opts.onTool(t.id);
    });
    toolRow.appendChild(b);
    return b;
  });

  // ペイント材質サブパレット（地表ツール選択時のみ表示）
  const matRow = document.createElement('div');
  matRow.className = 'btn-row mat-row hidden';
  const matBtns = MATERIALS.map((mt) => {
    const b = document.createElement('button');
    b.className = 'ui-btn chip-btn';
    b.textContent = mt.label;
    b.dataset.mat = mt.id;
    b.addEventListener('click', () => {
      setActive(matBtns, 'mat', mt.id);
      opts.onPaintMaterial(mt.id);
    });
    matRow.appendChild(b);
    return b;
  });

  const sliders = document.createElement('div');
  sliders.className = 'sliders';
  sliders.appendChild(
    makeSlider('ブラシの幅', opts.radiusRange, opts.radius, 0.1, opts.onRadius, (v) =>
      v.toFixed(1)
    )
  );
  sliders.appendChild(
    makeSlider('ブラシの強さ', opts.strengthRange, opts.strength, 0.01, opts.onStrength, (v) =>
      v.toFixed(2)
    )
  );
  editPanel.append(toolRow, matRow, sliders);

  // ===== 設置パネル =====
  const placePanel = document.createElement('div');
  placePanel.className = 'panel place-panel hidden';

  const paletteRow = document.createElement('div');
  paletteRow.className = 'btn-row';
  const palBtns = PALETTE.map((p) => {
    const b = document.createElement('button');
    b.className = 'ui-btn chip-btn';
    b.textContent = p.label;
    b.dataset.pal = p.id;
    b.addEventListener('click', () => {
      setActive(palBtns, 'pal', p.id);
      opts.onPalette(p.id);
    });
    paletteRow.appendChild(b);
    return b;
  });

  const selRow = document.createElement('div');
  selRow.className = 'btn-row sel-row hidden';
  const rotBtn = document.createElement('button');
  rotBtn.className = 'ui-btn chip-btn';
  rotBtn.textContent = '↻ 回転';
  rotBtn.addEventListener('click', () => opts.onRotate());
  const delBtn = document.createElement('button');
  delBtn.className = 'ui-btn chip-btn danger';
  delBtn.textContent = '🗑 削除';
  delBtn.addEventListener('click', () => opts.onDelete());
  selRow.append(rotBtn, delBtn);

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = '地面をタップで設置 / 置いた物をタップで選択';

  placePanel.append(paletteRow, selRow, hint);

  // ===== トースト =====
  const toastEl = document.createElement('div');
  toastEl.className = 'toast hidden';

  root.append(topbar, editPanel, placePanel, toastEl);
  document.body.appendChild(root);

  // ===== 動作 =====
  function setActive(btns, key, id) {
    btns.forEach((b) => b.classList.toggle('active', b.dataset[key] === id));
  }

  function setMode(m) {
    mode = m;
    modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    editPanel.classList.toggle('hidden', m !== 'edit');
    placePanel.classList.toggle('hidden', m !== 'place');
    opts.onMode(m);
  }

  function setSelected(on) {
    selRow.classList.toggle('hidden', !on);
    hint.textContent = on
      ? '回転・削除できます / 別の場所をタップで設置'
      : '地面をタップで設置 / 置いた物をタップで選択';
  }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2200);
  }

  // 初期表示（コールバックは呼ばず見た目だけ整える。実際のモード適用は main 側）
  setActive(toolBtns, 'tool', 'raise');
  setActive(matBtns, 'mat', 'grass');
  setActive(palBtns, 'pal', 'tree');
  modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === 'camera'));
  editPanel.classList.add('hidden');
  placePanel.classList.add('hidden');

  return { setMode, setSelected, toast };
}

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
