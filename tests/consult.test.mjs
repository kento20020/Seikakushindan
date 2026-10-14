// node tests/consult.test.mjs
// 相談モードの判定（js/consult/）のテスト。仕様：docs/consult-scoring.md
//  - §10 の検証ケース（S1〜S12・C1〜C3・C2b・T1〜T17）：局面・一手・付け足し（順番まで）・その他の項目
//  - §10.1 の計算の例（C2 の点数）
//  - 同じ入力なら同じ結果、除外された行動は選ばない、self_calm は after_makeup.once 以外で一手にしない
//  - 診断結果からの変換（domainsFromProfile3・domainsFromChoices）
import assert from "node:assert/strict";
import { judge, classifyPhase, scoreActions, pickAction, DEFAULT_INPUT, normalizeInput } from "../js/consult/judge.js";
import { ACTIONS, PHASES, BASE, PRIORITY, AVOID, KEY_PARTNER_DOMAIN, HEAVY } from "../js/consult/rules.js";
import { domainsFromProfile3, domainsFromChoices } from "../js/consult/from_diagnosis.js";
import { domainFlags3, DOMAINS } from "../js/engine3.js";
import { fromLikertAnswers, fromScores } from "../js/adaptive3.js";
import { SAMPLES3, PROFILE_SAMPLES3 } from "../js/data/samples3.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 5).join("\n  ")); }
}

/** 8領域の短い書き方："2A 1B" → {2:{side:"A",conf:"sure"}, 1:{side:"B",conf:"sure"}}。"3A~" は est */
const D = (s) => Object.fromEntries(s.split(/\s+/).filter(Boolean).map(t => [+t[0], { side: t[1], conf: t.endsWith("~") ? "est" : "sure" }]));
const scoreOf = (r, a) => (r.scores.find(([x]) => x === a) || [])[1];

// ---------------------------------------------------------------- 1. 表のデータ
test("表：16局面・15行動・優先順は15行動の並べ替え、鍵の領域と避ける言葉が全局面にある", () => {
  assert.equal(PHASES.length, 16);
  assert.equal(ACTIONS.length, 15);
  assert.deepEqual([...PRIORITY].sort(), [...ACTIONS].sort());
  for (const p of PHASES) {
    assert.ok(BASE[p] && Object.keys(BASE[p]).length > 0, p);
    assert.ok(p in KEY_PARTNER_DOMAIN, p);
    assert.ok(Array.isArray(AVOID[p]), p);
  }
  assert.ok(!("self_calm" in BASE["heated"]) && BASE["after_makeup.once"].self_calm === 60);
  assert.equal(BASE["waiting_partner"].wait_until, 45);
  assert.equal(BASE["want_apologize"].apology_partial, 50);
  assert.equal(BASE["want_apologize"].apology_full, 50);
  // 避ける言葉（consult-mode.md §3.3 の判定 ID だけ。「そっちが先に」などの自由文は入れない）
  assert.deepEqual(AVOID["heated"], ["long", "past", "generalize", "ultimatum", "sarcasm"]);
  assert.deepEqual(AVOID["waiting_partner"], ["read_receipt", "interrogate", "ultimatum"]);
  assert.deepEqual(AVOID["cold_war.long"], ["read_receipt", "ultimatum"]);
  assert.deepEqual(AVOID["space.partner"], ["multi", "long", "ultimatum"]);
  assert.deepEqual(AVOID["partner_msg.d"], []);
});
test("既定値：§10 の冒頭のとおり", () => {
  const x = normalizeInput({});
  assert.equal(x.cause, "unknown"); assert.equal(x.severity, "small"); assert.equal(x.selfTemp, "cooling");
  assert.equal(x.goal, "reconcile"); assert.equal(x.medium, "text"); assert.equal(x.lastSender, "none");
  assert.equal(x.elapsed, "lt3h"); assert.equal(x.intent, "none"); assert.equal(x.partnerLast, "none"); assert.equal(x.selfLast, "none");
  for (const k of ["danger", "ongoing", "repeat", "afterMakeup", "talkScheduled", "lateNight"]) assert.equal(x[k], false, k);
  for (let d = 1; d <= 8; d++) { assert.deepEqual(x.self[d], { side: null, conf: "none" }); assert.deepEqual(x.partner[d], { side: null, conf: "none" }); }
  assert.deepEqual(normalizeInput(DEFAULT_INPUT), x);
});

