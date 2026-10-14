// 相談モードの判定表（データ）。仕様：docs/consult-scoring.md
// 判定の手順は js/consult/judge.js。ここには表の数字と、補正・付け足しのルールだけを置く。
// 補正の ID は出力の applied に入り、「なぜこの一手か」の説明の材料になる。

/** 行動（§3 の列の順）。safety は安全ゲート専用なのでここには入れない */
export const ACTIONS = [
  "wait_until", "pause_with_time", "self_calm", "acknowledge", "ask_feeling", "short_feeling",
  "apology_partial", "apology_full", "accept_apology", "restore_routine", "propose_call",
  "propose_talk_plan", "prepare_points", "accept_space", "request_space",
];

/** 局面キー（§2・§3 の16個） */
export const PHASES = [
  "heated", "waiting_partner",
  "partner_msg.a", "partner_msg.b", "partner_msg.c", "partner_msg.d",
  "cold_war.short", "cold_war.long", "cold_war.ignored",
  "want_apologize", "got_apology", "space.partner", "space.self", "before_talk",
  "after_makeup.once", "after_makeup.repeat",
];

// ---------------------------------------------------------------- §3 基本点
// 列は ACTIONS と同じ順。_ は空欄（除外）
const _ = null;
const BASE_ROWS = {
  //                     wait pause calm  ack  ask short a_pt a_fl a_ap rest call plan prep a_sp r_sp
  "heated":              [_,   60,  _,   35,  _,  10,  35,  10,  _,   _,   _,   10,  _,   _,   10],
  "waiting_partner":     [45,  60,  _,   _,   10, 10,  35,  _,   _,   _,   10,  10,  _,   _,   10],
  "partner_msg.a":       [_,   10,  _,   35,  _,  10,  _,   _,   _,   60,  _,   10,  _,   _,   10],
  "partner_msg.b":       [_,   10,  _,   60,  35, 10,  10,  10,  _,   _,   _,   10,  _,   _,   10],
  "partner_msg.c":       [_,   10,  _,   60,  _,  10,  35,  10,  _,   _,   _,   _,   _,   _,   10],
  "partner_msg.d":       [_,   10,  _,   10,  _,  10,  _,   _,   _,   _,   _,   60,  35,  _,   _ ],
  "cold_war.short":      [_,   _,   _,   _,   10, 60,  35,  10,  _,   35,  35,  10,  _,   _,   10],
  "cold_war.long":       [_,   _,   _,   _,   10, 60,  10,  10,  _,   10,  35,  35,  _,   _,   10],
  "cold_war.ignored":    [60,  _,   _,   _,   35, _,   _,   _,   _,   _,   _,   _,   _,   _,   _ ],
  "want_apologize":      [_,   _,   _,   10,  _,  10,  50,  50,  _,   _,   _,   35,  _,   _,   _ ],
  "got_apology":         [_,   _,   _,   _,   _,  35,  _,   _,   60,  10,  _,   35,  _,   _,   _ ],
  "space.partner":       [_,   _,   _,   _,   _,  _,   _,   _,   _,   _,   _,   _,   _,   60,  _ ],
  "space.self":          [_,   35,  _,   _,   _,  _,   _,   _,   _,   _,   _,   _,   _,   _,   60],
  "before_talk":         [_,   _,   _,   _,   35, 10,  _,   _,   _,   _,   10,  35,  60,  _,   _ ],
  "after_makeup.once":   [_,   _,   60,  _,   _,  10,  _,   _,   _,   _,   _,   35,  _,   _,   _ ],
  "after_makeup.repeat": [_,   _,   _,   _,   10, 10,  _,   _,   _,   _,   _,   60,  35,  _,   _ ],
};

/** BASE[局面][行動] = 基本点。空欄（除外）の行動はキーが無い */
export const BASE = Object.fromEntries(Object.entries(BASE_ROWS).map(([phase, row]) => [
  phase, Object.fromEntries(ACTIONS.map((a, i) => [a, row[i]]).filter(([, v]) => v != null)),
]));

// ---------------------------------------------------------------- §5 同点の優先順（安全で取り返しのつく行動が先）
export const PRIORITY = [
  "pause_with_time", "acknowledge", "accept_space", "accept_apology", "wait_until", "apology_partial",
  "short_feeling", "restore_routine", "ask_feeling", "propose_talk_plan", "prepare_points", "apology_full",
  "self_calm", "propose_call", "request_space",
];

/** self_calm を一手にしてよい局面（§3・§5） */
export const SELF_CALM_PHASE = "after_makeup.once";

// ---------------------------------------------------------------- §7 重い行動（深夜は朝に回す）
export const HEAVY = new Set([
  "apology_full", "short_feeling", "ask_feeling", "propose_call", "propose_talk_plan", "prepare_points", "restore_routine",
  "apology_partial", "request_space",
]);

