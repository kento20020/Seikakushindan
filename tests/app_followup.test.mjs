// node tests/app_followup.test.mjs
// 新しい画面（app/）の相談の「続き（往復）」のうち、DOM の無い部分（app/js/consult_followup.js）のテスト。仕様：docs/app-screens.md §11（決定 U30）
//  - 時間の区切り（elapsedBucket）と「送ってから◯時間ほどですね。」
//  - 答え合わせの1行（checkReply。数字なし・「当たる」と言わない）
//  - 状況の書き換え（afterSent・afterNoReply・afterReply・mergeTalk・splitExtra）
//  - 一手が変わったか（actionChanged）と、判定し直し（rejudge）が最初のカードと同じ道で決まること
//  - 例：「wait_until のあと相手から謝りが来たら一手が変わる」「やっぱり謝りたい で一手が変わる」
// 時刻は UTC で渡し、時差は tzOffset（日本時間 540）で固定するので、実行環境の時差に依存しない
import assert from "node:assert/strict";
import * as F from "../app/js/consult_followup.js";
import * as M from "../poc/card/model.js";
import { readText } from "../js/consult/extract.js";
import { ACTIONS } from "../js/consult/rules.js";
import { ASKABLE } from "../js/consult/needed.js";
import { READ_CASES } from "./fixtures/consult_read_cases.mjs";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}
const JST = 540;
const NOON = new Date("2026-10-18T03:00:00Z");   // 日本時間の 12:00（深夜ではない）
const HOUR = 3600 * 1000;
const judge = (known, now = NOON, extra = {}) => F.rejudge({ known, extra, text: "", now, tzOffset: JST });
const caseKnown = (id) => ({ ...readText(READ_CASES.find(c => c.id === id).text).fields });

// ---------------------------------------------------------------- 時間
test("elapsedBucket：3時間未満／3〜12時間／半日〜2日（3日未満まで）／3日以上。数でない・負は 3時間未満", () => {
  assert.equal(F.elapsedBucket(0), "lt3h");
  assert.equal(F.elapsedBucket(3 * HOUR - 1), "lt3h");
  assert.equal(F.elapsedBucket(3 * HOUR), "3h_12h");
  assert.equal(F.elapsedBucket(12 * HOUR - 1), "3h_12h");
  assert.equal(F.elapsedBucket(12 * HOUR), "12h_2d");
  assert.equal(F.elapsedBucket(71 * HOUR), "12h_2d");
  assert.equal(F.elapsedBucket(72 * HOUR), "ge3d");
  assert.equal(F.elapsedBucket(-5), "lt3h");
  assert.equal(F.elapsedBucket(NaN), "lt3h");
  assert.equal(F.elapsedBucket(undefined), "lt3h");
  for (const ms of [0, 4 * HOUR, 20 * HOUR, 100 * HOUR]) assert.ok(ASKABLE.elapsed.includes(F.elapsedBucket(ms)));
});

test("sinceText：1時間未満・時間・日の3通り", () => {
  assert.equal(F.sinceText(10 * 60 * 1000), "送ってから、まだ1時間たっていませんね。");
  assert.equal(F.sinceText(5 * HOUR + 10 * 60 * 1000), "送ってから5時間ほどですね。");
  assert.equal(F.sinceText(30 * HOUR), "送ってから1日ほどですね。");
  assert.equal(F.sinceText(80 * HOUR), "送ってから3日ほどですね。");
  assert.equal(F.sinceText(-1), "送ってから、まだ1時間たっていませんね。");
});