// ---------------------------------------------------------------- 2. §10 の検証ケース
const SAME = { lastSender: "self", elapsed: "lt3h", selfLast: "explain" };   // S1・C1〜C3 の共通
const CASES = [
  ["S1", { ...SAME, self: D("3A 2A"), partner: D("2B 1B") }, "waiting_partner", "pause_with_time", ["self_calm"],
    r => assert.equal(r.recheck, "next_noon")],
  ["S2", { lastSender: "partner", partnerLast: "attack", elapsed: "3h_12h" }, "partner_msg.c", "acknowledge", ["pause_with_time"]],
  ["S3", { lastSender: "partner", partnerLast: "casual", elapsed: "3h_12h", self: D("8A") }, "partner_msg.a", "restore_routine", ["propose_talk_plan"]],
  ["S4", { lastSender: "none", elapsed: "ge3d", cause: "self" }, "cold_war.long", "apology_full", ["propose_talk_plan"]],
  ["S5", { lastSender: "partner", partnerLast: "apology", selfTemp: "high" }, "got_apology", "accept_apology", ["propose_talk_plan"],
    r => assert.ok(r.styles.includes("need_time"))],
  ["S6", { lastSender: "partner", partnerLast: "space" }, "space.partner", "accept_space", []],
  ["S7", { ongoing: true, medium: "in_person" }, "heated", "pause_with_time", ["self_calm"],
    r => { assert.ok(r.styles.includes("spoken")); assert.equal(r.recheck, "+2h"); }],
  ["S8", { lastSender: "partner", partnerLast: "explain", elapsed: "3h_12h", selfTemp: "high" }, "partner_msg.b", "pause_with_time", ["self_calm"],
    r => assert.ok(r.applied.includes("R3"))],
  ["S9", { ongoing: true, selfLast: "attack", cause: "self" }, "heated", "apology_partial", ["pause_with_time", "self_calm"]],
  ["S10", { afterMakeup: true, repeat: true }, "after_makeup.repeat", "propose_talk_plan", ["prepare_points"],
    r => assert.ok(r.notes.includes("use_diagnosis"))],
  ["S11", { danger: true }, null, "safety", [],
    r => { assert.equal(r.phase, null); assert.equal(r.gate, "danger"); }],
  ["S12", { intent: "tell", lateNight: true }, "before_talk", "prepare_points", ["propose_talk_plan", "self_calm"],
    r => assert.equal(r.timing, "morning")],
  ["C1", { ...SAME, partner: D("2B 1B") }, "waiting_partner", "pause_with_time", [],
    r => assert.equal(r.recheck, "next_noon")],
  ["C2", { ...SAME, partner: D("2A 1A") }, "waiting_partner", "apology_partial", ["propose_call"],
    r => {
      assert.ok(r.notes.includes("confirm_cause")); assert.ok(r.styles.includes("short_return"));
      assert.equal(r.confidence, "sure"); assert.equal(r.margin, 20);
      assert.deepEqual(r.styleVariants, { domain: 5, A: ["concrete"], B: ["feeling_first"] });
    }],
  ["C2b", { ...SAME, cause: "partner", partner: D("2A 1A") }, "waiting_partner", "pause_with_time", [],
    r => {
      assert.ok(r.styles.includes("short_return")); assert.equal(r.recheck, "+3h"); assert.ok(r.applied.includes("HG"));
      assert.equal(scoreOf(r, "pause_with_time"), 60); assert.equal(scoreOf(r, "ask_feeling"), 50);
      assert.equal(scoreOf(r, "apology_partial"), 35); assert.equal(scoreOf(r, "propose_call"), 35);
    }],
  ["C3", { ...SAME }, "waiting_partner", "pause_with_time", [],
    r => assert.deepEqual(r.variants, { A: "apology_partial", B: "pause_with_time" })],
  ["T1", { lastSender: "none", elapsed: "12h_2d", cause: "both", partner: D("8B") }, "cold_war.short", "restore_routine", []],
  ["T2", { lastSender: "none", elapsed: "12h_2d", cause: "both", partner: D("8A") }, "cold_war.short", "short_feeling", []],   // AO12：相手の領域1 が不明
  ["T3", { lastSender: "none", elapsed: "12h_2d", goal: "space" }, "cold_war.short", "request_space", []],
  ["T4", { lastSender: "self", selfLast: "reconcile", elapsed: "12h_2d" }, "cold_war.ignored", "wait_until", ["ask_feeling"],
    r => assert.equal(r.recheck, "+24h")],
  ["T5", { intent: "apologize", cause: "both", partner: D("8A") }, "want_apologize", "apology_partial", ["propose_talk_plan"]],
  ["T6", { lastSender: "partner", partnerLast: "talk_proposal" }, "partner_msg.d", "propose_talk_plan", []],
  ["T7", { intent: "tell", self: D("7A") }, "before_talk", "prepare_points", ["propose_talk_plan"],
    r => assert.ok(r.styles.includes("one_topic"))],
  ["T8", { afterMakeup: true }, "after_makeup.once", "self_calm", ["wait_until"],
    r => assert.equal(r.recheck, "+7d")],
  ["T9", { lastSender: "self", selfLast: "hold", elapsed: "lt3h", partner: D("3A") }, "waiting_partner", "wait_until", [],
    r => assert.equal(r.recheck, "next_morning")],
  ["T10", { intent: "request_space" }, "space.self", "request_space", []],
  ["T11", { lastSender: "self", selfLast: "hold", elapsed: "12h_2d" }, "cold_war.short", "short_feeling", [],
    r => {
      assert.ok(r.styles.includes("return_as_promised")); assert.ok(r.applied.includes("L1b") && !r.applied.includes("L1"));
      assert.equal(r.variants, null, "restore_routine を除外したので A・B で一手が変わらない");
      assert.ok(!r.scores.some(([a]) => a === "restore_routine"));
    }],
  ["T12", { lastSender: "self", partnerLast: "breakup", elapsed: "3h_12h" }, "space.partner", "accept_space", [],
    r => assert.ok(r.styles.includes("breakup"))],
  ["T13", { lastSender: "partner", partnerLast: "talk_proposal", selfTemp: "high" }, "partner_msg.d", "propose_talk_plan", [],
    r => { assert.ok(r.styles.includes("date_only")); assert.ok(!r.applied.includes("R3")); }],
  ["T14", { lastSender: "partner", partnerLast: "casual", selfTemp: "high" }, "partner_msg.a", "restore_routine", []],
  ["T15", { intent: "apologize", cause: "both", lateNight: true }, "want_apologize", "apology_partial", ["self_calm"],
    r => assert.equal(r.timing, "morning")],
  ["T16", { lastSender: "none", elapsed: "ge3d", cause: "self", goal: "understood" }, "cold_war.long", "apology_full", ["propose_talk_plan"]],
  ["T17a", { ...SAME }, "waiting_partner", "pause_with_time", [], r => assert.equal(r.confidence, "provisional")],   // C3
  ["T17b", { lastSender: "partner", partnerLast: "apology", selfTemp: "high" }, "got_apology", "accept_apology", ["propose_talk_plan"],
    r => assert.equal(r.confidence, "situational")],   // S5
];
assert.equal(CASES.length, 34, "§10 は34ケース（S1〜S12・C1〜C3・C2b・T1〜T17。T17 は C3 と S5 の2つ）");

