// node tests/app_consult_chat.test.mjs
// 新しい画面（app/）の相談のチャットの形（決定 U51）のうち、DOM の無い部分のテスト。画面そのもの（app/js/consult_chat.js）は Playwright で確かめる
//  - 相談の形の切り替え（app/js/consult_version.js）：既定 chat、?cv=card、知らない値は既定
//  - 返し方（app/js/consult_chat_logic.js）：おまかせの決め方（短く・じっくり・ふつう）、表示、受け止めの最初の1文、相談の文のつなぎ（2000字で切る）
//  - 診断の結果 → 判定に渡す本人の8領域（selfFromStatus：24問・三択・診断前・向きなし）、終わったあとの診断の案内（dxInvite）
//  - 判定に診断を渡す：buildPoc・rejudge に self を渡すと判定の入力に入る／省くと今までと同じ
//  - カードより前のやりとりを記録に残す形（安全の確認は残さない）
//  - 上の帯に常に出す、いまの状況の要約（statusSummary。言葉は「いまの状況」の3行と同じ）と、帯の2行目・低い画面の1行の決まり
//  - つなぎ（main.js の振り分け・index.html の CSS・sw.js の殻）と、CSS の決まり（直の色なし・動きは transform と opacity だけ）
// 時刻は UTC で渡し、時差は tzOffset（日本時間 540）で固定するので、実行環境の時差に依存しない
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as V from "../app/js/consult_version.js";
import * as L from "../app/js/consult_chat_logic.js";
import * as M from "../poc/card/model.js";
import * as F from "../app/js/consult_followup.js";
import { readText } from "../js/consult/extract.js";
import { computeResult4 } from "../js/engine4.js";
import { domainsFromResult4 } from "../js/consult/from_diagnosis4.js";
import { domainsFromProfile3 } from "../js/consult/from_diagnosis.js";
import { fromLikertAnswers } from "../js/adaptive3.js";
import { SAMPLES3 } from "../js/data/samples3.js";
import { CONSULT_EXAMPLES } from "../app/js/consult_examples.js";
import { READ_CASES } from "./fixtures/consult_read_cases.mjs";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const JST = 540;
const NOON = new Date("2026-10-18T03:00:00Z");    // 日本時間の 12:00
const NIGHT = new Date("2026-10-18T16:30:00Z");   // 日本時間の 1:30（深夜）

// ---------------------------------------------------------------- 相談の形の切り替え
test("consult_version：既定は chat。?cv=card で今までの形、?cv=chat でチャット。知らない値・無しは既定", () => {
  assert.equal(V.DEFAULT_CONSULT_VERSION, "chat");
  assert.deepEqual([...V.CONSULT_VERSIONS], ["chat", "card"]);
  assert.equal(V.consultVersionFrom(""), "chat");
  assert.equal(V.consultVersionFrom(undefined), "chat");
  assert.equal(V.consultVersionFrom("?cv=card"), "card");
  assert.equal(V.consultVersionFrom("?cv=CARD"), "card");
  assert.equal(V.consultVersionFrom("?dv=v3&cv=card"), "card");
  assert.equal(V.consultVersionFrom("?cv=chat"), "chat");
  assert.equal(V.consultVersionFrom("?cv=v2"), "chat");
  assert.equal(V.consultVersionFrom("?cv="), "chat");
  assert.equal(V.consultVersion(), "chat", "Node（location なし）では既定");
});

