// node tests/poc_card.test.mjs
// 次の一手カードの試作（poc/card/。統合1・統合3）のうち、DOM を使わない部分（poc/card/model.js）のテスト。
//  - 伝えたいこと：したいこと・ゴールからの文型、相手の引用は相手の言葉のときだけ、選び直しの差分
//  - 相手はたぶん：全部の一手に仮の文があり、数字・決めつけの言葉を使わない
//  - 道のり：全部の局面に段がある
//  - 戻る時刻：点検時刻の種類ごとの時刻（日本時間で固定。実行環境の時差に左右されない）
//  - 読み取りのチップ、案D の10件でカードの中身が作れること
import assert from "node:assert/strict";
import * as M from "../poc/card/model.js";
import { readText } from "../js/consult/extract.js";
import { nextQuestion, applyAnswer } from "../js/consult/needed.js";
import { ACTIONS, PHASES } from "../js/consult/rules.js";
import { FORBIDDEN_WORDS } from "../js/consult/card.js";
import { READ_CASES, answerFromTruth } from "./fixtures/consult_read_cases.mjs";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}
const JST = 540;
const at = (s) => new Date(s);

test("URL の設定：並びは既定 3、?v=1 で 1、見比べる・表示", () => {
  assert.equal(M.layoutOf(""), "3");
  assert.equal(M.layoutOf("?v=1"), "1");
  assert.equal(M.layoutOf("?v=2"), "3");
  assert.equal(M.compareOf("?compare=1"), true);
  assert.equal(M.compareOf("?v=1"), false);
  assert.equal(M.themeOf("?theme=dark", "light"), "dark");
  assert.equal(M.themeOf("", "light"), "light");
  assert.equal(M.themeOf("", "purple"), "auto");
});

test("伝えたいこと：したいことが先、なければゴール", () => {
  assert.equal(M.wantKeyOf({ intent: "apologize", goal: "settle" }), "apologize");
  assert.equal(M.wantKeyOf({ intent: "tell" }), "tell");
  assert.equal(M.wantKeyOf({ intent: "request_space" }), "space");
  assert.equal(M.wantKeyOf({ intent: "none", goal: "space" }), "space");
  assert.equal(M.wantKeyOf({ goal: "understood" }), "understood");
  assert.equal(M.wantKeyOf({ goal: "settle" }), "settle");
  assert.equal(M.wantKeyOf({}), "reconcile");
  for (const w of M.WANTS) assert.ok(w.label, w.key);
});

test("伝えたいこと：相手の「」は、相手から責める言葉が来たときだけ使う", () => {
  const text = "帰ってから彼から「もういい」ってLINEきた";
  assert.equal(M.wantText({ lastSender: "partner", partnerLast: "attack" }, text), "「もういい」で終わりにしたくない、ということ");
  assert.equal(M.wantText({ lastSender: "partner", partnerLast: "attack", goal: "understood" }, text), "「もういい」で終わりにしたくない、ということ");
  // 自分が送った「もういいよ」は相手の言葉ではない
  assert.equal(M.wantText({ lastSender: "self", partnerLast: "none" }, "最後に私が「もういいよ」って送った"), "このまま終わりにしたくない、ということ");
  assert.equal(M.wantText({ goal: "understood" }, ""), "気持ちを分かってほしい、ということ");
  assert.equal(M.wantText({ intent: "apologize", cause: "self" }, ""), "言いすぎた分を、ちゃんと謝りたい、ということ");
  assert.equal(M.wantText({ intent: "apologize", cause: "unknown" }, ""), "謝るところは、ちゃんと謝りたい、ということ");
  assert.equal(M.wantText({ intent: "request_space" }, ""), "少し時間がほしい、ということ");
  assert.equal(M.wantText({ goal: "settle" }, ""), "うやむやにせず決めたい、ということ");
  for (const k of ["apologize", "tell", "space", "understood", "settle", "reconcile"]) {
    const input = { intent: { apologize: "apologize", tell: "tell", space: "request_space" }[k] ?? "none", goal: { understood: "understood", settle: "settle" }[k] ?? "reconcile" };
    assert.match(M.wantText(input, ""), /、ということ$/, k);
  }
});

test("伝えたいこと：選び直すと、その種類になる差分（同じなら空）", () => {
  const base = { intent: "apologize", goal: "reconcile" };
  assert.deepEqual(M.wantPatch("apologize", base), {});
  for (const w of M.WANTS) {
    const p = M.wantPatch(w.key, base);
    assert.equal(M.wantKeyOf({ ...base, ...p }), w.key, w.key);
  }
  assert.deepEqual(M.wantPatch("understood", base), { goal: "understood", intent: "none" });
  assert.deepEqual(M.wantPatch("settle", { intent: "none", goal: "reconcile" }), { goal: "settle" });
});