for (const [id, input, phase, action, addons, more] of CASES) {
  test(`§10 ${id}：${phase ?? "（ゲート）"} → ${action}${addons.length ? " ＋ " + addons.join("・") : ""}`, () => {
    const r = judge(input);
    assert.equal(classifyPhase(input), phase, "classifyPhase");
    assert.equal(r.phase, phase, "phase");
    assert.equal(r.action, action, `action（点数：${JSON.stringify(r.scores)}）`);
    assert.deepEqual(r.addons, addons, "addons");
    assert.ok(!r.addons.includes(r.action), "付け足しに一手と同じ行動はない");
    assert.deepEqual(r.avoid, phase ? AVOID[phase] : []);
    if (phase && !r.variants) assert.equal(r.scores[0][0], action, "点数の一覧の先頭が一手");
    if (more) more(r);
  });
}

test("§10.1 計算の例（C2）：apology_partial 80・pause_with_time 60・propose_call 35・wait_until 20・short_feeling 15", () => {
  const r = judge({ ...SAME, partner: D("2A 1A") });
  assert.equal(scoreOf(r, "apology_partial"), 80);
  assert.equal(scoreOf(r, "pause_with_time"), 60);
  assert.equal(scoreOf(r, "propose_call"), 35);
  assert.equal(scoreOf(r, "wait_until"), 20);
  assert.equal(scoreOf(r, "short_feeling"), 15);
  for (const id of ["P1A", "P2A", "P2A_silent", "G1", "AO12"]) assert.ok(r.applied.includes(id), id);
  assert.equal(r.variants, null, "鍵の領域2 が分かっているので2通りにしない");
  assert.deepEqual(r.avoid, ["read_receipt", "interrogate", "ultimatum"]);
});

test("§11 の出力例は C2 の出力そのもの", () => {
  assert.deepEqual(judge({ ...SAME, partner: D("2A 1A") }), {
    gate: null, phase: "waiting_partner", action: "apology_partial", addons: ["propose_call"], timing: "now", recheck: "+24h",
    styles: ["short_return"], styleVariants: { domain: 5, A: ["concrete"], B: ["feeling_first"] }, notes: ["confirm_cause"],
    variants: null, confidence: "sure", margin: 20,
    scores: [["apology_partial", 80], ["pause_with_time", 60], ["propose_call", 35], ["wait_until", 20], ["short_feeling", 15],
      ["ask_feeling", 10], ["propose_talk_plan", 10], ["request_space", 10]],
    applied: ["P1A", "P2A", "P2A_silent", "G1", "AO12"],
    avoid: ["read_receipt", "interrogate", "ultimatum"],
  });
});

test("§8 相手が分からないとき（C3）：A・B の点の低いほうで選び、2通りの点は scoreActions で再現できる", () => {
  const r = judge(SAME);
  const sA = scoreActions({ ...SAME, partner: D("2A") }, "waiting_partner").scores;
  const sB = scoreActions({ ...SAME, partner: D("2B") }, "waiting_partner").scores;
  assert.equal(sA.apology_partial, 70); assert.equal(sB.pause_with_time, 65);
  for (const [a, v] of r.scores) assert.equal(v, Math.min(sA[a], sB[a]), a);
  assert.equal(scoreOf(r, "pause_with_time"), 60);
  assert.ok(!r.applied.includes("P2A") && !r.applied.includes("P2B"), "applied は元の入力（鍵の領域は不明のまま）で決める");
});