// ---------------------------------------------------------------- 返し方
const fakeRead = (fields) => ({ fields });
test("autoStyle：気持ちがまだ熱い・言い合いの最中は「短く」", () => {
  assert.equal(L.autoStyle(fakeRead({ selfTemp: "high" }), ""), "short");
  assert.equal(L.autoStyle(fakeRead({ ongoing: true }), ""), "short");
  // 熱いときは「聞いてほしい」と書いてあっても短く（先に見る）
  assert.equal(L.autoStyle(fakeRead({ selfTemp: "high" }), "話を聞いてほしい"), "short");
  const t = "いま電話で言い合いの最中。腹が立つ";
  assert.equal(L.autoStyle(readText(t), t), "short", "規則の読み取りでも");
});
test("autoStyle：「聞いてほしい・聞いて欲しい・聞いてもらいたい・話を聞いて・吐き出し」なら「じっくり」", () => {
  for (const w of ["聞いてほしい", "聞いて欲しい", "聞いてもらいたい", "話を聞いて", "吐き出したい"]) {
    assert.equal(L.autoStyle(fakeRead({ selfTemp: "cooling" }), `昨日喧嘩した。${w}`), "deep", w);
  }
  const t = "昨日の夜に喧嘩して既読のまま。とにかく話を聞いてほしい";
  assert.equal(L.autoStyle(readText(t), t), "deep");
});
test("autoStyle：どちらでもなければ「ふつう」（読み取りが無くても動く）", () => {
  assert.equal(L.autoStyle(fakeRead({ selfTemp: "calm", ongoing: false }), "昨日喧嘩した"), "normal");
  assert.equal(L.autoStyle(null, ""), "normal");
  assert.equal(L.autoStyle(undefined, undefined), "normal");
  const t = CONSULT_EXAMPLES[0].text;
  assert.equal(L.autoStyle(readText(t), t), "normal");
});
test("effectiveStyle・styleLabel：選んだ返し方が先。おまかせは今どれかを添える（書く前は「おまかせ」だけ）", () => {
  const hot = fakeRead({ selfTemp: "high" });
  assert.equal(L.effectiveStyle("short", fakeRead({}), "聞いてほしい"), "short");
  assert.equal(L.effectiveStyle("deep", hot, ""), "deep");
  assert.equal(L.effectiveStyle("auto", hot, ""), "short");
  assert.equal(L.effectiveStyle("auto", fakeRead({}), ""), "normal");
  assert.equal(L.styleLabel("auto", "short"), "おまかせ（短め）");
  assert.equal(L.styleLabel("auto", "deep"), "おまかせ（じっくり）");
  assert.equal(L.styleLabel("auto", "normal"), "おまかせ（ふつう）");
  assert.equal(L.styleLabel("auto", null), "おまかせ");
  assert.equal(L.styleLabel("short", "deep"), "短く");
  assert.equal(L.styleLabel("deep", "short"), "じっくり");
  assert.equal(L.styleLabel("nope", null), "おまかせ");
  assert.equal(L.DEFAULT_STYLE, "auto");
  assert.equal(L.STYLE_KEY, "seikaku16:app:consult-style");
  assert.deepEqual(L.STYLE_OPTIONS.map(o => o.key), ["auto", "short", "deep"]);
  assert.ok(L.isStyle("deep") && !L.isStyle("normal") && !L.isStyle(null));
});

test("firstSentence：最初の「。」「！」「？」まで。「」の中の句点では切らない。無ければ全部", () => {
  assert.equal(L.firstSentence("送ったあと、返事がないんですね。待つ時間が長く感じるのは、自然なことです。"), "送ったあと、返事がないんですね。");
  assert.equal(L.firstSentence("相手から「もういい。勝手にして」と来たんですね。つらいですよね。"), "相手から「もういい。勝手にして」と来たんですね。");
  assert.equal(L.firstSentence("本当？！それはつらいですね。"), "本当？！");
  assert.equal(L.firstSentence("句点が無い文"), "句点が無い文");
  assert.equal(L.firstSentence(""), "");
  assert.equal(L.firstSentence(M.ACCEPT_SAFETY), "話してくれて、ありがとうございます。");
  // 今の受け止めの文（1〜2文）の最初の1文は、元の文の頭と同じ
  for (const c of READ_CASES) {
    const r = readText(c.text);
    const t = M.acceptText({ known: { ...r.fields }, text: c.text, evidence: r.evidence });
    const f = L.firstSentence(t);
    assert.ok(t.startsWith(f) && f.length > 0 && /[。！？]$/.test(f), `${c.id}: ${f}`);
  }
});

