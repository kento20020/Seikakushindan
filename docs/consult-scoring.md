# 相談モード 判定表（点数つき）

- 状態：設計（2026-10-14）。実装は `js/consult/`、検証は `tests/consult.test.mjs`
- 元になった表：[consult-mode.md](consult-mode.md) §3.3（局面ごとの基本・吟味版）、§3.4（共通ルール）、§3.6（8領域）
- 目的：相談の状況と、自分・相手のタイプから、**次の一手（行動）を1つ、毎回同じ結果で**決める。AI は決まった行動の枠の中で文章だけを書く

---

## 0. 全体の流れ

1. **安全ゲート**：危ないサインがあれば `safety` だけを返して終わり
2. **局面の判定**：入力項目から16の局面キーのどれかに決める（§2）
3. **点数**：局面ごとの基本点（§3）に、状況・共通ルール・8領域・ゴールの補正（§4）を足す。除外された行動は候補から外す
4. **一手を選ぶ**：点が最も高い行動。同点なら優先順（§5）
5. **付け足し**：一手に添える行動を最大2つ（§6）
6. **期限とタイミング**：点検時刻と、今送るか朝に回すか（§7）
7. **相手のタイプが分からないとき**：両方のタイプで計算して、どちらでも外れにくい一手を選び、違えば2通りを並べる（§8）

出力には、選んだ一手、付け足し、点数の一覧、適用した補正の ID、確かさ（`confidence`）と1位と2位の差（`margin`）を入れる（§11）。補正の ID が「なぜこの一手か」の説明の材料になる。

---

## 1. 入力項目

| キー | 値 | 意味 |
| --- | --- | --- |
| `danger` | true / false | 危ないサイン（暴力・脅し・監視・お金の支配・交友の制限・「別れるなら死ぬ」・本人の自傷の示唆） |
| `ongoing` | true / false | やりとりが今続いている、対面で口論中 |
| `lastSender` | `self` / `partner` / `none` | 最後に送ったのは（`none`：対面で終わった、どちらも送っていない） |
| `elapsed` | `lt3h` / `3h_12h` / `12h_2d` / `ge3d` | 最後のやりとりからの時間 |
| `partnerLast` | `apology` / `casual` / `explain` / `attack` / `talk_proposal` / `space` / `breakup` / `none` | 相手の最後のメッセージの種類（普通の話題／説明・反論／責める・追撃・最後通告／話し合いの提案／距離を置きたい／別れ話） |
| `selfLast` | `hold` / `apology` / `reconcile` / `attack` / `explain` / `none` | 自分の最後のメッセージの種類（保留宣言／謝罪／和解の連絡／責める・追撃／説明・反論） |
| `selfTemp` | `high` / `cooling` / `calm` | 本人の温度 |
| `cause` | `self` / `partner` / `both` / `unknown` | 原因の自己評価 |
| `severity` | `small` / `large` | 喧嘩の大きさ（すれ違い程度／信頼・約束に関わる） |
| `repeat` | true / false | 同じ喧嘩の繰り返しか |
| `afterMakeup` | true / false | 喧嘩は終わっている（仲直りした） |
| `intent` | `apologize` / `tell` / `request_space` / `none` | 本人の意図（謝りたい／伝えたい・切り出したい／距離を置きたいと伝えたい） |
| `talkScheduled` | true / false | 話し合いの日時がもう決まっている |
| `medium` | `text` / `call` / `in_person` | 場（文字／電話／対面・同居） |
| `lateNight` | true / false | 今が 0時〜6時 |
| `goal` | `reconcile` / `understood` / `settle` / `space` | 今回のゴール（仲直り／分かってほしい／決着／距離を置きたい） |
| `self` / `partner` | `{1..8: { side: "A"/"B"/null, conf: "sure"/"observed"/"est"/"none", source?, reason? }}` | 8領域のタイプ。`side` は領域の A 側・B 側（§9）。`conf` は確かさ。`source`（`diagnosis` 診断／`observed` 利用者の見立て／`stated` 本人が直した／`none`）と `reason`（est の理由：`weak` 優勢（弱）／`conflict` W と X の向きが逆）は AI に渡す人ごとの層で言い方を変えるためのもので、点数には使わない |

**確かさの係数** `w`：`sure` = 1.0、`observed` = 0.8、`est` = 0.6、`none` = 0。8領域の補正はすべて `点数 × w` で足す。

| 出どころ | 相手の領域 | 本人の領域 |
| --- | --- | --- |
| 診断（確度低の印なし） | `sure` 1.0（相手本人の診断。招待で同意があるときだけ） | `sure` 1.0 |
| 利用者の見立て（外から見える行動の2択） | `observed` 0.8 | — |
| 診断で確度低の印あり | `est` 0.6 | `est` 0.6 |
| 本人が直した | — | `sure` 1.0（`source: "stated"`） |
| 不明・拮抗 | `none` 0 | `none` 0 |

