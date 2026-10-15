# 相談モード：回答の層（カード・決まった文型・AI の差し込み口）

- 状態：実装（2026-10-15）。今は AI を呼ばず、決まった文型でカードを作る。AI は設定を変えるだけでつながる
- 方針：[consult-answer-guide.md](consult-answer-guide.md) 第2部（カードの形・トーン・理由の作り方・安全ゲート・点検表・1層目の骨組み）、[decisions.md](decisions.md) D1〜D5
- 判定（一手を決める側）：[consult-scoring.md](consult-scoring.md)、`js/consult/judge.js`
- テスト：`node tests/consult_responder.test.mjs`

---

## 1. 仕組み

```
入力（タップ項目・相談文・診断結果）
  └ buildContext（context.js） … 判定 judge・人ごとの層・文体・現在時刻をまとめた ctx
      ├ respond（respond.js）
      │   ├ 中継の URL なし → templateRespond（template_responder.js）… 決まった文型。同じ ctx なら同じカード
      │   └ 中継の URL あり → aiRespond（ai_responder.js）→ 中継 → Claude → カード
      │                        └ 点検（validateCard）に通らない・HTTP の失敗・時間切れ → 決まった文型に戻す
      └ refineQuestions（context.js） … カードの下に出す問い（最大2つ）→ 答えたら applyPatchToContext で作り直す
```

- 一手・時刻・期限は判定（プログラム）が決める。カードの文はその枠の中だけで書く。AI でも決まった文型でも、**同じカードの形（JSON）・同じ点検**を通る
- 安全ゲートのカードは、中継があっても**いつも決まった文型**（窓口の番号を AI に書かせない）
- 文の置き場所は `texts.js` だけ。決まった文型も、AI の1層目のプロンプトも、ここから作る

### 画面が使う関数

| 関数 | 中身 |
| --- | --- |
| `buildContext({ input, consultText, self, partner, couple, register, partnerCall, selfMain, now, tzOffset, safety })` → `ctx` | 相談1回分の文脈。`input` は判定の入力（consult-scoring.md §1）。`lateNight` を省くと `now` から決める（0時〜6時前）。`register` は `"casual"`（タメ口）か `"polite"`（敬語）、省くと `couple.register`、それもなければタメ口。`now` を渡せば結果は毎回同じ |
| `respond(ctx, { endpoint, fetchImpl, timeoutMs, retries })` → `Promise<{ card, source, errors, prompt }>` | カードを作る。`source` は `"template"` か `"ai"`。`errors` は AI をあきらめた理由。`prompt`（l1・l2・l3・version）は開発者用の表示に |
| `templateRespond(ctx)` → `card` | 決まった文型のカード（同期） |
| `refineQuestions(ctx)` → `[{ id, text, options: [{ label, patch }] }]` | 問い。原因の確認（メモ `confirm_cause`）と、相手のタイプで一手か文面が変わるときの2択（外から見える行動。答えは「あなたの見立て」observed） |
| `applyPatchToContext(ctx, patch)` → `ctx` | 問いの答え（`options[].patch`）を当てて作り直す。`applyPatch(input, patch)` は入力だけに当てる版 |
| `validateCard(card, ctx)` → `{ ok, errors }` | カードの点検（§3） |
| `renderCardText(card, { action })` | カードを素の文字列に（コピー・確認用）。欄の名前は `SECTION_LABELS`、「待つ間に／やること」は `doNowLabel(action)`（texts.js） |
| `currentAiEndpoint(location.search)` | 中継の URL（`aiEndpointHosts` に載っているホストの `?ai=`、なければ config の `aiEndpoint`）。いまは一覧が空なので `?ai=` は無視される |
| `recheckText(code, now, { tzOffset, clampNight })`・`timingText(timing)` | 時刻の言い方（「明日の12時」「30分後（14時40分ごろ）」「10月22日」など） |
| `estimateTokens(text)` | プロンプトの大まかなトークン数（字数 ÷ 1.5） |

