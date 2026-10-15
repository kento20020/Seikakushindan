// node tests/consult.test.mjs
// 相談モードの判定（js/consult/）のテスト。仕様：docs/consult-scoring.md
//  - §10 の検証ケース（S1〜S12・C1〜C3・C2b・T1〜T17）：局面・一手・付け足し（順番まで）・その他の項目
//  - §10.1 の計算の例（C2 の点数）
//  - 同じ入力なら同じ結果、除外された行動は選ばない、self_calm は after_makeup.once 以外で一手にしない
//  - 診断結果からの変換（domainsFromProfile3・domainsFromChoices・domainsFromInvite・removePartnerDiagnosis・applySelfCorrections）
//  - 出どころの段階と上限 CAP（decisions.md D1）、人ごとの層（D2）、送る前チェック（D3・D4(a)）
import assert from "node:assert/strict";
import { judge, classifyPhase, scoreActions, pickAction, DEFAULT_INPUT, normalizeInput } from "../js/consult/judge.js";
import { ACTIONS, PHASES, BASE, PRIORITY, AVOID, KEY_PARTNER_DOMAIN, HEAVY } from "../js/consult/rules.js";
import { domainsFromProfile3, domainsFromChoices, domainsFromInvite, removePartnerDiagnosis, applySelfCorrections } from "../js/consult/from_diagnosis.js";
import { buildPersonLayer, personLayerText } from "../js/consult/person_layer.js";
import { checkDraft, LONG_CHARS } from "../js/consult/draft_check.js";
import { getText } from "../js/data/patterns.js";
import { domainFlags3, DOMAINS } from "../js/engine3.js";
import { fromLikertAnswers, fromScores } from "../js/adaptive3.js";
import { SAMPLES3, PROFILE_SAMPLES3 } from "../js/data/samples3.js";
import { D, SAME, CASES, scoreOf } from "./fixtures/consult_cases.mjs";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 5).join("\n  ")); }
}

// 8領域の短い書き方 D・共通の入力 SAME・§10 の検証ケース CASES・点数の取り出し scoreOf は tests/fixtures/consult_cases.mjs

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

// ---------------------------------------------------------------- 2. §10 の検証ケース（CASES は tests/fixtures/consult_cases.mjs）
assert.equal(CASES.length, 37, "§10 は37ケース（S1〜S12・C1〜C3・C2b・T1〜T20。T17 は C3 と S5 の2つ）");

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
    contributions: { P1A: 10, P2A: 15, P2A_silent: 15, G1: 5 },
  });
});

test("contributions：一手の点の内訳。基本点＋内訳＝点（決まった種の入力3000件・全行動）、上限で抑えた分は割合で縮める", () => {
  const t18 = judge({ lastSender: "none", elapsed: "12h_2d", cause: "both", partner: D("8B*") });
  assert.deepEqual(t18.contributions, { P8B: 30, G1: 5 }, "T18：P8B 32 → 上限 30");
  const t20 = scoreActions({ ...SAME, partner: D("2A* 1A*") }, "waiting_partner").contributions.apology_partial;
  assert.equal(Math.round((t20.P1A + t20.P2A + t20.P2A_silent) * 100) / 100, 30, "T20：8＋12＋12＝32 → 30 に縮める");
  assert.deepEqual(judge({ danger: true }).contributions, {});
  for (const x of inputs(3000, 4242)) {
    const r = judge(x);
    if (r.gate) continue;
    const s = scoreActions(x, r.phase);
    assert.deepEqual(r.contributions, s.contributions[r.action]);
    for (const [a, v] of Object.entries(s.scores)) {
      const sum = BASE[r.phase][a] + Object.values(s.contributions[a]).reduce((p, q) => p + q, 0);
      assert.ok(Math.abs(sum - v) < 0.05, `${r.phase} ${a}：${sum} ≠ ${v}`);
      for (const id of Object.keys(s.contributions[a])) assert.ok(s.applied.includes(id), `${id} は applied にある`);
    }
  }
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
    { side: "A", conf: "est" }, { side: "B", conf: "est" }, { side: "A", conf: "observed" }, { side: "B", conf: "observed" }])]));
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

