# School Stock

神教材製作所の「棚」。先生のための**無料ツール・教材**をおすそ分けする、GitHub Pages 公開用リポジトリ。

- 公開URL：https://a-tozak.github.io/School_Stock/
- 運営：School Stock（外﨑顯博）／ note: https://note.com/tozaki_edu

## 階層設計（増えても迷子にならない形）

```
School_Stock/
├─ index.html              # 棚のトップ（カタログ）。商品が増えたらここに並べる
├─ assets/                 # 共通アセット（ロゴ・OGP・共通CSS 等）
│  └─ brand/
├─ tools/                  # ツール類（1ツール = 1フォルダ）
│  └─ pdf-toolbox/
│     ├─ index.html        # このツールの紹介LP
│     ├─ terms.html        # 利用規約
│     ├─ img/              # LP用画像（公開OK＝自作/CC0/本人 のみ）
│     └─ download/
│        └─ pdf-toolbox.html   # 配布ファイル本体（DL時は「先生のPDF道具箱.html」で保存）
├─ prints/                 # プリント教材（自作・著作権クリアのみ・今後）
└─ .nojekyll               # Pagesで素直に配信する
```

**新しいツールを足すとき**：`tools/<name>/` を1フォルダ作り、`index.html`（LP）・`download/`・`img/` を置き、トップの `index.html` にカードを1枚追加する。
**プリント教材を足すとき**：`prints/<教科>/` に置く（**自作・著作権クリアのみ**）。

## 公開の大原則（著作権ゲート）

**このリポジトリに入れてよいのは、自作・自分が権利を持つ・再配布可ライセンス（CC0/OFL/MIT/Apache等）のものだけ。**
教科書スキャン・市販ドリル・過去問・出版社PDF・児童の写真や名前・学校内部情報・**再配布不可のストック素材（Adobe Stock標準ライセンス等）は入れない**。
（そのため一部のLP画像は `.gitignore` で除外中。CC0へ差し替えたら公開する。）

## クレジット

© School Stock. 各ツールに同梱のOSS・フォントは、それぞれのライセンス（MIT / Apache-2.0 / SIL OFL 等）に従う。
