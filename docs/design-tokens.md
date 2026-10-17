# デザイントークンと部品の決まり（新しい見た目 v2）

- 状態：段階0・1 実装済み（2026-10-16）。新しい見た目は `?ui=v2` のときだけ効く。既定は今の見た目（v1）のまま
- 正：**`css/tokens.css`（トークン）**と **`css/ui2.css`（v2 の見た目）**。値を変えるときはこの2つだけを直す
- 方針の元：[ui-audit.md](ui-audit.md) §3（デザイン方針）・§4（改善計画）、[ui-ux.md](ui-ux.md) の U8「味方・落ち着き・確か」、決定 U9〜U11（[decisions.md](decisions.md)）
- テスト：`tests/ui_flags.test.mjs`（切り替えの判定、v2 の CSS が v1 に効かないこと、色のコントラスト、アイコン）

---

## 1. 仕組み

```
index.html の <head> の先頭
  <html data-ui-default="v1">         … 既定の版
  <script>（小さな同期スクリプト）       … URL の ?ui= と ?dev= を読み、<html data-ui="v1|v2" data-dev="1"> を付ける
  css/tokens.css                       … トークンの定義だけ（どの要素の見た目も書かない）
  css/style.css・css/consult.css       … 今の見た目（v1）。古い変数名（--paper・--ink など）で書かれている
  css/ui2.css                          … 新しい見た目（v2）。セレクタはすべて :root[data-ui="v2"] の下
```

- **v1 には何も効かない**：`tokens.css` は変数を定義するだけで、v1 の CSS はその変数名を使っていない（名前が重なるのは `--gutter` だけで、`style.css` の `:root` が 16px に上書きする）。`ui2.css` はすべて `:root[data-ui="v2"]` の下なので、`data-ui="v1"` では1つも当たらない（テストで確かめている）
- **v2 は2段で効く**：
  1. `ui2.css` §1 で、古い変数名を役割のトークンに結び直す（下の §7 の表）。これだけで全画面の色と書体が新しくなる
  2. `ui2.css` §2〜§9 で、部品（ボタン・カード・チップ・入力欄・タブ）と文字の大きさを上書きする。DOM の構造は変えない
- **判定**は `js/ui_flags.js` の `resolveUiFlags(search, defaultUi)` → `{ ui, dev, fb }`。`index.html` のスクリプトと同じ判定（テストで `index.html` のスクリプトを実際に走らせて比べている）。localStorage には保存しない（URL だけで決める）
- タブの移動（`#three` ↔ `#consult` など）はハッシュだけを変えるので、`?ui=` `?dev=` は残る。足元の「旧版（5択）」（`./?five=1`）は、開いたときに `?ui=` `?dev=` を引き継ぐ（`js/app.js`、`keepUiParams`）

### 既定を v2 に切り替える・戻す

1. `index.html` の `<html data-ui-default="v1">` を `"v2"` にする
2. `js/ui_flags.js` の `DEFAULT_UI` も `"v2"` にする（2つが食い違うとテストが落ちる）
3. 既定を変えたあとも、`?ui=v1` でいつでも今の見た目に戻せる（`?ui=v2` で新しい見た目を強制）

## 2. 色

役割の値だけを画面で使う。ライト／ダークは `@media (prefers-color-scheme: dark)` で役割の値だけを切り替える。コントラストは WCAG 2.x の計算式で実測した値（`tests/ui_flags.test.mjs` が毎回確かめる）。