**相手由来の補正の上限（CAP）**：相手の8領域の補正（P1A〜P8B、P2A_silent、HG で振り替えた分を含む）と R2・R8（R8 は相手の領域1 として数える）を「相手由来の補正」とする。行動ごとに、相手由来の補正の合計 ＝（重み 1.0 の領域からの分の合計。上限なし）＋（重み 1.0 未満の領域からの分の合計を −30〜+30 に抑えたもの）。抑えて値が変わったら `applied` に `CAP` を入れる（1回だけ）。当たりにくい情報が大きな補正を積み上げて一手を反転させるのを防ぐ。

---

## 2. 局面の判定（上から順に、最初に当てはまったもの）

| 順 | 条件 | 局面キー |
| --- | --- | --- |
| 0 | `danger` | （安全ゲート：`safety` だけを返す） |
| 1 | `partnerLast` が `space` か `breakup`、かつ `elapsed ≠ ge3d`（最後に送ったのはどちらでもよい） | `space.partner` |
| 2 | `intent = request_space` | `space.self` |
| 3 | `partnerLast = apology` かつ `lastSender = partner` | `got_apology` |
| 4 | `ongoing`、または（`selfTemp = high` かつ `elapsed = lt3h` かつ `lastSender ≠ partner`） | `heated` |
| 5 | `intent = apologize` | `want_apologize` |
| 6 | `intent = tell` または `talkScheduled` | `before_talk` |
| 7 | `afterMakeup` | `repeat` なら `after_makeup.repeat`、でなければ `after_makeup.once` |
| 8 | `lastSender = partner` | `partnerLast` が `casual` → `partner_msg.a`、`explain` → `.b`、`attack` → `.c`、`talk_proposal` → `.d`（それ以外は `.b`） |
| 9 | `lastSender = self` かつ `elapsed` が `lt3h` か `3h_12h` | `waiting_partner` |
| 10 | `lastSender = self` かつ `selfLast` が `reconcile` か `apology` | `cold_war.ignored` |
| 11 | それ以外 | `elapsed = ge3d` なら `cold_war.long`、でなければ `cold_war.short` |

- 相手が最後に送ってきて自分が返していない場面は、経過時間に関係なく `partner_msg`（自分の番）
- 本人が熱いまま `partner_msg.b`・`.c` になった場合は、局面は変えずに R3（§4.2）で保留宣言を上げる。`.d`（話し合いの提案）は日時を返すだけ（R3d）、`.a`（普通の話題）は普通に応じる
- 相手が距離・別れ話を出したあと本人が何か返していても、3日以内なら `space.partner`（引き止めや電話の提案を出さない）

---

## 3. 基本点

◎ = 60（おすすめ）、○ = 35（候補）、· = 10（ありうる）、空欄 = 除外。`waiting_partner` の `wait_until` だけ 45（保留宣言を送ってあれば L1 で +20 されて ◎ 相当になる）。`want_apologize` の2つの謝罪は 50 ずつ（原因で差がつく）。

| 局面 | wait_until | pause_with_time | self_calm | acknowledge | ask_feeling | short_feeling | apology_partial | apology_full | accept_apology | restore_routine | propose_call | propose_talk_plan | prepare_points | accept_space | request_space |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| heated | | 60 | | 35 | | 10 | 35 | 10 | | | | 10 | | | 10 |
| waiting_partner | 45 | 60 | | | 10 | 10 | 35 | | | | 10 | 10 | | | 10 |
| partner_msg.a | | 10 | | 35 | | 10 | | | | 60 | | 10 | | | 10 |
| partner_msg.b | | 10 | | 60 | 35 | 10 | 10 | 10 | | | | 10 | | | 10 |
| partner_msg.c | | 10 | | 60 | | 10 | 35 | 10 | | | | | | | 10 |
| partner_msg.d | | 10 | | 10 | | 10 | | | | | | 60 | 35 | | |
| cold_war.short | | | | | 10 | 60 | 35 | 10 | | 35 | 35 | 10 | | | 10 |
| cold_war.long | | | | | 10 | 60 | 10 | 10 | | 10 | 35 | 35 | | | 10 |
| cold_war.ignored | 60 | | | | 35 | | | | | | | | | | |
| want_apologize | | | | 10 | | 10 | 50 | 50 | | | | 35 | | | |
| got_apology | | | | | | 35 | | | 60 | 10 | | 35 | | | |
| space.partner | | | | | | | | | | | | | | 60 | |
| space.self | | 35 | | | | | | | | | | | | | 60 |
| before_talk | | | | | 35 | 10 | | | | | 10 | 35 | 60 | | |
| after_makeup.once | | | 60 | | | 10 | | | | | | 35 | | | |
| after_makeup.repeat | | | | | 10 | 10 | | | | | | 60 | 35 | | |

