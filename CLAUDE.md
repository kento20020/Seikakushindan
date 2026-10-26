# CLAUDE.md — 16次元診断（引き継ぎメモ）

このリポジトリで作業する Claude Code 向けの引き継ぎです。最終更新 2026-10-26（相談の入力 U14「書いて、足りない分だけ聞く」、Figma は使わない U15、三択のスワイプの形の案 U27、既定は C「触った回答だけ」U28、新しい画面 `app/` U29、診断結果の絵の一覧 `app/#images` U34、新しい画面を Android でインストールできる PWA に U35、まんなかの軸の絵 U36、iPhone でも PWA に U37、診断結果の一覧 `app/#types` U38、お問い合わせ `app/#contact` とホーム画面で使うのをやめる方法 U39、お問い合わせの送り先をメールに U40、相談の書き方の例と例文・診断の「2つの選択肢」・質問の画面の目立たせ方とスワイプの向き（上＝右へ・下＝左へ）・8つの軸の補足を外す・B2-4 の見出し U41、新しい画面の診断を固定24問（v4）に U42、サービス名を「喧嘩の答え」に U43、24問をすべて「どっち？」の2択とスワイプに U44、新しい画面の共有の文・リンクの見た目（OGP）・共有のリンクから来た人の入口 U45、24問の結果を持ち主の原稿〔72パターン・補足・一言〕の形に U46、相談の外の安全と人目の守り〔窓口のページ `app/#help`・どの画面にも「危ないときは」・24問の結果の安全の1行・履歴の一覧に相談の冒頭を出さない〕U47、AI が書いた相談文の見本155件〔架空〕をテストの材料に U48、三択の結果と診断結果の一覧も原稿の形に U49、デザインのスキル Hallmark を入れた U50、新しい画面の相談をチャットの形に U51）。
**新しいセッションでは、まず `docs/session-log-2026-10-16.md` の §4（返事待ち）と §9（2026-10-17 の続き）を読んでから始める。**
詳しい仕様は README.md と docs/ にある。ここは「全体像・決まりごと・今どこまで進んでいて次に何をするか」をまとめる。

---

## 1. これは何か

- **彼氏診断 Web サービス**の試作。恋人との喧嘩での動き方を測る「16次元診断」と、その結果を使って次の一手を助言する「相談モード」でできている
- 8つの領域 × 2つの傾向（A/B）＝16傾向。固定タイプに分類せず、解釈パターン集（156本＋弱い版16本）から2〜4本を選んで人物像を示す
- 今はビルドなしの静的サイトで、GitHub Pages に公開している。判定はすべてブラウザ内で計算し、サーバーへは何も送らない（例外は新しい画面のお問い合わせ `app/#contact` だけ：今は［メールのアプリで送る］で利用者のメールのアプリを開き、利用者が送信すると運営者のメール bokuhagbpt@gmail.com に届く〔決定 U40〕。Google フォームを入れたら、［送る］を押したときに書いた内容をフォームへ送る〔決定 U39〕）
- 持ち主：Ken（kento20020）。日本語で話す。説明は詳しめが好み
- **役割分担（決定 U19）**：実際の画面（見た目・画面の流れ・部品・並び）は**この Seikakushindan が正**。プロダクトの細かい中身（料金・ログイン・年齢・保存・安全の決まり・データ・技術の構成・集客など）は **Website（`kento20020/Website`、非公開）が正**。食い違いは持ち主に確かめる。Website の非公開の中身はこのリポジトリに書き写さない

| 項目 | 場所 |
| --- | --- |
| リポジトリ | https://github.com/kento20020/Seikakushindan （main に push すると Actions がテスト → Pages に公開） |
| 公開ページ | https://kento20020.github.io/Seikakushindan/ |

### 8領域と A/B（`js/data/questions.js` の `domains` が正）

| 領域 | A | B |
| --- | --- | --- |
| 1 衝突への向き合い方 | 向き合う | 距離を取る |
| 2 反応速度 | 即応 | 熟考 |
| 3 不安時の確認行動 | 追う | 待つ |
| 4 感情表出 | 表に出す | 内に置く |
| 5 納得の条件 | 理由・具体 | 気持ち・共感 |
| 6 話し合いの主導 | 主導する | 調整する |
| 7 問題の広げ方 | 広げる | 切り分ける |
| 8 修復の条件 | 解決する | 関係を戻す |

---

## 2. 画面と URL