| 役割（`--color-…`） | ライト | ダーク | 使いどころ |
| --- | --- | --- | --- |
| `bg` | `#F6F4F0` 紙（暖かい中立） | `#121319` | ページの背景。絵の生成り・灰色となじむ（U11） |
| `surface` | `#FFFFFF` | `#1B1D25` | カード・入力欄・ボタンの面 |
| `surface-2` | `#EEEAE4` | `#252833` | 入れ子の面（注記、誤解しやすい点など） |
| `text` | `#1F2230` | `#ECEDF2` | 本文 |
| `text-2` | `#474C5E` | `#C5C8D4` | 補助の文 |
| `muted` | `#5F6475` | `#9EA2B2` | 控えめな文（注記・件数） |
| `primary` | `#26304F` 夜の藍 | `#C9D3F5` | 主ボタン、選択中、進み具合、強調カードの枠 |
| `primary-hover` | `#1A2240` | `#B3C1F0` | 主ボタンにカーソルを載せたとき |
| `primary-soft` | `#E7EAF3` | `#262D45` | 選んだ選択肢の面、相談の答えの見出しの面 |
| `on-primary` | `#FFFFFF` | `#151A2E` | 主色の上の文字 |
| `accent` | `#A8466F` 紅梅 | `#E79BBA` | 特別な強調の小さな印（「次の一手」の見出し）。1画面に1か所まで |
| `accent-soft` | `#F7E8EE` | `#3D2431` | 差し色の淡い面（今は未使用） |
| `divider` | `#E3DED6` | `#2E313C` | 区切り（飾りの線・カードの枠）。押せる部品には使わない |
| `control-border` | `#868A99` | `#7D8295` | 押せる部品の枠（ボタン・チップ・入力欄・選択肢） |
| `error` / `error-soft` | `#B3261E` / `#FBE6E4` | `#F28E84` / `#43221F` | 入力の誤り |
| `success` / `success-soft` | `#2C7349` / `#E2F1E7` | `#7FCC9E` / `#1D3527` | うまくいった知らせ（届きやすさ「高」など） |
| `warn` / `warn-soft` | `#7F5600` / `#F8EED8` | `#E5BC60` / `#3A2F17` | 注意（推定・時間の目安・低い届きやすさ） |
| `safety-bg` | `#FBEDEE` | `#3A2228` | 安全の面（危ないサイン、窓口の案内）。文字は本文色 |
| `data-a` / `data-a-soft` | `#2E5E8C` / `#E3EBF4` | `#8AB2DE` / `#21304A` | 診断の A 側。領域の両側を表すときだけ（操作の色には使わない） |
| `data-b` / `data-b-soft` | `#A3456F` / `#F6E4EC` | `#E391B6` / `#40243A` | 診断の B 側。同上 |
| `focus` | `#3E56B8` | `#9FB1F2` | キーボード操作のフォーカスの輪 |

基本の値（`--c-indigo-900` など）は `tokens.css` の先頭にある。役割の値はそれを指すだけにして、画面の CSS からは基本の値を直接使わない。

### コントラストの実測

文字（目標 4.5:1 以上）。値は「背景 bg ／ 面 surface ／ 面2 surface-2」の順。

| 文字の色 | ライト | ダーク |
| --- | --- | --- |
| `text` | 14.38 / 15.79 / 13.18 | 15.86 / 14.38 / 12.56 |
| `text-2` | 7.76 / 8.53 / 7.11 | 11.11 / 10.08 / 8.80 |
| `muted` | 5.36 / 5.89 / 4.91 | 7.30 / 6.62 / 5.78 |
| `accent` | 5.07 / 5.57 / 4.65 | 8.65 / 7.84 / 6.85 |
| `error` | 5.95 / 6.54 / 5.45 | 7.92 / 7.19 / 6.28 |
| `success` | 5.23 / 5.74 / 4.79 | 9.74 / 8.83 / 7.72 |
| `warn` | 5.91 / 6.49 / 5.42 | 10.32 / 9.36 / 8.18 |
| `data-a` | 6.17 / 6.78 / 5.66 | 8.39 / 7.61 / 6.65 |
| `data-b` | 5.25 / 5.77 / 4.82 | 7.94 / 7.20 / 6.29 |

組み合わせ（文字 4.5:1 以上）。