test("§8 T9：保留宣言のあとは、相手が分からなくても謝罪の連投を選ばない（2通りとも wait_until）", () => {
  const r = judge({ lastSender: "self", selfLast: "hold", elapsed: "lt3h", partner: D("3A") });
  assert.equal(r.variants, null);
  assert.ok(r.applied.includes("L1") && r.applied.includes("R2"));
  assert.ok(!r.scores.some(([a]) => a === "pause_with_time"), "L1 で pause_with_time は除外");
});

// ---------------------------------------------------------------- 3. 性質
/** 決まった種から入力を作る（乱数は使うが種が固定なので毎回同じ） */
function* inputs(n, seed = 12345) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const doms = () => Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(d => [d, pick([
    { side: null, conf: "none" }, { side: null, conf: "none" }, { side: "A", conf: "sure" }, { side: "B", conf: "sure" },
    { side: "A", conf: "est" }, { side: "B", conf: "est" }])]));
  for (let i = 0; i < n; i++) {
    yield {
      danger: rnd() < 0.03, ongoing: rnd() < 0.15, lastSender: pick(["self", "partner", "none"]),
      elapsed: pick(["lt3h", "3h_12h", "12h_2d", "ge3d"]),
      partnerLast: pick(["apology", "casual", "explain", "attack", "talk_proposal", "space", "breakup", "none"]),
      selfLast: pick(["hold", "apology", "reconcile", "attack", "explain", "none"]),
      selfTemp: pick(["high", "cooling", "calm"]), cause: pick(["self", "partner", "both", "unknown"]),
      severity: pick(["small", "large"]), repeat: rnd() < 0.5, afterMakeup: rnd() < 0.15,
      intent: pick(["apologize", "tell", "request_space", "none", "none", "none"]), talkScheduled: rnd() < 0.1,
      medium: pick(["text", "call", "in_person"]), lateNight: rnd() < 0.3, goal: pick(["reconcile", "understood", "settle", "space"]),
      self: doms(), partner: doms(),
    };
  }
}

test("同じ入力なら同じ結果（§10 の全ケースと、決まった種の入力3000件）", () => {
  for (const [, input] of CASES) assert.deepEqual(judge(input), judge(structuredClone(input)));
  for (const x of inputs(3000)) assert.deepEqual(judge(x), judge(structuredClone(x)));
});

test("入力を書き換えない", () => {
  for (const x of inputs(200, 7)) { const before = structuredClone(x); judge(x); assert.deepEqual(x, before); }
});

test("除外：heated で goal=space・相手が熟考/待つ派でも wait_until は選ばない（空欄は候補にもならない）", () => {
  const r = judge({ ongoing: true, goal: "space", partner: D("2B 3B 1B") });
  assert.equal(r.phase, "heated");
  assert.notEqual(r.action, "wait_until");
  assert.ok(!r.scores.some(([a]) => a === "wait_until"));
  assert.ok(scoreActions({ ongoing: true, goal: "space", partner: D("2B 3B 1B") }, "heated").excluded.has("wait_until"));
});

test("除外：L1（保留宣言済み）は R3 の +60 があっても pause_with_time を選ばない。付け足しにも出さない", () => {
  const inp = { lastSender: "partner", partnerLast: "explain", elapsed: "3h_12h", selfTemp: "high", selfLast: "hold", partner: D("2B 1B 3A") };
  const r = judge(inp);
  assert.equal(r.phase, "partner_msg.b");
  assert.notEqual(r.action, "pause_with_time");
  assert.equal(r.action, "acknowledge");
  assert.ok(!r.scores.some(([a]) => a === "pause_with_time"));
  assert.ok(r.applied.includes("L1"));
  const s = scoreActions(inp, "partner_msg.b");
  assert.ok(s.excluded.has("pause_with_time") && s.blocked.has("pause_with_time"));
  // partner_msg.c の AO3（pause_with_time）も、L1 で除外されていれば足さない
  const c = judge({ lastSender: "partner", partnerLast: "attack", selfLast: "hold" });
  assert.equal(c.phase, "partner_msg.c");
  assert.ok(!c.addons.includes("pause_with_time"));
});

test("除外：深夜（R4）と熱いとき（R1）は propose_call を選ばず、AO12 でも足さない", () => {
  const base = { lastSender: "none", elapsed: "12h_2d", cause: "both", partner: D("8A 2A 1A") };
  const day = judge(base);
  assert.ok(day.addons.includes("propose_call") || day.action === "propose_call");
  for (const extra of [{ lateNight: true }, { selfTemp: "high" }]) {
    const r = judge({ ...base, ...extra });
    assert.notEqual(r.action, "propose_call");
    assert.ok(!r.addons.includes("propose_call"));
    assert.ok(!r.scores.some(([a]) => a === "propose_call"));
  }
});