test("joinConsult：改行でつなぐ。前が無ければそのまま。2000字（文字の数）で切る", () => {
  assert.equal(L.MAX_CHARS, 2000);
  assert.equal(L.joinConsult("彼と喧嘩した", "相手から「もういい」と来た"), "彼と喧嘩した\n相手から「もういい」と来た");
  assert.equal(L.joinConsult("", "  最初の文 "), "最初の文");
  assert.equal(L.joinConsult(" 前の文 ", ""), "前の文");
  const long = L.joinConsult("あ".repeat(1990), "い".repeat(30));
  assert.equal(Array.from(long).length, 2000);
  assert.ok(long.startsWith("あ".repeat(1990) + "\n") && long.endsWith("い".repeat(9)));
  // 絵文字（サロゲートの組）を途中で切らない
  const emo = L.joinConsult("😀".repeat(1999), "😀😀");
  assert.equal(Array.from(emo).length, 2000);
  assert.ok(!/[\uD800-\uDBFF]$/.test(emo));
  assert.equal(L.joinConsult("a", "b", 2), "a\n");
});

// ---------------------------------------------------------------- 診断の結果 → 本人の8領域
const ans = (v) => (v === null ? { status: "unknown", value: null } : { status: "answered", value: v });
const VAL = { A: 1, B: -1, "?": null };
const result4Of = (spec) => {
  const answers = {};
  for (const [d, x] of Object.entries(spec)) ["U", "P", "N"].forEach((k, i) => { answers[`${k}${d}`] = ans(VAL[x[i]]); });
  return computeResult4(answers);
};
const all8 = (x) => result4Of(Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((d) => [d, x])));

test("selfFromStatus：24問（v4）の終わった結果は domainsFromResult4", () => {
  const r = result4Of({ 1: "AAA", 2: "BBB", 3: "AAB", 4: "ABB", 5: "AB?", 6: "A??", 7: "AAA", 8: "BBA" });
  const self = L.selfFromStatus({ version: "v4", state: "done", result: r });
  assert.deepEqual(self, domainsFromResult4(r));
  assert.equal(self[1].side, "A");
  assert.equal(self[1].conf, "sure");
  assert.equal(self[2].side, "B");
  assert.equal(self[3].conf, "est");
  assert.equal(self[5].side, null, "まんなかは向きなし");
  assert.equal(self[6].side, null, "答えが足りない領域は向きなし");
  // 版が書いていなくても、結果の形（diagnosisVersion）で分かる
  assert.deepEqual(L.selfFromStatus({ state: "done", result: r }), self);
});
test("selfFromStatus：三択（v3）の終わった結果は domainsFromProfile3（結果の profile3）", () => {
  const r = fromLikertAnswers(SAMPLES3[0].answers, SAMPLES3[0].wording).result();
  assert.ok(r.profile3);
  const self = L.selfFromStatus({ version: "v3", state: "done", result: r });
  assert.deepEqual(self, domainsFromProfile3(r.profile3));
  assert.ok(L.hasSide(self));
});
test("selfFromStatus：診断前・途中・結果なし・向きが1つも無いときは null", () => {
  const r = all8("AAA");
  assert.equal(L.selfFromStatus(null), null);
  assert.equal(L.selfFromStatus(undefined), null);
  assert.equal(L.selfFromStatus({ version: "v4", state: "before", answered: 0, total: 24, result: null }), null);
  assert.equal(L.selfFromStatus({ version: "v4", state: "mid", answered: 10, total: 24, result: r }), null);
  assert.equal(L.selfFromStatus({ version: "v4", state: "done", result: null }), null);
  assert.equal(L.selfFromStatus({ version: "v4", state: "done", result: all8("ABA".slice(0, 2)) }), null, "全部まんなか");
  assert.equal(L.selfFromStatus({ version: "v4", state: "done", result: computeResult4({}) }), null, "答えが無い");
  assert.equal(L.selfFromStatus({ version: "v3", state: "done", result: { source: {} } }), null, "三択で profile3 が無い");
  assert.equal(L.hasSide(null), false);
  assert.equal(L.hasSide({ 1: { side: null } }), false);
  assert.equal(L.hasSide({ 8: { side: "B" } }), true);
});