| URL | 中身 |
| --- | --- |
| `/`（`#three`） | **既定**。三択診断（左／右／問題を変える、スワイプ可）。設問は v3 が既定（2026-10-16）。スワイプは C「触った回答だけ」が既定（2026-10-17、決定 U28） |
| `?qv=v2#three`、`?qv=v1#three` | 三択の古い設問（v2・v1）で開く。`?qv=v3` で v3（`js/three_version.js` の `DEFAULT_THREE_VERSION` で既定を切り替え） |
| `?fb=1#three` | テスト協力モード（回答ログと感想をテキストで送ってもらう）。集計は `admin.html` |
| `?ui=v2` | **新しい見た目**（トークンと部品。`css/tokens.css`・`css/ui2.css`）。既定は今の見た目 v1 で、`?ui=v1` で戻せる。既定の切り替えは `index.html` の `data-ui-default` と `js/ui_flags.js` の `DEFAULT_UI`（決定 U9） |
| `?sw=card`・`?sw=a`・`?sw=b`・`?sw=c` | **三択のスワイプの形**（決定 U27・U28）。**c＝指を置いた回答だけが、その側へだけ動く（既定）**／card＝カードごと（前の既定）／a＝回答2枚がひとまとまりで動き、質問文は動かない／b＝左へは左の回答だけ、右へは右の回答だけ。上（問題を変える）・下（戻る）はどの形でもカード全体。既定は `js/ui_flags.js` の `DEFAULT_SWIPE`。詳しくは `docs/swipe-variants.md` |
| `?dev=1` | **開発・検証用の表示**（設問の版、サンプル、内部の段階名、点数の内訳、5択版との比較、相談の判定・プロンプトなど）。利用者向けの既定では隠す（クラス `dev-only`。機能は消していない。決定 U10）。`?ui=` `?qv=` `?fb=` `?sw=` と組み合わせられる |
| `app/` | **新しい画面（試作ができた。決定 U29）**。サービス名は**「喧嘩の答え」**（タブの題「喧嘩の答え（試作）」・ホーム画面のアプリの名前・お問い合わせの件名など、`app/` ではどこも。決定 U43。今の画面 `/` は「16次元診断」のまま）。持ち主の画像6枚（`docs/mockups/2026-10-18/`）をもとにしたホーム・診断・結果・相談・アカウント・履歴・マイページ。診断と相談の中身は今の JS を使い回し、見た目だけ新しい（グレージュ・くすんだ赤・明朝）。`app/#images` は診断結果の絵の一覧（絵が無い枠は「準備中」。決定 U34）。`app/#types` は利用者向けの診断結果の一覧（8軸×3のタイプ図鑑。24タイプの絵と説明、結果があれば「あなたの型」の印。決定 U38。説明は U49 で持ち主の原稿の文に）。Android の Chrome でホーム画面に追加できる PWA（マイページの「アプリとして使う」から。決定 U35）。iPhone も Safari などの共有ボタンから追加できる（手順・起動画面・Safari とアプリのあいだで診断を移す引き継ぎのコード。決定 U37）。`app/#help` は「危ないときは」（110・119 と相談できる窓口。履歴に残さない。どの画面にも上の帯の右かいちばん下の1行で入口がある。決定 U47。`docs/app-screens.md` §23）。マイページに「ホーム画面で使うのをやめるには」と、`app/#contact` のお問い合わせ（今は利用者のメールのアプリで運営者のメール bokuhagbpt@gmail.com へ。決定 U40。`app/js/contact_form.js` に Google フォームを入れればそちらが先。決定 U39）。`app/?from=share` は結果の画面の「シェア」が送る共有のリンク（起動時に読み取ってこのタブの印にし、URL から外す。印があって診断が終わっていなければ、ホームを「上 → 診断〔箱「送られてきた診断です」〕→ 相談」に。結果はリンクに載せない）。リンクの見た目（OGP）は `app/index.html` の head と絵 `app/img/og/og-1200x630.jpg`（決定 U45。`docs/app-screens.md` §21）。仕様は `docs/app-screens.md` |
| `app/?dv=v3`・`app/?dv=v4` | **新しい画面の診断の版**（決定 U42）。**`app/` の新しい診断の既定は固定24問（v4）**。どの問も「どっち？」の2択（A か B）で、三択と同じカード2枚とスワイプ（決定 U44）。`?dv=v3` で三択 v3（64〜80問）、`?dv=v4` で24問。既定は `app/js/diagnosis_version.js` の `DEFAULT_DIAGNOSIS_VERSION`（`"v3"` にすると80問の三択に戻る）。途中の三択は三択のまま続き、三択の結果は三択の結果の画面で出る。仕様は `docs/diagnosis-v4.md` |
| `app/?rc=u44` | **24問の結果の前の形**（決定 U44 の結果の画面・ホームのカード・シェアの文）。**既定は持ち主の原稿の形**（決定 U46：絵・タイトル1つ・本文・補足0〜1文・相手に伝える一言・閉じた「回答の内訳を見る」・操作。ホームのカード・履歴の題・シェアの文も同じタイトル）。既定は `app/js/result_copy_version.js` の `DEFAULT_RESULT_COPY`（`"u44"` にすると前の形に戻る）。三択の結果の画面は `?rc=` では変わらない（三択は下の `?rc3=`）。仕様は `docs/diagnosis-v4.md` §6・`docs/app-screens.md` §22 |
| `app/?rc3=old`・`app/?tc=old` | **三択（80問）の結果・診断結果の一覧の前の形**（決定 U49）。**既定は持ち主の原稿の形**：三択（`?dv=v3`）の結果の画面も24問と同じ形（絵・タイトル1つ・本文・補足・一言・閉じた「回答の内訳を見る」〔選んだ数だけ。％なし〕・安全の囲み・操作）、ホームのカード・履歴の題・シェアの文・いちばん上の絵も同じタイトルから。`#types` の24タイプの説明は原稿の文（A寄り B{軸}-1・まんなか B{軸}-5・B寄り B{軸}-3 の題と本文、A寄り・B寄りは一言も。「この型に近い見出し」は外した。「あなたの型」の印も原稿の状態で：1・2・1w → A寄り、3・4・3w → B寄り、5・6・7 → まんなか）。`?rc3=old` で三択の前の結果の画面、`?tc=old` で前の一覧（どちらも直す前と画素まで同じ）。既定は `app/js/result_copy_version.js` の `DEFAULT_RESULT_COPY3`・`DEFAULT_TYPE_COPY`（`"old"` にすると戻る）。仕様は `docs/app-screens.md` §24・`docs/diagnosis-v4.md` §6.5 |
| `app/?cv=card` | **新しい画面の相談の前の形**（決定 U51）。**`app/#consult` の既定はチャットの形**（やりとりを1本の列に、下に固定の入力の欄。返事は今の規則と決まった文で AI なし。上に「いまの一手」の帯、返し方〔おまかせ・短く・じっくり〕、送る一文を自分で直す欄、診断の結果を判定に使う〔この相談では使わない、も選べる〕、終わったあとに診断していない人へ診断の案内）。`?cv=card` で今までの段階ごとの画面（書く → 受け止め → 問 → カード。見た目と動きは変えていない）、`?cv=chat` でチャット。既定は `app/js/consult_version.js` の `DEFAULT_CONSULT_VERSION`（`"card"` にすると戻る）。記録の形は同じで、どちらの形でも続きと履歴の詳細が開ける。仕様は `docs/app-screens.md` §25 |
| `#consult` | 相談（試作）。状況のタップ入力 → 次の一手カード。AI は未接続で、決まった文型で答える |
| `poc/card/` | **案D の流れと次の一手カード（統合1・統合3）の動く試作**。書く → （兆しがあるときだけ）安全の確認 → こう読み取りました → 足りない問 → カード。`?v=1|3` で並び、`?compare=1` で左右に見比べ（900px 以上）。今の画面には入れていない（別のページ） |
| `?five=1#diagnose` ほか `#result` `#logic` `#questions` `#design` | 旧版（5択）。コードは残してあるが、表には出していない |

結果画面（三択）には傾向の絵が出る（主軸の傾向の絵＋「8つの軸の絵」）。
サンプル（石原など）は `?dev=1` の開始画面にある。検証で結果画面を見るときは `?dev=1#three` でサンプルを流す（利用者向けの見た目は、そのあと `?dev=` を外して「結果」タブで見られる）。

---

## 3. 作業の決まり

### 3.1 動かし方とテスト

- **ビルドなし**。素の HTML＋ES モジュール＋CSS。サイトには npm 依存を入れない（外部は `#design` の marked を cdnjs から読むだけ）
- ローカル表示：`python3 -m http.server` → `http://127.0.0.1:8000/#three`
- テスト（Node の素のスクリプト）：
  ```sh
  for t in tests/*.test.mjs; do node "$t" >/dev/null || echo "FAIL $t"; done
  ```
- **CI は UTC で Node 20 を使う**。時刻を扱うテストは時差に依存しないこと。確認するときは `TZ=UTC` でも流す
- 画面の確認は Playwright（スクリプトは置いていない）。サーバーを立てて、スマホ幅 390×844 と PC 幅 1280×900 で確かめるのが慣例
  - 横スクロールが出ないこと
  - コンソールエラーがないこと

### 3.2 進め方（持ち主の希望）