test("確かさ：est は ×0.6、observed は ×0.8（P8B の +40 → +24・+32）。相手が関係を戻す派なら RR は効かない", () => {
  const sure = scoreActions({ lastSender: "none", elapsed: "12h_2d", partner: D("8B") }, "cold_war.short").scores;
  const est = scoreActions({ lastSender: "none", elapsed: "12h_2d", partner: D("8B~") }, "cold_war.short").scores;
  const obs = scoreActions({ lastSender: "none", elapsed: "12h_2d", partner: D("8B*") }, "cold_war.short");
  assert.equal(sure.restore_routine, 80);   // 35 + G1 5 + P8B 40
  assert.equal(est.restore_routine, 64);    // 35 + G1 5 + P8B 40×0.6
  assert.equal(obs.scores.restore_routine, 70);   // 35 + G1 5 + P8B 40×0.8=32 → 上限 30
  assert.ok(obs.applied.includes("CAP"));
  for (const p of ["8A", "8A*", ""]) assert.ok(scoreActions({ lastSender: "none", elapsed: "12h_2d", partner: D(p) }, "cold_war.short").applied.includes("RR"), p);
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
  const est = judge({ ...SAME, partner: D("2A~ 1A~") });   // apology_partial 64 vs pause 60
  assert.equal(est.margin, 4); assert.equal(est.confidence, "provisional");
  const obs = judge({ ...SAME, partner: domainsFromChoices({ 2: "A", 1: "A" }) });   // observed → est（T20 と同じ。差 10 なので下げない）
  assert.equal(obs.margin, 10); assert.equal(obs.confidence, "est");
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
    assert.equal(v.source, "diagnosis", `${label} ${d}：source`);
    if (f.lead) {
      assert.equal(v.side, f.lead === DOMAINS[d].a ? "A" : "B", `${label} ${d}：side`);
      assert.equal(f.weak || f.conflict, v.conf === "est", `${label} ${d}：weak/conflict ⇔ est`);
      assert.equal(!(f.weak || f.conflict), v.conf === "sure", `${label} ${d}：sure`);
      assert.equal(v.reason, f.conflict ? "conflict" : f.weak ? "weak" : undefined, `${label} ${d}：reason`);
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
  assert.deepEqual(doms[1], { side: "A", conf: "sure", source: "diagnosis" });
  assert.deepEqual(doms[2], { side: "B", conf: "est", source: "diagnosis", reason: "weak" });
  assert.deepEqual(doms[3], { side: "B", conf: "est", source: "diagnosis", reason: "conflict" });
  for (const d of [4, 5, 6, 7, 8]) assert.deepEqual(doms[d], { side: null, conf: "none", source: "diagnosis" });
});
test("domainsFromChoices：答えた領域は observed（0.8・利用者の見立て）、答えていない・不正な値は none", () => {
  const doms = domainsFromChoices({ 2: "A", 1: "B", 5: "x" });
  assert.deepEqual(Object.keys(doms).map(Number), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(doms[1], { side: "B", conf: "observed", source: "observed" });
  assert.deepEqual(doms[2], { side: "A", conf: "observed", source: "observed" });
  for (const d of [3, 4, 5, 6, 7, 8]) assert.deepEqual(doms[d], { side: null, conf: "none", source: "none" });
  assert.deepEqual(domainsFromChoices(), domainsFromChoices({}));
  // C2 を2択の推定（est）で答えた場合：鍵の領域2 が分かっているので2通りにせず、謝罪寄りになる
  const r = judge({ ...SAME, partner: domainsFromChoices({ 2: "A", 1: "A" }) });
  assert.equal(r.variants, null);
  assert.equal(r.action, "apology_partial");
});

// ---------------------------------------------------------------- 5. D1 上限 CAP の細部
test("CAP：重み 1.0 の相手由来の補正は上限なし（C2 は 80 のまま、CAP なし）", () => {
  const r = judge({ ...SAME, partner: D("2A 1A") });
  assert.equal(scoreOf(r, "apology_partial"), 80); assert.ok(!r.applied.includes("CAP"));
});
test("CAP：1.0 の分はそのまま、1.0 未満の分だけ ±30（2A sure・1A observed → 35 + 30 + 8 + 5 = 78、上限に届かない）", () => {
  const s = scoreActions({ ...SAME, partner: D("2A 1A*") }, "waiting_partner");
  assert.equal(s.scores.apology_partial, 78); assert.ok(!s.applied.includes("CAP"));
});
test("CAP：減点も −30 まで（相手 1A・2A・3A が observed：wait_until は P1A −12・P2A −8・R2 −16 = −36 → −30）", () => {
  const s = scoreActions({ lastSender: "self", selfLast: "hold", elapsed: "lt3h", partner: D("1A* 2A* 3A*") }, "waiting_partner");
  assert.equal(s.scores.wait_until, 45 + 20 - 30); assert.ok(s.applied.includes("CAP"));
  assert.equal(s.applied.filter(x => x === "CAP").length, 1);
});
test("CAP：R8 は相手の領域1 として数える（自分 3A・相手 1B observed：ask_feeling −8、propose_call −12 は上限内）", () => {
  const s = scoreActions({ ...SAME, self: D("3A"), partner: D("1B*") }, "waiting_partner");
  assert.ok(s.applied.includes("R8"));
  assert.equal(s.scores.propose_call, 10 - 12 - 12);   // R8 −15×0.8、P1B −15×0.8
  assert.equal(s.scores.ask_feeling, 10 - 8 - 4 - 10);   // R8 −10×0.8、P1B −5×0.8、S3A −10
});
test("CAP：HG で ask_feeling に回した分も上限の対象（C2 を cause=partner・observed にすると ask_feeling は 10 + 30）", () => {
  const s = scoreActions({ ...SAME, cause: "partner", partner: D("2A* 1A*") }, "waiting_partner");
  assert.equal(s.scores.ask_feeling, 40); assert.ok(s.applied.includes("HG") && s.applied.includes("CAP"));
});

// ---------------------------------------------------------------- 6. D4(c) 同意、D5 本人の修正
test("domainsFromInvite：相手の同意（consent === true）があるときだけ取り込む", () => {
  const p3 = fromLikertAnswers(SAMPLES3[0].answers, SAMPLES3[0].wording).result().profile3;
  for (const opt of [{}, { consent: false }, { consent: "yes" }, undefined]) {
    const doms = domainsFromInvite(p3, opt);
    for (let d = 1; d <= 8; d++) assert.deepEqual(doms[d], { side: null, conf: "none", source: "none" }, JSON.stringify(opt));
  }
  assert.deepEqual(domainsFromInvite(p3, { consent: true }), domainsFromProfile3(p3));
});
test("removePartnerDiagnosis：出どころが診断の領域だけ不明に戻し、見立ては残す。元は変えない", () => {
  const partner = { 1: { side: "A", conf: "sure", source: "diagnosis" }, 2: { side: "B", conf: "est", source: "diagnosis", reason: "weak" },
    3: { side: "A", conf: "observed", source: "observed" } };
  const before = structuredClone(partner);
  const out = removePartnerDiagnosis(partner);
  assert.deepEqual(partner, before);
  assert.deepEqual(out[1], { side: null, conf: "none", source: "none" });
  assert.deepEqual(out[2], { side: null, conf: "none", source: "none" });
  assert.deepEqual(out[3], { side: "A", conf: "observed", source: "observed" });
  for (const d of [4, 5, 6, 7, 8]) assert.deepEqual(out[d], { side: null, conf: "none", source: "none" });
  assert.equal(judge({ ...SAME, partner: out }).variants?.A, "apology_partial", "鍵の領域2 が不明に戻り、2通りになる");
});
test("applySelfCorrections：直した領域は stated・sure（重み 1.0）。不正な項目は無視、元は変えない", () => {
  const self = { 7: { side: "B", conf: "est", source: "diagnosis", reason: "weak" }, 3: { side: "B", conf: "sure", source: "diagnosis" } };
  const before = structuredClone(self);
  const out = applySelfCorrections(self, { 7: "A", 9: "A", 2: "C", 0: "B", x: "A" });
  assert.deepEqual(self, before);
  assert.deepEqual(out[7], { side: "A", conf: "sure", source: "stated" });
  assert.deepEqual(out[3], { side: "B", conf: "sure", source: "diagnosis" });
  for (const d of [1, 2, 4, 5, 6, 8]) assert.deepEqual(out[d], { side: null, conf: "none", source: "none" });
  // 判定では w = 1.0：S7A（prepare_points +10）がそのまま効く（est なら +6）
  const est = scoreActions({ intent: "tell", self: { 7: { side: "A", conf: "est" } } }, "before_talk").scores.prepare_points;
  const stated = judge({ intent: "tell", self: out });
  assert.equal(est, 66); assert.equal(scoreOf(stated, "prepare_points"), 70);
  assert.ok(stated.styles.includes("one_topic"));
});

// ---------------------------------------------------------------- 7. D2 人ごとの層
const COUPLE = { calmDownTime: "数時間", medium: "call", livingTogether: true, register: "casual", partnerCall: "ゆうくん" };
test("人ごとの層：8領域は向き・確かさ・出どころ（確度低の理由）だけ。不明は番号の一覧", () => {
  const L = buildPersonLayer({
    self: { 1: { side: "A", conf: "sure", source: "diagnosis" }, 2: { side: "B", conf: "est", source: "diagnosis", reason: "conflict" }, 3: { side: "A", conf: "sure", source: "stated" } },
    partner: domainsFromChoices({ 8: "B" }),
  });
  assert.deepEqual(Object.keys(L), ["self", "partner", "couple", "selfMain"]);
  assert.deepEqual(L.self.domains, [
    { d: 1, name: DOMAINS[1].name, tendency: DOMAINS[1].a, conf: "sure", source: "diagnosis" },
    { d: 2, name: DOMAINS[2].name, tendency: DOMAINS[2].b, conf: "est", source: "diagnosis", reason: "conflict" },
    { d: 3, name: DOMAINS[3].name, tendency: DOMAINS[3].a, conf: "sure", source: "stated" },
  ]);
  assert.deepEqual(L.self.unknown, [4, 5, 6, 7, 8]);
  assert.deepEqual(L.partner.domains, [{ d: 8, name: DOMAINS[8].name, tendency: DOMAINS[8].b, conf: "observed", source: "observed" }]);
  assert.deepEqual(L.partner.unknown, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(L.couple, { calmDownTime: null, medium: null, livingTogether: null, register: null, partnerCall: null });
  assert.equal(L.selfMain, null);
});
test("人ごとの層：カップルの事実は決まった値だけ（不正な値は null、自由記述は20字まで）", () => {
  assert.deepEqual(buildPersonLayer({ couple: COUPLE }).couple, COUPLE);
  const bad = buildPersonLayer({ couple: { calmDownTime: "あ".repeat(30), medium: "line", livingTogether: "yes", register: "rude", partnerCall: "  " } }).couple;
  assert.deepEqual(bad, { calmDownTime: "あ".repeat(20), medium: null, livingTogether: null, register: null, partnerCall: null });
});
test("人ごとの層：本人の主軸は「当たっている」（confirmed === true）のときだけ。見出しと注意点だけで、一言・本文・場面例は入れない", () => {
  const p3 = fromLikertAnswers(SAMPLES3[0].answers, SAMPLES3[0].wording).result();
  const mainId = p3.select.chosen.find(h => h.role === "主軸").meta.id;
  for (const confirmed of [false, undefined, "true", 1]) assert.equal(buildPersonLayer({ selfMain: { id: mainId, confirmed } }).selfMain, null, String(confirmed));
  const L = buildPersonLayer({ self: domainsFromProfile3(p3.profile3), selfMain: { id: mainId, confirmed: true } });
  const t = getText(mainId);
  assert.deepEqual(Object.keys(L.selfMain), ["id", "headline", "caveat"]);
  assert.equal(L.selfMain.caveat, t.caveat);
  const json = JSON.stringify(L), text = personLayerText(L);
  for (const part of [t.one, t.detail, ...t.scenes, t.unique].filter(Boolean)) {
    assert.ok(!json.includes(part) && !text.includes(part), "一言・本文・場面例・独自性を入れない");
  }
  assert.ok(text.includes(t.caveat));
  assert.equal(buildPersonLayer({ selfMain: { id: "NOPE", confirmed: true } }).selfMain, null);
});
test("人ごとの層：X の level・W の数・点数・相手のパターンを入れない（実回答サンプルで確かめる）", () => {
  for (const smp of SAMPLES3) {
    const r = fromLikertAnswers(smp.answers, smp.wording).result();
    const L = buildPersonLayer({ self: domainsFromProfile3(r.profile3), partner: domainsFromProfile3(r.profile3), couple: COUPLE,
      selfMain: { id: r.select.chosen[0].meta.id, confirmed: true } });
    const json = JSON.stringify(L), text = personLayerText(L);
    for (const key of ["level", "levels", "w", "a", "b", "n", "score", "margin", "importance", "patterns", "partnerMain"]) {
      assert.ok(!json.includes(`"${key}":`), `${smp.key}：キー ${key}`);
    }
    assert.ok(!/\d+:\d+/.test(json + text), `${smp.key}：W の数（3:1 など）`);
    // 数値は領域番号（1〜8）だけ。文字列の値には数字を含まない（level・W の数・点数が文章に紛れ込んでいない）
    const nums = [], strs = [];
    JSON.parse(json, (k, v) => { if (typeof v === "number") nums.push([k, v]); if (typeof v === "string" && k !== "id") strs.push(v); return v; });   // id はパターン ID（S03 など）
    assert.ok(nums.every(([k, v]) => (k === "d" || /^\d+$/.test(k)) && v >= 1 && v <= 8), JSON.stringify(nums));
    assert.ok(strs.every(v => !/[0-9０-９]/.test(v)), `${smp.key}：文字列に数字 ${strs.filter(v => /[0-9０-９]/.test(v))}`);
    assert.ok(text.split("\n").every(line => !/[0-9０-９]/.test(line.replace(/^[1-8] /, "").replace(/、[1-8] /g, "、"))), `${smp.key}：文字列の数字は領域番号だけ`);
    assert.ok(!("partner" in L && "main" in L.partner), "相手のパターンは入れない");
  }
});
test("人ごとの層：同じ入力なら同じ文字列。8＋8領域・事実・主軸を全部入れても小さい（JSON < 2000字、文字列 < 800字）", () => {
  const full = (conf, source, reason) => Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(d => [d, { side: d % 2 ? "A" : "B", conf, source, ...(reason ? { reason } : {}) }]));
  const typical = buildPersonLayer({ self: full("sure", "diagnosis"), partner: full("observed", "observed"), couple: COUPLE, selfMain: { id: "S03", confirmed: true } });
  const worst = buildPersonLayer({ self: full("est", "diagnosis", "conflict"), partner: full("est", "diagnosis", "conflict"),
    couple: { ...COUPLE, calmDownTime: "あ".repeat(40), partnerCall: "い".repeat(40) }, selfMain: { id: "X25-4", confirmed: true } });
  for (const [name, L] of [["typical", typical], ["worst", worst]]) {
    const json = JSON.stringify(L), text = personLayerText(L);
    console.log(`     人ごとの層 ${name}：JSON ${json.length}字（8＋8領域だけ ${JSON.stringify({ self: L.self, partner: L.partner }).length}字）、文字列 ${text.length}字`);
    assert.ok(json.length < 2000, `${name} JSON ${json.length}`);
    assert.ok(text.length < 800, `${name} text ${text.length}`);
    assert.equal(personLayerText(structuredClone(L)), text);
  }
  const t = personLayerText(typical);
  assert.ok(t.startsWith("[本人]\n1 衝突への向き合い方：向き合う（確か・診断）"));
  assert.ok(t.includes("（あなたの見立て）") && !t.includes("見立て・あなたの見立て"));
  assert.ok(t.includes("[ふたり]\n落ち着くまで：数時間\n話しやすいのは：電話\n同居：している\n文体：タメ口\n相手の呼び方：ゆうくん"));
  assert.ok(personLayerText(worst).includes("（仮・相手の診断・向きが逆）"));
});

// ---------------------------------------------------------------- 8. D3・D4(a) 送る前チェック
const DRAFTS = [
  // [ラベル, 文面, { action, avoid }, 期待する level, 期待する hits の id]
  ["例1 S1（§2.12）", "今日はここで止めて、明日の昼にちゃんと話したい。返事はいらないよ", { action: "pause_with_time", avoid: AVOID["waiting_partner"] }, "届きやすい", []],
  ["例2 S2（§2.12）", "そこまで言わせたんだなと思ってる。ちゃんと返したいから、今夜10時ごろにもう一度送るね", { action: "acknowledge", avoid: AVOID["partner_msg.c"] }, "届きやすい", []],
  ["例3 S4（§2.12）", "この前は待たせてごめん。時間を軽く見てた自分が悪かった。次は遅れそうな時点で連絡する。週末どこかで少し話せる？ 無理なら日はいつでもいい", { action: "apology_full", avoid: AVOID["cold_war.long"] }, "届きやすい", []],
  ["例4 S5（§2.12）", "ちゃんと謝ってくれてありがとう。読んだよ。正直まだ気持ちが追いついてないから、少し時間がほしい。落ち着いたらこっちから話すね", { action: "accept_apology", avoid: AVOID["got_apology"] }, "届きやすい", []],
  ["例5 S6（§2.12）", "わかった、距離を置こう。1つだけ、どれくらいを考えてるかと、急ぎの連絡はLINEでいいかだけ教えてほしい。答えは急がなくていい", { action: "accept_space", avoid: AVOID["space.partner"] }, "届きやすい", []],
  ["例5 を short_feeling で", "わかった、距離を置こう。1つだけ、どれくらいを考えてるかと、急ぎの連絡はLINEでいいかだけ教えてほしい。答えは急がなくていい", { action: "short_feeling" }, "ふつう", ["asks_reply"]],
  ["request_space（時刻あり）", "日曜の夜に連絡する。それまで考えさせて", { action: "request_space", avoid: AVOID["space.self"] }, "届きやすい", []],
  ["pause_with_time（時刻なし）", "ちょっと落ち着きたいから、少し時間をちょうだい", { action: "pause_with_time" }, "ふつう", ["missing_time"]],
  ["同じ文を short_feeling で", "ちょっと落ち着きたいから、少し時間をちょうだい", { action: "short_feeling" }, "届きやすい", []],
  ["問い詰め＋既読", "なんで無視するの？既読ついてるよね", { action: "short_feeling", avoid: AVOID["waiting_partner"] }, "届きにくい", ["interrogate", "read_receipt"]],
  ["最後通告", "もういい。勝手にして", {}, "届きにくい", ["ultimatum", "ultimatum"]],
  ["でも付きの謝罪", "ごめん、でもそっちも悪いよね", { action: "apology_partial" }, "届きにくい", ["but_apology"]],
  ["人格への批判", "あなたって本当に自分勝手な人だよね", {}, "届きにくい", ["character"]],
  ["一般化＋過去", "いつもそう。前も同じことしてたよね", {}, "ふつう", ["generalize", "past"]],
  ["返事の要求", "このままは嫌だな。返事して", { action: "short_feeling" }, "ふつう", ["asks_reply"]],
  ["ask_feeling は聞いてよい", "さっきの件、どう感じてたか教えてほしい", { action: "ask_feeling" }, "届きやすい", []],
  ["診断への言及", "診断だと君は熟考派だから、ゆっくりでいいよ", {}, "届きにくい", ["mentions_diagnosis", "mentions_diagnosis"]],
  ["第三者の引用", "友達もおかしいって言ってた", {}, "ふつう", ["third_party"]],
  ["禁止語＋皮肉", "論破したいわけじゃないけど、はいはいって言うのはやめて", {}, "届きにくい", ["sarcasm", "forbidden"]],
  ["長文", "今日はありがとう。".repeat(23), {}, "ふつう", ["long"]],
  ["「言い返して」は返事の要求ではない", "さっきは言い返してごめん。言い方がきつかった", { action: "apology_partial" }, "届きやすい", []],
  ["avoid にない past は見ない", "前も同じこと言ったよね", { avoid: AVOID["waiting_partner"] }, "届きやすい", []],
  ["avoid にある past は見る", "前も同じこと言ったよね", { avoid: AVOID["heated"] }, "ふつう", ["past"]],
  ["third_party は avoid によらず見る（ふつう）", "親もおかしいって言ってたよ", { action: "short_feeling", avoid: AVOID["cold_war.short"] }, "ふつう", ["third_party"]],
];
for (const [label, text, opts, level, ids] of DRAFTS) {
  test(`送る前チェック：${label} → ${level}`, () => {
    const r = checkDraft(text, opts);
    console.log(`     「${text.length > 40 ? text.slice(0, 40) + "…" : text}」 → ${r.level} ${JSON.stringify(r.hits)}`);
    assert.equal(r.level, level);
    assert.deepEqual(r.hits.map(h => h.id), ids);
    assert.deepEqual(Object.keys(r), ["level", "hits"]);
    for (const h of r.hits) assert.deepEqual(Object.keys(h), ["id", "text"]);
    assert.ok(!JSON.stringify(r).match(/"(score|probability|rate)"/), "数字の点数は出さない");
  });
}
test("送る前チェック：長さの目安は 200 字（200 字ちょうどは長文ではない）", () => {
  assert.equal(LONG_CHARS, 200);
  assert.deepEqual(checkDraft("あ".repeat(200)).hits, []);
  assert.deepEqual(checkDraft("あ".repeat(201)).hits.map(h => h.id), ["long"]);
  assert.equal(checkDraft("").level, "届きやすい");
});

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} consult tests passed`);
process.exit(fail ? 1 : 0);
