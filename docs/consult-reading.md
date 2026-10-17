# 相談の読み取りと足りない問（案D の中身）

- 状態：中身（画面なし）を実装（2026-10-17）。画面はまだ作っていない（次の段階。今の相談画面 `#consult` はそのまま）
- 元になった決定：U14（案D「書いて、足りない分だけ聞く」、合計3問まで）、U17（読み取りは規則＋Clef）、U21（足りない問も判定表で決める）、U22（安全の確認は兆しがあるときだけ。3問に数えない）。流れの設計は [ui-design-thinking.md](ui-design-thinking.md) §6
- 判定の入力の値は [consult-scoring.md](consult-scoring.md) §1 と同じ。判定表（`rules.js`・`judge.js`）は変えていない

| ファイル | 役割 |
| --- | --- |
| `js/consult/extract_rules.js` | 書いた文 → 項目の一部（決まった規則。端末の中だけで動く） |
| `js/consult/clef.js` | Clef（Cloudflare の決めるためのモデル）に送る質問の組と、返り値の読み方（通信はしない） |
| `js/consult/extract.js` | 規則と Clef の組み合わせ（`readText`） |
| `js/consult/needed.js` | 足りない項目のうち、一手に要るものだけを1問ずつ出す（`nextQuestion`） |
| `tests/consult_read.test.mjs` | 上の4つのテスト（CI で動く） |
| `tests/fixtures/consult_read_cases.mjs` | 試作の10件（文と正解の入力）。テストと `tools/clef_eval.mjs` の両方で使う |
| `tools/clef_eval.mjs` | Clef を実際に呼んで、規則・Clef・組み合わせを比べる道具（CI では動かさない） |

---

## 1. 全体の流れ

1. 本人が書く
2. 安全：読み取りの `safety`（規則で見つけた兆し）が true のとき、または本人が「危ないときは」を押したときだけ、画面が安全の確認を出す（U22。足りない問の3問には数えない）。書いた文に自分を傷つける言葉があれば、すぐ安全のカード（A7）
3. 読み取り：`readText(文, { clef })` → 項目・どこから読んだか・食い違い・根拠の言葉・安全
4. 「こう読み取りました」を見せる（根拠の言葉 `evidence` と、確かさの低い項目 `lowConfidence` を目立たせる。1タップで直せる）
5. 足りない問：`nextQuestion(分かっている項目, 聞いた問)` を、null が返るまで（最大3問）
6. 一手：`decide(分かっている項目)`（分からない項目は既定値で埋めて `judge`）

```js
import { readText } from "./js/consult/extract.js";
import { nextQuestion, applyAnswer, decide } from "./js/consult/needed.js";

const read = readText(text);                       // Clef を使うときは { clef: parseClefAnswers(返り値) }
let known = { ...read.fields, lateNight };         // 文から決まらないもの（深夜かどうか・8領域 self/partner）も入れてよい
const asked = [];
for (let q; (q = nextQuestion(known, asked)); ) {  // 画面では1問ずつ出して、押された選択肢を待つ
  const picked = /* 押された選択肢 */ q.options[0];
  asked.push(q);
  known = applyAnswer(known, picked.patch);
}
const result = decide(known);                      // judge の結果（一手・局面・付け足し…）
```

- 危ないサイン（`danger`）は `nextQuestion` では聞かない（U22：安全の確認は兆しがあるときだけ画面が別に出し、3問に数えない）。`known.danger` が true なら null を返す（安全のカードは画面が出す）
- 確認の画面で本人が項目を直したら、`known` の値を差し替えて、もう一度 `nextQuestion` を呼べばよい

---

## 2. 規則の読み取り（`extract_rules.js`）

`extractRules(文)` → `{ fields, evidence, safety }`

- `fields`：読めた項目だけ（`lastSender`・`elapsed`・`partnerLast`・`ongoing`・`selfTemp`・`intent`・`goal`・`cause`・`repeat`・`afterMakeup`・`selfLast`）。読めない項目は入れない
- `evidence`：項目ごとの根拠の言葉（20字まで）。例：`{ lastSender: "既読無視され", elapsed: "2時間" }`
- `safety`：`{ selfHarm, partnerThreat }`。`texts.js` の `SELF_HARM_RE`・`PARTNER_THREAT_RE` をそのまま使う