- **実装作業は Opus や Sonnet のサブエージェントに振り分けて任せる**（何度も明示的に依頼されている）。設計・レビュー・確認はメイン、実装はサブエージェント、が基本
- **既存のものは壊さず残す**。新しい版は別ファイル・別タブ・別バージョンで足し、戻せるようにする（例：5択を残したまま三択を足した、三択 v1 を残したまま v2 を足し、v1・v2 を残したまま v3 を足した）
- **決めたこと・変えたことは記録する**
  - 方針は `docs/decisions.md`（日付・理由・反映先）
  - 判定表の点数の変更は `docs/consult-scoring.md` §12
- **ドキュメントとコードを一緒に直す**。判定表は `docs/consult-scoring.md` と `js/consult/rules.js`・`judge.js` の両方を直し、§10 の検証ケースをテストで通す
- **テスターの回答は `data/testers/` に置く**（持ち主の判断で公開。決定 D7）。新しい回答も版ごとのフォルダに足し、一覧（`data/testers/README.md`）を更新する。自由記述に本名・連絡先・第三者が分かる内容があれば、入れる前に持ち主に確認する。それ以外の個人データは入れない
- UI と文書は日本語で、平易な言葉で書く。結果の文言は相手や本人を評価しない（決めつけない、「〜な人」と言わない）

### 3.3 唯一の正（ここを直せば全体が変わる）

| 何 | ファイル |
| --- | --- |
| 解釈パターン本文 | `docs/design.md`。`python3 tools/build_patterns.py` で `js/data/patterns_text_*.js` を生成するので、生成物を直接直さない |
| 三択の設問 | `js/data/questions3.js`（v1）、`js/data/questions3_v2.js`（v2）、`js/data/questions3_v3.js`（v3。v2 を元に W1-1・W3-3・W3-4 の3問を差し替え。変更点は `changesFromV2`）。場面例は `js/data/scenes_v2.js`（v2・v3 共通） |
| 24問の設問（v4） | `js/data/questions4.js`（24問の全文〔普段 U8・仕様書の場面 P8・AI の下書きの場面 N8。どれも A か B〕・固定の出題順・問いの1行・「判断できない」・開始画面の文。決定 U44。文を変えたら `QUESTION_BANK_VERSION4` も変える） |
| 24問の採点と結果の文（v4） | `js/engine4.js`（領域ごとに3問のうち A の数 → A強・A寄り・まんなか・B寄り・B強・incomplete、違いの印、主軸と補足、状態の見出しと本文。決定 U44）。保存と再開は `js/ui/four_store.js`。仕様は `docs/diagnosis-v4.md` |
| 24問・三択の結果の文（持ち主の原稿の形。U46・U49） | `js/data/result_copy4.js`（原稿の写し：72本〔8領域×9状態〕・16の補足と一言とテーマ・テーマの組・PAIR-7B-8B・主軸が無いときの文。**原稿の文は一字も変えない**。文を変えたら `RESULT_COPY_VERSION4` も変える）。選び方（状態への当てはめ・主軸・補足・一言）は `js/result_copy4.js`。画面は `app/js/result4.js`（前の形は `?rc=u44`。`app/js/result_copy_version.js`）。**三択（80問）の結果と `#types` の説明も同じ原稿を使う**（U49）：三択の状態の当てはめと三択だけの並べ方は `js/result_copy3.js`（組み立ては `js/result_copy4.js` の `resultCopyFromStates` を共有。24問の出力は変えない）、画面は `app/js/result.js`（前の形は `?rc3=old`）、`#types` は `app/js/type_catalog.js` の `copy`（前の一覧は `?tc=old`） |
| 新しい画面の共有（シェア） | `app/js/share.js`（共有の文・共有のリンク `?from=share`・コピー・共有のリンクから来た印。決定 U45）。リンクの見た目（OGP）は `app/index.html`、絵は `tools/make_og_image.mjs` で `app/img/og/` に書き出す |
| 新しい画面の安全と人目の守り（U47） | `app/js/safety.js`（窓口のページの文と並び・`tel:` の作り方・24問の結果の安全の1行〔三択の原稿の形にも。U49〕・`#types` の注・小さな文）。窓口の名前・番号・注は `js/consult/texts.js` の `SAFETY_RESOURCES` が正。**`app/sw.js` のつながらないときの画面だけは番号を文字で持つ**ので、番号を変えたら両方を直す（`tests/app_safety.test.mjs` が突き合わせる）。履歴の冒頭を出す設定は `app/js/local.js`（キー `seikaku16:app:history-snippet`） |
| 新しい画面の相談のチャットの形（U51） | `app/js/consult_chat.js`（画面）、`app/js/consult_chat_logic.js`（DOM なし：チャットで足した決まった文 `CHAT_TEXTS`・返し方 `autoStyle`・診断の結果 → 本人の8領域 `selfFromStatus`・診断の案内 `dxInvite`・記録の形）、`app/css/consult_chat.css`。切り替えは `app/js/consult_version.js`。読み取り・問・判定・往復・カードの文は今の `js/consult/`・`poc/card/model.js`（`buildPoc` に省いてよい `self`・`selfMain`）・`app/js/consult_followup.js`（`rejudge` も同じ）・`app/js/consult_card.js` を使う。今の形 `app/js/consult.js` は変えない |
| 傾向の絵と一言 | `js/data/type_images.js`。絵は `img/types/<1A〜8B>.jpg`（960×960） |
| 相談の判定表 | `js/consult/rules.js`（点数）、`js/consult/judge.js`（判定）。仕様は `docs/consult-scoring.md` |
| 相談の文言 | `js/consult/texts.js`。カードの文型、理由の文型、相手の2択の質問 |
| 書いた文の読み取り（案D） | `js/consult/extract_rules.js`（規則の言葉の一覧）、`js/consult/clef.js`（Clef の質問の組）。組み合わせは `extract.js`、足りない問は `needed.js`。仕様は `docs/consult-reading.md` |
| AI の設定 | `js/consult/config.js`。`aiEndpoint` と `aiEndpointHosts` の許可リスト（既定は空） |
| デザイントークン | `css/tokens.css`（色・文字・余白・形・影・動き・レイアウト。ライト／ダークは役割の値だけを切り替える）。一覧とコントラストは `docs/design-tokens.md` |
| 新しい見た目（v2） | `css/ui2.css`（すべて `:root[data-ui="v2"]` の下。古い変数名を役割の値に結び直し、部品を上書きする）。アイコンは `img/icons.svg`（名前は `js/ui/dom.js` の `ICON_NAMES`） |

---

## 4. 構成（主なもの）