- `self_calm` が一手になるのは `after_makeup.once` だけ。ほかの局面では付け足し（§6）として出す
- 除外（空欄）の行動は、補正でどれだけ点が上がっても選ばない

---

## 4. 補正

各行の「ID」が出力の `applied` に入る。8領域の補正は `× w`（§1）。相手由来の補正は重み 1.0 未満の分に上限 ±30（CAP、§1）。「×」は除外。

### 4.1 状況

| ID | 条件 | 補正 |
| --- | --- | --- |
| C1h | `cause = self` かつ局面 `heated` | apology_partial +15、apology_full +10 |
| C1 | `cause = self` かつ局面が `heated` 以外 | apology_full +55、apology_partial +5、short_feeling −10 |
| C2 | `cause = both` | apology_partial +10 |
| C3 | `cause = partner` | apology_full −20、apology_partial −5、short_feeling +5 |
| L1 | `selfLast = hold` かつ `elapsed` が `lt3h` か `3h_12h` | pause_with_time ×、wait_until +20、apology_partial −25、short_feeling −10、ask_feeling −10、propose_call −10（保留宣言のあとは追わない） |
| L1b | `selfLast = hold` かつ `elapsed` が `12h_2d` か `ge3d` | pause_with_time ×、restore_routine ×（「明日話したい」と約束したので「おはよう」で普段に戻すのは約束を破る）、short_feeling +5、propose_talk_plan +10。文面の指定 `return_as_promised`（「言ってた時間になったので」。言った時刻に戻る） |
| L2 | `selfLast = attack` | apology_partial +20 |
| L3 | 局面 `waiting_partner` かつ `selfLast` が `reconcile` か `apology` | wait_until +15、pause_with_time −15、apology_partial ×、apology_full × |
| E1 | 局面 `waiting_partner` かつ `elapsed = 3h_12h` | ask_feeling +5 |
| V1 | `severity = large` | restore_routine −25、apology_full +5、propose_talk_plan +10 |
| RR | 局面が `partner_msg.a`・`got_apology` 以外で、相手の領域8 が B（関係を戻す）でない（B なら確かさによらず、見立てでも外す） | restore_routine −25 |
| BRK | 局面 `space.partner` かつ `partnerLast = breakup` | 点数の補正なし。文面の指定 `breakup`（期限や連絡方法の確認をしない） |

### 4.2 共通ルール

| ID | 条件 | 補正 |
| --- | --- | --- |
| R1 | `selfTemp = high` | propose_call ×、prepare_points −20、apology_full −10 |
| R2 | 相手の領域3 が A（追う） | wait_until −20 × w |
| R3 | 局面が `partner_msg.b` か `partner_msg.c` かつ `selfTemp = high` | pause_with_time +60（文面は「ちゃんと返したいから、後で返すね」） |
| R3d | 局面 `partner_msg.d` かつ `selfTemp = high` | 点数の補正なし。文面の指定 `date_only`（「明日の夜なら話せる」と日時を返すだけ） |
| R4 | `lateNight` | propose_call ×。重い行動（§7）はタイミングを朝に回す |
| R7 | `medium = in_person` | 点数の補正なし。文面の指定 `spoken`（「送る」を「声をかける」に読み替え） |
| R8 | 自分の領域3 が A（追う）かつ相手の領域1 が B（距離を取る） | ask_feeling −10 × w、propose_call −15 × w（w は相手の領域1の係数） |

R5（1回に1つ）と R6（返事を求めない書き方）は文面の決まりなので点数には入れない。

### 4.3 ゴール

| ID | ゴール | 補正 |
| --- | --- | --- |
| G1 | `reconcile` | apology_partial +5、restore_routine +5、short_feeling +5 |
| G2 | `understood` | short_feeling +10、prepare_points +10、propose_talk_plan +5、apology_full −10（`cause = self` のときは apology_full を減らさない） |
| G3 | `settle` | propose_talk_plan +15、prepare_points +10、restore_routine −15 |
| G4 | `space` | request_space +50、short_feeling −10、restore_routine −20、propose_call −20、propose_talk_plan −10 |

### 4.4 相手の8領域（`× w`）

A・B は各領域の A 側・B 側（§9 の表）。