### 2.1 何を手がかりにするか

| 項目 | 主な手がかり |
| --- | --- |
| `lastSender` | いちばん後ろに書かれた出来事。本人が送った（「」って送った、送ったけど、既読無視・返事が来ない）→ `self`。相手から来た（「」って来た・言われた、彼から…来た、返せてない・返したくない・なんて返せば）→ `partner`。お互い連絡していない → `none` |
| `partnerLast` | 相手のいちばん後ろの発言・知らせの中身（別れ話 → 距離 → 謝罪 → 話し合いの提案 → 責める → 説明 → 普通の話題 の順に当てる） |
| `selfLast` | 本人のいちばん後ろの発言の中身（保留 → 謝罪 → 責める → 仲直り → 説明）。引用がなければ「謝ったけど」「言い返しちゃった」 |
| `elapsed` | 時間の言葉のうち、最後のやりとりにいちばん近いもの（同じ文の中を優先）。「さっき」「2時間」→ 3時間以内、「5時間」「今朝」→ 半日以内、「昨日」→ 1〜2日、「3日目」「1週間」→ 3日以上。「2時間」「3日」のような長さは、前後に止まっている言葉（返ってこない・既読・冷戦・たった など）があるときだけ使う（「3時間電話で喧嘩した」の3時間は使わない）。付き合っている長さ・「23時」のような時刻は使わない |
| `ongoing` | 言い合いの最中（今まさに・言い合ってる・ヒートアップ）→ true。止まっている（冷戦・帰ってから・既読無視・返せてない・週末に会う・3時間以上たった）→ false。両方あれば後ろに書かれたほう |
| `selfTemp` | 腹立つ・怒ってる・イライラ → `high`、落ち着いてきた → `cooling`、冷静・落ち着いてる → `calm`。いちばん後ろに書かれたもの。「彼が怒ってる」は相手のことなので使わない |
| `intent` | 謝りたい・どこまで謝れば → `apologize`、話したい・伝えたい → `tell`、距離を置きたい・一人になりたい → `request_space`（「電話したい」は「話したい」にしない） |
| `goal` | 仲直りしたい → `reconcile`、分かってほしい → `understood`、決着をつけたい・はっきりさせたい → `settle` |
| `cause` | 私が言いすぎた → `self`、彼が約束を破った → `partner`、お互い言いすぎた（または両方が書かれている）→ `both` |
| `repeat` | 毎回・毎月・また同じ → true、初めての喧嘩 → false |
| `afterMakeup` | 仲直りした（けど）→ true（「仲直りしたい」は当てない） |

### 2.2 取り違えないための決まり

- **誰の言葉か**：「」の引用は、後ろの動詞（って送った／って来た・言われた）→ 前の主語（私が／彼から）の順で決める。「」なしでも「ごめんって来た」「距離置きたいって言われた」は引用として読む。「友達に…って言われた」は恋人の言葉にしない
- **相手の言葉から本人の希望を読まない**：本人の希望（したいこと・ゴール・原因・温度）は、引用の中身を消した地の文だけから読む。「彼に距離置きたいって言われた」は `partnerLast: "space"` で、`intent` にはしない
- **打ち消し**：当たった言葉のすぐ後ろに「わけじゃない」「とは思わない」などが続いたら当てない（「別れたいわけじゃない」「私が悪いとは思わない」）
- **動詞の「て形」**：「帰ってから」「謝ってきた」「返ってきた」は引用の「って」ではない

### 2.3 言葉を足すとき

1. `extract_rules.js` の上の「言葉の表」から、足す先の表を選ぶ（例：返事を待っている言い方は `WAITING`、相手の言葉の種類は `PARTNER_KINDS`、時間は `TIMES`）
2. 表に1行（正規表現）足す。各表の上のコメントに、何を拾う表かを書いてある
3. 正規表現は先読み（`(?=…)`・`(?!…)`）まで。**後読み（`(?<=…)`・`(?<!…)`）は使わない**（古い iPhone のブラウザでファイルごと読み込めなくなる）。前の文字を見たいときは `findAll` の `before` を使う
4. `tests/consult_read.test.mjs` の「規則の読み取り」に、足した言葉の例と、取り違えやすい例を1つずつ足す
5. `for t in tests/*.test.mjs; do node "$t" >/dev/null || echo "FAIL $t"; done` で全部通ることを確かめる