```
index.html, js/app.js            ハッシュルーター。index.html の先頭のスクリプトが <html data-ui data-dev> を付ける
js/ui_flags.js                   見た目の版（?ui=v1|v2）・開発用の表示（?dev=1）の判定（resolveUiFlags・isDev）
css/tokens.css, css/ui2.css      デザイントークン、新しい見た目 v2（style.css・consult.css は今の見た目 v1）
img/icons.svg                    線のアイコン（<symbol>。js/ui/dom.js の icon(name)）
js/engine.js, adaptive.js        5択版の判定・可変質問（旧版）
js/engine3.js, adaptive3.js      三択版の判定・出題の流れ（domainStates3 / domainFlags3 / lowConfDomains3）
js/three_version.js              三択の設問の版（v1/v2/v3）の切り替え。v3 のロジックは v2 と同じ（logic.id も "v2"）
js/engine4.js, data/questions4.js, ui/four_store.js  24問版（v4。決定 U42・U44「どっち？」の2択）の採点・設問・保存（キー seikaku16:four:v1）。画面は app/js/diagnose4.js・result4.js
app/js/diagnosis_version.js      新しい画面の診断の版（DEFAULT_DIAGNOSIS_VERSION＝"v4"、?dv=v3|v4、今の診断の版）
js/data/result_copy4.js, js/result_copy4.js  24問の結果の文（持ち主の原稿の写し）と選び方（決定 U46。DOM なし。組み立ては resultCopyFromStates で三択と共有）
js/result_copy3.js               三択（80問）の結果の文の選び方（決定 U49。domainStates3 の状態 → 原稿 B{d}-{状態}、三択だけの並べ方・補足・PAIR の条件。DOM なし）
app/js/result_copy_version.js    24問の結果の出し方の版（DEFAULT_RESULT_COPY＝"v4.1"、?rc=u44 で前の形。決定 U46）と、三択の結果・#types の出し方（DEFAULT_RESULT_COPY3・DEFAULT_TYPE_COPY＝"copy"、?rc3=old・?tc=old で前の形。決定 U49）
app/js/help.js, safety.js        新しい画面の窓口のページ #help と、相談の外の安全と人目の守りの文と関数（決定 U47。safety.js は DOM なし）
app/js/share.js                  新しい画面の結果のシェア（24問・三択の共有の文、共有のリンク ?from=share、コピー）と共有のリンクから来た印（決定 U45。読み込んだだけでは DOM を触らない）
app/js/consult_chat.js, consult_chat_logic.js, consult_version.js  新しい画面の相談のチャットの形（既定。決定 U51）と、その DOM の無い部分・形の切り替え（?cv=card で今までの consult.js）
js/data/questions3*.js           三択の設問（questions3.js＝v1、_v2.js＝v2、_v3.js＝v3）
js/ui/three*.js, swipe.js        三択の画面（結果画面に type_images の部品）
js/ui/feedback.js, feedback_*.js テスト協力モード（送信テキスト 16DFB1 形式）、admin.html と js/admin/ が集計（同じ文の設問は版をまたいで1行）
js/consult/                      相談モードの中身（下の表）
js/ui/consult*.js, css/consult.css  相談画面（#consult）
js/data/type_images.js, js/ui/type_images.js, img/types/  傾向の絵
workers/consult-proxy.js         AI 中継の見本（Cloudflare Worker。未デプロイ）
poc/card/                        案D と次の一手カード（統合1・3）の動く試作（model.js＝DOM なしの部分、poc.js＝画面）
tools/clef_eval.mjs              Clef の読み取りを試す道具（CLOUDFLARE_API_TOKEN・CLOUDFLARE_ACCOUNT_ID が要る。CI では動かさない）
tools/make_pwa_icons.mjs         新しい画面（app/）の PWA のアイコンと iPhone の起動画面（app/img/pwa/splash/）を SVG から PNG に書き出す道具（Playwright。CI では動かさない。docs/app-screens.md §15・§15.10）
tools/make_og_image.mjs          新しい画面（app/）のリンクの見た目（OGP）の絵 app/img/og/og-1200x630.jpg を書き出す道具（Playwright。CI では動かさない。Google Fonts が読めないときは curl で落とした文字のファイルを OG_FONT_700 で渡す。docs/app-screens.md §21.2）
tools/make_axis_mid.sh           新しい画面の、まんなか（50:50）の軸の絵を横長のまとめ画像から切り出す道具（ImageMagick。CI では動かさない。docs/app-screens.md §13）
tests/                           Node テスト。fixtures/consult_cases.mjs が相談の検証ケース。fixtures/consult_samples_ai.mjs は AI が書いた相談文の見本155件（架空。本物の利用者の文ではない。読み取りと安全の規則の見張り。U48）
data/testers/                    テスター6人の回答原文（v1 5人・v2 1人）と自動集計 summary-*.md
tools/build_patterns.py          docs/design.md → パターン本文 JS
.github/workflows/pages.yml      テスト → Pages 公開
```

**相談モードの中身（`js/consult/`）**

| ファイル | 役割 |
| --- | --- |
| `judge.js` / `rules.js` | 状況 → 局面 → 行動の点数 → 一手。結果は毎回同じ（決定論） |
| `from_diagnosis.js` | 診断結果を8領域の向き・確かさに変換。本人の修正（D5）と、相手の同意（D4）も扱う |
| `context.js` | 判定に必要なものをまとめた `buildContext` と、追加の質問（`refineQuestions`） |
| `template_responder.js` | 決まった文型でカードを作る（今の回答はこれ） |
| `card.js` | カードの形と点検（`validateCard`） |
| `prompt.js` | AI 用の3層プロンプト（L1 固定、L2 人ごと、L3 毎回） |
| `ai_responder.js` / `respond.js` | AI 呼び出し。失敗したら文型に自動で戻る |
| `draft_check.js` | 送る前チェック。届きやすさ3段階で、数字は出さない |
| `person_layer.js` | AI に渡す人ごとの層 |
| `extract_rules.js` / `clef.js` / `extract.js` | 案D の読み取り（U14・U17）。規則で読み、Clef（テストのあと）と組み合わせる（`readText`）。安全の言葉は規則で毎回見る |
| `needed.js` | 案D の足りない問（`nextQuestion`・`applyAnswer`・`decide`）。一手が変わる項目だけ、場面の問も含めて合計3問まで。速さのため judge の手順の写しを持つ（点数は rules.js を読む）。**judge.js の手順を変えたら `tests/consult_read.test.mjs` を必ず流す** |

---

## 5. 主な文書（docs/）