// ---------------------------------------------------------------- 答え合わせ
test("checkReply：落ち着いた返事は近い、強い返事はちがう。距離の受け止めで距離・別れ話なら近い", () => {
  for (const k of ["casual", "explain", "talk_proposal", "apology"]) {
    assert.deepEqual(F.checkReply("wait_until", k), { result: "near", text: "予想に近い返事です。" }, k);
    assert.equal(F.checkReply("accept_space", k).result, "near", `accept_space ${k}`);
  }
  for (const k of ["attack", "space", "breakup"]) {
    assert.deepEqual(F.checkReply("pause_with_time", k), { result: "different", text: "予想とはちがう返事でした。ここから一緒に考え直します。" }, k);
  }
  assert.equal(F.checkReply("accept_space", "space").result, "near");
  assert.equal(F.checkReply("accept_space", "breakup").result, "near");
  assert.equal(F.checkReply("accept_space", "attack").result, "different");
  assert.equal(F.checkReply("wait_until", null), null);
  assert.equal(F.checkReply("wait_until", "none"), null);
});

test("答え合わせ・決まった文に数字と「当たる」「確率」を使わない", () => {
  const texts = [...Object.values(F.TEXTS), ...F.OUTCOMES.map(o => o.reply), F.OUTCOME_SKIP_REPLY, F.REPLY_KIND_QUESTION.text];
  for (const t of texts) {
    assert.ok(!/当た|確率|%|％/.test(t), t);
  }
  for (const k of ["casual", "attack"]) assert.ok(!/[0-9０-９]/.test(F.checkReply("wait_until", k).text));
});

// ---------------------------------------------------------------- ［送った］
test("SELF_LAST_BY_ACTION：全部の一手に行があり、§11.4 の表のとおり（待つ一手は null＝変えない）", () => {
  assert.deepEqual(Object.keys(F.SELF_LAST_BY_ACTION).sort(), [...ACTIONS].sort());
  assert.equal(F.SELF_LAST_BY_ACTION.apology_full, "apology");
  assert.equal(F.SELF_LAST_BY_ACTION.apology_partial, "apology");
  for (const a of ["acknowledge", "short_feeling", "accept_apology", "restore_routine", "ask_feeling", "propose_call", "propose_talk_plan"]) assert.equal(F.SELF_LAST_BY_ACTION[a], "reconcile", a);
  for (const a of ["pause_with_time", "accept_space", "request_space"]) assert.equal(F.SELF_LAST_BY_ACTION[a], "hold", a);
  for (const a of ["wait_until", "self_calm", "prepare_points"]) assert.equal(F.SELF_LAST_BY_ACTION[a], null, a);
});

test("afterSent：最後は自分・3時間未満・相手からは無し・自分の最後は一手から。待つ一手は保留。したいことと言い合いは戻す", () => {
  const known = { lastSender: "partner", partnerLast: "attack", elapsed: "12h_2d", selfTemp: "high", intent: "apologize", ongoing: true, goal: "understood" };
  const r = F.afterSent(known, "apology_full", NOON);
  assert.deepEqual(r.known, { lastSender: "self", partnerLast: "none", elapsed: "lt3h", selfTemp: "high", intent: "none", ongoing: false, goal: "understood", selfLast: "apology" });
  assert.equal(r.sentAt, NOON.toISOString());
  assert.equal(known.lastSender, "partner", "元は変えない");
  assert.equal(F.afterSent({}, "wait_until", NOON).known.selfLast, "hold");
  assert.equal(F.afterSent({}, "propose_call", NOON).known.selfLast, "reconcile");
  assert.equal(F.afterSent({}, "pause_with_time", NOON).known.selfLast, "hold");
  assert.ok(!("intent" in F.afterSent({}, "acknowledge", NOON).known), "分からない項目は足さない");
});

test("afterNoReply：ミリ秒でも区切りの値でも、どれくらい前かを入れる", () => {
  const k = F.afterSent({ selfTemp: "cooling" }, "short_feeling", NOON).known;
  assert.equal(F.afterNoReply(k, 30 * HOUR).elapsed, "12h_2d");
  assert.equal(F.afterNoReply(k, "ge3d").elapsed, "ge3d");
  assert.equal(F.afterNoReply(k, 30 * HOUR).selfLast, "reconcile");
  assert.equal(F.afterNoReply(k, 30 * HOUR).lastSender, "self");
});