| ID | 領域・側 | 補正 |
| --- | --- | --- |
| P1A | 1 向き合う（A） | 局面 `heated`・`waiting_partner`・`cold_war.*`：文面の指定 `short_return`（戻る時刻を30分〜1時間に。保留宣言は早めに送る）。さらに局面 `waiting_partner`・`cold_war.*`：wait_until −15、apology_partial +10（HG）、propose_call +10 |
| P1B | 1 距離を取る（B） | propose_call −15、propose_talk_plan +10、pause_with_time +5、ask_feeling −5 |
| P2A | 2 即応（A） | wait_until −10、propose_call +15、apology_partial +15（HG）。さらに局面が `waiting_partner`・`cold_war.*` で `selfLast ≠ hold` なら apology_partial +15（HG。ID は P2A_silent。いつもすぐ返す人が黙っている＝強く傷ついている可能性。こちらが「後で話そう」と送った後の沈黙は除く） |
| P2B | 2 熟考（B） | wait_until +10、pause_with_time +5、propose_call −10 |
| P3A | 3 追う（A） | pause_with_time +10、short_feeling +5（wait_until −20 は R2） |
| P3B | 3 待つ（B） | wait_until +5 |
| P4A | 4 表に出す（A） | acknowledge +5 |
| P4B | 4 内に置く（B） | ask_feeling +10、propose_talk_plan +5 |
| P5A | 5 理由・具体（A） | apology_full +5。文面の指定 `concrete`（何が悪かったかを具体的に） |
| P5B | 5 気持ち・共感（B） | acknowledge +5。文面の指定 `feeling_first`（気持ちの受け止めから） |
| P6A | 6 主導する（A） | 文面の指定 `offer_choices`（日時は選択肢を渡す） |
| P6B | 6 調整する（B） | 文面の指定 `propose_date`（こちらから日時の案を出す） |
| P7A | 7 広げる（A） | 文面の指定 `stay_on_topic`（過去の話に乗らず今回の件に戻す） |
| P8A | 8 解決する（A） | restore_routine −20、propose_talk_plan +15、apology_full +5 |
| P8B | 8 関係を戻す（B） | restore_routine +40 |

**謝罪への加点の門（HG）**：表で「（HG）」と書いた apology_partial への加点（P1A +10、P2A +15、P2A_silent +15）は、相手のタイプが理由の加点なので、`cause` が `self`・`both`・`unknown` のとき、または `selfLast = attack` のときだけ apology_partial に入れる。`cause = partner`（かつ `selfLast ≠ attack`）のときは同じ点を ask_feeling に振り替え（「黙っているのが珍しいので心配している」）、`applied` に `HG` を入れる。相手のタイプに合わせて、非のない本人に謝らせないため。

### 4.5 自分の8領域

| ID | 領域・側 | 補正 |
| --- | --- | --- |
| S3A | 3 追う（A） | 局面 `waiting_partner`：ask_feeling −10。付け足し AO2 の条件 |
| S2A | 2 即応（A） | 付け足し AO2 の条件 |
| S4A | 4 表に出す（A） | 文面の指定 `tone_down` |
| S7A | 7 広げる（A） | prepare_points +10、文面の指定 `one_topic` |
| S8A | 8 解決する（A） | 付け足し AO4 の条件 |

---

## 5. 一手の選び方と同点の扱い

- 除外されていない行動のうち、点が最も高いものを一手にする（`self_calm` は `after_makeup.once` 以外では一手にしない）
- 同点のときは次の優先順で前にあるほう（安全で取り返しのつく行動を先にした）：

`pause_with_time` → `acknowledge` → `accept_space` → `accept_apology` → `wait_until` → `apology_partial` → `short_feeling` → `restore_routine` → `ask_feeling` → `propose_talk_plan` → `prepare_points` → `apology_full` → `self_calm` → `propose_call` → `request_space`

- 一手が apology_partial か apology_full で、`cause = unknown` かつ `selfLast ≠ attack` なら、メモ `confirm_cause` を付ける（謝る文を書く前に「言い方がきつかったと自分でも思う？」と確かめる）

---

## 6. 付け足し（最大2つ。上から順に、一手と同じものは足さない）