全角の数字・記号は読む前に半角にそろえる（NFKC）。『』“” は「」として扱う。

---

## 3. Clef（`clef.js`）

Clef は選択肢つきの質問に確率で答えるモデル（`@cf/cloudflare/clef`）。文章を書かないので形が崩れず、速い（決定 U17）。

### 3.1 質問の組（`clefQuestions()`）

質問の ID は判定の入力の項目名そのまま（英数字だけ）。すべての質問の前に「書いた人＝本人、彼・相手＝恋人」の説明を付ける。

| ID | 種類 | 選択肢（判定の値） |
| --- | --- | --- |
| `lastSender` | choice | self／partner／none／**unknown** |
| `elapsed` | choice | lt3h／3h_12h／12h_2d／ge3d／**unknown** |
| `partnerLast` | choice | apology／casual／explain／attack／talk_proposal／space／breakup／none／**unknown** |
| `selfLast` | choice | hold／apology／reconcile／attack／explain／none／**unknown** |
| `selfTemp` | choice | high／cooling／calm／**unknown** |
| `intent` | choice | apologize／tell／request_space／**unknown**（「特になし」は選択肢にしない。書かれていなければ unknown にして、要るなら問で聞く） |
| `goal` | choice | reconcile／understood／settle／space／**unknown** |
| `cause` | choice | self／partner／both／**unknown** |
| `ongoing` | noul | はい＝今も言い合っている |
| `repeat` | noul | はい＝前にも同じことで喧嘩した |
| `afterMakeup` | noul | はい＝もう仲直りした |

choice には必ず unknown（文からは分からない）を入れる。送る本文は `clefRequest(文, { model: "clef" | "clef-flash" })` → `{ model, state: 文, questions }`。

### 3.2 返り値の読み方（`parseClefAnswers(返り値, { threshold })`）

- 返り値の形は、公式の出力スキーマ（`schema-output.json`）で確かめた：`{ model, answers: { ID: 答え }, usage }`。choice の答えは `{ type, choice, probabilities, confidence }`、noul の答えは `{ type, noul }`（「はい」の確率）
- REST で呼ぶと `{ result: { … }, success, errors, messages }` に包まれる（Cloudflare API の共通の形。Clef での実物は**未確認**）。どちらでも読めるようにしてある。ほかに、choice が無く probabilities だけ、noul が数だけ、の形も読む（**未確認**の形への備え）
- choice：選ばれた選択肢の確率（`probabilities[choice]`。無ければ `confidence`）が **threshold 以上**なら埋める。unknown が選ばれたら埋めない
- noul：はいの確率が threshold 以上なら true、1 − threshold 以下なら false、その間は埋めない
- 返す値：`{ fields, confidence, low, unknown }`。`low` は値は出たが確率が低くて埋めなかった項目、`unknown` は「分からない」が選ばれた項目
- **threshold は仮に 0.8**（`CLEF_THRESHOLD`）。`tools/clef_eval.mjs` で確率の当てになり具合を見て決める

### 3.3 使うときの注意

- 書いた文が Cloudflare に送られるので、送る前に画面で一言断る（U17）
- 安全の言葉は Clef に頼らない（規則で毎回見る）
- Clef が使えないとき（通信の失敗・無料枠の超過）は、規則だけで続ける（`readText(文)` だけ呼ぶ）
- 呼び出しは中継（Cloudflare Worker）から行う。ブラウザに鍵を置かない

---

## 4. 組み合わせ（`extract.js`）

`readText(文, { clef })` → `{ fields, sources, conflicts, conflictValues, lowConfidence, confidence, evidence, safety }`

| 場合 | 扱い |
| --- | --- |
| 規則と Clef の両方にあって同じ | 埋める（`sources[項目] = "both"`） |
| 両方にあって違う | **埋めない**（`conflicts` に入れ、`conflictValues` に両方の値）。分からない扱いなので、要るなら足りない問で聞く |
| 規則だけ | 埋める（`"rules"`） |
| Clef だけ | 埋める（`"clef"`。Clef は確率が基準以上のものしか返さない） |
| Clef が迷った（`low`） | `lowConfidence` に入れる（規則で埋まっていても入れる）。確認の画面で目立たせる |
| 安全 | 規則の結果を常に使う |