### ファイル

| ファイル | 中身 |
| --- | --- |
| `js/consult/config.js` | `CONSULT_CONFIG`（aiEndpoint・model・maxTokens・timeoutMs・promptVersion・aiEndpointHosts）、`resolveAiEndpoint`（`?ai=` は `aiEndpointHosts` に載っているホストの https だけ。既定の一覧は空なので何も受け付けない） |
| `js/consult/texts.js` | 決まった日本語のすべて（局面の文、補正 ID ごとの理由の文型、確かさの言い方、見出し、文面の型、やること、その後、避けたい言葉の例、2通りの行、相手を推定する2択、本人の傾向の言い方、安全ゲートの窓口） |
| `js/consult/timefmt.js` | 点検時刻・文面の時刻・送るタイミングの言い方 |
| `js/consult/context.js` | `buildContext`・`refineQuestions`・`applyPatch`・`applyPatchToContext` |
| `js/consult/card.js` | カードの形（JSDoc）、`CARD_JSON_SCHEMA`、`validateCard`、`renderCardText` |
| `js/consult/template_responder.js` | 決まった文型の回答 |
| `js/consult/prompt.js` | 3層のプロンプト `buildPrompt` |
| `js/consult/ai_responder.js` | 中継を呼ぶ `aiRespond` |
| `js/consult/respond.js` | 入口 `respond`（AI → だめなら決まった文型） |
| `workers/consult-proxy.js` | 中継の見本（Cloudflare Worker。未デプロイ） |
| `js/ui/consult.js`・`consult_state.js`・`consult_self.js`・`consult_card.js`・`consult_dev.js`、`css/consult.css` | 画面 `#consult`（相談（試作））。§1 の関数を呼ぶだけで、判定・文の作成はしない（下の「画面」） |

### 画面（`#consult`）

- ヘッダーの「相談（試作）」リンクから開く（既定の画面は今までどおり `#three`）。入力 → `buildContext` → `respond(ctx, { endpoint: currentAiEndpoint(location.search) })` → カード。カードの下に `refineQuestions` の問いが出て、答えると `applyPatchToContext` → `respond` でカードだけを作り直し、答えは入力欄にも映す（ページは動かさない）
- 「あなたのタイプ」は、この端末の三択の結果（三択画面が持つ結果。`localStorage` の `seikaku16:three:v1`。画面の側は読むだけで書き換えない）、サンプル（石原・別宮。5択回答を三択に流した結果）、診断なしから選ぶ。8領域は `domainsFromProfile3`、「これは違う」は `applySelfCorrections`（D5。直した領域は `source: "stated"`）、主軸は「この説明は当たっている」にチェックしたときだけ `selfMain.confirmed`
- 相手の8問は `domainsFromChoices`（A／B／分からない）。相談文（600字まで）・状況のタップ項目は judge の入力（consult-scoring.md §1）にそのまま対応する。深夜は「自動」なら入力に入れず `buildContext` が `now` から決める。一緒に住んでいる はオンのときだけ `couple.livingTogether: true` を渡す（オフは「していない」とは言い切らない）
- 危ないサインは1つでもあれば `danger: true`。「「別れるなら死ぬ」と言われた」は `safety.partnerThreat`、「自分を傷つけたい気持ちがある」は `safety.selfHarm`。**相談文に `SELF_HARM_RE`（死にたい・消えたい など）が入っているときも、チェックがなくても `danger: true`・`selfHarm` にする**（画面に理由を出す）。相手の脅しの言葉（`PARTNER_THREAT_RE`）は「死ぬほど〜」のような言い方で誤って止めないよう、チェックのときだけ
- 保存は `localStorage` の `consult-form-v1`（入力・選択・相談文。カードは保存しない）。使えない環境でもそのまま動く。どこにも送らない（AI は `aiEndpoint` と `aiEndpointHosts` を設定するまで呼ばない）
- 開発用の折りたたみ：「判定の中身」（局面・一手・付け足し・タイミング・点検時刻・確かさ・差・文面の指定・メモ・点数・補正）と「AI に渡すプロンプト」（L1 は字数・トークン数と本文を開いたときだけ表示、L2・L3、AI の接続（未接続／送り先のホスト）、`respond.errors`）
- テスト：入力の変換は `node tests/consult_ui_state.test.mjs`。画面は Playwright で確かめた（スクリプトはリポジトリに入れていない）