test("相手はたぶん：安全以外の全部の一手に仮の文。数字・決めつけ・使わない語なし", () => {
  for (const a of ACTIONS) {
    if (a === "safety") continue;
    const t = M.guessText(a);
    assert.ok(t, a);
    assert.doesNotMatch(t, /[%％]|[0-9０-９]+(?:割|倍|人に)|絶対|必ず|な人|性格|確率/, a);   // 確率・割合を出さない（「1つ」は可）
    for (const w of FORBIDDEN_WORDS) assert.ok(!t.includes(w), `${a}: ${w}`);
  }
});

test("道のり：全部の局面に段（0〜3）、保留の一手は落ち着く段、安全はなし", () => {
  for (const phase of PHASES) {
    const s = M.roadStep({ gate: null, phase, action: "wait_until" });
    assert.ok(s >= 0 && s <= 3, phase);
  }
  assert.equal(M.roadStep({ gate: null, phase: "cold_war.long", action: "pause_with_time" }), 0);
  assert.equal(M.roadStep({ gate: null, phase: "want_apologize", action: "apology_full" }), 2);
  assert.equal(M.roadStep({ gate: "danger", phase: null, action: "safety" }), null);
  assert.equal(M.ROAD.length, 4);
});

test("送る／待つ：待つ一手は wait_until・self_calm・prepare_points", () => {
  assert.equal(M.cardMode({ gate: null, action: "wait_until" }), "wait");
  assert.equal(M.cardMode({ gate: null, action: "self_calm" }), "wait");
  assert.equal(M.cardMode({ gate: null, action: "prepare_points" }), "wait");
  assert.equal(M.cardMode({ gate: null, action: "pause_with_time" }), "send");
  assert.equal(M.cardMode({ gate: "danger", action: "safety" }), "safety");
  assert.equal(M.avoidPhrase("もういい"), "「もういい」");
  assert.equal(M.avoidPhrase("返事の前にもう1通"), "返事の前にもう1通");
});

test("戻る時刻：点検時刻の種類ごと（日本時間）", () => {
  const eve = at("2026-10-17T23:40:00+09:00"), day = at("2026-10-17T14:07:00+09:00"), night = at("2026-10-17T02:10:00+09:00");
  const t = (code, now) => M.returnAt(code, now, JST)?.text;
  assert.equal(t("+30m", day), "今日 14:35");
  assert.equal(t("+2h", day), "今日 16:00");
  assert.equal(t("+3h", day), "今日 17:00");
  assert.equal(t("+24h", day), "明日 14:05");
  assert.equal(t("+7d", day), "10月24日 14:05");
  assert.equal(t("next_noon", day), "明日 12:00");
  assert.equal(t("next_noon", night), "今日 12:00");
  assert.equal(t("next_morning", day), `明日 ${M.MORNING_HOUR}:00`);
  // 夜中に当たる時刻は朝に読み替える。夜中に言う「明日の朝」は日付を書かない（見出しの「明日の朝」と食い違わないように）
  assert.equal(t("+30m", eve), `明日 ${M.MORNING_HOUR}:00`);
  assert.equal(t("+2h", eve), `明日 ${M.MORNING_HOUR}:00`);
  assert.equal(t("next_morning", night), `${M.MORNING_HOUR}:00`);
  assert.equal(M.returnAt("next_morning", night, JST).approx, true);
  assert.equal(M.returnAt("+2h", day, JST).approx, false);
  assert.equal(M.returnAt(null, day, JST), null);
  assert.equal(M.returnAt("+1y", day, JST), null);
  assert.equal(M.returnAt("+2h", day, JST).at.toISOString(), "2026-10-17T07:00:00.000Z");
});

test("残り時間と進み具合", () => {
  const now = at("2026-10-17T14:00:00+09:00");
  const plus = (min) => new Date(now.getTime() + min * 60000);
  assert.equal(M.remainingText(plus(500), now), "あと8時間20分");
  assert.equal(M.remainingText(plus(35), now), "あと35分");
  assert.equal(M.remainingText(plus(120), now), "あと2時間");
  assert.equal(M.remainingText(plus(-1), now), "時刻になりました");
  assert.equal(M.progressOf(now, plus(100), plus(25)), 0.25);
  assert.equal(M.progressOf(now, plus(100), plus(200)), 1);
  assert.equal(M.progressOf(now, plus(100), plus(-5)), 0);
  assert.equal(M.clockOf(now, JST), "14:00");
});

