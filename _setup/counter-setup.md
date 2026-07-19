# School Stock アクセスカウンター 設定手順

サイトの「見られた数」と「ダウンロードされた数（＝人気素材）」を測るしくみです。
コード側は全部できています。**あなたがやるのは Supabase を用意してキーを2つ貼るだけ**です。
（Cookieなし・個人情報なし・無料枠で十分）

## やること（10分ほど）

### 1. Supabase のプロジェクトを作る
- https://supabase.com にアクセス → GitHubアカウントでサインアップ/ログイン
- 「New project」→ 名前（例: school-stock）とパスワードを決めて作成
- できるまで1〜2分待つ

### 2. SQLを貼って実行
- 左メニュー **SQL Editor** → 新規クエリ
- このフォルダの **`counter-setup.sql`** の中身を丸ごと貼り付け → **Run**
- 「Success」と出ればOK

### 3. キーを2つコピーして貼る
- 左メニュー **Project Settings → API**
- 次の2つをコピー：
  - **Project URL**（例: `https://abcdefgh.supabase.co`）
  - **anon public** キー（`eyJ...` で始まる長い文字列）
- `assets/counter-config.js` を開いて、この2つを貼る：
  ```js
  window.SS_COUNTER = {
    url: "ここにProject URL",
    key: "ここにanon public キー"
  };
  ```
  ※ anon public キーは公開して大丈夫な種類です（RLSで守っています。service_role キーは絶対に貼らない）

### 4. commit & push
- 変更した `counter-config.js` を push（数分でサイトに反映）
- これで計測開始。以後どのページでも自動でカウントします

## 見る場所

- 集計ページ：**https://a-tozak.github.io/School_Stock/stats/**
  - よくダウンロードされた素材ランキング
  - よく見られたページ
  - のべ表示数・のべダウンロード数
- このページは検索に出ない設定（noindex）で、メニューにも載せていません。URLを知っている人だけ見られます

## 仕組み（かんたんに）

- `assets/counter.js` … 全ページに読み込み済み。ページ表示とダウンロード（保存ボタン）を1回ずつ数える
- `assets/counter-config.js` … あなたがキーを貼るファイル（ここだけ触ればいい）
- Supabaseの `counts` テーブルに「key（住所）」と「n（回数）」だけ貯まる
- 書き込みは `bump()` 関数だけ・読み取りは数字だけ公開 → 荒らされにくい

困ったら「counterの設定でつまずいた」と言ってください。一緒に直します。