| 文書 | 中身 |
| --- | --- |
| `three-choice-logic.md` | 三択の判定ロジック（v1 と v2 の違い、v3 で差し替えた3問と理由） |
| `feedback-spec.md` | テスト協力モードの送信形式・集計 |
| `design.md` | 診断の設計とパターン本文の原典（古い書き出し。最新の設計書は下の Claude Docs） |
| `consult-mode.md` | 相談モードの構想。局面9つ＋安全ゲート、行動16個、共通ルール R1〜R8、避ける言葉 |
| `consult-scoring.md` | 点数つき判定表の仕様。§10 検証ケース、§12 変更履歴 |
| `consult-answer-guide.md` | Fable（レビュー役の AI）による連携レビューと回答方針。カードの形、言い切り方、回答例、自動点検、L1 の骨組み |
| `consult-ai.md` | 回答の層の仕組みと AI のつなぎ方。公開前のチェックリスト |
| `consult-reading.md` | 案D の読み取り（規則・Clef・組み合わせ）と足りない問の仕組み、Clef を試す道具の使い方。§9 に AI が書いた相談文の見本155件（架空）と、それで見た今の安全の規則の拾え方（U48） |
| `type-images.md` | 傾向の絵の16枠と差し替え手順 |
| `marketing-plan.md` | 集客計画（広がる仕組み → SNS → 検索） |
| `test-results.md` | テスト結果のまとめ（6人）。一致率、問題のある設問、ロジック変更の影響、次にやること |
| `decisions.md` | **決定記録**。K1〜K5、D1〜D7、A1〜A7、U1〜U51 |
| `diagnosis-v4.md` | 24問版の診断（v4。決定 U42・U44・U46）：三択・U42 との違い、問い（U・P・N）と順番、画面（三択と同じカードとスワイプ）、採点（状態の表）、結果の表示と文（§6。持ち主の原稿の形〔U46〕と、状態への当てはめ・主軸・補足・一言の決まり、前の形 `?rc=u44`）、保存の形と「回答を見直す」、ほかの画面と相談への連携、80問（三択）への戻し方 |
| `ui-ux.md` | UI/UX 設計（進行中）。戦略・体験・世界観の決定（U1〜U8）、次に決める構造、検証の方法 |
| `ui-audit.md` | UI の現状分析（撮影・評価・重要度順の改善点）、デザイン方針とトークン案、改善計画（段階0〜3 承認済み。段階0・1 実装済み）。改善前の画面は `ui-audit/before/` |
| `ui-design-thinking.md` | 相談の体験のデザイン思考。ペルソナ6人、課題と問い、入力・タップの問・カードの順番・待つ間・診断とのつなぎの案をペルソナごとに比較、組み合わせ3案（案A「場面から」を推奨）と試し方。§6 に**採用した案D「書いて、足りない分だけ聞く」**（流れ、要る項目の決め方、試作10件の結果、弱いところ、作るときの形） |
| `session-log-2026-10-16.md` | **2026-10-16 のセッションの作業記録（引き継ぎ用）**。最初にやること、やったことの順番、決定、持ち主の回答、返事待ち、次にやること、優先順の提案、外部の物（キャンバス・Figma・プラグイン）、作業の注意 |
| `app-screens.md` | 新しい画面 `app/` の構成と仕様（画像と画面の対応、流れ、持ち主の15の答え、画面ごとの中身、色・文字・部品、使い回す仕組み、定義書と違うところ、§14 診断結果の絵の一覧 `#images`、§15 アプリとして使う〔PWA。Android・iPhone。§15.10 が iPhone〕、§15.11 ホーム画面で使うのをやめるには、§16 診断結果の一覧 `#types`〔8軸×3のタイプ図鑑〕、§17 お問い合わせ `#contact`〔今はメールのアプリで送る §17.3。Google フォームは任意で、持ち主がフォームを作る手順は §17.5〕、§18 持ち主の依頼での直し〔U41〕、§19 24問の診断と三択への戻し方〔U42〕、§20 サービス名「喧嘩の答え」〔U43〕、§21 結果のシェアと共有のリンク〔OGP・共有のリンクから来た人の入口。U45〕、§22 24問の結果を持ち主の原稿の形に〔U46〕、§23 安全と人目の守り〔U47〕、§24 三択の結果と診断結果の一覧も原稿の形に〔U49〕、§25 相談をチャットの形に〔U51〕） |
| `swipe-variants.md` | 三択のスワイプの形（c＝既定・カードごと・a・b）。開き方、どの形でも同じこと、触って比べるときに見るところ、仕組みのファイル、既定の変え方 |
| `design-tokens.md` | トークンの一覧（役割・値・ライト／ダーク・コントラストの実測）、部品のルール、`?ui=v2` の仕組みと既定の切り替え方、古い変数名との対応、`?dev=1` の表示の分け方 |

---

## 6. 今どこまで進んでいるか

- **診断**
  - **新しい画面 `app/` の新しい診断は固定24問（v4）が既定**（2026-10-20。決定 U42。`docs/diagnosis-v4.md`）。**2026-10-21 に24問をすべて「どっち？」の2択（A か B ＋「判断できない」）と、三択と同じカード2枚のスワイプにした**（決定 U44。持ち主「24問でもスワイプする」「診断は当てはまり度ではなく、どっち？みたいな内容のはず」。普段8問・仕様書の場面8問・AI の下書きの新しい場面8問。採点は領域ごとに3問のうち A の数）。U42 の仕様書どおりの当てはまり度の版は GitHub のブランチ `diagnosis-v4-ratings`。三択 v3 は残してあり、`DEFAULT_DIAGNOSIS_VERSION`（`app/js/diagnosis_version.js`）か `?dv=v3` で戻る。今の画面 `/#three` は三択 v3 のまま。v4 は精度を実測したものではなく、まだ誰も受けていない（新しい場面の8問は持ち主があとで直せる）
  - 三択 v3 が既定（2026-10-16。今の画面 `/#three`。`app/` では `?dv=v3`）。v2（2026-10-10）の W1-1・W3-3・W3-4 だけを差し替えた版で、ロジックは v2 と同じ（決定 K5）
  - 5人テスト（v1）のあと、v2 を1人で確認した。逆側に外した判定は0件。数字のまとめは `docs/test-results.md`、原文は `data/testers/`
  - W1-1 が答えにくい・W3-3・W3-4 は全員 B だった問題は、v3 で差し替え済み（**未検証**。v3 で受けた人はまだいない）
  - 未解決：追加質問で上限の80問に届きやすい、全員が「長い」と回答
- **相談モード**
  - 判定表（点数つき・実装・検証ケース）ができている
  - Fable の改善案（D1〜D5）も採用済み
  - 画面（#consult）は試作が公開済み。回答は決まった文型で、AI は設定だけで差し込める
- **傾向の絵（D6）**
  - 16傾向のうち8つに絵がある（1A 向き合う、2B 熟考、3A 追う、4B 内に置く、5A 理由・具体、6B 調整する、7A 広げる、8B 関係を戻す）
  - 残り8つは「準備中」の枠。たたき台で、今後変える前提