| ID | 条件 | 足す行動 |
| --- | --- | --- |
| AO1 | 局面 `heated` | 一手が pause_with_time 以外なら pause_with_time。そのうえで self_calm |
| AO2 | 一手が pause_with_time か wait_until で、自分の領域2 が A・自分の領域3 が A・`selfTemp = high`・`lateNight` のどれか | self_calm（下書きを預ける） |
| AO3 | 局面 `partner_msg.c` | pause_with_time |
| AO4 | 局面 `partner_msg.a` かつ自分の領域8 が A（解決する） | propose_talk_plan（「夜ちゃんと話したい」） |
| AO5 | 局面 `cold_war.long` | propose_talk_plan |
| AO6 | 局面 `want_apologize` かつ相手の領域8 が A（w > 0） | propose_talk_plan |
| AO7 | 局面 `got_apology` かつ `selfTemp ≠ calm` | propose_talk_plan（後日の話し合いを予約）。文面の指定 `need_time` |
| AO8 | 局面 `before_talk` かつ `talkScheduled` でない | propose_talk_plan |
| AO9 | 局面 `after_makeup.once` | wait_until（1週間後に見直す） |
| AO10 | 局面 `after_makeup.repeat` | prepare_points。メモ `use_diagnosis`（ふたりの診断結果を話の材料にする） |
| AO11 | 局面 `cold_war.ignored` | ask_feeling（期限が来たら1回だけ） |
| AO12 | 一手が apology_partial・short_feeling・ask_feeling のどれかで、局面が `heated` 以外、`lateNight` でなく、相手の領域1 が分かっていて（`conf ≠ none`）、propose_call の点が 30 以上 | propose_call（「電話していい？」）。相手が距離を取る派かもしれないときは付けない |
| AO13 | `lateNight` かつ一手が重い行動（§7） | self_calm（下書きを預ける） |

---

## 7. 期限とタイミング

**タイミング**：`lateNight` のとき、重い行動（apology_full、apology_partial、short_feeling、ask_feeling、propose_call、propose_talk_plan、prepare_points、restore_routine、request_space）は `morning`（朝に送る）。それ以外は `now`。

**点検時刻**（`recheck`）：

| 条件 | 値 |
| --- | --- |
| `after_makeup.once` | `+7d` |
| `cold_war.ignored` | `+24h` |
| `heated` | 相手の領域1 が A なら `+30m`、それ以外 `+2h`。`lateNight` なら `next_morning` |
| 一手か付け足しに wait_until・pause_with_time がある | 相手の領域2 が A なら `+3h`、B なら `next_noon`、不明なら `next_morning`。`lateNight` なら `next_morning` |
| それ以外 | `+24h` |

---

## 8. 相手のタイプが分からないとき

局面ごとに「鍵になる相手の領域」を1つ決めておく。

| 局面 | 鍵の領域 |
| --- | --- |
| heated | 1 |
| waiting_partner | 2 |
| partner_msg.a | 8 |
| partner_msg.b | 5 |
| partner_msg.c | 3 |
| partner_msg.d | 6 |
| cold_war.short / cold_war.long | 8 |
| cold_war.ignored | 2 |
| want_apologize | 5 |
| before_talk | 5 |
| space.self | 3 |
| got_apology・space.partner・after_makeup.* | なし |

鍵の領域の `conf` が `none` のとき：

1. その領域を A（`sure`）にした場合と B（`sure`）にした場合の両方で点数を出す
2. 行動ごとに2つの点の**低いほう**を取り、それが最も高い行動を一手にする（どちらのタイプでも外れにくい一手）。同点は §5 の優先順
3. A のときの一手と B のときの一手が違えば、`variants: { A: …, B: … }` として2通りを出す（「相手がこっちのタイプなら」）
4. 付け足し・期限は、選んだ一手と元の入力（鍵の領域は不明のまま）で決める
5. `confidence` は `provisional` から始まる（§11）。一手が同じでも文面の指定が相手のタイプで変わるときは `styleVariants` に2通りを出す（§11）

---

## 9. 診断結果からの変換

8領域の A 側・B 側：

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

三択版の結果（profile3）からの変換（`domainFlags3` を使う。`js/consult/from_diagnosis.js`）：

| 三択版の結果 | side | conf | source | reason |
| --- | --- | --- | --- | --- |
| 左右（W）で優勢な傾向があり、確度低の印（優勢（弱）・W と X の向きが逆）がない | 優勢な側 | `sure` | `diagnosis` | — |
| 優勢な傾向はあるが、確度低の印がある | 優勢な側 | `est` | `diagnosis` | `conflict`（向きが逆。両方の印があればこちら）か `weak` |
| 拮抗（優勢な傾向なし） | null | `none` | `diagnosis` | — |
| 利用者が相手について2択で答えた（`domainsFromChoices`） | 答えた側 | `observed` | `observed` | — |
| 答えていない | null | `none` | `none` | — |

- **相手の診断の取り込み**（`domainsFromInvite`）：相手が「相談モードで使われる」ことに同意したとき（`consent === true`）だけ上の変換で取り込む。同意がなければ8領域すべて `none`。相手が外したら（`removePartnerDiagnosis`）出どころが `diagnosis` の領域だけ `none` に戻し、利用者の見立て（`observed`）は残す
- **本人の修正**（`applySelfCorrections`）：本人が「これは違う」と直した領域は `{ side: 直した側, conf: "sure", source: "stated" }`（重み 1.0）

---

## 10. 検証ケース