test("性質（決まった種の入力3000件）：除外は選ばない・self_calm は after_makeup.once だけ・付け足しは2つまで・点数は高い順", () => {
  let gates = 0, seenVariants = 0;
  const phases = new Set();
  for (const x of inputs(3000)) {
    const r = judge(x);
    if (r.gate) { gates++; assert.equal(r.action, "safety"); assert.equal(r.phase, null); continue; }
    phases.add(r.phase);
    const s = scoreActions(x, r.phase);
    assert.ok(!s.excluded.has(r.action), `除外された ${r.action} を選んだ（${r.phase}）`);
    assert.ok(r.scores.some(([a]) => a === r.action), "一手は点数の一覧にある");
    for (const [a] of r.scores) assert.ok(!s.excluded.has(a), `除外された ${a} が一覧にある`);
    if (r.action === "self_calm") assert.equal(r.phase, "after_makeup.once");
    assert.ok(r.addons.length <= 2);
    assert.ok(!r.addons.includes(r.action));
    assert.equal(new Set(r.addons).size, r.addons.length);
    for (const a of r.addons) assert.ok(!s.blocked.has(a), `× で除外された ${a} を付け足した`);
    for (let i = 1; i < r.scores.length; i++) assert.ok(r.scores[i - 1][1] >= r.scores[i][1], "高い順");
    for (const [, v] of r.scores) assert.equal(v, Math.round(v * 100) / 100, "丸め");
    assert.equal(r.timing, x.lateNight && HEAVY.has(r.action) ? "morning" : "now");
    assert.equal(new Set(r.styles).size, r.styles.length);
    assert.equal(new Set(r.applied).size, r.applied.length);
    if (r.variants) { seenVariants++; assert.notEqual(r.variants.A, r.variants.B); }
    assert.ok(["sure", "est", "provisional", "situational"].includes(r.confidence));
    if (r.scores.length > 1) assert.equal(r.margin, Math.round((r.scores[0][1] - r.scores[1][1]) * 100) / 100);
    else assert.equal(r.margin, null);
    if (r.styleVariants) assert.ok([1, 5, 6].includes(r.styleVariants.domain));
  }
  assert.ok(gates > 0 && seenVariants > 0);
  assert.equal(phases.size, 16, `全局面が出る（${[...phases].join(",")}）`);
});

test("self_calm：after_makeup.once 以外では、点が上がっても一手にならない", () => {
  for (const p of PHASES) {
    if (p === "after_makeup.once") continue;
    assert.ok(!("self_calm" in BASE[p]), p);
  }
  // after_makeup.once では一手になる（T8）、ほかでは付け足しとしてだけ出る（S1・S7・S8・S9・S12）
  assert.equal(judge({ afterMakeup: true }).action, "self_calm");
  assert.ok(judge({ ongoing: true }).addons.includes("self_calm"));
  for (const p of PHASES) {
    const got = pickAction({ self_calm: 999, acknowledge: 1 }, p);
    assert.equal(got, p === "after_makeup.once" ? "self_calm" : "acknowledge", p);
  }
});

test("確かさ：est は ×0.6（P8B の +40 → +24、RR の −25 → −10）", () => {
  const sure = scoreActions({ lastSender: "none", elapsed: "12h_2d", partner: D("8B") }, "cold_war.short").scores;
  const est = scoreActions({ lastSender: "none", elapsed: "12h_2d", partner: D("8B~") }, "cold_war.short").scores;
  assert.equal(sure.restore_routine, 80);   // 35 + RR 0 + G1 5 + P8B 40
  assert.equal(est.restore_routine, 54);    // 35 + RR −25×(1−0.6) + G1 5 + P8B 40×0.6
});

test("局面の判定：優先順（space.partner が heated より先、partner_msg は経過時間に関係なく、該当なしの partnerLast は .b）", () => {
  assert.equal(classifyPhase({ ongoing: true, lastSender: "partner", partnerLast: "breakup" }), "space.partner");
  assert.equal(classifyPhase({ ongoing: true, intent: "request_space" }), "space.self");
  assert.equal(classifyPhase({ lastSender: "partner", partnerLast: "attack", elapsed: "ge3d" }), "partner_msg.c");
  assert.equal(classifyPhase({ lastSender: "partner", partnerLast: "none" }), "partner_msg.b");
  assert.equal(classifyPhase({ selfTemp: "high", lastSender: "partner", partnerLast: "casual" }), "partner_msg.a", "相手が最後なら熱くても heated にしない");
  assert.equal(classifyPhase({ selfTemp: "high", lastSender: "self" }), "heated");
  assert.equal(classifyPhase({ lastSender: "self", elapsed: "3h_12h", selfLast: "apology" }), "waiting_partner");
  assert.equal(classifyPhase({ lastSender: "self", elapsed: "ge3d", selfLast: "explain" }), "cold_war.long");
  assert.equal(classifyPhase({ lastSender: "none", elapsed: "lt3h" }), "cold_war.short");
  assert.equal(classifyPhase({ danger: true, ongoing: true }), null);
});