// ---------------------------------------------------------------- §8 鍵になる相手の領域（null＝なし）
export const KEY_PARTNER_DOMAIN = {
  "heated": 1, "waiting_partner": 2,
  "partner_msg.a": 8, "partner_msg.b": 5, "partner_msg.c": 3, "partner_msg.d": 6,
  "cold_war.short": 8, "cold_war.long": 8, "cold_war.ignored": 2,
  "want_apologize": 5, "before_talk": 5, "space.self": 3,
  "got_apology": null, "space.partner": null, "after_makeup.once": null, "after_makeup.repeat": null,
};

// ---------------------------------------------------------------- 避ける言葉（consult-mode.md §3.3 の判定 ID だけ）
export const AVOID = {
  "heated": ["long", "past", "generalize", "ultimatum", "sarcasm"],
  "waiting_partner": ["read_receipt", "interrogate", "ultimatum"],
  "partner_msg.a": ["sarcasm"],
  "partner_msg.b": ["long", "but_apology"],
  "partner_msg.c": ["sarcasm", "generalize", "ultimatum"],
  "partner_msg.d": [],
  "cold_war.short": ["read_receipt", "ultimatum"],
  "cold_war.long": ["read_receipt", "ultimatum"],
  "cold_war.ignored": ["multi"],
  "want_apologize": ["but_apology", "long"],
  "got_apology": ["past", "sarcasm"],
  "space.partner": ["multi", "long", "ultimatum"],
  "space.self": ["ultimatum"],
  "before_talk": ["character", "generalize", "past"],
  "after_makeup.once": ["past"],
  "after_makeup.repeat": ["past", "generalize"],
};

/** 確かさの係数 w（§1） */
export const CONF_WEIGHT = { sure: 1.0, est: 0.6, none: 0 };

// ---------------------------------------------------------------- §11 確かさ（confidence）と文面の2通り（styleVariants）
/** 一手と2位の差がこれ未満なら confidence を1段下げる（sure → est → provisional。situational はそのまま） */
export const MARGIN_LOW = 10;
export const CONFIDENCE_DOWN = { sure: "est", est: "provisional", provisional: "provisional", situational: "situational" };
/** 一手の文面を左右する相手の領域。その領域が不明なら styleVariants に A・B の文面の指定を並べる */
export const STYLE_KEY_BY_ACTION = {
  apology_partial: 5, apology_full: 5, acknowledge: 5, accept_apology: 5, prepare_points: 5, propose_talk_plan: 6, pause_with_time: 1,
};
export const STYLE_BY_DOMAIN_SIDE = {
  1: { A: ["short_return"], B: [] },
  5: { A: ["concrete"], B: ["feeling_first"] },
  6: { A: ["offer_choices"], B: ["propose_date"] },
};

// ---------------------------------------------------------------- §4 補正
// 1行 = 1つの補正。c（判定の文脈）は judge.js の scoreActions が渡す：
//   c.in    … 入力（既定値で埋めたもの）
//   c.phase … 局面キー
//   c.pw(d, side) / c.sw(d, side) … 相手／自分の領域 d が side なら確かさの係数 w、違えば 0
// 形：{ id, when?(c) → 真偽, w?(c) → 係数（0 なら適用しない。既定 1）, add?: {行動: 点}（× w して足す）,
//       apology?: 点（× w。謝罪への加点の門 HG を通す。開いていれば apology_partial、閉じていれば ask_feeling に足す）,
//       exclude?: [行動]（×＝除外）, styles?: [文面の指定], always?: 真（点数・文面に効かなくても applied に入れる） }
// 同じ ID の行が複数あるのは、局面や条件によって中身が変わる補正（P1A・G2）。
// applied に入る順は §11 の出力例に合わせて 状況 → 共通ルール → 相手の8領域 → 自分の8領域 → ゴール。
const inPhase = (...ps) => (c) => ps.includes(c.phase);
const isWaitOrCold = (c) => c.phase === "waiting_partner" || c.phase.startsWith("cold_war.");
const partner = (d, side) => (c) => c.pw(d, side);
const self = (d, side) => (c) => c.sw(d, side);
const holdSent = (c) => c.in.selfLast === "hold";
const early = (c) => c.in.elapsed === "lt3h" || c.in.elapsed === "3h_12h";

/**
 * 謝罪への加点の門（HG）：相手のタイプ（P1A・P2A・P2A_silent）を理由にした apology_partial への加点は、
 * 原因が自分・両方・分からない、または自分の最後が責める・追撃のときだけ。原因が相手なら同じ点を ask_feeling に振り替える
 */
export const apologyGateOpen = (x) => x.cause !== "partner" || x.selfLast === "attack";