`clef` には `parseClefAnswers` の結果を渡す。Clef の生の返り値（`{ answers }` など）を渡しても、中で読む。

---

## 5. 足りない問（`needed.js`）

### 5.1 使い方

- `nextQuestion(known, asked = [], { maxTotal = 3 })` → 次の問 `{ id, text, options: [{ label, patch }] }` か null
  - `known`：分かっている判定の入力（読み取り＋答え＋文脈）。分からない項目は入れない。深夜かどうか（`lateNight`）と8領域（`self`・`partner`）は文から決まらないので、画面が入れる（入れないと既定値＝深夜ではない・タイプ不明）
  - `asked`：もう聞いた問（問そのものか id）。数が上限に届いたら null
  - `patch`：判定の入力への差分。`applyAnswer(known, patch)` で当てる
- `decide(known)`：分からない項目を既定値で埋めて `judge` した結果
- `runQuestions(known, answer)`：上限まで順に聞いて答える（テスト・道具用）

### 5.2 場面の問（最初の1問）

誰が最後に送ったか（`lastSender`）としたいこと（`intent`）がどちらも分からず、言い合いの最中・仲直り済み・距離や別れの話でもないときは、最初に場面を1タップで聞く（[ui-design-thinking.md](ui-design-thinking.md) §3.1 の I4）。場面の問も3問に数える。

| 表示（先頭4つを1画面、残りは「ほかの場面」） | 埋める項目 |
| --- | --- |
| 送ったけど、返事が来ない | lastSender self、ongoing false、intent none |
| 相手から連絡が来た（まだ返していない） | lastSender partner、ongoing false、intent none |
| いま言い合いの最中 | ongoing true、intent none |
| お互い連絡していない | lastSender none、ongoing false、intent none |
| 自分から謝りたい | intent apologize、ongoing false |
| 話す前・伝えたいことがある | intent tell、ongoing false |
| 仲直りしたけどモヤモヤ | afterMakeup true、lastSender none、partnerLast none、ongoing false、intent none |
| 相手から距離・別れの話が出た | lastSender partner、partnerLast space、ongoing false、intent none |

（決定 U14 の文では「lastSender・ongoing・intent がどれも分からないとき」。ここでは「言い合いは止まっている」だけが分かっているときも場面から聞く。場面の1問で誰が最後か・したいことが両方埋まるため。仲直り済み・距離や別れの話が読めたときは場面を飛ばす。最後の場面は、本人が距離を置きたい場合と取り違えないよう「相手から」を付けた）

### 5.3 要るかどうかの決め方

1. 分からない項目（聞ける項目：`lastSender`・`ongoing`・`intent`・`partnerLast`・`elapsed`・`selfLast`・`selfTemp`・`goal`・`cause`、仲直り済みのときだけ `repeat`）に、ありうる値をすべて入れて判定する
2. 一手が1つに決まれば聞かない（null）
3. 値によって一手の分かれ方が変わる項目だけが候補（どの値でも同じ分かれ方なら、聞いても絞れない）
4. 候補のうち、答えたあとの一手の散らばり（エントロピーの見込み）がいちばん小さい項目を聞く。同じなら `ORDER` の順
5. 合計3問で決まらなければ打ち切り、`decide` で埋まった項目と既定値で判定する

危ないサインは聞かない（U22）。重み：分からない値はどれも同じ重みで数える（実際の人の多さは見ていない）。

### 5.4 問の言葉

`js/ui/consult_state.js` の `GROUPS` の表示に合わせる（テストで確かめる）。違うところ：

- 返事待ち・対面で終わった人（`lastSender` が self か none）に相手の言葉を聞くときは「相手から『距離を置きたい』『別れたい』という話は出ている？」（出ていない／距離を置きたいと言われた／別れ話をされた）。この人たちでは、相手の言葉の種類のうち一手が変わるのは距離・別れ話だけなので
- 相手から来た人には「相手から来たのは、どんな内容？」（7種類）、分からない人には「相手から最後に来たのは？」（7種類＋まだ何も来ていない）
- 自分の最後の一言の「なし」は「どれでもない」。相手から来た人には「相手から来る前に、自分が最後に送ったのは？」