test("期限：heated で相手が向き合う派 → +30m、深夜なら next_morning。待つ系で即応派 → +3h", () => {
  assert.equal(judge({ ongoing: true, partner: D("1A") }).recheck, "+30m");
  assert.equal(judge({ ongoing: true, partner: D("1A"), lateNight: true }).recheck, "next_morning");
  assert.ok(judge({ ongoing: true, partner: D("1A") }).styles.includes("short_return"));
  // 一手が pause_with_time で相手が即応派 → +3h（pause 75 > apology_partial 70）
  const q = judge({ ...SAME, partner: D("2A 1B 3A") });
  assert.equal(q.action, "pause_with_time"); assert.equal(q.recheck, "+3h");
  assert.equal(judge({ ...SAME, partner: D("2A 1A") }).recheck, "+24h", "C2：一手も付け足しも待つ系でない");
});

// ---------------------------------------------------------------- 3b. レビュー（consult-answer-guide.md §1.6）を受けた直し F1〜F11
test("F1 P1A：waiting_partner・cold_war では保留宣言を減点しない。short_return は heated・waiting_partner・cold_war.* で出す", () => {
  const without = scoreActions({ ...SAME, partner: D("2B") }, "waiting_partner").scores;
  const withA = scoreActions({ ...SAME, partner: D("2B 1A") }, "waiting_partner");
  assert.equal(withA.scores.pause_with_time, without.pause_with_time);
  assert.equal(withA.scores.wait_until, without.wait_until - 15);
  assert.equal(withA.scores.propose_call, without.propose_call + 10);
  assert.equal(withA.scores.apology_partial, without.apology_partial + 10);
  for (const [inp, ph] of [[{ ongoing: true }, "heated"], [SAME, "waiting_partner"], [{ elapsed: "12h_2d" }, "cold_war.short"],
    [{ elapsed: "ge3d" }, "cold_war.long"], [{ lastSender: "self", selfLast: "reconcile", elapsed: "12h_2d" }, "cold_war.ignored"]]) {
    assert.ok(scoreActions({ ...inp, partner: D("1A") }, ph).styles.includes("short_return"), ph);
  }
  assert.ok(!scoreActions({ lastSender: "partner", partnerLast: "explain", partner: D("1A") }, "partner_msg.b").styles.includes("short_return"));
});

test("F2 謝罪への加点の門（HG）：原因が相手なら相手のタイプによる加点を ask_feeling に振り替える。自分が責めたなら謝罪に入れる", () => {
  const open = scoreActions({ ...SAME, partner: D("2A 1A") }, "waiting_partner");
  const closed = scoreActions({ ...SAME, cause: "partner", partner: D("2A 1A") }, "waiting_partner");
  assert.equal(open.scores.apology_partial - 40, closed.scores.ask_feeling - 10, "同じ点（10＋15＋15）を振り替え");
  assert.equal(closed.scores.apology_partial, 35 - 5 + 5, "C3 −5・G1 +5 だけ");
  assert.ok(closed.applied.includes("HG") && !open.applied.includes("HG"));
  const attack = scoreActions({ ...SAME, cause: "partner", selfLast: "attack", partner: D("2A 1A") }, "waiting_partner");
  assert.ok(!attack.applied.includes("HG"));
  assert.equal(attack.scores.apology_partial, 35 - 5 + 20 + 10 + 15 + 15 + 5);
  for (const cause of ["self", "both", "unknown"]) {
    assert.ok(!scoreActions({ ...SAME, cause, partner: D("2A") }, "waiting_partner").applied.includes("HG"), cause);
  }
});

test("F2 confirm_cause：謝る一手で、原因が分からず自分が責めたわけでもないとき", () => {
  const r = judge({ intent: "apologize" });
  assert.equal(r.action, "apology_partial"); assert.deepEqual(r.notes, ["confirm_cause"]);
  assert.deepEqual(judge({ intent: "apologize", selfLast: "attack" }).notes, []);
  assert.deepEqual(judge({ intent: "apologize", cause: "both" }).notes, []);
  assert.equal(judge({ lastSender: "none", elapsed: "ge3d", cause: "self" }).notes.length, 0, "S4：原因は自分");
  assert.ok(!judge(SAME).notes.includes("confirm_cause"), "C3：一手が謝罪でない");
});

test("F3 R3 は partner_msg.b・c だけ。partner_msg.d で本人が熱いときは date_only（R3d）", () => {
  for (const pl of ["explain", "attack"]) assert.ok(judge({ lastSender: "partner", partnerLast: pl, selfTemp: "high" }).applied.includes("R3"), pl);
  for (const pl of ["casual", "talk_proposal"]) assert.ok(!judge({ lastSender: "partner", partnerLast: pl, selfTemp: "high" }).applied.includes("R3"), pl);
  const d = judge({ lastSender: "partner", partnerLast: "talk_proposal", selfTemp: "high" });
  assert.ok(d.applied.includes("R3d")); assert.equal(scoreOf(d, "pause_with_time"), 10);
  assert.ok(!judge({ lastSender: "partner", partnerLast: "talk_proposal" }).styles.includes("date_only"));
});