test("dxInvite：［仲直りできた］［まだ］で、診断が終わっていない人だけ（［こじれた］・答えずに終えたときは出さない）", () => {
  const before = { state: "before" }, mid = { state: "mid" }, done = { state: "done" };
  assert.equal(L.dxInvite("made_up", before), true);
  assert.equal(L.dxInvite("not_yet", mid), true);
  assert.equal(L.dxInvite("made_up", null), true, "状態が読めなければ、終わっていないとみなす");
  assert.equal(L.dxInvite("made_up", done), false);
  assert.equal(L.dxInvite("not_yet", done), false);
  assert.equal(L.dxInvite("worse", before), false);
  assert.equal(L.dxInvite(null, before), false);
  // 案内の key は consult_followup.js の OUTCOMES と同じ
  assert.deepEqual(F.OUTCOMES.map(o => o.key), ["made_up", "not_yet", "worse"]);
});

// ---------------------------------------------------------------- 判定に診断を渡す（buildPoc・rejudge の省いてよい引数）
const SELF = all8("AAA");
const selfA = domainsFromResult4(SELF);
const selfB = domainsFromResult4(all8("BBB"));
const ser = (m) => JSON.stringify(m, (k, v) => (v instanceof Date ? v.toISOString() : v));
const cases = [...READ_CASES.map(c => c.text), ...CONSULT_EXAMPLES.map(c => c.text)];

test("buildPoc：self を省くと、今までと1字も同じ（引数に self・selfMain の名前も足さない）", () => {
  for (const t of cases) {
    for (const now of [NOON, NIGHT]) {
      const known = { ...readText(t).fields };
      const a = M.buildPoc({ known, text: t, now, tzOffset: JST });
      const b = M.buildPoc({ known, text: t, now, tzOffset: JST, self: undefined, selfMain: undefined });
      assert.equal(ser(a), ser(b));
      assert.deepStrictEqual(Object.keys(a.ctx.args).sort(), ["consultText", "input", "now", "safety", "tzOffset"]);
      for (const d of [1, 2, 3, 4, 5, 6, 7, 8]) assert.equal(a.ctx.input.self[d].conf, "none");
    }
  }
});
test("buildPoc：self を渡すと、判定の入力（ctx.input.self）に入る。selfMain もそのまま渡る", () => {
  const t = CONSULT_EXAMPLES[1].text;
  const known = { ...readText(t).fields };
  const m = M.buildPoc({ known, text: t, now: NOON, tzOffset: JST, self: selfA });
  assert.equal(m.ctx.args.self, selfA);
  for (const d of [1, 2, 3, 4, 5, 6, 7, 8]) {
    assert.equal(m.ctx.input.self[d].side, "A");
    assert.equal(m.ctx.input.self[d].conf, "sure");
    assert.equal(m.ctx.input.self[d].source, "diagnosis");
  }
  const main = { id: "S03", confirmed: false };
  assert.equal(M.buildPoc({ known, text: t, now: NOON, tzOffset: JST, self: selfB, selfMain: main }).ctx.args.selfMain, main);
  // 本人の向きで、カードの中身が変わる場面がある（同じ一手の手順・同じ文型のまま）
  let changed = 0;
  for (const c of cases) {
    const k = { ...readText(c).fields };
    const base = ser(M.buildPoc({ known: k, text: c, now: NOON, tzOffset: JST }).card);
    if (ser(M.buildPoc({ known: k, text: c, now: NOON, tzOffset: JST, self: selfA }).card) !== base
      || ser(M.buildPoc({ known: k, text: c, now: NOON, tzOffset: JST, self: selfB }).card) !== base) changed++;
  }
  assert.ok(changed > 0, "self が判定に効いていない");
});
test("rejudge：self を buildPoc に渡す。省けば今までと同じ", () => {
  const t = CONSULT_EXAMPLES[0].text;
  const known = { ...readText(t).fields };
  const m = F.rejudge({ known, text: t, now: NOON, tzOffset: JST, self: selfB });
  assert.equal(m.ctx.args.self, selfB);
  assert.equal(m.ctx.input.self[3].side, "B");
  const direct = M.buildPoc({ known: { ...known, lateNight: false }, text: t, now: NOON, tzOffset: JST, self: selfB });
  assert.equal(ser(m), ser(direct));
  const plain = F.rejudge({ known, text: t, now: NOON, tzOffset: JST });
  assert.ok(!("self" in plain.ctx.args) && !("selfMain" in plain.ctx.args));
  assert.equal(ser(plain), ser(F.rejudge({ known, text: t, now: NOON, tzOffset: JST, self: undefined })));
  assert.equal(ser(plain), ser(M.buildPoc({ known: { ...known, lateNight: false }, text: t, now: NOON, tzOffset: JST })));
});