// ---------------------------------------------------------------- ［相手の返事を貼る］
test("readReply：「相手から「…」と返事が来た」の形で読む。読めなければ null、安全の言葉は毎回見る", () => {
  assert.equal(F.replyText("ごめん、言いすぎた"), "相手から「ごめん、言いすぎた」と返事が来た");
  assert.equal(F.readReply("ごめん、言いすぎた").kind, "apology");
  assert.equal(F.readReply("もう無理、別れよう").kind, "breakup");
  assert.equal(F.readReply("今は話したくない").kind, null);
  assert.equal(F.readReply("ちょっと距離を置きたい").kind, "space");
  const s = F.readReply("別れるなら死ぬ");
  assert.equal(s.safety.partnerThreat, true);
  assert.ok(M.hasSafetySign(s.read));
  assert.equal(M.hasSafetySign(F.readReply("ごめん、言いすぎた").read), false);
  // 中の「」・改行があっても形がくずれない
  assert.equal(F.replyText("「もういい」って\nどういう意味？"), "相手から「『もういい』って どういう意味？」と返事が来た");
});

test("REPLY_KIND_QUESTION：相手の言葉の7つ（なしは入れない）", () => {
  assert.deepEqual(F.REPLY_KIND_QUESTION.options.map(o => o.kind), ["apology", "casual", "explain", "attack", "talk_proposal", "space", "breakup"]);
  for (const o of F.REPLY_KIND_QUESTION.options) assert.deepEqual(o.patch, { partnerLast: o.kind });
});

test("afterReply：最後は相手から・相手の言葉の種類・3時間未満・言い合いの最中ではない。自分の最後の送り方は変えない", () => {
  const sent = F.afterSent({ selfTemp: "cooling" }, "apology_partial", NOON).known;
  const k = F.afterReply(sent, "attack", { sent: true });
  assert.equal(k.lastSender, "partner");
  assert.equal(k.partnerLast, "attack");
  assert.equal(k.elapsed, "lt3h");
  assert.equal(k.ongoing, false);
  assert.equal(k.selfLast, "apology");
  assert.equal(F.afterReply({ selfLast: "hold" }, "casual").selfLast, "hold");
  assert.ok(!("partnerLast" in F.afterReply({ partnerLast: "attack" }, null)), "種類が分からなければ外す");
});

// ---------------------------------------------------------------- ［もう少し話したい］
test("mergeTalk：読めた項目だけを重ねる（正しくない値は入れない）", () => {
  const k = F.mergeTalk({ lastSender: "self", intent: "none" }, readText("やっぱり謝りたい").fields);
  assert.equal(k.intent, "apologize");
  assert.equal(k.lastSender, "self");
  assert.deepEqual(F.mergeTalk({ elapsed: "lt3h" }, { elapsed: "forever", selfTemp: "high", other: 1 }), { elapsed: "lt3h", selfTemp: "high" });
  assert.deepEqual(F.mergeTalk({ a: 1 }, { afterMakeup: true }), { a: 1, afterMakeup: true });
});

test("talkAccept：気持ちの部分だけ。読めなければ「話してくれて、ありがとうございます。」", () => {
  assert.equal(F.talkAccept(readText("うーん"), "うーん"), "話してくれて、ありがとうございます。");
  assert.equal(F.talkAccept(readText("やっぱり謝りたい"), "やっぱり謝りたい"), "謝りたいんですね。");
  assert.match(F.talkAccept(readText("まだ腹が立つ"), "まだ腹が立つ"), /腹が立つのも無理はないです/);
});

test("talkQuestion：一手が変わる項目があれば1つだけ。もう聞いた項目は二度聞かない", () => {
  const known = F.mergeTalk(caseKnown("P2"), readText("やっぱり謝りたい").fields);
  const q = F.talkQuestion(known, ["scene"], { lateNight: false });
  assert.ok(q, "聞く問がある");
  assert.notEqual(q.id, "scene");
  assert.ok(q.options.length >= 2 && q.options.every(o => o.patch && typeof o.label === "string"));
  const q2 = F.talkQuestion(known, ["scene", q.id], { lateNight: false });
  assert.notEqual(q2?.id, q.id);
  // 一手が1つに決まっていれば聞かない（相手から謝りが来た：謝りを受け取る）
  assert.equal(F.talkQuestion({ lastSender: "partner", partnerLast: "apology", elapsed: "lt3h", ongoing: false, intent: "none", selfTemp: "calm" }, [], { lateNight: false }), null);
});