test("F4 局面1：距離・別れ話は最後に送ったのがどちらでも space.partner（3日以上たっていれば外す）。breakup は指定 breakup", () => {
  for (const ls of ["self", "partner", "none"]) assert.equal(classifyPhase({ lastSender: ls, partnerLast: "space", elapsed: "12h_2d" }), "space.partner", ls);
  assert.equal(classifyPhase({ lastSender: "partner", partnerLast: "space", elapsed: "ge3d" }), "partner_msg.b");
  assert.equal(classifyPhase({ lastSender: "self", partnerLast: "breakup", elapsed: "ge3d" }), "cold_war.long");
  const r = judge({ lastSender: "partner", partnerLast: "breakup" });
  assert.ok(r.styles.includes("breakup") && r.applied.includes("BRK"));
  assert.ok(!judge({ lastSender: "partner", partnerLast: "space" }).styles.includes("breakup"));
});

test("F5 AO12：相手の領域1 が分かっているときだけ（est でも可）", () => {
  const base = { lastSender: "none", elapsed: "12h_2d", cause: "both", partner: D("8A") };
  assert.deepEqual(judge(base).addons, []);
  assert.deepEqual(judge({ ...base, partner: D("8A 1A~") }).addons, ["propose_call"]);
});

test("F6 保留宣言のあと：半日未満は L1、半日以上は L1b（pause ×、short_feeling +5、propose_talk_plan +10、return_as_promised）", () => {
  for (const el of ["lt3h", "3h_12h"]) {
    const r = judge({ lastSender: "self", selfLast: "hold", elapsed: el });
    assert.ok(r.applied.includes("L1") && !r.applied.includes("L1b"), el);
  }
  for (const el of ["12h_2d", "ge3d"]) {
    const x = { lastSender: "partner", partnerLast: "explain", selfLast: "hold", elapsed: el };
    const s = scoreActions(x, "partner_msg.b");
    assert.ok(s.applied.includes("L1b") && !s.applied.includes("L1"), el);
    assert.ok(s.excluded.has("pause_with_time"));
    assert.ok(scoreActions({ lastSender: "self", selfLast: "hold", elapsed: el, partner: D("8B") }, el === "ge3d" ? "cold_war.long" : "cold_war.short")
      .blocked.has("restore_routine"), "L1b は restore_routine も除外（相手が関係を戻す派でも）");
    assert.equal(s.scores.short_feeling, 10 + 5 + 5);       // L1b +5、G1 +5
    assert.equal(s.scores.propose_talk_plan, 10 + 10);
    assert.ok(s.styles.includes("return_as_promised"));
  }
});

test("F7 C1 は +55、G2 の apology_full −10 は原因が自分なら効かせない（T16）", () => {
  const r = judge({ lastSender: "none", elapsed: "ge3d", cause: "self", goal: "understood" });
  assert.equal(scoreOf(r, "apology_full"), 65); assert.equal(scoreOf(r, "short_feeling"), 60);
  assert.ok(r.applied.includes("G2"));
  const other = scoreActions({ lastSender: "none", elapsed: "ge3d", cause: "both", goal: "understood" }, "cold_war.long").scores;
  assert.equal(other.apology_full, 0, "原因が自分でなければ −10");
});

test("F8 confidence と margin：鍵の領域の確かさから、差が10未満なら1段下げる（situational はそのまま）", () => {
  const sure = judge({ ...SAME, partner: D("2A 1B 3A") });   // pause 75 vs apology_partial 70
  assert.equal(sure.margin, 5); assert.equal(sure.confidence, "est");
  const est = judge({ ...SAME, partner: domainsFromChoices({ 2: "A", 1: "A" }) });   // apology_partial 64 vs pause 60
  assert.equal(est.margin, 4); assert.equal(est.confidence, "provisional");
  const estWide = judge({ ...SAME, partner: D("2B~ 1B") });
  assert.ok(estWide.margin >= 10); assert.equal(estWide.confidence, "est");
  const sit = judge({ lastSender: "partner", partnerLast: "apology", goal: "settle", severity: "large" });   // accept 60 vs plan 60
  assert.equal(sit.action, "accept_apology"); assert.equal(sit.margin, 0); assert.equal(sit.confidence, "situational");
  const one = judge({ lastSender: "partner", partnerLast: "space" });
  assert.equal(one.margin, null, "候補が1つだけ"); assert.equal(one.confidence, "situational");
  const gate = judge({ danger: true });
  assert.equal(gate.confidence, null); assert.equal(gate.margin, null); assert.equal(gate.styleVariants, null);
});

test("F9 深夜は apology_partial・request_space も朝に回す", () => {
  assert.equal(judge({ intent: "request_space", lateNight: true }).timing, "morning");
  assert.equal(judge({ intent: "request_space" }).timing, "now");
  assert.equal(judge({ intent: "apologize", cause: "both", lateNight: true }).timing, "morning");
});

test("F10 styleVariants：一手の文面を左右する相手の領域が不明なら A・B の指定を並べる", () => {
  assert.deepEqual(judge({ ongoing: true, medium: "in_person" }).styleVariants, { domain: 1, A: ["short_return"], B: [] });   // S7
  assert.equal(judge({ ...SAME, partner: D("2B 1B") }).styleVariants, null, "C1：領域1 が分かっている");
  assert.deepEqual(judge({ lastSender: "partner", partnerLast: "talk_proposal" }).styleVariants, { domain: 6, A: ["offer_choices"], B: ["propose_date"] });
  assert.equal(judge({ lastSender: "partner", partnerLast: "space" }).styleVariants, null, "accept_space は対象外");
  assert.equal(judge({ intent: "tell", partner: D("5B~") }).styleVariants, null, "est でも分かっている扱い");
});