// ---------------------------------------------------------------- カードより前のやりとり（記録）
test("prePersist：自分・アプリの吹き出しだけ { who, text, at, label? }。安全の確認（sf）・安全のカード・形の違う物は残さない", () => {
  const at = "2026-10-18T03:00:00.000Z";
  const items = [
    { id: 1, who: "me", text: "彼と喧嘩した", at },
    { id: 2, who: "app", text: "いま、身の危険や強い怖さを感じていますか？", at, sf: true },
    { id: 3, who: "me", text: "今、危ない", at, sf: true },
    { id: 4, who: "safety", at, sf: true },
    { id: 5, who: "app", text: "いまの場面に近いのは？", at, label: "（1つめ・多くて3つ）" },
    { id: 6, who: "card", text: "x", at },
    null,
    { id: 7, who: "app", text: 3, at },
    { id: 8, who: "me", text: "送ったけど、返事が来ない" },
  ];
  assert.deepEqual(L.prePersist(items), [
    { who: "me", text: "彼と喧嘩した", at },
    { who: "app", text: "いまの場面に近いのは？", at, label: "（1つめ・多くて3つ）" },
    { who: "me", text: "送ったけど、返事が来ない", at: null },
  ]);
  assert.deepEqual(L.prePersist(null), []);
  assert.deepEqual(L.preFrom(L.prePersist(items)), L.prePersist(items));
});