## 2. カードの形

| 欄 | 中身 | 上限 |
| --- | --- | --- |
| `kind` | `"card"`、安全ゲートだけ `"safety"` | — |
| `headline` | おすすめ（行動＋いつ） | 40字（目安 20〜35） |
| `addonLines` | 文面に入れなかった付け足し（「そのあと『電話していい？』と聞く形で1回だけ」など） | 2つ・各40字 |
| `timingLine` | 深夜で朝に回すときの一行。ほかは null | 40字 |
| `reasons` | 理由。局面の文 → 状況 → 相手 → 自分 | 3つ・各50字 |
| `drafts` | 文面 `{label, text}`。2つ目は「別の言い方」（同じ中身）だけ | 2つ。ふつう80字、apology_full・accept_space・request_space は120字で1つだけ、pause_with_time は60字 |
| `variantLines` | 相手のタイプで変わるところ（「相手が〜なら → 〜」） | 2つ・各60字 |
| `doNow` | 待つ間に／やること | 50字 |
| `avoid` | 避けたい言葉の例 | 3つ・各12字 |
| `ifReply`・`ifNoReply` | その後（「条件 → すること」。来なければの方に点検時刻） | 各50字 |
| `confidenceLine` | 確かさ。safety は null | 40字 |
| `safety` | 安全ゲートのときだけ `{ intro, resources:[{name, contact, note}], steps, closing }` | steps 2つ |

カード全体（avoid を含む文の合計）は 450 字まで。`CARD_JSON_SCHEMA` は Claude API の structured outputs（`output_config.format = { type: "json_schema", schema }`）にそのまま渡せる形にしてある（全 object が `additionalProperties: false`・全項目 required、null は型の配列、長さ・数の制約は入れない。長さと数は `validateCard` で見る）。

## 3. 点検（validateCard）

[consult-answer-guide.md](consult-answer-guide.md) §2.13 のうち、1枚で見られるもの：形（スキーマ）、数と長さ、全体 450 字、文面ごとの送る前チェック（`checkDraft`。「届きにくい」なら不合格）、pause_with_time・request_space の文面に時刻、聞く形の行動でも「？」は1つ、使わない語（モラハラ・絶対・必ず・すべき・性格・専門用語など）、「〜な人」、「DV」は窓口の名前だけ、内部の名前（`waiting_partner`・`P2B`・`AO12` など）、点数（「80点」「5点差」）、英語（LINE・SNS を除く）・絵文字・感嘆符・「笑」、第三者の引用、相手のタイプへの言及（その領域が分からないのに「相手は〜寄り」、見立てなのに「（診断結果）」）、確かさの言い方（sure は「はっきり」、est は「仮」か「見立て」、provisional は「仮」、situational は「状況」）、文体（タメ口に です・ます がない／敬語にある）、安全ゲート（#8008 の窓口がある、文面・避けたい言葉・その後・確かさがない）。

決まった文型のカードは、§10 の全ケース × 2つの文体と、決まった種の入力 2000 件で、全部この点検を通り、文面はすべて「届きやすい」（テストで確かめている）。

## 4. AI に渡すもの（3層）とキャッシュ