test("F11 補正 ID の改名：restore_routine の減点は RR、経過時間は E1（P1・T1 は使わない）", () => {
  assert.ok(judge({ lastSender: "none", elapsed: "ge3d", cause: "self" }).applied.includes("RR"));
  assert.ok(judge({ lastSender: "self", elapsed: "3h_12h" }).applied.includes("E1"));
  for (const x of inputs(500, 99)) { const r = judge(x); assert.ok(!r.applied.includes("P1") && !r.applied.includes("T1")); }
});

// ---------------------------------------------------------------- 4. 診断結果からの変換
const DOMAIN_SIDES = new Set(["A", "B", null]);
function checkFromProfile3(profile3, label) {
  const doms = domainsFromProfile3(profile3);
  assert.deepEqual(Object.keys(doms).map(Number), [1, 2, 3, 4, 5, 6, 7, 8], label);
  for (const d of Object.keys(doms)) {
    const v = doms[d], f = domainFlags3(profile3, d);
    assert.ok(DOMAIN_SIDES.has(v.side), `${label} ${d}`);
    assert.equal(f.lead === null, v.side === null, `${label} ${d}：lead null ⇔ side null`);
    if (f.lead) {
      assert.equal(v.side, f.lead === DOMAINS[d].a ? "A" : "B", `${label} ${d}：side`);
      assert.equal(f.weak || f.conflict, v.conf === "est", `${label} ${d}：weak/conflict ⇔ est`);
      assert.equal(!(f.weak || f.conflict), v.conf === "sure", `${label} ${d}：sure`);
    } else assert.equal(v.conf, "none", `${label} ${d}：拮抗は none`);
  }
  return doms;
}
test("domainsFromProfile3：実回答サンプル（三択に変換）で8領域・side は A/B/null・domainFlags3 と一致", () => {
  const confs = new Set();
  for (const smp of SAMPLES3) {
    const p3 = fromLikertAnswers(smp.answers, smp.wording).result().profile3;
    const doms = checkFromProfile3(p3, smp.key);
    for (const v of Object.values(doms)) confs.add(v.conf);
    const r = judge({ ...SAME, partner: doms, self: doms });   // そのまま判定の入力に使える
    assert.equal(r.phase, "waiting_partner");
  }
  for (const p of PROFILE_SAMPLES3) checkFromProfile3(fromScores(p.scores, p.duel).result().profile3, p.key);
  assert.ok(confs.has("sure"), "sure が少なくとも1つ");
});
test("domainsFromProfile3：手で作ったプロファイル（4:0・level 75/25 → sure、3:1・level 50 → est（弱）、2:2 → none）", () => {
  const levels = Object.fromEntries(Object.values(DOMAINS).flatMap(Dm => [[Dm.a, 50], [Dm.b, 50]]));
  const w = Object.fromEntries(Object.keys(DOMAINS).map(d => [d, { a: 2, b: 2, n: 4 }]));
  w[1] = { a: 4, b: 0, n: 4 }; levels[DOMAINS[1].a] = 75; levels[DOMAINS[1].b] = 25;
  w[2] = { a: 1, b: 3, n: 4 }; levels[DOMAINS[2].b] = 50;
  w[3] = { a: 0, b: 4, n: 4 }; levels[DOMAINS[3].b] = 75; levels[DOMAINS[3].a] = 100;   // 向きが逆（conflict）
  const doms = domainsFromProfile3({ levels, w });
  assert.deepEqual(doms[1], { side: "A", conf: "sure" });
  assert.deepEqual(doms[2], { side: "B", conf: "est" });
  assert.deepEqual(doms[3], { side: "B", conf: "est" });
  for (const d of [4, 5, 6, 7, 8]) assert.deepEqual(doms[d], { side: null, conf: "none" });
});
test("domainsFromChoices：答えた領域は est、答えていない・不正な値は none", () => {
  const doms = domainsFromChoices({ 2: "A", 1: "B", 5: "x" });
  assert.deepEqual(Object.keys(doms).map(Number), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(doms[1], { side: "B", conf: "est" });
  assert.deepEqual(doms[2], { side: "A", conf: "est" });
  for (const d of [3, 4, 5, 6, 7, 8]) assert.deepEqual(doms[d], { side: null, conf: "none" });
  assert.deepEqual(domainsFromChoices(), domainsFromChoices({}));
  // C2 を2択の推定（est）で答えた場合：鍵の領域2 が分かっているので2通りにせず、謝罪寄りになる
  const r = judge({ ...SAME, partner: domainsFromChoices({ 2: "A", 1: "A" }) });
  assert.equal(r.variants, null);
  assert.equal(r.action, "apology_partial");
});

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} consult tests passed`);
process.exit(fail ? 1 : 0);