実装はこの全ケースを `tests/consult.test.mjs` で確かめる。相手・自分の領域は書いたもの以外すべて `none`。`cause` は書かなければ `unknown`、`severity` は `small`、`selfTemp` は `cooling`、`goal` は `reconcile`、`medium` は `text`、真偽値は false。

| # | 場面 | 主な入力 | 局面 | 一手 | 付け足し | その他 |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | 23時、LINE で言い合い。自分が最後に送り、相手が2時間既読無視 | lastSender=self, elapsed=lt3h, selfLast=explain, 自分 3=A sure・2=A sure, 相手 2=B sure・1=B sure | waiting_partner | pause_with_time | self_calm | recheck=next_noon |
| S2 | 相手が「もういい」と送ってきて、それきり | lastSender=partner, partnerLast=attack, elapsed=3h_12h | partner_msg.c | acknowledge | pause_with_time | — |
| S3 | 翌朝、相手から「おはよう」だけ。自分は解決派 | lastSender=partner, partnerLast=casual, elapsed=3h_12h, 自分 8=A sure | partner_msg.a | restore_routine | propose_talk_plan | — |
| S4 | 3日間お互い無言。原因は自分の遅刻 | lastSender=none, elapsed=ge3d, cause=self | cold_war.long | apology_full | propose_talk_plan | — |
| S5 | 長文で謝られた。まだ怒っている | lastSender=partner, partnerLast=apology, selfTemp=high | got_apology | accept_apology | propose_talk_plan | 文面の指定に need_time |
| S6 | 相手が「しばらく距離を置きたい」 | lastSender=partner, partnerLast=space | space.partner | accept_space | なし | — |
| S7 | 同棲中、口論のあと相手が部屋にこもった | ongoing, medium=in_person | heated | pause_with_time | self_calm | 文面の指定に spoken、recheck=+2h |
| S8 | 自分が怒っていて、相手の LINE に返したくない | lastSender=partner, partnerLast=explain, elapsed=3h_12h, selfTemp=high | partner_msg.b | pause_with_time | self_calm | applied に R3 |
| S9 | 言い合いの最中、自分が明らかに言いすぎた | ongoing, selfLast=attack, cause=self | heated | apology_partial | pause_with_time, self_calm | — |
| S10 | 毎月同じことで喧嘩になる | afterMakeup, repeat | after_makeup.repeat | propose_talk_plan | prepare_points | メモに use_diagnosis |
| S11 | 「別れるなら死ぬ」と言われた | danger | （ゲート） | safety | なし | phase は null |
| S12 | 深夜2時、言いたいことを長文で書いた | intent=tell, lateNight | before_talk | prepare_points | propose_talk_plan, self_calm | timing=morning |
| C1 | §3.7 相手が熟考・距離を取る（S1 と同じ入力で自分の領域なし） | lastSender=self, elapsed=lt3h, selfLast=explain, 相手 2=B sure・1=B sure | waiting_partner | pause_with_time | なし | recheck=next_noon |
| C2 | §3.7 相手が即応・向き合う | 同上で 相手 2=A sure・1=A sure | waiting_partner | apology_partial | propose_call | メモに confirm_cause、文面の指定に short_return、confidence=sure、margin=20、styleVariants={domain: 5, A: [concrete], B: [feeling_first]} |
| C2b | C2 で原因は相手 | C2 と同じで cause=partner | waiting_partner | pause_with_time | なし | 文面の指定に short_return、recheck=+3h、applied に HG（pause 60・ask_feeling 50・apology_partial 35・propose_call 35） |
| C3 | §3.7 相手が分からない | 同上で 相手なし | waiting_partner | pause_with_time | なし | variants={A: apology_partial, B: pause_with_time} |
| T1 | 冷戦半日〜2日、相手は関係を戻す派 | lastSender=none, elapsed=12h_2d, cause=both, 相手 8=B sure | cold_war.short | restore_routine | なし | — |
| T2 | 同じで相手は解決派 | 同上で 相手 8=A sure | cold_war.short | short_feeling | なし | 相手の領域1 が不明なので AO12 は付けない |
| T3 | 冷戦で、自分は距離を置きたい | lastSender=none, elapsed=12h_2d, goal=space | cold_war.short | request_space | なし | — |
| T4 | 和解の連絡が半日以上無視されている | lastSender=self, selfLast=reconcile, elapsed=12h_2d | cold_war.ignored | wait_until | ask_feeling | recheck=+24h |
| T5 | 謝りたい。原因は両方、相手は解決派 | intent=apologize, cause=both, 相手 8=A sure | want_apologize | apology_partial | propose_talk_plan | — |
| T6 | 相手から話し合いの提案が来た | lastSender=partner, partnerLast=talk_proposal | partner_msg.d | propose_talk_plan | なし | — |
| T7 | 不満を切り出したい。日時は未定、自分は広げる派 | intent=tell, 自分 7=A sure | before_talk | prepare_points | propose_talk_plan | 文面の指定に one_topic |
| T8 | 仲直りしたけど一回きりのモヤモヤ | afterMakeup | after_makeup.once | self_calm | wait_until | recheck=+7d |
| T9 | 保留宣言は送った。相手は追う派 | lastSender=self, selfLast=hold, elapsed=lt3h, 相手 3=A sure | waiting_partner | wait_until | なし | recheck=next_morning |
| T10 | 自分から距離を置きたいと伝えたい | intent=request_space | space.self | request_space | なし | — |
| T11 | 「明日話そう」と保留宣言して半日以上たった | lastSender=self, selfLast=hold, elapsed=12h_2d | cold_war.short | short_feeling | なし | 文面の指定に return_as_promised、variants=null（restore_routine は除外） |
| T12 | 相手から別れ話。自分はもう返した | lastSender=self, partnerLast=breakup, elapsed=3h_12h | space.partner | accept_space | なし | 文面の指定に breakup |
| T13 | 相手から話し合いの提案。自分はまだ熱い | lastSender=partner, partnerLast=talk_proposal, selfTemp=high | partner_msg.d | propose_talk_plan | なし | 文面の指定に date_only、applied に R3 がない |
| T14 | 相手から「おはよう」。自分はまだ熱い | lastSender=partner, partnerLast=casual, selfTemp=high | partner_msg.a | restore_routine | なし | — |
| T15 | 深夜に謝りたい。原因は両方 | intent=apologize, cause=both, lateNight | want_apologize | apology_partial | self_calm | timing=morning |
| T16 | S4 で、ゴールが「分かってほしい」 | S4 と同じで goal=understood | cold_war.long | apology_full | propose_talk_plan | — |
| T17 | 確かさ | C3 と S5 の入力 | （C3・S5 と同じ） | （同じ） | （同じ） | C3 は confidence=provisional、S5 は confidence=situational |
| T18 | 冷戦半日〜2日、相手は関係を戻す派（利用者の見立て） | lastSender=none, elapsed=12h_2d, cause=both, 相手 8=B observed | cold_war.short | restore_routine | なし | applied に CAP（restore_routine 35 + P8B 32 → 上限 30 + G1 5 = 70、short_feeling 65） |
| T19 | 同じで相手の診断が確度低 | 同上で 相手 8=B est | cold_war.short | short_feeling | なし | variants=null（restore_routine 35 + 24 + 5 = 64） |
| T20 | C2 を利用者の見立てで | C2 と同じで 相手 2=A・1=A observed | waiting_partner | apology_partial | propose_call | applied に CAP、メモに confirm_cause、confidence=est、margin=10（apology_partial 35 + 32 → 上限 30 + 5 = 70、pause_with_time 60、propose_call 30） |