export const ADJUSTMENTS = [
  // 4.1 状況
  { id: "C1h", when: c => c.in.cause === "self" && c.phase === "heated", add: { apology_partial: 15, apology_full: 10 } },
  { id: "C1", when: c => c.in.cause === "self" && c.phase !== "heated", add: { apology_full: 55, apology_partial: 5, short_feeling: -10 } },
  { id: "C2", when: c => c.in.cause === "both", add: { apology_partial: 10 } },
  { id: "C3", when: c => c.in.cause === "partner", add: { apology_full: -20, apology_partial: -5, short_feeling: 5 } },
  // 保留宣言のあと：半日未満は追わない（L1）、半日以上たったら言った時刻に戻る（L1b）
  { id: "L1", when: c => holdSent(c) && early(c), exclude: ["pause_with_time"],
    add: { wait_until: 20, apology_partial: -25, short_feeling: -10, ask_feeling: -10, propose_call: -10 } },
  // 「明日話したい」と約束したので、「おはよう」で普段に戻す（restore_routine）のも約束を破ることになる
  { id: "L1b", when: c => holdSent(c) && !early(c), exclude: ["pause_with_time", "restore_routine"],
    add: { short_feeling: 5, propose_talk_plan: 10 }, styles: ["return_as_promised"] },
  { id: "L2", when: c => c.in.selfLast === "attack", add: { apology_partial: 20 } },
  { id: "L3", when: c => c.phase === "waiting_partner" && (c.in.selfLast === "reconcile" || c.in.selfLast === "apology"),
    add: { wait_until: 15, pause_with_time: -15 }, exclude: ["apology_partial", "apology_full"] },
  { id: "E1", when: c => c.phase === "waiting_partner" && c.in.elapsed === "3h_12h", add: { ask_feeling: 5 } },
  { id: "V1", when: c => c.in.severity === "large", add: { restore_routine: -25, apology_full: 5, propose_talk_plan: 10 } },
  // RR：w8B（相手の領域8 が B の確かさ）が 1 なら効かない
  { id: "RR", when: c => c.phase !== "partner_msg.a" && c.phase !== "got_apology", w: c => 1 - c.pw(8, "B"), add: { restore_routine: -25 } },
  { id: "BRK", when: c => c.phase === "space.partner" && c.in.partnerLast === "breakup", styles: ["breakup"] },

  // 4.2 共通ルール（R5・R6 は文面の決まりなので点数に入れない）
  { id: "R1", when: c => c.in.selfTemp === "high", exclude: ["propose_call"], add: { prepare_points: -20, apology_full: -10 } },
  { id: "R2", w: partner(3, "A"), add: { wait_until: -20 } },
  { id: "R3", when: c => (c.phase === "partner_msg.b" || c.phase === "partner_msg.c") && c.in.selfTemp === "high", add: { pause_with_time: 60 } },
  { id: "R3d", when: c => c.phase === "partner_msg.d" && c.in.selfTemp === "high", styles: ["date_only"] },
  { id: "R4", when: c => c.in.lateNight, exclude: ["propose_call"], always: true },   // 重い行動を朝に回す（§7）
  { id: "R7", when: c => c.in.medium === "in_person", styles: ["spoken"] },
  { id: "R8", when: c => c.sw(3, "A") > 0, w: partner(1, "B"), add: { ask_feeling: -10, propose_call: -15 } },

  // 4.4 相手の8領域（× w）
  { id: "P1A", when: inPhase("heated"), w: partner(1, "A"), styles: ["short_return"] },
  { id: "P1A", when: isWaitOrCold, w: partner(1, "A"), add: { wait_until: -15, propose_call: 10 }, apology: 10, styles: ["short_return"] },
  { id: "P1B", w: partner(1, "B"), add: { propose_call: -15, propose_talk_plan: 10, pause_with_time: 5, ask_feeling: -5 } },
  { id: "P2A", w: partner(2, "A"), add: { wait_until: -10, propose_call: 15 }, apology: 15 },
  // いつもすぐ返す人が黙っている＝強く傷ついている可能性。こちらが保留宣言を送った後の沈黙は除く
  { id: "P2A_silent", when: c => isWaitOrCold(c) && c.in.selfLast !== "hold", w: partner(2, "A"), apology: 15 },
  { id: "P2B", w: partner(2, "B"), add: { wait_until: 10, pause_with_time: 5, propose_call: -10 } },
  { id: "P3A", w: partner(3, "A"), add: { pause_with_time: 10, short_feeling: 5 } },
  { id: "P3B", w: partner(3, "B"), add: { wait_until: 5 } },
  { id: "P4A", w: partner(4, "A"), add: { acknowledge: 5 } },
  { id: "P4B", w: partner(4, "B"), add: { ask_feeling: 10, propose_talk_plan: 5 } },
  { id: "P5A", w: partner(5, "A"), add: { apology_full: 5 }, styles: ["concrete"] },
  { id: "P5B", w: partner(5, "B"), add: { acknowledge: 5 }, styles: ["feeling_first"] },
  { id: "P6A", w: partner(6, "A"), styles: ["offer_choices"] },
  { id: "P6B", w: partner(6, "B"), styles: ["propose_date"] },
  { id: "P7A", w: partner(7, "A"), styles: ["stay_on_topic"] },
  { id: "P8A", w: partner(8, "A"), add: { restore_routine: -20, propose_talk_plan: 15, apology_full: 5 } },
  { id: "P8B", w: partner(8, "B"), add: { restore_routine: 40 } },

  // 4.5 自分の8領域（S2A・S8A は付け足し AO2・AO4 の条件。ADDONS 側で applied に入れる）
  { id: "S3A", when: inPhase("waiting_partner"), w: self(3, "A"), add: { ask_feeling: -10 } },
  { id: "S4A", w: self(4, "A"), styles: ["tone_down"] },
  { id: "S7A", w: self(7, "A"), add: { prepare_points: 10 }, styles: ["one_topic"] },

  // 4.3 ゴール
  { id: "G1", when: c => c.in.goal === "reconcile", add: { apology_partial: 5, restore_routine: 5, short_feeling: 5 } },
  { id: "G2", when: c => c.in.goal === "understood", add: { short_feeling: 10, prepare_points: 10, propose_talk_plan: 5 } },
  { id: "G2", when: c => c.in.goal === "understood" && c.in.cause !== "self", add: { apology_full: -10 } },   // 原因が自分なら謝罪は減らさない
  { id: "G3", when: c => c.in.goal === "settle", add: { propose_talk_plan: 15, prepare_points: 10, restore_routine: -15 } },
  { id: "G4", when: c => c.in.goal === "space",
    add: { request_space: 50, short_feeling: -10, restore_routine: -20, propose_call: -20, propose_talk_plan: -10 } },
];