- **UI の改善**（`docs/ui-audit.md` の改善計画。決定 U9〜U11）
  - 段階0（トークン・部品・`?ui=v2` の切り替え）と段階1（開発・検証用の表示を `?dev=1` に移す）が実装済み。既定の見た目は v1 のまま
  - 段階1 は v1 にも効く：利用者向けの既定では、設問の版・サンプル・内部の段階名・点数の内訳・5択版との比較・相談の「（試作）」などが隠れる（`?dev=1` で今までどおり見える）
  - 次は段階2（質問画面）・段階3（結果画面）。どちらも `?ui=v2` の中で、`docs/design-tokens.md` の部品を使って作る（承認済み。プラグイン frontend-design は使えることを確認済み）
  - **新しい画面 `app/`（U29。2026-10-18）**：持ち主の画像6枚をもとに、ホーム（相談が上・診断が下）・診断（開始・練習・質問・結果）・相談（入力 → 受け止め → 足りない問 → カード）・アカウント（LINE・Google、見た目だけ）・履歴とマイページ（端末の中だけ）を作った。中身は今の JS を使い回す。作ってみて足したこと・変えたことは `docs/app-screens.md` §10（持ち主が了承）。**相談の続き（往復）は規則だけで作った**（U30。［相手の返事を貼る］［送った］［もう少し話したい］、答え合わせ、10往復まで。`docs/app-screens.md` §11）。**診断結果の絵の一覧 `app/#images`**（U34。新しい画面の24枠と今の画面の16枠、絵が無い枠は「準備中」、結果があれば「あなたの結果」の印。マイページと結果の画面から。`docs/app-screens.md` §14）。**PWA**（U35。2026-10-19）：Android の Chrome でインストールできる（`app/manifest.webmanifest`・`app/sw.js`〔ネットにつながっていれば新しいもの、つながらないときだけ保存した物〕・`app/js/pwa.js`・マイページの「アプリとして使う」）。アイコンは仮の「16」の絵（差し替えは `tools/make_pwa_icons.mjs`）。名前は「喧嘩の答え」（U43。2026-10-20。`docs/app-screens.md` §20）。通知・Google Play・iPhone の案内のボタンはこのリポジトリではできない。`docs/app-screens.md` §15。**iPhone でも PWA に**（U37。2026-10-19）：`app/index.html` に iPhone の meta と起動画面12枚（`app/img/pwa/splash/`）、マイページに iPhone の Safari・ほかのブラウザの追加の手順と、保存が Safari と別なための**引き継ぎのコード**（`app/js/transfer.js`。診断と診断の記録・印を移す。相談は移さない）。実機の iPhone での確認は持ち主に頼む。`docs/app-screens.md` §15.10。**まんなか（50:50）の軸の絵**（U36。2026-10-19）：横長の8枚並び（題は 25:75）を持ち主の答えで 50:50 の絵とし、`app/img/axes/<軸>-mid.jpg` の8枚にした（作り方は `tools/make_axis_mid.sh`）。これで軸の絵は24枚すべてそろい、8つの軸の行・結果とホームのいちばん上・`#images` に出る。`docs/app-screens.md` §13。**診断結果の一覧 `app/#types`**（U38。2026-10-19）：持ち主の依頼「診断結果一覧ページも作って」に、8軸×3のタイプ図鑑で答えた。24タイプのカード（絵・型の名前・比率・短い説明・この型に近い見出し）と目次、結果があれば軸ごとに「あなたの型」の印。新しく書いた文はまんなかの型の文だけ（ほかは `BASIC_TEXT` の one と `PATTERN_META` の見出し）。入口はマイページと結果の画面。データは `app/js/type_catalog.js`（DOM なし）。`docs/app-screens.md` §16。**お問い合わせ `app/#contact` とやめ方**（U39。2026-10-20）：持ち主の依頼「マイページにお問い合わせホーム（フォーム）を作る。また、ホームで使うのを辞める方法も教えて」。送り先は Google フォーム（`fetch` の POST・`no-cors`）で、**フォームは持ち主がこれから作る**（手順は `docs/app-screens.md` §17.5。回答者用の URL をもらったら AI が `app/js/contact_form.js` に入れる〔§17.6〕。それまでは［送る］を押せない → U40 でメールで送れるようにしたので、フォームは任意）。マイページの「アプリとして使う」のカードに「ホーム画面で使うのをやめるには」（iPhone・Android・パソコンの手順。ボタンの名前は実機で未確認）。`docs/app-screens.md` §17・§15.11。**お問い合わせをメールで**（U40。2026-10-20）：持ち主「メールアドレス。bokuhagbpt@gmail.com にして」。送り方を3つにした（`contact_form.js` の `contactMode`：フォームが入っていればフォーム、無くて `CONTACT_MAIL` があればメール〔今〕、どちらも無ければ送れない）。メールのときは返事の連絡先の欄を出さず、［メールのアプリで送る］で mailto: を開き、欄の代わりに案内（「送りました」とは言わない。もう一度開く・宛先と文のコピー・入力に戻る・書いた物を消す）。アドレスはページに出す（持ち主が選んだ）。実機のメールのアプリでの確認は持ち主に頼む。`docs/app-screens.md` §17.3。**共有**（U45。2026-10-21）：持ち主「123をPagesに入れる」。結果のシェアの文の頭にサービス名（「喧嘩の答えで診断しました。」＋見出し）、リンクは `app/?from=share`、リンクの見た目（OGP。絵は `tools/make_og_image.mjs`）、共有のリンクから来た人は診断が終わるまでホームの並びを「上 → 診断（箱）→ 相談」に。結果ごとのページ・結果の画像は入れない（結果をリンクに載せない）。実機の LINE などでのカードの見え方は持ち主に頼む。`docs/app-screens.md` §21。**24問の結果を持ち主の原稿の形に**（U46。2026-10-21）：持ち主の原稿（診断結果のリニューアルの仕様と72パターンの原稿）。問い・保存・engine4 の判定は変えず、結果の文と画面だけ。原稿の72本（8領域×9状態）・16の補足と一言・特別の組 PAIR-7B-8B・主軸が無いときの文を `js/data/result_copy4.js` に一字も変えずに写し、2択の答えを原稿の状態に当てはめる（3問とも A → 1、2問 A → 2、2問だけ答えて同じ側 → 1w・3w、A1・B1・判断できない1 → 7、普段と場面の向きが逆 → 7 の専用の文。`js/result_copy4.js`）。結果の画面は絵・タイトル1つ・本文・補足0〜1文・「たとえば、こんな一言から。」と一言・閉じた「回答の内訳を見る」・操作だけ。ホームのカード・履歴の題・シェアの文・いちばん上の絵も同じ出どころ。答えがそろった領域が無いときは［回答を見直す］（答えを消さずに1問目へ。`four_store.js` の `review4`）。前の形は `?rc=u44`。`docs/diagnosis-v4.md` §6・`docs/app-screens.md` §22。**相談の外の安全と人目の守り**（U47。2026-10-22）：持ち主「足す機能の Fable の案を実装してみて」「相談機能は無視する」。窓口のページ `app/#help`（110・119 と3つの窓口。履歴に残さない）、どの画面にも「危ないときは」（上の帯の右か、いちばん下の1行。つながらないときの画面にも番号）、24問の結果で領域3か6が A強のときだけ内訳の後ろに安全の1行（三択には入れていない）、`#types` の下の注、履歴の一覧では相談の行に書いた文の冒頭を出さない（マイページで出すようにもできる）、小さな文の足し。相談の画面と原稿の文は変えていない。入れなかった Fable の案と理由は `docs/decisions.md` の U47。`docs/app-screens.md` §23。**三択の結果と診断結果の一覧も原稿の形に**（U49。2026-10-23）：持ち主「診断結果を修正して」（原稿を添えて）と、メインの問いへの答え。三択（`?dv=v3`）の結果の画面を24問と同じ原稿の形にし（三択の状態をそのまま原稿 B{d}-{状態} に当て、判定なしは 7。同じ段の中は強さ → 左右の余裕 → 差 → 番号、補足は選んだ側 ≧ 反対側、PAIR は両方 LB ≧ LA。U47 の安全の囲みと［相談する］も）、`#types` の説明を原稿の文にした。前の形は `?rc3=old`・`?tc=old`。`docs/app-screens.md` §24。**相談をチャットの形に**（U51。2026-10-26）：持ち主「試作の性格診断のところの画面まで作ってほしい。本番環境にはまだ入れない。」と、メインの問いへの答え（Seikakushindan の `app/` の相談・公開ページには出す・チャットを既定に・今の規則と決まった文・診断の結果を使う〔切り替えつき〕・です・ます・提案の4つ全部）。やりとりを1本の列にし、下に固定の入力の欄、上に「いまの一手」の帯、返し方（おまかせ・短く・じっくり）、送る一文を自分で直す欄、終わったあとに診断していない人へ診断の案内。読み取り・問・判定・往復は今のまま（AI なし）。今の形は `?cv=card`。Website の本番には入れていない。`docs/app-screens.md` §25
  - **スワイプの形（U27・U28）**：質問カードのスワイプを4つの形にし（`?sw=`。v1・v2 の両方で動く）、持ち主が触って比べて **C「触った回答だけ」を既定にした**（2026-10-17）。前の形は `?sw=card`。段階2 の質問画面も C の前提で作る
