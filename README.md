# island-builder

3D の島づくり箱庭ゲーム（Three.js 製）。ビルドツール不要で、`index.html` を開くだけで動きます。

## 現在の状態（フェーズ1）

- 画面いっぱいの 3D シーン
- 青い海（広い水面）の上に、中央のローポリ風・平らな島（砂浜＋緑）
- 斜め見下ろしのカメラ
- タッチ操作
  - 1本指ドラッグ：視点回転
  - 2本指ピンチ：ズーム
  - PC：左ドラッグで回転 / マウスホイールでズーム
- やわらかい光（環境光＋平行光1つ）、影なしで軽量

地形編集や設置などの機能は今後のフェーズで追加予定です。

## ファイル構成

```
index.html      … エントリ。Three.js を CDN（importmap）で読み込む
js/main.js      … 各モジュールを組み立てて描画ループを回す
js/scene.js     … レンダラー / カメラ / シーン / 海 / ライト
js/island.js    … 中央の島の生成
js/controls.js  … タッチ・マウスでのカメラ操作
```

## ローカルで開く方法

ES Modules と importmap を使っているため、`file://` で直接開くと
ブラウザのセキュリティ制限で動かない場合があります。簡易サーバー経由で開いてください。

Python があれば：

```bash
# このフォルダ（island-builder）の中で実行
python3 -m http.server 8000
```

ブラウザで http://localhost:8000 を開きます。

Node.js 派なら：

```bash
npx serve .
```

## GitHub Pages で見る方法

1. このリポジトリを GitHub に push する
2. GitHub のリポジトリ → **Settings** → **Pages**
3. **Build and deployment** の **Source** を **Deploy from a branch** にする
4. Branch を `main`（または公開したいブランチ）の `/ (root)` に設定して **Save**
5. 数十秒〜数分後に表示される URL（`https://<ユーザー名>.github.io/island-builder/`）を開く

CDN から Three.js を読み込むので、追加のビルド作業は不要です。

## 動作環境

- インターネット接続（Three.js を CDN から取得するため）
- 最近のスマホ／PC のブラウザ（WebGL 対応）