### 5.5 速さ

`judge` は1回 50µs ほどかかり、分からない項目の組み合わせは最大で数十万になる（試作の総当たりは最大2秒）。次の工夫で、初めての文脈でも1回 10ms 前後（2026-10-17、手元の node で、5回の真ん中の値。何も分からないときの数え上げ 約10ms、次の問のいちばん遅い場合 約8ms）。

1. **局面を先に決める**：局面だけに効く項目（誰が最後か・最中か・したいこと・相手の言葉の種類・くり返し）は、局面ごとの重みにまとめて数える
2. **点数は局面ごとに1回ずつ**：点数に効く項目（経過・自分の最後の一言・温度・原因・ゴール）の組み合わせごとに1回だけ一手を出して覚える。文脈（深夜・8領域など）が同じなら、次の問でも覚えを使う
3. **同じ扱いの値をまとめる**（`SAME_AS`）：落ち着いてきた／落ち着いている、謝った／仲直りしようとした、説明した／なし、距離／別れ話
4. **判定の軽い写し**：局面と点数は `judge.js` と同じ手順の写し（`phaseOf`・`compilePhase`）で出す。補正のうち、点数に効く項目を読まないものは局面ごとに1回だけ確かめて使い回す

3・4 が `judge` と同じ結果になることは、テストで確かめている（局面は全部の組み合わせ 110,592 通り、一手は §10 の37件＋抜き取り 12,000 件、まとめた値は抜き取り 1,500 件、数え上げは5つの場面で総当たりと比べる）。**`rules.js`・`judge.js` を変えたら、このテストを必ず流す**。写しがずれていればここで落ちる。

---

## 6. Clef を試す（`tools/clef_eval.mjs`）

テストの10件（`tests/fixtures/consult_read_cases.mjs`）を Clef に読ませ、規則・Clef・組み合わせを比べる。CI では動かさない。

### 6.1 鍵の入れ方

1. Cloudflare のダッシュボードの Workers AI の画面で「Use REST API」→「Create a Workers AI API Token」（用意された型。権限は `Workers AI - Read` と `Workers AI - Edit`）でトークンを作る。同じ画面の「Account ID」も控える
2. **持ち主が、この道具を動かす環境の設定に入れる**（Claude Code のクラウドの環境なら環境変数・シークレットの設定、手元ならシェルの export）
   - `CLOUDFLARE_API_TOKEN`：トークン
   - `CLOUDFLARE_ACCOUNT_ID`：アカウント ID
3. **トークンはチャット・Issue・コミットに貼らない**。道具はトークンの値を表示もログもしない

鍵が無いときは、何をどこに設定すればよいかを表示して、何も呼ばずに終わる（終了コード 0）。結果を作り話で出すことはない。

### 6.2 動かし方と読み方

```sh
node tools/clef_eval.mjs                     # 大きい Clef（第一候補）
node tools/clef_eval.mjs --model clef-flash  # 小さい Clef-flash
node tools/clef_eval.mjs --threshold 0.7     # 埋める基準を変える
```

出るもの：

- 件ごと：規則・Clef の読み取り、Clef の確率、迷った項目、食い違い、かかった時間
- 項目ごとの正解率（正しく埋めた数／埋めた数）：規則・Clef・組み合わせ。正解は fixtures の `truth`（書かれていない項目は判定の既定値）
- 最後の一手：問に正解の入力から答えたときの正しい一手の数と、問の平均
- 確率の当てになり具合：確率の帯ごとの正解の割合、基準以上なのに違った答え
- 時間（通信を含む）と入力トークン

### 6.3 決めること

- Clef を入れるか（U17：日本語をテストで確かめてから）、Clef と Clef-flash のどちら（大きい方が第一候補）
- threshold（確率の帯ごとの正解の割合を見て決める）
- 10件では少ない。お手本の相談30〜50件（CLAUDE.md §7 の6）を fixtures に足してから決めるのがよい

---

## 7. テスト（`tests/consult_read.test.mjs`）