| 文字 / 面 | ライト | ダーク |
| --- | --- | --- |
| `on-primary` / `primary` | 12.98 | 11.58 |
| `on-primary` / `primary-hover` | 15.59 | 9.68 |
| `text` / `primary-soft` | 13.13 | 11.64 |
| `muted` / `primary-soft` | 4.90 | 5.35 |
| `accent` / `accent-soft` | 4.70 | 6.55 |
| `error` / `error-soft` | 5.46 | 6.04 |
| `success` / `success-soft` | 4.92 | 6.94 |
| `warn` / `warn-soft` | 5.63 | 7.31 |
| `data-a` / `data-a-soft` | 5.64 | 5.99 |
| `data-b` / `data-b-soft` | 4.74 | 5.87 |
| `text` / `safety-bg` | 13.87 | 12.48 |
| `muted` / `safety-bg` | 5.17 | 5.74 |

部品の枠・フォーカス（目標 3:1 以上）。値は「bg ／ surface ／ surface-2」。

| 線の色 | ライト | ダーク |
| --- | --- | --- |
| `control-border` | 3.13 / 3.44 / **2.87** | 4.85 / 4.40 / 3.85 |
| `focus` | 5.92 / 6.51 / 5.43 | 8.87 / 8.04 / 7.02 |
| `primary`（選んだ印の枠） | 11.81 / 12.98 / 10.83 | 12.46 / 11.30 / 9.87 |
| `divider`（飾り。基準の対象外） | 1.22 / 1.34 / 1.12 | 1.43 / 1.30 / 1.13 |

- **注意**：ライトの `control-border` は面2（`#EEEAE4`）の上だけ 2.87:1 で、3:1 に届かない（[ui-audit.md](ui-audit.md) §3.2 の値のまま）。そのため**押せる部品を面2の上に置くときは、部品の中を面（`surface`）で塗る**（今の画面はすべてそうなっている。例：テスト協力の同意の箱の中のチェック・入力欄）。面2の上に枠だけの部品を置く必要が出たら、`--c-ink-400` を `#82869A`（面2の上で 3.01:1）に下げる
- 安全の面（`safety-bg`）の上の部品の枠は 3.02（ライト）・3.82（ダーク）

## 3. 文字

| トークン | 値 | 使いどころ |
| --- | --- | --- |
| `--font-sans` | system-ui, Hiragino Sans, Noto Sans JP ほか | 書体は**ゴシック1つ**。v2 では `--serif` もこれに結ぶ（明朝は使わない） |
| `--font-mono` | ui-monospace ほか | 参加者コード・送信用テキスト・開発用の表示 |
| `--fs-12` | 12px | 注記、札（タグ） |
| `--fs-14` | 14px | 補助、ボタン（小）、表 |
| `--fs-16` | 16px | 本文、ボタン、入力欄 |
| `--fs-18` | 18px | 小見出し、質問の選択肢（PC） |
| `--fs-22` | 22px | 見出し |
| `--fs-28` | 28px | 画面の題 |
| `--lh-body` / `--lh-head` | 1.7 / 1.4 | 本文 / 見出しの行間 |
| `--fw-regular` / `--fw-bold` | 400 / 700 | 太さは2つだけ（600・800 は 700 にする） |

- v1 の CSS にある細かい文字サイズ（`.78rem`・`.84rem` など 45種類）は、`ui2.css` §3 で近い段階に置き換えている（元の並び・`@media` のまま書いてあるので、勝ち負けは元と同じ）。元の CSS で文字の大きさを足したら、§3 にも同じセレクタで段階を足す
- PC で見出しを一段大きくする案（[ui-audit.md](ui-audit.md) §3.3）は、段階を増やさないため今回は入れていない

## 4. 余白・形・影・動き・レイアウト