// ---------------------------------------------------------------- 判定し直し・一手が変わったか
test("rejudge：最初のカードと同じ道（buildPoc）で、同じ入力なら同じ一手", () => {
  for (const c of READ_CASES) {
    const known = { ...readText(c.text).fields };
    const a = F.rejudge({ known, text: c.text, now: NOON, tzOffset: JST, lateNight: false });
    const b = M.buildPoc({ known: { ...known, lateNight: false }, text: c.text, now: NOON, tzOffset: JST });
    assert.equal(a.result.action, b.result.action, c.id);
    assert.equal(a.headline, b.headline, c.id);
  }
});

test("actionChanged：一手・送る／待つ・安全の扱いのどれかが変わったら true（写しでもよい）", () => {
  const m1 = judge({ lastSender: "partner", partnerLast: "apology", elapsed: "lt3h" });
  const m2 = judge({ lastSender: "partner", partnerLast: "apology", elapsed: "lt3h" });
  assert.equal(F.actionChanged(m1, m2), false);
  const m3 = judge({ lastSender: "partner", partnerLast: "casual", elapsed: "lt3h" });
  assert.notEqual(m1.result.action, m3.result.action);
  assert.equal(F.actionChanged(m1, m3), true);
  const safe = F.rejudge({ known: { lastSender: "partner", partnerLast: "apology", elapsed: "lt3h" }, now: NOON, tzOffset: JST, safetyContinue: true, safety: { partnerThreat: true } });
  assert.equal(safe.result.action, m1.result.action);
  assert.equal(F.actionChanged(m1, safe), true, "安全の扱いが変わった");
  assert.equal(F.actionChanged({ mode: "send", action: m1.result.action, safetyLine: null }, m2), false, "写しと比べる");
  assert.equal(F.actionChanged(null, m1), true);
});

test("例：返事待ち（P1）→［送った］で待つ一手 → 相手から謝りが来たら一手が変わる（謝りを受け取る）。答え合わせは近い", () => {
  const known = caseKnown("P1");
  const first = judge(known);
  const sent = F.afterSent(known, first.result.action, NOON);
  const waiting = judge(sent.known);
  assert.equal(waiting.result.action, "wait_until");
  const rr = F.readReply("ごめん、言いすぎた");
  assert.equal(F.checkReply(waiting.result.action, rr.kind).result, "near");
  const after = judge(F.afterReply(sent.known, rr.kind, { sent: true }));
  assert.equal(after.result.action, "accept_apology");
  assert.equal(F.actionChanged(waiting, after), true);
});

test("例：送ったあと［まだ来ない］で1日以上たつと、待つ一手から短く気持ちを伝える一手に変わる", () => {
  const known = caseKnown("P1");
  const first = judge(known);
  const sent = F.afterSent(known, first.result.action, NOON);
  const now = new Date(NOON.getTime() + 30 * HOUR);
  const k = F.afterNoReply(sent.known, now.getTime() - Date.parse(sent.sentAt));
  assert.equal(k.elapsed, "12h_2d");
  const m = judge(k, now);
  assert.notEqual(m.result.action, "wait_until");
  assert.equal(F.actionChanged(judge(sent.known), m), true);
});

test("例：相手からきつい言葉（P2）→［もう少し話したい］「やっぱり謝りたい」で謝る一手に変わる", () => {
  const known = caseKnown("P2");
  const first = judge(known);
  const k = F.mergeTalk(known, readText("やっぱり謝りたい").fields);
  const m = judge(k);
  assert.ok(["apology_partial", "apology_full"].includes(m.result.action), m.result.action);
  assert.equal(F.actionChanged(first, m), true);
});