// ---------------------------------------------------------------- 上の帯の「いまの状況」の要約
test("statusSummary：言い合いの最中・最後に送った人・どれくらい前か・気持ち・したいことを「・」でつなぐ", () => {
  assert.equal(L.statusSummary({ ongoing: true, elapsed: "lt3h", selfTemp: "high", intent: "apologize" }), "いま言い合いの最中・3時間以内・まだ熱い・謝りたい");
  assert.equal(L.statusSummary({ lastSender: "self", elapsed: "3h_12h", selfTemp: "cooling", goal: "reconcile" }), "最後に送ったのは自分・半日以内・落ち着いてきた・仲直りしたい");
  assert.equal(L.statusSummary({ lastSender: "partner", partnerLast: "attack", elapsed: "12h_2d" }), "最後は相手から・1〜2日", "最後が相手のときは相手の言葉の補足を足さない");
  assert.equal(L.statusSummary({ lastSender: "none", elapsed: "ge3d", selfTemp: "calm" }), "どちらも送っていない・3日以上・落ち着いている");
  // ongoing が true なら、最後に送った人の言葉は出さない（statusLines と同じ先の決まり）
  assert.equal(L.statusSummary({ ongoing: true, lastSender: "self" }), "いま言い合いの最中");
  // ongoing が false なら最後に送った人
  assert.equal(L.statusSummary({ ongoing: false, lastSender: "self" }), "最後に送ったのは自分");
});
test("statusSummary：自分が最後で、相手の言葉が「距離を置きたい」「別れ話」なら相手の言葉を足す（最後が相手のときは足さない）", () => {
  assert.equal(L.statusSummary({ lastSender: "self", partnerLast: "space", elapsed: "12h_2d" }), "最後に送ったのは自分・相手の言葉：距離を置きたい・1〜2日");
  assert.equal(L.statusSummary({ lastSender: "self", partnerLast: "breakup" }), "最後に送ったのは自分・相手の言葉：別れ話");
  assert.equal(L.statusSummary({ partnerLast: "space", elapsed: "lt3h" }), "相手の言葉：距離を置きたい・3時間以内", "最後に送った人が分からなくても、相手の言葉は足す");
  assert.equal(L.statusSummary({ ongoing: true, partnerLast: "breakup" }), "いま言い合いの最中・相手の言葉：別れ話");
  assert.equal(L.statusSummary({ lastSender: "partner", partnerLast: "space" }), "最後は相手から");
  assert.equal(L.statusSummary({ lastSender: "self", partnerLast: "attack" }), "最後に送ったのは自分", "責める・謝ってきた などは足さない");
  assert.equal(L.statusSummary({ lastSender: "self", partnerLast: "none" }), "最後に送ったのは自分");
});
test("statusSummary：もう仲直りしたは先頭に。したいこと（intent）が「特になし」ならゴール。未知（undefined・null）は出さない", () => {
  assert.equal(L.statusSummary({ afterMakeup: true, lastSender: "partner", elapsed: "lt3h" }), "もう仲直りした・最後は相手から・3時間以内");
  assert.equal(L.statusSummary({ afterMakeup: false, lastSender: "self" }), "最後に送ったのは自分", "仲直りしていない（false）は出さない");
  assert.equal(L.statusSummary({ intent: "none", goal: "understood" }), "分かってほしい");
  assert.equal(L.statusSummary({ intent: "tell", goal: "understood" }), "伝えたいことがある", "intent があればゴールは出さない");
  assert.equal(L.statusSummary({ intent: null, goal: "settle", selfTemp: null, elapsed: undefined }), "ちゃんと決着をつけたい");
  assert.equal(L.statusSummary({ intent: "none" }), L.STATUS_SUMMARY_NONE);
  assert.equal(L.statusSummary({ goal: "space", intent: "request_space" }), "距離を置きたいと伝えたい");
});
test("statusSummary：何も分からなければ「最後に送ったのは：分からない」（statusLines の1行目と同じ）。壊れた入力でも文字列を返す", () => {
  assert.equal(L.statusSummary({}), "最後に送ったのは：分からない");
  assert.equal(L.statusSummary(), "最後に送ったのは：分からない");
  assert.equal(L.statusSummary(null), "最後に送ったのは：分からない");
  assert.equal(L.statusSummary("x"), "最後に送ったのは：分からない");
  assert.equal(L.statusSummary({}), F.statusLines({})[0]);
  assert.equal(L.statusSummary({ lastSender: "self", elapsed: "bogus", selfTemp: "bogus" }), "最後に送ったのは自分", "選択肢に無い値は「分からない」と出さずに外す");
});
test("statusSummary：読み取りの結果・例文の状況でも使える（言葉は statusLines と同じ項目の言葉）", () => {
  const t = "昨日の夜に喧嘩して、私が謝りのLINEを送ったけど既読のまま返事が来ない。";
  const known = { ...readText(t).fields };
  const s = L.statusSummary(known);
  assert.equal(typeof s, "string");
  assert.ok(s.length > 0 && !s.includes("undefined") && !s.includes("null"), s);
  for (const ex of CONSULT_EXAMPLES) {
    const r = L.statusSummary({ ...readText(ex.text).fields });
    assert.ok(typeof r === "string" && r && !/undefined|null|\[object/.test(r), `${ex.text}: ${r}`);
    // 3行のどれかに出ている言葉だけを使う（要約の各部分は statusLines のいずれかの行に含まれる）
    const lines = F.statusLines({ ...readText(ex.text).fields }).join("。");
    for (const part of r.split("・").filter(p => p !== L.STATUS_SUMMARY_NONE)) {
      const word = part.replace(/^相手の言葉：/, "");
      assert.ok(lines.includes(word), `${ex.text}: 「${part}」が3行に無い`);
    }
  }
});
test("上の帯：背の高い画面は2行目に要約（a-ch-sum）、max-height: 700px では今までの1行（右の小さな「状況」）。開け閉めは1つの状態で、パネルの高さは帯の上の部分から引く", () => {
  const js = read("app/js/consult_chat.js");
  assert.match(js, /class: "a-ch-sum", "aria-expanded": String\(S\.statusOpen\), "aria-controls": "a-ch-status-panel"/);
  assert.match(js, /h\("span", \{ class: "a-ch-sum-label" \}, "いまの状況"\)/);
  assert.match(js, /h\("span", \{ class: "a-ch-sum-text" \}, L\.statusSummary\(S\.fu\.known\)\)/);
  assert.match(js, /toggle\.addEventListener\("click", flip\);\s*sum\.addEventListener\("click", flip\);/);
  assert.match(js, /toggle\.setAttribute\("aria-expanded", String\(S\.statusOpen\)\);\s*sum\.setAttribute\("aria-expanded", String\(S\.statusOpen\)\);/);
  assert.match(js, /--a-ch-band-head-h/);
  const css = read("app/css/consult_chat.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.a-ch-st-btn \{\s*display: none;/, "背の高い画面では小さな「状況」を出さない（読み上げからも外す）");
  assert.match(css, /@media \(max-height: 700px\) \{\s*\.a-ch-sum \{ display: none; \}\s*\.a-ch-st-btn \{ display: inline-flex; \}\s*\}/);
  assert.match(css, /\.a-ch-sum \{[^}]*min-height: 44px;/);
  assert.match(css, /\.a-ch-sum-text \{[^}]*-webkit-line-clamp: 2;[^}]*line-clamp: 2;[^}]*overflow: hidden;/);
  assert.match(css, /\.a-ch-band \.a-ch-status-panel \{[^}]*var\(--a-ch-band-head-h/);
  assert.doesNotMatch(css, /\b64px\b/, "帯の高さの決め打ち（64px）は使わない");
  // 低い画面の1行の帯は今までどおり（ボタンの大きさ）
  assert.match(css, /\.a-ch-st-btn \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
});

// ---------------------------------------------------------------- 文
test("CHAT_TEXTS：仕様（U51）に書いた文のまま。です・ます", () => {
  const T = L.CHAT_TEXTS;
  assert.equal(T.greet, "いま、何があったか、そのまま書いてください。全部そろっていなくても大丈夫です。足りないところは、あとで少しだけ聞きます。");
  assert.equal(T.dxOn, "診断の結果も使って考えます。");
  assert.equal(T.dxOff, "診断の結果は使わずに考えます。");
  assert.equal(T.dxRedoOn, "診断の結果も使って、考え直しました。");
  assert.equal(T.dxRedoOff, "診断の結果を使わずに、考え直しました。");
  assert.equal(T.deepAsk, "よければ、いちばん引っかかっているところを、もう少し聞かせてください。");
  assert.equal(T.invite, "よければ、性格診断もしてみてください。次の相談から、あなたの傾向も使って考えられます。");
  assert.equal(T.editNote, "自分の言葉に直すと、伝わりやすくなります。");
  assert.equal(T.privacy, "書いた文は、この端末の中だけで読み取ります。どこにも送りません。");
  assert.equal(T.dxNone, "まだ診断していません。");
  for (const [k, v] of Object.entries(T)) assert.ok(typeof v === "string" && v.trim(), k);
  // 文の言い切りは です・ます（「。」で終わる文）
  for (const k of ["greet", "dxOn", "dxOff", "dxUsing", "dxRedoOn", "dxRedoOff", "deepAsk", "invite", "editNote", "privacy", "dxNone"]) {
    for (const s of T[k].split("。").filter(Boolean)) assert.match(s, /(ます|です|ません|ください|ました|ません)$/, `${k}: ${s}`);
  }
});

// ---------------------------------------------------------------- つなぎ・CSS
test("main.js：#consult は版で consult_chat.js か consult.js。index.html は consult.css のあとに consult_chat.css。sw.js の殻に新しいファイル", () => {
  const main = read("app/js/main.js");
  assert.match(main, /import \{ consultVersion \} from "\.\/consult_version\.js";/);
  assert.match(main, /consult: \{ load: \(\) => \(consultVersion\(\) === "card" \? import\("\.\/consult\.js"\) : import\("\.\/consult_chat\.js"\)\)/);
  const html = read("app/index.html");
  const a = html.indexOf('href="./css/consult.css"'), b = html.indexOf('href="./css/consult_chat.css"');
  assert.ok(a > 0 && b > a);
  const shell = read("app/sw.js").match(/const SHELL = \[([\s\S]*?)\];/)[1];
  for (const f of ["./css/consult_chat.css", "./js/consult_version.js", "./js/consult_chat.js", "./js/consult_chat_logic.js"]) assert.ok(shell.includes(`"${f}"`), f);
  // 履歴の詳細は今までどおり consult.js の renderSaved（記録の形が同じ）。チャットの側も同じ savedView を export する
  assert.match(read("app/js/history.js"), /import\("\.\/consult\.js"\)/);
  assert.match(read("app/js/consult_chat.js"), /export function renderSaved\(record\) \{\n  try \{ return savedView\(record\); \}/);
});
test("consult_chat.css：色は app.css の変数だけ（直の色なし）。クラスは a-ch-。動きは transform と opacity だけで、動きを減らす設定で止める", () => {
  const css = read("app/css/consult_chat.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "直の色（#…）");
  assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/, "直の色（rgb・名前）");
  const defined = new Set([...read("app/css/app.css").matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
  for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
    assert.ok(defined.has(m[1]) || m[1].startsWith("--a-ch-"), `app.css に無い変数：${m[1]}`);
  }
  for (const m of css.matchAll(/(^|[\s,}])\.([a-z][a-z0-9-]*)/g)) {
    if (m[2] === "a-ch" || m[2].startsWith("a-ch-")) continue;
    assert.ok(/^a-(cs-|textarea|link|btn|ic)/.test(m[2]), `今の部品のクラスに a-ch- で足す：.${m[2]}`);
  }
  for (const m of css.matchAll(/transition\s*:\s*([^;]+);/g)) assert.match(m[1].trim(), /^(transform|opacity|none)\b/, m[1]);
  const kf = css.match(/@keyframes a-ch-in \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(kf.replace(/opacity|transform/g, ""), /[a-z-]+\s*:/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.a-ch-in \{ animation: none; \}/);
  assert.doesNotMatch(css, /:focus-visible\s*\{[^}]*outline:\s*(none|0)/, "焦点の輪を消さない");
});

console.log(`\n${pass} OK / ${fail} FAIL`);
if (fail) process.exit(1);