- **UI/UX の設計**（`docs/ui-ux.md`・`docs/ui-design-thinking.md`）
  - 決定：U1〜U8（戦略・体験・世界観）、U12（トップは案B＋「送ったけど返事が来ない」）、U13（安全の確認は相談のタップの1問目）、**U14（相談の入力は案D「書いて、足りない分だけ聞く」：書く → 安全（毎回）→ 書いた文から項目を機械的に埋めて見せる（直せる）→ 足りない項目のうち一手に要るものだけ、合計3問まで）**、U15（Figma は使わない）、U16（次の一手カードは C6：結論 → 理由の1行目 → 文面 → 理由の続き → 避けたい言葉 → その後 → 確かさ）
  - **U17（読み取りは規則＋Clef。Clef は日本語をテストで確かめてから）**、**U18（進め方は案ウ。公開は Clef が通れば規則＋Clef、通らなければ規則だけ。カードの文章の AI は公開のあと）**
  - **U19〜U23（Website との役割分担）**：画面は Seikakushindan、プロダクトの細かい中身は Website が正（U19）。**公開は Website の計画どおり Website のアプリで行い、U18 の「公開の形」は取り消し。Seikakushindan は画面の試作と手本・テスター用**（U20）。一手は判定表、AI は文章（U21）。安全の確認は兆しがあるときだけ聞く（U22、U13 を置き換え）。理由の1行目は無料で全員に、2行目からは［なぜ？］（U23）
  - **U24〜U26（PoC を見ての意見）**：［コピー］は吹き出しの右上の小さなボタン（U24）。「預ける」は使わない（U25）。書いたあとの画面は「受け止めと状況の整理」の1画面（共感＝感情の整理〔気持ち・どうしたいか〕と状況の整理＝事実〔誰が何を送ったか・どれくらい前か〕を、分けずにひと続きの1文で出す＋直す手段。U26）
  - Website と残る差：カードへの Website の中身の入れ方、診断の中身（タイプ・全問・短い版）、実在の2人とテスターの回答の公開（D7）、ペルソナ（`docs/session-log-2026-10-16.md` §9）
  - 骨組みはデザインキャンバス（§8）
- **戻せる地点**
  - 新しい画面の相談を前の形（段階ごとの画面）に戻す：`app/js/consult_version.js` の `DEFAULT_CONSULT_VERSION` を `"card"`、その場では `app/?cv=card#consult`（決定 U51）
  - 三択（80問）の結果・診断結果の一覧を前の形に戻す：`app/js/result_copy_version.js` の `DEFAULT_RESULT_COPY3`・`DEFAULT_TYPE_COPY` を `"old"`、その場では `app/?rc3=old`・`app/?tc=old`（決定 U49）
  - 24問の結果を前の形（U44）に戻す：`app/js/result_copy_version.js` の `DEFAULT_RESULT_COPY` を `"u44"`、その場では `app/?rc=u44`（決定 U46）
  - 新しい画面の診断を80問（三択 v3）に戻す：`app/js/diagnosis_version.js` の `DEFAULT_DIAGNOSIS_VERSION` を `"v3"`、その場では `app/?dv=v3`（決定 U42）
  - 三択 v1 だけの状態：コミット `2fc9f11`
  - 設問 v2 だけ：`?qv=v2`、または `DEFAULT_THREE_VERSION` を `"v2"`
  - 設問の版：`?qv=v1`、または `DEFAULT_THREE_VERSION`

---

## 7. 次にやること（候補。持ち主に優先順を確認して進める）

### 診断
1. **W1-1・W3-3・W3-4 は v3 で差し替え済み。次のテストで確認**（W1-1 の迷いと回答時間、W3-3・W3-4 の左右の割れ方、領域3の追加質問の数。`docs/three-choice-logic.md` の v3 の節）。領域1・3は相談でいちばん使う（決定 K1・K5）。8分類そのものは変えない
2. **短い版（クイック版）を検討する**（W 問題だけで16〜24問・2〜3分）。精度は `data/testers/` の回答を W だけで採点し直して確かめる
3. 元の5人に v2 を同じ参加者コードで受け直してもらい、`admin.html` で集計する
4. 主軸の名前付け・一言ラベル（シェア用）

### 相談モード
5. **16傾向の対応ガイド**（効く対応・逆効果・伝え方。形式は `consult-answer-guide.md` §2.14 の6）
6. **お手本の相談30〜50件**（期待する一手と理由の補正 ID つき）で、文章の回帰テストを作る
7. **AI をつなぐ**：`workers/consult-proxy.js` を Cloudflare にデプロイ → API キーを秘密として登録 → `config.js` の `aiEndpoint` と `aiEndpointHosts` を設定（手順は `docs/consult-ai.md`）
   - モデル `claude-haiku-5-5`、L1 は1時間キャッシュ、回答は構造化出力（`output_config.format`）
   - L1 が約1.1万トークンで、目安より大きい。お手本を減らすか検討
