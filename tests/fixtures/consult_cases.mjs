// 相談モードの検証ケース（docs/consult-scoring.md §10）。判定のテスト（tests/consult.test.mjs）と
// 回答の層のテスト（tests/consult_responder.test.mjs）の両方で使う。
// CASES の1行：[ID, 入力, 局面, 一手, 付け足し（順番まで）, その他の確かめ（r => …）]
import assert from "node:assert/strict";

/** 8領域の短い書き方："2A 1B" → {2:{side:"A",conf:"sure"}, 1:{side:"B",conf:"sure"}}。"3A~" は est、"3A*" は observed */
export const D = (s) => Object.fromEntries(s.split(/\s+/).filter(Boolean).map(t => [+t[0], { side: t[1], conf: t.endsWith("~") ? "est" : t.endsWith("*") ? "observed" : "sure" }]));
/** 点数の一覧から行動の点を引く */
export const scoreOf = (r, a) => (r.scores.find(([x]) => x === a) || [])[1];

export const SAME = { lastSender: "self", elapsed: "lt3h", selfLast: "explain" };   // S1・C1〜C3 の共通
export const CASES = [
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
  // D1：出どころの段階（observed 0.8）と上限 CAP（w < 1.0 の相手由来の補正は ±30 まで）、RR は相手が関係を戻す派なら外す
  ["T18", { lastSender: "none", elapsed: "12h_2d", cause: "both", partner: D("8B*") }, "cold_war.short", "restore_routine", [],
    r => {
      assert.ok(r.applied.includes("CAP")); assert.ok(!r.applied.includes("RR"));
      assert.equal(scoreOf(r, "restore_routine"), 70); assert.equal(scoreOf(r, "short_feeling"), 65);
    }],
  ["T19", { lastSender: "none", elapsed: "12h_2d", cause: "both", partner: D("8B~") }, "cold_war.short", "short_feeling", [],
    r => { assert.equal(r.variants, null); assert.equal(scoreOf(r, "restore_routine"), 64); assert.ok(!r.applied.includes("CAP")); }],
  ["T20", { ...SAME, partner: D("2A* 1A*") }, "waiting_partner", "apology_partial", ["propose_call"],
    r => {
      assert.ok(r.applied.includes("CAP")); assert.ok(r.notes.includes("confirm_cause"));
      assert.equal(r.confidence, "est"); assert.equal(r.margin, 10);
      assert.equal(scoreOf(r, "apology_partial"), 70); assert.equal(scoreOf(r, "pause_with_time"), 60); assert.equal(scoreOf(r, "propose_call"), 30);
    }],
];

/**
 * 回答の層のテストで使う相談文（§10 の「場面」を本人が書いた想定）。安全ゲートや「」の引用の扱いを確かめるのにも使う
 */
export const CASE_TEXTS = {
  S1: "23時、LINEで言い合いになって、最後に送ったのは自分。そこから2時間既読のまま返事がない",
  S2: "相手から「もういい」と来て、それきり。どう返したらいいか分からない",
  S3: "昨日喧嘩して、今朝相手から「おはよう」だけ来た。ちゃんと話して終わらせたい",
  S4: "自分の遅刻が原因で喧嘩になって、3日間お互い何も送っていない",
  S5: "相手から長文で謝られた。でも正直まだ怒っている",
  S6: "相手から「しばらく距離を置きたい」と言われた",
  S7: "同棲中。口論のあと、相手が部屋にこもってしまった",
  S8: "自分が怒っていて、相手から来た言い分のLINEに返したくない",
  S9: "言い合いの最中に、自分が明らかに言いすぎた",
  S10: "毎月同じこと（連絡の頻度）で喧嘩になる。今は仲直りしている",
  S11: "「別れるなら死ぬ」と言われた。怖い",
  S12: "深夜2時。言いたいことを長文で書いてしまった",
  C1: "言い合いのあと、最後に送ったのは自分。2時間返事がない",
  C2: "言い合いのあと、最後に送ったのは自分。2時間返事がない。いつもはすぐ返ってくるのに",
  C2b: "言い合いのあと、最後に送ったのは自分。2時間返事がない。今回は相手のほうが悪いと思う",
  C3: "言い合いのあと、最後に送ったのは自分。2時間返事がない",
};