| 種類 | トークン | 値 |
| --- | --- | --- |
| 余白（4px 単位の7段階） | `--space-1`〜`--space-7` | 4 / 8 / 12 / 16 / 24 / 32 / 48px |
| 角丸 | `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-pill` | 8（タグ・小さな部品）/ 12（ボタン・入力欄）/ 16（カード・絵）/ 999px（チップ） |
| 線の太さ | `--border-w` / `--border-w-strong` | 1px（カード・チップ・入力欄）/ 1.5px（副ボタン・強調カード） |
| 影（1段だけ） | `--shadow-float` | トーストと下から出る面だけ。カードには使わず、1px の枠で面を分ける |
| 動き | `--dur-fast` / `--dur` / `--ease` | 150ms / 250ms / ease-out。「動きを減らす」設定では 0ms |
| 本文の最大幅 | `--content-max` | 720px（ヘッダーと足元も同じ幅にそろえる） |
| 画面の左右の余白 | `--gutter`（`--gutter-mobile` / `--gutter-wide`） | 16px / PC（641px 以上）24px |
| 押せる大きさ | `--tap` | 44px（これより小さい押せる部品を作らない。文中のリンクは除く） |
| ボタン・入力欄の高さ | `--btn-h` / `--btn-h-primary` / `--textarea-min-h` | 48px / 52px / 120px |

## 5. 部品のルール（v2）

| 部品 | ルール | 主なクラス |
| --- | --- | --- |
| 主ボタン | 主色の塗り、文字は主色の上の色、高さ 52px、角丸 12、太字。**1画面に1つ** | `.btn.primary` |
| 副ボタン | 面の色、枠 1.5px（部品の枠の色）、高さ 48px、角丸 12 | `.btn`、`.btn.ghost`（面なし）、`.btn.small`（高さ 44px） |
| 文字リンク | 押せる範囲は高さ 44px | `.linkish`、`.t3-tip-close`、`.cs-back a` |
| カード | 面の色＋枠 1px（区切りの色）＋角丸 16＋内側 16px（PC 24px）。**種類は3つだけ**：ふつう／強調（主色の枠 1.5px：主軸の解釈・相談の答え）／安全（安全の面：危ないサイン・安全の案内）。**左の太線・グラデーション・影は使わない** | `.q-card`・`.pcard`・`.cs-step`・`.resume`・`.cs-answer`・`.cs-danger` ほか |
| チップ（選択肢） | 高さ 44px 以上、枠 1px（部品の枠の色）、角丸は丸。選ぶと主色の塗り＋**チェックの印**（色だけに頼らない） | `.cs-opt`・`.fb-pill`・`.fb-chip`・`.fb-yn-btn` |
| 行の選択肢 | チェック・ラジオ・スイッチの行は高さ 48px 以上、枠は部品の枠の色、選ぶと主色の枠 2px | `.check`・`.cs-radio`・`.cs-toggle` |
| 入力欄 | 高さ 48px 以上（文章は 120px 以上）、枠は部品の枠の色、フォーカス時は主色の 2px の輪 | `.cs-input`・`.cs-textarea`・`.fb-input`・`.fb-textarea`・`select` |
| タブ・ヘッダーのリンク | 高さ 44px 以上。選んでいるタブは主色の下線、ヘッダーのリンクは主色の塗り | `.t3-subnav button`・`.tabs a`・`.head-link` |
| 進み具合 | 細いバー（4px）1本、主色 | `.progress` |
| フォーカス | `--color-focus` の 2px の輪（離して 2px） | `:focus-visible` |
| アイコン | 線のアイコン1種類（下の §6） | `.icon` |
| トースト | 本文色の面＋紙の色の文字、角丸 12、影1段 | `.toast` |

質問カードの作り直し（段階2）・結果画面の作り直し（段階3）・相談の流れ（段階4）は、この部品を使って次の担当が行う。

## 6. アイコン