| 層 | 中身 | キャッシュ |
| --- | --- | --- |
| l1（固定） | 役割、出力の形と上限、行動の定義、文面の指定、文面の決まり、避ける言葉、局面の意味、理由の文型（全 ID）、確かさとタイプの言い方、トーン、「今は送らない」の書き方、やってはいけないこと、お手本3つ（決まった文型の出力）。**人ごと・相談ごとのデータは入れない**（どの相談でも1文字も変わらない）。約1.7万字 | 1時間（`ttl: "1h"`） |
| l2（人ごと） | `personLayerText`：本人・相手の8領域の向き・確かさ・出どころ、カップルの事実（落ち着くまでの時間・電話か文字か・同居）。本人が「当たっている」と答えたときだけ主軸の見出しと注意点 | 5分 |
| l3（今回） | 判定の出力（局面・一手・付け足し・タイミング・点検時刻・文面の指定・メモ・applied・避ける言葉・2通り・確かさ・差）、決まった文（点検時刻と文面の時刻の言い方、局面の文、理由の文、確かさの行、避けたい言葉の例、文面の型、画面の問い）、相談文（600字まで）、現在時刻、文体、相手の呼び方 | なし |

**AI が見ないもの**（D2・D4）：X の level・W の数・点数（scores）、156パターンの本文・場面例、補強・矛盾・地のパターン、相手のパターン。相手の診断結果は「一手と送り方を選ぶため」だけに使い、文面に書かせない（1層目で禁止し、点検の `checkDraft` で「診断」「タイプ」「〜派」を止める）。

`version`（`CONSULT_CONFIG.promptVersion`）は1層目の版。texts.js やお手本を変えたら上げる。

## 5. 中継の約束

```
POST <endpoint>   Content-Type: application/json
  { version, model, l1, l2, l3, schema, maxTokens }
→ 200 { card }   ／   4xx・5xx { error }
```

- ブラウザに API キーは置かない。キーは中継（Worker）の秘密にだけ置く
- 中継は Claude Messages API（`https://api.anthropic.com/v1/messages`、`anthropic-version: 2023-06-01`）を呼ぶ：`system` に l1（`cache_control: { type: "ephemeral", ttl: "1h" }`）、`messages[0].content` に l2（`cache_control: { type: "ephemeral" }`）と l3、`output_config.format` に `{ type: "json_schema", schema }`。長い TTL を短い TTL より前に置く。区切りは2つ（上限4つ）。Haiku 5.5 は 512 トークン以上でキャッシュされる
- 返ってきた text ブロックの JSON を `JSON.parse` して `{ card }` で返す。`stop_reason` が `refusal`・`max_tokens` ならエラー
- 点検（validateCard）はブラウザ側でする

## 6. つなぎ方

1. `workers/consult-proxy.js` を Cloudflare Worker にする（`npm create cloudflare@latest consult-proxy` などで作り、この中身を入れる）
2. `wrangler secret put ANTHROPIC_API_KEY`
3. 必要なら `wrangler.toml` の `[vars]` に `ALLOWED_ORIGINS`（既定 `https://kento20020.github.io`）、`ALLOWED_L1_SHA256`（l1 の SHA-256。入れるとその l1 以外を断る）、Rate Limiting のバインディング `RATE_LIMITER`
4. `wrangler deploy`
5. 出た URL を `js/consult/config.js` の `aiEndpoint` に入れる。または、試すだけなら `aiEndpointHosts` にその Worker のホスト名（例 `"consult-proxy.example.workers.dev"`）を入れて、ページを `?ai=<URL>` で開く。`?ai=` が通るのは **https で、ホスト名が `aiEndpointHosts` に完全一致で載っているときだけ**（サブドメインは別のホスト）。**`aiEndpointHosts` の既定は空なので、いまは `?ai=` を付けても無視される**（細工したリンクで相談文が他人のサーバーに送られないようにするため）。`aiEndpoint` に書いた URL は一覧と関係なく使われる

## 7. 失敗したとき