### 10.1 計算の例（C2：相手が即応・向き合う）

| 行動 | 基本 | 補正 | 合計 |
| --- | --- | --- | --- |
| apology_partial | 35 | P1A +10、P2A +15、P2A_silent +15、G1 +5 | **80** |
| pause_with_time | 60 | （P1A は保留宣言を減点しない） | 60 |
| propose_call | 10 | P1A +10、P2A +15 | 35 |
| wait_until | 45 | P1A −15、P2A −10 | 20 |
| short_feeling | 10 | G1 +5 | 15 |
| ask_feeling・propose_talk_plan・request_space | 10 | — | 10 |

→ 一手は apology_partial（2位の pause_with_time と 20 点差、鍵の領域2 が sure なので confidence は sure）。相手の領域1 が分かっていて propose_call が 35（30 以上）なので AO12 で「電話していい？」を付け足す。原因が分からないのでメモ `confirm_cause`（謝る前に確かめる）。P1A で文面の指定 `short_return`。相手の領域5 が不明なので `styleVariants` に理由派・気持ち派の2通り。

C2b（同じで `cause = partner`）では、HG で謝罪への加点 40（P1A 10・P2A 15・P2A_silent 15）が ask_feeling に回る：pause_with_time 60、ask_feeling 50（10 + 40）、apology_partial 35（35 − C3 5 + G1 5）、propose_call 35 → 一手は pause_with_time。

---

## 11. 出力

C2 の出力：