- `img/icons.svg` に `<symbol>` で置く（このサイト用に描いた線のアイコン。外部のアイコン集は使わない）。viewBox 24、線の太さ 1.5、塗りなし、色は `currentColor`（使う側の文字色）
- 名前：`arrow-left`（左）・`arrow-right`（右）・`arrow-up`（上）・`chevron-down`（下向きの山形）・`check`（チェック）・`close`（閉じる）・`info`（情報）・`alert`（注意・安全）・`copy`（コピー）・`redo`（やり直し）
- 使い方：`js/ui/dom.js` の `icon(name, { size = 20 })` が `<svg class="icon icon-<name>" aria-hidden="true"><use href="img/icons.svg#<name>"></use></svg>` を返す。飾りなので読み上げない（意味はボタンの文字で伝える）。大きさは 20 か 24
- 足すとき：`icons.svg` に `<symbol id>` を足し、`dom.js` の `ICON_NAMES` にも足す（一致しないとテストが落ちる）
- 今は部品を用意しただけで、画面の矢印（← → ↑）の置き換えは段階2・3で行う

## 7. 古い変数名との対応（v2 で結び直すもの。`ui2.css` §1）

| 古い変数名（style.css・consult.css） | v2 で結ぶ役割の値 | メモ |
| --- | --- | --- |
| `--paper` | `--color-bg` | |
| `--surface` | `--color-surface` | |
| `--surface-2` | `--color-surface-2` | |
| `--ink` | `--color-text` | 塗りの部品（主ボタン・選んだチップ・進み具合など）は §5 で `--color-primary` に個別に上書き |
| `--ink-2` | `--color-text-2` | |
| `--muted` | `--color-muted` | |
| `--line` | `--color-divider` | 飾りの線。押せる部品の枠に使っていた箇所（`.check`・`.cs-radio`・`.cs-toggle`・`.fb-chip`）は個別に `--color-control-border` |
| `--line-strong` | `--color-control-border` | ほとんどが部品の枠。飾りの破線などに使っていた箇所（`.why`・`.cs-draft + .cs-draft` など）は個別に `--color-divider` |
| `--a` / `--a-soft` | `--color-data-a` / `--color-data-a-soft` | |
| `--b` / `--b-soft` | `--color-data-b` / `--color-data-b-soft` | |
| `--ok` / `--ok-soft` | `--color-success` / `--color-success-soft` | |
| `--warn` / `--warn-soft` | `--color-warn` / `--color-warn-soft` | |
| `--ng` / `--ng-soft` | `--color-error` / `--color-error-soft` | |
| `--focus` | `--color-focus` | |
| `--sans` | `--font-sans` | |
| `--serif` | `--font-sans` | 明朝をやめる |
| `--mono` | `--font-mono` | |
| `--radius` | `--radius-md` | カードは §5 で `--radius-lg` |
| `--gutter` | `--gutter-mobile`（PC は `--gutter-wide`） | v1 と同じ名前。v1 では style.css の 16px のまま |
| `--ti-bg` | （そのまま） | 絵の背景のグレー（絵の四隅の色）。見た目の版では変えない |

移行が進んで v1 を消すときは、`style.css`・`consult.css` を役割の値で書き直し、この対応表と `ui2.css` §1 を外す。

## 8. 利用者向けと開発・検証用（`?dev=1`）の表示

- `?dev=1` のとき `<html data-dev="1">`（`index.html` のスクリプト）。v1・v2 のどちらでも効く（`style.css` の末尾）
  - `.dev-only`：開発・検証用。`?dev=1` のときだけ見える。**機能は消さず、表示を分けるだけ**（`?dev=1` を付ければ今までとまったく同じものが見える）
  - `.user-only`：利用者向けの代わりの一行（相談の「いまは決まった文型で答えます（AI は準備中）」、足元の「試作中のサービスです。」）。`?dev=1` のときは隠す
  - `.kbd-hint`：キーボード操作の説明。`?dev=1` か、マウスなどで細かく指せる端末（hover かつ pointer: fine）のときだけ見える
- JS で作る要素は、作るときにクラスを付ける。JS から判定するときは `js/ui_flags.js` の `isDev()`
- 何を移したかは [decisions.md](decisions.md) の U10 と [ui-audit.md](ui-audit.md) §4 の段階1