test("例：謝りたい（P5）→ 謝る1通を［送った］あとは、また謝る一手にはならない（したいことを戻すため）", () => {
  const known = caseKnown("P5");
  const first = judge(known);
  assert.ok(first.result.action.startsWith("apology"));
  const m = judge(F.afterSent(known, first.result.action, NOON).known);
  assert.ok(!m.result.action.startsWith("apology"), m.result.action);
});

test("keepText：送る一手は文面の見出し、待つ一手は戻る時刻への案内", () => {
  const send = judge({ lastSender: "partner", partnerLast: "apology", elapsed: "lt3h" });
  assert.match(F.keepText(send), /^一手はこのままで大丈夫です。/);
  assert.match(F.keepText(send), /送るならこの1通/);
  const wait = judge(F.afterSent(caseKnown("P1"), "pause_with_time", NOON).known);
  assert.equal(wait.mode, "wait");
  assert.equal(F.keepText(wait), "一手はこのままで大丈夫です。上のカードの「戻る時刻」まで、このまま待つ形です。");
  assert.ok(!/[0-9]/.test(F.keepText(wait)), "時刻は書かない（履歴で読むとずれるため）");
});

// ---------------------------------------------------------------- いまの状況・記録
test("statusLines：3行（やりとり・どれくらい前か・気持ち）。分からない項目は「分からない」", () => {
  assert.deepEqual(F.statusLines({}), ["最後に送ったのは：分からない", "最後のやりとりから：分からない", "いまの気持ち：分からない"]);
  const lines = F.statusLines({ lastSender: "self", selfLast: "apology", elapsed: "3h_12h", selfTemp: "high", intent: "apologize" });
  assert.deepEqual(lines, ["最後に送ったのは自分（謝った）", "最後のやりとりから：半日以内", "いまの気持ち：まだ熱い。したいこと：謝りたい"]);
  assert.equal(F.statusLines({ lastSender: "partner", partnerLast: "attack" })[0], "最後は相手から（責める・「もういい」）");
  assert.equal(F.statusLines({ ongoing: true })[0], "いま言い合いの最中");
  assert.equal(F.statusLines({ lastSender: "self", partnerLast: "space" })[0], "最後に送ったのは自分。相手の言葉：距離を置きたい");
});

test("splitExtra：カードで足した差分のうち、状況の項目は known へ（相手のタイプなどは差分に残す）", () => {
  const r = F.splitExtra({ lastSender: "self" }, { intent: "apologize", goal: "reconcile", partner: { 1: { side: "A", conf: "observed" } } });
  assert.deepEqual(r.known, { lastSender: "self", intent: "apologize", goal: "reconcile" });
  assert.deepEqual(r.extra, { partner: { 1: { side: "A", conf: "observed" } } });
});

test("newFollow と resumable：深夜の印は状況に入れない。終えた・閉じた相談は続きにしない", () => {
  const fu = F.newFollow({ known: { lastSender: "self", lateNight: true, want: "x" }, asked: ["scene"], safety: { selfHarm: true } });
  assert.deepEqual(fu.known, { lastSender: "self" });
  assert.deepEqual(fu.asked, ["scene"]);
  assert.deepEqual(fu.safety, { selfHarm: true, partnerThreat: false });
  assert.equal(fu.turns, 0);
  fu.thread = [{ who: "card" }];
  const rec = { kind: "consult", data: { v: 2, text: "t", input: {}, fu } };
  assert.equal(F.resumable(rec), true);
  assert.equal(F.resumable({ ...rec, data: { ...rec.data, fu: { ...fu, ended: true } } }), false);
  assert.equal(F.resumable({ ...rec, data: { ...rec.data, fu: { ...fu, closed: true } } }), false);
  assert.equal(F.resumable({ ...rec, data: { ...rec.data, v: 1 } }), false);
  assert.equal(F.resumable(null), false);
  assert.equal(F.MAX_TURNS, 10);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