```json
{
  "gate": null,
  "phase": "waiting_partner",
  "action": "apology_partial",
  "addons": ["propose_call"],
  "timing": "now",
  "recheck": "+24h",
  "styles": ["short_return"],
  "styleVariants": { "domain": 5, "A": ["concrete"], "B": ["feeling_first"] },
  "notes": ["confirm_cause"],
  "variants": null,
  "confidence": "sure",
  "margin": 20,
  "scores": [["apology_partial", 80], ["pause_with_time", 60], ["propose_call", 35], ["wait_until", 20], ["short_feeling", 15], ["ask_feeling", 10], ["propose_talk_plan", 10], ["request_space", 10]],
  "applied": ["P1A", "P2A", "P2A_silent", "G1", "AO12"],
  "avoid": ["read_receipt", "interrogate", "ultimatum"]
}
```

- `scores`：除外されていない行動の点（高い順、同点は §5 の優先順）。相手が分からないとき（§8）は A・B の低いほう
- `applied`：点・除外・文面の指定を実際に動かした補正の ID（状況 → 共通ルール → 相手の8領域 → 自分の8領域 → ゴール → 付け足しの順）
- `margin`：一手の点 − 2位の点（相手が分からないときは低いほうの点で）。候補が1つだけの局面は null
- `confidence`：局面の鍵の領域（§8）の `conf` が `none` なら `provisional`、`est` か `observed` なら `est`、`sure` なら `sure`。鍵の領域がない局面は `situational`。そのうえで `margin` が 10 未満なら1段下げる（sure → est → provisional。situational はそのまま）
- `styleVariants`：一手の文面を左右する相手の領域（apology_partial・apology_full・acknowledge・accept_apology・prepare_points → 5、propose_talk_plan → 6、pause_with_time → 1）が `none` のとき `{ domain, A: [...], B: [...] }`。領域5 は A `concrete`／B `feeling_first`、領域6 は A `offer_choices`／B `propose_date`、領域1 は A `short_return`／B なし。それ以外は null
- 安全ゲートのときは `{ gate: "danger", phase: null, action: "safety", addons: [], timing: "now", recheck: null, styles: [], styleVariants: null, notes: [], variants: null, confidence: null, margin: null, scores: [], applied: [], avoid: [] }`

`avoid` は [consult-mode.md](consult-mode.md) §3.3 の「避ける言葉」を局面ごとにそのまま返す。

---

## 12. 変更履歴

- 2026-10-14：初版（consult-mode.md §3.3 吟味版から点数化）。手計算の検証で2か所直した：C1 を +45 → +50（S4 で「気持ちを伝える」と同点になり謝罪が選ばれなかった）、L1 に「保留宣言のあとは追わない」減点を追加し P2A_silent を保留宣言の後は除外（T9 で相手のタイプが分からないとき謝罪の連投が選ばれた）
- 2026-10-14：Fable のレビュー（consult-answer-guide.md §1.6）を受けて：P1A は保留宣言の減点（−15）をやめ、heated・waiting_partner・cold_war.* で `short_return` を出す／相手のタイプによる謝罪への加点（P1A・P2A・P2A_silent）に門 HG（原因が相手なら ask_feeling に振り替え）、原因不明で謝る一手ならメモ `confirm_cause`／R3 を partner_msg.b・c に限り、.d で熱いときは `date_only`（R3d）／局面1 は lastSender を問わず3日以内なら space.partner、別れ話は `breakup`（BRK）／AO12 は相手の領域1 が分かっているときだけ／L1 は半日未満だけにし、半日以上は L1b（`return_as_promised`）／C1 を +50 → +55、G2 の apology_full −10 は原因が自分なら効かせない／出力に `confidence`・`margin`・`styleVariants` を追加／重い行動に apology_partial・request_space を追加／補正 ID を改名（P1 → RR、T1 → E1）／§11 の出力例を実際の C2 の出力に合わせた（recheck は +24h、ask_feeling 10 が抜けていた）。検証ケースは T2 の付け足しが propose_call → なしに変わり、C2b・T11〜T17 を追加。あわせて L1b で restore_routine も除外（T11 で相手が関係を戻す派なら「おはよう」が一手になり、保留宣言の約束を破るため。T11 は相手のタイプによらず short_feeling）
- 2026-10-15：Fable の改善案を採用（decisions.md D1〜D5）：確かさに `observed`（利用者の見立て 0.8）を追加し、2択の答えは est → observed、領域に出どころ `source` と確度低の理由 `reason` を付ける／相手由来の補正（P1A〜P8B・R2・R8）は重み 1.0 未満の分の合計を行動ごとに ±30 に抑える（CAP）／RR は相手が関係を戻す派なら確かさによらず外し、それ以外は −25（×(1 − w8B) をやめた）／confidence は observed を est と同じに扱う／相手の診断の取り込みは同意があるときだけ、外したら診断由来の領域を不明に戻す／本人が直した領域は stated・1.0。検証ケース T18〜T20 を追加（既存のケースの結果は変わらない）。人ごとの層（`person_layer.js`）と送る前チェック（`draft_check.js`）は判定の点数には関わらない