// ---------------------------------------------------------------- §6 付け足し（最大2つ。上から順に、一手と同じものは足さない）
// c（judge.js が渡す）：c.in・c.phase・c.action（選んだ一手）・c.scores（元の入力での点）・c.blocked（× で除外された行動）・c.pw・c.sw
// 形：{ id, when(c), acts: [行動], styles?, notes?, because?(c) → [この付け足しの条件になった自分の領域の ID] }
const AO2_ACTIONS = new Set(["pause_with_time", "wait_until"]);
const AO12_ACTIONS = new Set(["apology_partial", "short_feeling", "ask_feeling"]);

export const MAX_ADDONS = 2;
export const ADDONS = [
  { id: "AO1", when: c => c.phase === "heated", acts: ["pause_with_time", "self_calm"] },
  { id: "AO2", when: c => AO2_ACTIONS.has(c.action) && (c.sw(2, "A") > 0 || c.sw(3, "A") > 0 || c.in.selfTemp === "high" || c.in.lateNight),
    acts: ["self_calm"], because: c => [c.sw(2, "A") > 0 && "S2A", c.sw(3, "A") > 0 && "S3A"].filter(Boolean) },
  { id: "AO3", when: c => c.phase === "partner_msg.c", acts: ["pause_with_time"] },
  { id: "AO4", when: c => c.phase === "partner_msg.a" && c.sw(8, "A") > 0, acts: ["propose_talk_plan"], because: () => ["S8A"] },
  { id: "AO5", when: c => c.phase === "cold_war.long", acts: ["propose_talk_plan"] },
  { id: "AO6", when: c => c.phase === "want_apologize" && c.pw(8, "A") > 0, acts: ["propose_talk_plan"] },
  { id: "AO7", when: c => c.phase === "got_apology" && c.in.selfTemp !== "calm", acts: ["propose_talk_plan"], styles: ["need_time"] },
  { id: "AO8", when: c => c.phase === "before_talk" && !c.in.talkScheduled, acts: ["propose_talk_plan"] },
  { id: "AO9", when: c => c.phase === "after_makeup.once", acts: ["wait_until"] },
  { id: "AO10", when: c => c.phase === "after_makeup.repeat", acts: ["prepare_points"], notes: ["use_diagnosis"] },
  { id: "AO11", when: c => c.phase === "cold_war.ignored", acts: ["ask_feeling"] },
  // 相手の領域1（向き合う／距離を取る）が分からないときは付けない（距離を取る派には逆効果）
  { id: "AO12", when: c => AO12_ACTIONS.has(c.action) && c.phase !== "heated" && !c.in.lateNight && c.in.partner[1].conf !== "none"
    && !c.blocked.has("propose_call") && (c.scores.propose_call ?? -Infinity) >= 30, acts: ["propose_call"] },
  { id: "AO13", when: c => c.in.lateNight && HEAVY.has(c.action), acts: ["self_calm"] },
];