- 中継の URL がない → 決まった文型（`source: "template"`、errors は空）
- HTTP の失敗・中継の `{ error }`・通信の失敗・時間切れ（`timeoutMs`、既定 20 秒。AbortController で止め、fetch が止まらなくても待たない）・JSON でない・点検に通らない → 決まった文型に戻し、`errors` に理由（点検の不合格なら1件ずつ）
- `retries`（既定 0）で試し直す回数を指定できる。guide §2.13 は「2回失敗したらテンプレ」だが、待ち時間と費用を考えて既定は1回にした
- 安全ゲート → いつも決まった文型

## 8. 決まった文型の作り方（template_responder.js）

- **理由**：1つ目は局面の文。2つ目以降は、判定の `contributions`（一手の点の内訳。consult-scoring.md §11）から「一手を押し上げた点」と「2位の行動を押し下げた点」の大きいほうで補正 ID を並べ、状況・相手・自分から選ぶ。点を動かさない補正（BRK・AO7・R3d・L1b・HG・R4 など）は決まった強さ。状況の補正が強い（20以上）ときはそれを先に入れ、相手・自分の理由がなければ一手そのものの理由（`ACTION_WHY`）を入れて2つで止める（診断なしなら2つ、guide §2.2）
- **言い切り方**：相手の理由は、その領域の確かさで「です（診断結果）」「だとあなたは見ています」「のようです（結果は弱め）」、本人の理由は「です（診断結果）」「です（あなたが直した結果）」「のようです（結果は弱め）」。分からない領域の理由は出さない
- **文面**：行動 × 文体 × 指定の型（texts.js の `DRAFTS`）を組み合わせる。付け足し（保留・話し合いの提案）は同じ1通に入れる行動と、一行（addonLines）にする行動を分けた。原因が分からないのに謝る一手（`confirm_cause`）は、文面の label を「きつかったと思うなら、この1通」にして、下の問いで確かめる
- **時刻**：点検時刻はプログラムの値をそのまま言い換える。ただしカードと文面では、夜中（0〜6時前）に当たる時刻を「明日の朝」と書く（23時の「3時間後」を「明日の2時ごろ」と相手に送らせないため。R4 の考え方）。相手が向き合う寄り（`short_return`）でそうなったときは「明日の朝いちばん」
- **相談文**：自由記述なので、使うのは最初の「」の短い引用だけ（相手の最後の一言は9字まで、安全ゲートの出来事は20字まで。英数字・使わない語を含むものは使わない）
- **450字に収める**：超えたら「別の言い方」→ 3つ目の理由 → 2通りの行 の順に外す

## 9. 公開前チェック

- [ ] 安全ゲートの窓口（DV相談ナビ #8008、DV相談＋ 0120-279-889、よりそいホットライン 0120-279-338）の番号・受付時間・チャットの有無を、各窓口の公式サイトで確かめ直す（`texts.js` の `SAFETY_RESOURCES`）
- [ ] 中継に回数の制限を入れる（Rate Limiting バインディング、または KV・Durable Object で IP ごとに数える）。`ALLOWED_L1_SHA256` で l1 を固定する
- [ ] `config.js` の `aiEndpointHosts` は空のままにするか、自分の Worker のホストだけを入れる（`workers.dev` のような共有のドメイン全体は入れない。完全一致なので、1つのホストごとに書く）。既定は空で `?ai=` は無視される。相談画面（`#consult`）の「AI に渡すプロンプト」に送り先のホストを出している
- [ ] 18歳未満の扱い（安全モードの範囲と合わせて。consult-mode.md §6、未決）
- [ ] 相談文を中継・ログに残さない（見本の Worker は usage だけをログに出す）。改善のためにデータを集めるなら本人の同意を取る
- [ ] AI の出力をお手本30〜50件で流し、点検の誤検出（特に使わない語・相手のタイプへの言及）と、人が見る項目（guide §2.13 の後半）を確かめてから `aiEndpoint` を入れる