test("読み取りのチップ：読めた項目だけ、根拠の言葉つき。直した項目は根拠を出さない", () => {
  const read = readText("会って喧嘩したあと、帰ってから彼から「もういい」ってLINEきた。めっちゃ腹立つ。すぐ電話したい");
  const chips = M.readChips(read, read.fields);
  assert.deepEqual(chips.map(c => c.text), ["相手から連絡が来た", "相手の言葉：責める・「もういい」", "言い合いは止まっている", "いまの気持ち：まだ熱い"]);
  assert.ok(chips.every(c => !c.weak));
  assert.ok(chips.find(c => c.key === "selfTemp").evidence);
  const edits = { selfTemp: "calm" };
  const k = M.knownFrom(read.fields, edits);
  const c2 = M.readChips(read, k, edits).find(c => c.key === "selfTemp");
  assert.equal(c2.text, "いまの気持ち：落ち着いている");
  assert.equal(c2.evidence, null);
  // 「分からない」で外した項目はチップから消える
  const k3 = M.knownFrom(read.fields, { selfTemp: null });
  assert.ok(!("selfTemp" in k3));
  assert.ok(!M.readChips(read, k3, { selfTemp: null }).some(c => c.key === "selfTemp"));
  // Clef が迷った・食い違った項目は目立たせる
  const weak = M.readChips({ ...read, lowConfidence: ["selfTemp"], conflicts: ["elapsed"] }, read.fields);
  assert.ok(weak.find(c => c.key === "selfTemp").weak);
  assert.ok(weak.find(c => c.key === "elapsed").weak);
  for (const key of M.CHIP_ORDER) assert.ok(M.fieldOptions(key).length >= 2, key);
});

test("安全：兆しの判定と窓口の1行", () => {
  assert.equal(M.hasSafetySign(readText("もう死にたい")), true);
  assert.equal(M.hasSafetySign(readText("彼に「別れるなら死ぬ」って言われた")), true);
  assert.equal(M.hasSafetySign(readText("既読無視されてる")), false);
  assert.equal(M.safetyLineResources({ selfHarm: true })[0].name, "よりそいホットライン");
  assert.equal(M.safetyLineResources({ partnerThreat: true })[0].name, "DV相談ナビ");
  assert.equal(M.telHref("#8008"), "tel:%238008");
  assert.equal(M.telHref("0120-279-338"), "tel:0120279338");
  const s = M.buildSafetyCard({ text: "もう死にたい", now: at("2026-10-17T14:00:00+09:00"), tzOffset: JST });
  assert.equal(s.card.kind, "safety");
  assert.ok(s.card.safety.resources.length >= 2);
});

test("案D の10件：書く → 読み取り → 足りない問 → カードの中身がそろう（同じ入力・同じ時刻なら同じ）", () => {
  const now = at("2026-10-17T22:10:00+09:00");
  for (const c of READ_CASES) {
    const read = readText(c.text);
    let known = M.knownFrom(read.fields, {}, [], { lateNight: false });
    const asked = [], ans = answerFromTruth(c.truth);
    for (let q; (q = nextQuestion(known, asked)); ) { const o = ans(q); asked.push(q); known = applyAnswer(known, o.patch); }
    assert.ok(asked.length <= 3, c.id);
    const m = M.buildPoc({ known, text: c.text, now, tzOffset: JST });
    assert.equal(m.card.kind, "card", c.id);
    assert.ok(m.card.headline && m.card.reasons.length >= 1, c.id);
    assert.ok(m.want?.text.endsWith("、ということ"), c.id);
    assert.ok(m.guess, c.id);
    assert.ok(m.road >= 0 && m.road <= 3, c.id);
    if (m.mode === "send") assert.ok(m.card.drafts.length >= 1, `${c.id}: 送る一手には文面`);
    if (m.mode === "wait") assert.ok(m.card.doNow, `${c.id}: 待つ一手には待つ間に`);
    if (M.TIMED_ACTIONS.has(m.result.action)) assert.ok(m.ret, c.id); else assert.equal(m.ret, null, c.id);
    assert.deepEqual(M.buildPoc({ known, text: c.text, now, tzOffset: JST }).card, m.card, `${c.id}: 決定論`);
  }
});

test("カードで足した差分：［ちがう］で一手が作り直され、［もっと合わせる］の答えで問が減る", () => {
  const now = at("2026-10-17T22:10:00+09:00");
  const text = "会って喧嘩したあと、帰ってから彼から「もういい」ってLINEきた。めっちゃ腹立つ。すぐ電話したい";
  const known = { ...readText(text).fields, intent: "none", selfLast: "none", lateNight: false };
  const m = M.buildPoc({ known, text, now, tzOffset: JST });
  assert.equal(m.want.text, "「もういい」で終わりにしたくない、ということ");
  const m2 = M.buildPoc({ known, extra: M.wantPatch("apologize", m.ctx.input), text, now, tzOffset: JST });
  assert.equal(m2.want.key, "apologize");
  assert.equal(m2.result.phase, "want_apologize");
  assert.ok(m.refine.length >= 1);
  const q = m.refine.find(r => r.id.startsWith("partner"));
  const m3 = M.buildPoc({ known, extra: q.options[0].patch, text, now, tzOffset: JST });
  assert.ok(!m3.refine.some(r => r.id === q.id));
});

test("安全の確認のあと続けるとき：窓口の1行を出し、伝えたいこと・道のりは出さない", () => {
  const now = at("2026-10-17T22:10:00+09:00");
  const text = "喧嘩ばかりで、もう死にたい";
  const m = M.buildPoc({ known: { lastSender: "self", lateNight: false }, text, now, tzOffset: JST, safetyContinue: true });
  assert.equal(m.want, null);
  assert.equal(m.road, null);
  assert.equal(m.safetyLine[0].name, "よりそいホットライン");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
