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
  { id: 'trench', label: '〰️ 溝' },
  { id: 'smooth', label: '🪵 ならす' },
  { id: 'source', label: '💧 水源' },
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

  // 右上：画質切替（タップで 低→中→高 を循環）＋ リセット
  const rightBox = document.createElement('div');
  rightBox.className = 'right-box';

  const QLEVELS = ['low', 'medium', 'high'];
  const QLABELS = { low: '低', medium: '中', high: '高' };
  let quality = opts.quality || 'medium';
  const qualityBtn = document.createElement('button');
  qualityBtn.className = 'ui-btn quality-btn';
  const updateQualityLabel = () => {
    qualityBtn.textContent = `画質:${QLABELS[quality]}`;
  };
  updateQualityLabel();
  qualityBtn.addEventListener('click', () => {
    const next = QLEVELS[(QLEVELS.indexOf(quality) + 1) % QLEVELS.length];
    quality = next;
    updateQualityLabel();
    opts.onQuality(next);
  });

  const resetBtn = document.createElement('button');
  resetBtn.className = 'ui-btn reset-btn';
  resetBtn.textContent = '🗑 リセット';
  resetBtn.addEventListener('click', () => opts.onReset());

  rightBox.append(qualityBtn, resetBtn);
  topbar.append(modeSeg, rightBox);

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
      // 「地表」ツールのときだけ材質サブパレット、「水源」のとき全消しを表示
      matRow.classList.toggle('hidden', t.id !== 'paint');
      srcRow.classList.toggle('hidden', t.id !== 'source');
      srcHint.classList.toggle('hidden', t.id !== 'source');
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

  // 水源サブ操作（水源ツール選択時のみ表示）
  const srcRow = document.createElement('div');
  srcRow.className = 'btn-row src-row hidden';
  const srcHint = document.createElement('div');
  srcHint.className = 'hint';
  srcHint.textContent = 'タップで水源を置く／同じ所を再タップで削除';
  const srcClearBtn = document.createElement('button');
  srcClearBtn.className = 'ui-btn chip-btn danger';
  srcClearBtn.textContent = '🚱 水源を全消し';
  srcClearBtn.addEventListener('click', () => opts.onClearSources());
  srcRow.append(srcClearBtn);

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
  editPanel.append(toolRow, matRow, srcRow, srcHint, sliders);
  srcHint.classList.add('hidden');

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
      houseRow.classList.toggle('hidden', p.id !== 'house'); // 家のときだけ種類選択
      opts.onPalette(p.id);
    });
    paletteRow.appendChild(b);
    return b;
  });

  // 家の種類サブパレット（家選択時のみ表示）
  const HOUSES = [
    { id: 0, label: '🏠 家1' },
    { id: 1, label: '🏠 家2' },
    { id: 2, label: '🏠 家3' },
  ];
  const houseRow = document.createElement('div');
  houseRow.className = 'btn-row house-row hidden';
  const houseBtns = HOUSES.map((h) => {
    const b = document.createElement('button');
    b.className = 'ui-btn chip-btn';
    b.textContent = h.label;
    b.dataset.house = String(h.id);
    b.addEventListener('click', () => {
      setActive(houseBtns, 'house', String(h.id));
      opts.onHouseVariant(h.id);
    });
    houseRow.appendChild(b);
    return b;
  });
  // 設置の向き（家を置く前に90度ずつ回す／家を選択中ならその家を回す）
  const orientBtn = document.createElement('button');
  orientBtn.className = 'ui-btn chip-btn';
  orientBtn.textContent = '↻ 向き 0°';
  orientBtn.addEventListener('click', () => {
    const deg = opts.onRotateHouse();
    orientBtn.textContent = `↻ 向き ${deg}°`;
  });
  houseRow.appendChild(orientBtn);

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

  placePanel.append(paletteRow, houseRow, selRow, hint);

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
  setActive(houseBtns, 'house', '0');
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