8. 結果報告からの続き（「送った → 返事が来ない」で次の一手）
9. 公開前に必要なこと：窓口の電話番号を公式で確認（#8008、DV相談＋、よりそいホットライン。番号は `js/consult/texts.js` の `SAFETY_RESOURCES` と `app/sw.js` のつながらないときの画面の2か所。`app/#help` の注にも「公開の前に確かめ直します」と書いてある。U47）、中継の利用回数の上限、18歳未満の扱い（未決）。**安全の規則は、AI が書いた見本155件のしるしあり16件のうち3件しか拾えない**（U48。拾えない種類と言葉を足すときの注意は `docs/consult-reading.md` §9。足すかどうかは持ち主と Website が決める）

### 絵・集客
10. 残り8傾向の絵（`type_images.js` に1行足すだけで出る）
11. 結果カード画像とシェアボタン、結果ごとの静的ページ（リンクプレビュー用）、「相手に送る」リンクとふたり診断、独自ドメイン、計測（回答の中身は送らずイベントだけ）。新しい画面 `app/` では U45 で、シェアボタンの文・リンクのカード（OGP）・共有のリンクから来た人の入口を入れ、結果ごとのページと結果の画像は入れないことにした（結果をリンクに載せない）

### UI/UX（2026-10-16 から持ち主と対話で設計中。`docs/ui-ux.md`）
12. 戦略・体験・世界観は決定済み（U1〜U8：主役は相談、入口を2つ、まず書いてタップで補う、世界観「味方・落ち着き・確か」）。構造はトップ（U12）・安全の確認（U13）・**相談の入力（U14 案D「書いて、足りない分だけ聞く」）**・**カードの順番（U16 C6）**が決定。キャンバスに案D の流れを描き、相談画面を新しい流れで作る（`js/consult/extract.js`＝書いた文の読み取り、`needed.js`＝足りない項目の問、確認の画面。今の画面は残し、別の版で足す。形は `docs/ui-design-thinking.md` §6.5）
13. **UI の改善計画の段階2・3**（`docs/ui-audit.md` §4）：質問画面（カード・進み具合・説明の整理）と結果画面（最初の画面に主軸の要点と合う絵、「詳しく」で開く）を `?ui=v2` の中で作り直す。確かめてから既定を v2 にする（段階0・1 は済み）

### 進め方（決定 U18：案ウ）
- 線1（Claude とサブエージェント）：読み取り（規則＋Clef の差し替え口）と足りない問の中身 → 案D の流れをキャンバスに → 相談画面の新しい版（今の画面は残す）→ お手本の相談30〜50件 → 16傾向の対応ガイド
- 線2（持ち主）：v3 の再テストをテスターに頼む
- 線3（線1の合間）：UI の段階2・3
- 合流：~~公開前の安全 → 公開（Clef がテストを通れば規則＋Clef、通らなければ規則だけ）→ AI（カードの文章）→ 広げる~~ → **公開は Website の計画どおり Website のアプリで（U20）**。Seikakushindan で作った画面を Website に移す
- Clef のテストは、持ち主が Cloudflare の鍵（`CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`）を環境の設定に入れてから

### 将来の構成（構想・未着手）
- 段階拡張：Phase 1 診断 → **Phase 2 AI相談（最初に出す、ログインなし）** → Phase 3 会員・保存 → Phase 4 スクショ解析 → Phase 5 音声
- 実行基盤は Cloudflare（Pages / Workers / R2）に決定。アプリの枠組み（Next.js＋OpenNext ほか）と DB（Supabase 案）は未決

---

## 8. リポジトリの外にある資料

- **設計書（Claude Docs）「16次元診断 解釈パターン集」**：https://claude.ai/code/artifact/53a84009-831f-49ec-9430-7d9c11cbfaf4
  - STEP4〜7 に、選択ロジック・AI 相談の情報設計（STEP5・5-2）・三択とフィードバックの経緯がある
  - claude.ai の中の文書なので、ここから読めない場合は持ち主に内容を貼ってもらう
- **Google Drive「彼氏診断アプリ」**：https://drive.google.com/drive/folders/1A2AXjEvCFiQg1M9wn902-zd69u7mMU9l
  - 「16次元診断 まとめ（2026-10-10時点）」
  - サブフォルダ「キャラクター作成」（https://drive.google.com/drive/folders/19rWQMhzLFw-VeYKsx2ZsRTkz98zGqS9O）：キャラクター案まとめ・描き方の切り口と絵柄
  - 50.市場戦略 ほか
- **デザインキャンバス「彼氏診断 画面構造の案」**：https://claude.ai/artifact/Ms4NvmoBVorYa17DHvXn4q （白黒の骨組み7枚：トップ案 A・B・C、相談の流れ4画面。持ち主だけが見られる設定）
- **Figma**：使わない（2026-10-17 持ち主が決定）。画面の案はデザインキャンバスと実際のコード（`?ui=v2`）で作る。参考：アカウント「けんと」、Starter・View 席
- **プラグイン**：frontend-design・Design（どちらも Anthropic）・Playwright（Microsoft）が入っていて、使える（2026-10-16 に確認。`docs/session-log-2026-10-16.md` §0）。スキル名は `frontend-design:frontend-design`、`design:design-critique`・`design:accessibility-review`・`design:ux-copy`・`design:design-system`・`design:user-research`・`design:research-synthesis`・`design:design-handoff`
- **デザインのスキル Hallmark**（2026-10-24 持ち主「Skills入れて」。決定 U50）：`.claude/skills/hallmark/`（[Nutlope/hallmark](https://github.com/Nutlope/hallmark) のコミット `7ec8682` の `skills/hallmark` をそのまま写した。MIT。`LICENSE` 同梱）。AI が作った感じの画面を避けるためのスキル（作る・`audit`〔点検だけ。直さない〕・`redesign`・`study`）。**今ある画面には、持ち主が「Hallmark」と名前を出したときだけ使う**（スキル自身の決まり）。`app/` の見た目は持ち主の画像（U29）と `docs/app-screens.md` §5 が正なので、Hallmark のテーマで塗り替えない。使うなら `/hallmark audit app/...` で点検の一覧を出し、直すかは持ち主に聞く。画像を作る `scripts/imagegen.mjs` は `TOGETHER_API_KEY` が無いと動かない（外の Together AI に送るので、鍵を入れて使うのは持ち主が決めてから）。編集のたびに点検するフック（`scripts/install-hook.mjs`）は入れていない（設定を書き換えるため）。更新は同じリポジトリの `skills/hallmark` を写し直す
- **Website**（`kento20020/Website`、非公開）：プロダクトの細かい中身の正（U19）。docs/00-overview.md が全体、docs/decisions/ が決定記録。作業の決まりはそのリポジトリの CLAUDE.md（決定は `docs/decisions/new-<名前>.md`、番号は PR の直前に付ける など）
- **テスターの回答テキスト**：リポジトリの `data/testers/` にある（決定 D7）。`admin.html` に貼れば集計と採点し直しができる