- 試作の10件：文 → 規則で読めた項目（読めてほしい項目が読め、読み違いがない）→ 正解の入力から問に答える → 最後の一手が `judge(正解)` と同じ、問は3つまで
- 規則：打ち消し、「言われた」、「」の発言者、時間の言葉、既読無視、最中・止まっている・仲直り・温度・くり返し、安全の言葉
- Clef：質問の組の形（ID の文字、choice に unknown）、返り値の読み方（高い確率・低い確率・unknown・noul、REST の包み、形の違い）
- 組み合わせ：一致・食い違い・Clef なし・Clef だけ・確率が低い・安全は規則
- 足りない問：判定の写しが `judge` と同じ、一手の分かれ方が総当たりと同じ、聞いた項目は一手を変えうる（総当たり）、分かっている項目は聞かない、危ないサインは聞かない、同じ入力なら同じ問、場面の問が最初、合計3問まで、問の言葉が `GROUPS` と同じ、最悪の場合の速さ（30ms 未満）

### 10件の結果（2026-10-17）

| 件 | 規則で読めたこと | 問 | 一手 |
| --- | --- | --- | --- |
| P1 | 最後は自分、3時間以内、最中ではない、自分の最後は責める | 3（どうしたい／距離・別れの話／原因）、打ち切りなし | ○ |
| P2 | 最後は相手、相手は責める、最中ではない、熱い | 2（どうしたい／相手から来る前に自分が送ったのは） | ○ |
| P3 | 最後は相手、普通の話題、3時間以内（「さっき」）、最中ではない | 2（どうしたい／ゴール） | ○ |
| P4 | 最後は相手、説明・言い返し、最中ではない、熱い | 2（どうしたい／相手から来る前に自分が送ったのは） | ○ |
| P5 | 謝りたい、原因は自分、初めて | 3（最中？／相手から最後に来たのは／どれくらい）、打ち切り | ○ |
| P6 | 伝えたい、くり返し、最中ではない（「週末に会う」） | 2（相手から最後に来たのは／気持ち） | ○ |
| 喧嘩した | なし | 3（場面／自分が送ったのは／どれくらい）、打ち切り | ○ |
| 既読無視されてる | 最後は自分、最中ではない | 3（どうしたい／自分が送ったのは／どれくらい）、打ち切り | ○ |
| 紛らわしい1 | 最後は相手、距離を置きたい | 1（どれくらい） | ○ |
| 紛らわしい2 | 最後は相手、謝ってきた、1〜2日、最中ではない | 1（どうしたい） | ○ |

上限ごとの違い（同じ10件）：合計2問 → 正しい一手 9/10・平均1.8問・打ち切り4件、**合計3問 → 10/10・平均2.2問・打ち切り3件**、上限なし → 10/10・平均2.7問（最大6問）。試作（平均2.0問）より少し多いのは、試作が聞かなかった「自分の最後の一言」（保留宣言のあとかどうかで一手が変わる）も候補にしたため。打ち切った3件が正しかったのは、既定値が当たっただけの可能性がある。

---

## 8. 弱いところ・次にやること

- **規則は10件と、その周りの例に合わせてある**。略語・絵文字・誤字・方言・「ブロック」などには弱い。お手本の相談30〜50件を fixtures に足して、読み違いを潰す（CLAUDE.md §7 の6）
- **「最後のやりとり」は書かれた順で決める**。時系列が前後する文（「さっき来たけど、その前に私が…」）は読み違える。確認の画面で直せる
- 「喧嘩中」だけでは最中かどうかを決めない（冷戦の意味でも使うため）
- **安全の兆し（U22）**：規則で見ているのは `texts.js` の2つ（自分を傷つける言葉・相手の「死ぬ」などの脅し）だけ。暴力・脅し・監視・お金・交友の制限（相談画面の `DANGER_ITEMS`）の言葉は、まだ文からは見ていない。U22 で「兆しがあるときだけ聞く」にしたので、この言葉の一覧を足すかどうかを決める必要がある
- 「今朝」「昨日」は今の時刻を見ずに、おおよその時間で区切りを決めている
- 分からない値はどれも同じ重みで数えている。実際の相談で多い場面に重みを付けると、聞く順がもっと良くなる可能性がある
- 場面「相手から距離・別れの話が出た」は相手の言葉を「距離を置きたい」にする（別れ話かどうかは一手が変わらないので聞かない。文面の指定 BRK だけが変わる）
- 画面（確認の画面・1問ずつの画面）は次の段階。今の相談画面は残し、別の版で足す（CLAUDE.md §3.2）
