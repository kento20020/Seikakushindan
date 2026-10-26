// node tests/app_consult_talk.test.mjs
// 新しい画面（app/）の相談の「ふつうのチャット」の形（決定 U55）のうち、DOM の無い部分のテスト。画面そのもの（app/js/consult_talk.js）は Playwright で確かめる
//  - 相談の形の切り替え（app/js/consult_version.js）：既定 talk、?cv=chat（ボタンつきのチャット）、?cv=card（段階ごとの画面）、知らない値は既定
//  - 書いた答え → 選択肢（matchAnswer）：各問の典型・言い換え（仕様のよくある短い答え）・読み取りでの当てはめ・当たらない
//  - 一手のあとに書いた文の種類（classifyFollow）：「」『』あり・送った・まだ来ない（送ったあとだけ）・それ以外
//  - 一手の吹き出しの中身（moveText）：送る一手・待つ一手（戻る時刻・待つ間に）・安全のモード・履歴の写しからも同じ
//  - 一手が変わらないときの文（keepText）・答え方の例・聞き直しの文
//  - TALK_TEXTS が仕様（U55）に書いた文のまま
//  - 記録の形（talkPersist・pendPersist）：安全の確かめは残さない。?cv=chat・?cv=card が読む形（fu.thread）とぶつからない
//  - つなぎ（main.js・index.html・sw.js）と CSS の決まり（直の色なし・クラスは a-tk-・動きは transform と opacity・動きを減らす設定で止める）
//  - 外した足し物（返し方・例文・文を自分で直す・相談を終える・ちがうところがある・診断の案内）が画面のコードに無い
// 時刻は UTC で渡し、時差は tzOffset（日本時間 540）で固定するので、実行環境の時差に依存しない
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as V from "../app/js/consult_version.js";
import * as L from "../app/js/consult_talk_logic.js";
import * as M from "../poc/card/model.js";
import * as F from "../app/js/consult_followup.js";
import { nextQuestion, SCENES } from "../js/consult/needed.js";
import { snapshotOf } from "../app/js/consult_card.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const NOON = new Date("2026-10-18T03:00:00Z");    // 日本時間の 12:00
const JST = 540;
/** known のときに次に聞く問（id を確かめる） */
function Q(known, id) {
  const q = nextQuestion(known, []);
  assert.ok(q, `問が出ません：${JSON.stringify(known)}`);
  assert.equal(q.id, id, `問の id：${JSON.stringify(known)}`);
  return q;
}
const patchOf = (q, text) => L.matchAnswer(q, text)?.patch ?? null;

// ---------------------------------------------------------------- 切り替え
test("consult_version：既定は talk。?cv=chat でボタンつきのチャット、?cv=card で段階ごとの画面、?cv=talk でこの形。知らない値・無しは既定", () => {
  assert.equal(V.DEFAULT_CONSULT_VERSION, "talk");
  assert.deepEqual([...V.CONSULT_VERSIONS], ["talk", "chat", "card"]);
  assert.equal(V.consultVersionFrom(""), "talk");
  assert.equal(V.consultVersionFrom(undefined), "talk");
  assert.equal(V.consultVersionFrom("?cv=talk"), "talk");
  assert.equal(V.consultVersionFrom("?cv=chat"), "chat");
  assert.equal(V.consultVersionFrom("?cv=Chat"), "chat");
  assert.equal(V.consultVersionFrom("?cv=card"), "card");
  assert.equal(V.consultVersionFrom("?dv=v3&cv=card"), "card");
  for (const bad of ["?cv=", "?cv=v2", "?cv=talks", "?cv=%20", "?x=chat"]) assert.equal(V.consultVersionFrom(bad), "talk", bad);
  assert.equal(V.consultVersion(), "talk", "Node（location なし）では既定");
});

// ---------------------------------------------------------------- 書いた答え → 選択肢
const SAMPLE = "付き合って1年の彼と、昨日の夜23時ごろLINEで言い合いになりました。私が「いつも直前に決めるよね」と送ったら「じゃあもういいよ」と返ってきて、そこから既読のまま2時間返事がありません。不安で、もう一回送るか迷っています。今夜のうちに仲直りしたいです。";
test("matchAnswer：どうしたい？（intent）。label そのまま・仕様の短い答え（謝りたい・伝えたい・距離・特に）・当たらない", () => {
  const q = Q({ lastSender: "self", elapsed: "lt3h", partnerLast: "attack", ongoing: false, goal: "reconcile" }, "intent");
  assert.deepEqual(patchOf(q, "謝りたい"), { intent: "apologize" });
  assert.deepEqual(patchOf(q, "謝りたいです。"), { intent: "apologize" });
  assert.deepEqual(patchOf(q, "伝えたいことがある"), { intent: "tell" });
  assert.deepEqual(patchOf(q, "伝えたい"), { intent: "tell" }, "「伝えたい」は伝えたいこと（距離を置きたいと伝えたい、ではない）");
  assert.deepEqual(patchOf(q, "距離を置きたいと伝えたい"), { intent: "request_space" }, "label がそのまま入っていれば長い label");
  assert.deepEqual(patchOf(q, "少し距離を置きたい"), { intent: "request_space" });
  assert.deepEqual(patchOf(q, "特にない"), { intent: "none" });
  assert.deepEqual(patchOf(q, "特になし"), { intent: "none" });
  assert.deepEqual(L.matchAnswer(q, "謝りたい"), { patch: { intent: "apologize" }, label: "謝りたい" }, "label も返す");
  for (const t of ["どうしよう", "うーん", "わからない", "", "  "]) assert.equal(L.matchAnswer(q, t), null, t);
});
test("matchAnswer：最後に送ったのは？（lastSender）。私・わたし・自分から → 自分、彼・彼女・向こう → 相手、どっちも・両方送ってない → どちらも", () => {
  const q = Q({ ongoing: false, intent: "none", selfLast: "reconcile", selfTemp: "calm" }, "lastSender");
  assert.deepEqual(q.options.map(o => o.label), ["自分", "相手", "どちらも送っていない（対面で終わった）"], "needed.js の選択肢の label");
  for (const t of ["自分", "私", "わたし", "私が最後", "自分から送った", "ワタシ".normalize("NFKC") === "ワタシ" ? "わたしです" : "わたし"]) assert.deepEqual(patchOf(q, t), { lastSender: "self" }, t);
  for (const t of ["相手", "彼", "彼女", "彼から来た", "向こうから"]) assert.deepEqual(patchOf(q, t), { lastSender: "partner" }, t);
  for (const t of ["どちらも送っていない", "どっちも送ってない", "両方送ってない", "対面で終わった"]) assert.deepEqual(patchOf(q, t), { lastSender: "none" }, t);
  assert.equal(L.matchAnswer(q, "わからない"), null);
  assert.equal(L.matchAnswer(q, "うーん"), null);
});
test("matchAnswer：いまの気持ちは？（selfTemp）。熱い・イライラ → まだ熱い、少し落ち着いた → 落ち着いてきた、落ち着いてる → 落ち着いている", () => {
  const q = Q({ lastSender: "self", elapsed: "lt3h", partnerLast: "attack", ongoing: false, goal: "reconcile", intent: "apologize" }, "selfTemp");
  assert.deepEqual(patchOf(q, "まだ熱い"), { selfTemp: "high" });
  assert.deepEqual(patchOf(q, "熱い"), { selfTemp: "high" });
  assert.deepEqual(patchOf(q, "まだイライラしてる"), { selfTemp: "high" });
  assert.deepEqual(patchOf(q, "少し落ち着いた"), { selfTemp: "cooling" });
  assert.deepEqual(patchOf(q, "落ち着いてきた"), { selfTemp: "cooling" });
  assert.deepEqual(patchOf(q, "落ち着いてる"), { selfTemp: "calm" });
  assert.deepEqual(patchOf(q, "落ち着いている"), { selfTemp: "calm" });
  assert.deepEqual(patchOf(q, "腹が立つ"), { selfTemp: "high" }, "選択肢に当たらなくても、読み取りで気持ちが読めればその値");
  assert.equal(L.matchAnswer(q, "落ち着いて"), null, "2つの選択肢に同じだけ当たるときは決めない");
  assert.equal(L.matchAnswer(q, "悲しい"), null);
});
test("matchAnswer：場面の問（scene。primary 4）。label の一部・読み取りで場面が決まるとき・決まらないとき", () => {
  const q = Q({}, "scene");
  assert.equal(q.primary, 4);
  assert.deepEqual(patchOf(q, "送ったけど、返事が来ない"), SCENES[0].patch);
  assert.deepEqual(patchOf(q, "返事が来ない"), SCENES[0].patch, "label の中に答えが入っている");
  assert.deepEqual(patchOf(q, "いま言い合いの最中です"), SCENES.find(s => s.id === "heated").patch);
  assert.deepEqual(patchOf(q, "謝りたい"), SCENES.find(s => s.id === "apologize").patch);
  assert.equal(L.matchAnswer(q, "なんとなく"), null);
});
test("matchAnswer：ほかの問（言い合いは今も・最後に送った内容・どれくらい前・相手の返事の種類）", () => {
  const og = Q({ intent: "none", partnerLast: "casual", selfLast: "none", selfTemp: "cooling", cause: "self", repeat: false }, "ongoing");
  assert.deepEqual(patchOf(og, "今も続いている"), { ongoing: true });
  assert.deepEqual(patchOf(og, "止まっている"), { ongoing: false });
  const sl = Q({ lastSender: "self", elapsed: "lt3h", partnerLast: "attack", ongoing: false, goal: "reconcile", intent: "none" }, "selfLast");
  assert.deepEqual(patchOf(sl, "謝った"), { selfLast: "apology" });
  assert.deepEqual(patchOf(sl, "言い返した"), { selfLast: "attack" });
  assert.deepEqual(patchOf(sl, "どれでもない"), { selfLast: "none" });
  const el = Q({ intent: "request_space", partnerLast: "space", selfTemp: "high" }, "elapsed");
  assert.deepEqual(patchOf(el, "3時間以内"), { elapsed: "lt3h" });
  assert.deepEqual(patchOf(el, "１〜２日"), { elapsed: "12h_2d" }, "全角の数字");
  assert.deepEqual(patchOf(el, "昨日"), { elapsed: "12h_2d" }, "読み取りで");
  assert.equal(L.matchAnswer(el, "12日"), null, "「1〜2日」の「〜」は外さない");
  const rk = L.REPLY_KIND_Q;
  assert.equal(rk.text, "相手の返事は、どれに近いですか？");
  assert.deepEqual(rk.options.map(o => o.label), F.REPLY_KIND_QUESTION.options.map(o => o.label));
  assert.deepEqual(patchOf(rk, "謝ってきた"), { partnerLast: "apology" });
  assert.deepEqual(patchOf(rk, "普通の話題だった"), { partnerLast: "casual" });
  assert.deepEqual(patchOf(rk, "別れ話"), { partnerLast: "breakup" });
  assert.equal(L.matchAnswer(rk, "わからない"), null);
  assert.equal(L.matchAnswer(null, "自分"), null);
});
test("exampleLine・retryText：選択肢の label を「／」でつなぐ（primary の分だけ）。聞き直しは1つ目の label", () => {
  const q = Q({ lastSender: "self", elapsed: "lt3h", partnerLast: "attack", ongoing: false, goal: "reconcile" }, "intent");
  assert.equal(L.exampleLine(q), "（例：謝りたい／伝えたいことがある／距離を置きたいと伝えたい／特になし）");
  assert.equal(L.retryText(q), "うまく読み取れませんでした。たとえば「謝りたい」のように、短く書いてもらえれば大丈夫です。");
  const sc = Q({}, "scene");
  assert.equal(L.exampleLine(sc), `（例：${SCENES.slice(0, 4).map(s => s.label).join("／")}）`);
  assert.equal(L.exampleLine(L.REPLY_KIND_Q), `（例：${F.REPLY_KIND_QUESTION.options.map(o => o.label).join("／")}）`);
});

// ---------------------------------------------------------------- 一手のあとに書いた文
test("classifyFollow：「」『』があれば相手の返事（中身と外の文）。閉じていない「も中身に", () => {
  assert.deepEqual(L.classifyFollow("「じゃあもういいよ。勝手にすれば」って来た"), { kind: "reply", quoted: ["じゃあもういいよ。勝手にすれば"], rest: "って来た" });
  assert.deepEqual(L.classifyFollow("『ごめんね』だって", { sent: true }), { kind: "reply", quoted: ["ごめんね"], rest: "だって" });
  assert.deepEqual(L.classifyFollow("「ごめん」と「でも話したい」").quoted, ["ごめん", "でも話したい"]);
  assert.deepEqual(L.classifyFollow("「外の『中』も」来た").quoted, ["外の『中』も"], "入れ子は外側ごと1つ");
  assert.deepEqual(L.classifyFollow("返事が来て「ごめん").quoted, ["ごめん"]);
  assert.equal(L.classifyFollow("「」").kind, "talk", "空の「」は相手の返事にしない");
});
test("classifyFollow：送った（送った・送りました・送信した・LINE した など）。送るか迷っている言い方は送ったにしない", () => {
  for (const t of ["送った", "送ったよ", "送りました", "さっき送信した", "LINE した", "ＬＩＮＥしました", "ラインした", "返信した", "もう連絡しました", "送ってみた"]) assert.equal(L.classifyFollow(t).kind, "sent", t);
  for (const t of ["送ったほうがいい？", "送った方がいいかな", "送ったらどうなる", "まだ送ってない", "送りましたか"]) assert.equal(L.classifyFollow(t).kind, "talk", t);
});
test("classifyFollow：まだ来ない（送ったあとだけ）。送る前は「もう少し話したい」", () => {
  for (const t of ["まだ来ない", "まだこない", "まだ", "返事がない", "既読無視されてる", "未読のまま", "返ってこない", "送ったけど返事がない"]) assert.equal(L.classifyFollow(t, { sent: true }).kind, "noreply", t);
  assert.equal(L.classifyFollow("まだ来ない").kind, "talk");
  assert.equal(L.classifyFollow("まだ").kind, "talk");
  assert.equal(L.classifyFollow("送ったけど返事がない").kind, "sent", "送る前に書いたら、まず送った");
});
test("classifyFollow：それ以外は「もう少し話したい」", () => {
  for (const t of ["やっぱり謝りたい", "不安でたまらない", "どうしたらいい？", "明日会う予定"]) assert.equal(L.classifyFollow(t, { sent: true }).kind, "talk", t);
  assert.deepEqual(L.classifyFollow(" やっぱり謝りたい "), { kind: "talk", quoted: [], rest: "やっぱり謝りたい" });
});

// ---------------------------------------------------------------- 一手の吹き出し
test("moveText：送る一手。太字の一手 → 理由の1行目 → 送る一文（見出しと文）→ 足さない方がいい一言 → 相手はたぶん", () => {
  const m = M.buildPoc({ known: { lastSender: "partner", partnerLast: "attack", elapsed: "lt3h", selfTemp: "high" }, text: "", now: NOON, tzOffset: JST });
  assert.equal(m.mode, "send");
  const t = L.moveText(m);
  assert.equal(t.safety, false);
  assert.deepEqual(t.parts.map(p => p.k), ["head", "p", "draft", "p", "p"]);
  assert.equal(t.parts[0].text, `いまの一手：${m.headline}`);
  assert.equal(t.parts[1].text, m.reasons[0]);
  assert.equal(m.reasons.length > 1, true);
  assert.ok(!t.text.includes(m.reasons[1]), "理由の2行目からは出さない");
  assert.deepEqual(t.draft, { label: m.card.drafts[0].label, text: m.card.drafts[0].text });
  for (const d of m.card.drafts.slice(1)) assert.ok(!t.text.includes(d.text), "別の言い方は出さない");
  assert.deepEqual(t.parts[3], { k: "p", lead: "足さない方がいい一言：", text: m.card.avoid.map(M.avoidPhrase).join(""), tone: "stop" });
  assert.deepEqual(t.parts[4], { k: "p", lead: "相手はたぶん、", text: m.guess, tag: "仮の文", tagTitle: "AI がつながるまでの、決まった仮の文です" });
  assert.equal(t.safetyLine, null);
  assert.equal(t.text, [`いまの一手：${m.headline}`, m.reasons[0], m.card.drafts[0].label, m.card.drafts[0].text, `足さない方がいい一言：${m.card.avoid.map(M.avoidPhrase).join("")}`, `相手はたぶん、${m.guess}`].join("\n"));
  for (const no of [m.card.confidenceLine, ...m.variantLines, m.card.ifReply, m.card.ifNoReply].filter(Boolean)) assert.ok(!t.text.includes(no), `出さない：${no}`);
});
test("moveText：待つ一手。戻る時刻（{戻る時刻}：明日 8:00）と、待つ間に（今の言い方）", () => {
  const m = M.buildPoc({ known: { lastSender: "self", elapsed: "lt3h", partnerLast: "none", selfLast: "reconcile" }, text: "", now: NOON, tzOffset: JST });
  assert.equal(m.mode, "wait");
  assert.equal(m.result.action, "wait_until");
  const t = L.moveText(m);
  assert.deepEqual(t.parts.map(p => p.k), ["head", "ret", "p", "p", "p", "p"]);
  assert.deepEqual(t.parts[1], { k: "ret", lead: "戻る時刻：", text: m.ret.text, at: m.ret.at.toISOString() });
  assert.equal(t.parts[1].text, "明日 8:00");
  assert.deepEqual(t.parts[3], { k: "p", lead: "待つ間に：", text: m.doNow });
  assert.equal(t.draft, null);
  // 読み返す日（self_calm）とやること
  const c = M.buildPoc({ known: { afterMakeup: true, repeat: false, lastSender: "none", partnerLast: "none" }, text: "", now: NOON, tzOffset: JST });
  assert.equal(c.result.action, "self_calm");
  const ct = L.moveText(c);
  assert.equal(ct.parts.find(p => p.k === "ret").lead, "読み返す日：");
  assert.equal(ct.parts.find(p => p.lead === "やること：").text, c.doNow);
});
test("moveText：続けるとき（安全の確かめのあと）は窓口の1行を添える。安全のモードは文章にしない", () => {
  const m = M.buildPoc({ known: { lastSender: "partner", partnerLast: "attack", elapsed: "lt3h" }, text: "", now: NOON, tzOffset: JST, safetyContinue: true, safety: { selfHarm: true, partnerThreat: false } });
  const t = L.moveText(m);
  assert.deepEqual(t.safetyLine, m.safetyLine.map(r => ({ name: r.name, contact: r.contact })));
  assert.equal(L.moveText({ mode: "safety", card: {} }).safety, true);
  assert.equal(L.moveText(null).safety, true);
});
test("moveText：履歴の写し（snapshotOf）からも同じ中身（戻る時刻の文が無ければ空。画面が日時で出す）", () => {
  const m = M.buildPoc({ known: { lastSender: "partner", partnerLast: "attack", elapsed: "lt3h", selfTemp: "high" }, text: "", now: NOON, tzOffset: JST });
  assert.deepEqual(L.moveText(snapshotOf(m)).parts, L.moveText(m).parts);
  const w = M.buildPoc({ known: { lastSender: "self", elapsed: "lt3h", partnerLast: "none", selfLast: "reconcile" }, text: "", now: NOON, tzOffset: JST });
  const sp = L.moveText(snapshotOf(w)).parts;
  assert.deepEqual(sp.find(p => p.k === "ret"), { k: "ret", lead: "戻る時刻：", text: "", at: w.ret.at.toISOString() });
  assert.deepEqual(sp.filter(p => p.k !== "ret"), L.moveText(w).parts.filter(p => p.k !== "ret"));
});
test("keepText：一手が変わらないとき。送る一文があれば前の見出し、待つ一手なら戻る時刻の言葉", () => {
  const send = M.buildPoc({ known: { lastSender: "partner", partnerLast: "attack", elapsed: "lt3h", selfTemp: "high" }, text: "", now: NOON, tzOffset: JST });
  assert.equal(L.keepText(send), `一手はこのままで大丈夫です。前の「${send.card.drafts[0].label}」を、そのまま使えます。`);
  const wait = M.buildPoc({ known: { lastSender: "self", elapsed: "lt3h", partnerLast: "none", selfLast: "reconcile" }, text: "", now: NOON, tzOffset: JST });
  assert.equal(L.keepText(wait), "一手はこのままで大丈夫です。前に書いた「戻る時刻」まで、このまま待つ形です。");
  const calm = M.buildPoc({ known: { afterMakeup: true, repeat: false, lastSender: "none", partnerLast: "none" }, text: "", now: NOON, tzOffset: JST });
  assert.equal(L.keepText(calm), "一手はこのままで大丈夫です。前に書いた「読み返す日」まで、このまま待つ形です。");
  assert.equal(L.keepText({ mode: "wait", ret: null }), "一手はこのままで大丈夫です。");
  assert.equal(L.keepText({ mode: "send", card: { drafts: [] } }), "一手はこのままで大丈夫です。");
});

// ---------------------------------------------------------------- 文
test("TALK_TEXTS：仕様（U55）に書いた文のまま", () => {
  const T = L.TALK_TEXTS;
  assert.equal(T.greet, "いま、何があったか、そのまま書いてください。全部そろっていなくても大丈夫です。足りないところは、あとで少しだけ聞きます。");
  assert.equal(T.quoteGuide, "相手から来た文や、相手に言われた言葉は「」で囲んで書いてください。");
  assert.equal(T.offer, "前の相談の続きがあります：");
  assert.equal(T.offerHow, "続けるときは、そのまま書いてください。新しく始めるときは、上の「新しく相談」を押してください。");
  assert.equal(T.retry, "うまく読み取れませんでした。たとえば「{例}」のように、短く書いてもらえれば大丈夫です。");
  assert.equal(T.example, "（例：{例}）");
  assert.equal(T.moveHead, "いまの一手：");
  assert.equal(T.avoidLead, "足さない方がいい一言：");
  assert.equal(T.guessLead, "相手はたぶん、");
  assert.equal(T.guessTag, "仮の文", "予想の札は今のカードと同じ字（consult_card.js の guessP）");
  assert.equal(T.replyKindQ, "相手の返事は、どれに近いですか？");
  assert.equal(T.sentAck, "送ったんですね。返事が来たら、相手の文を「」で囲んで書いてください。まだ来ないときは、そう書いてください。");
  assert.equal(T.redo, "いまの状況に合わせて、一手を考え直しました。");
  assert.equal(T.keep, "一手はこのままで大丈夫です。");
  assert.equal(T.keepDraft, "前の「{label}」を、そのまま使えます。");
  assert.equal(T.keepWait, "前に書いた「{時刻}」まで、このまま待つ形です。");
  assert.equal(T.limit, "この相談はここまでです。続きは、上の「新しく相談」から書いてください。");
  assert.equal(T.newConsult, "新しく相談");
  assert.equal(T.privacy, "書いた文は、この端末の中だけで読み取ります。どこにも送りません。");
  assert.deepEqual([T.status, T.collapse, T.expand, T.check, T.send], ["いまの状況", "たたむ", "状況", "答え合わせ", "送る"]);
  assert.ok(Object.isFrozen(T));
});

// ---------------------------------------------------------------- 記録
test("talkPersist：自分・アプリの吹き出しだけ。安全の確かめ（sf）・安全のカード・画面の中だけの印（id・old）は残さない", () => {
  const items = [
    { id: 1, who: "me", text: "書いた文", at: "2026-10-18T03:00:00.000Z" },
    { id: 2, who: "app", text: "いま、身の危険や強い怖さを感じていますか？", sf: true },
    { id: 3, who: "me", text: "大丈夫、続ける", sf: true },
    { id: 4, who: "safety", sf: true, card: {} },
    { id: 5, who: "app", label: "答え合わせ", text: "予想に近い返事です。", check: "near", at: "x", old: true },
    { id: 6, who: "app", text: "いまの一手：…", move: [{ k: "head", text: "いまの一手：…" }, { k: "draft", label: "送るならこの1通", text: "ごめんね" }, { k: "x", text: "?" }, { k: "ret", lead: "戻る時刻：", text: "明日 8:00", at: "2026-10-18T23:00:00.000Z" }], draft: { label: "送るならこの1通", text: "ごめんね" }, lead: "いまの状況に合わせて、一手を考え直しました。" },
    null, { who: "card" }, { who: "me" },
  ];
  assert.deepEqual(L.talkPersist(items), [
    { who: "me", text: "書いた文", at: "2026-10-18T03:00:00.000Z" },
    { who: "app", text: "予想に近い返事です。", at: "x", label: "答え合わせ", check: "near" },
    { who: "app", text: "いまの一手：…", at: null, move: [{ k: "head", text: "いまの一手：…" }, { k: "draft", text: "ごめんね", label: "送るならこの1通" }, { k: "ret", text: "明日 8:00", lead: "戻る時刻：", at: "2026-10-18T23:00:00.000Z" }], draft: { label: "送るならこの1通", text: "ごめんね" }, lead: "いまの状況に合わせて、一手を考え直しました。" },
  ]);
  assert.deepEqual(L.talkFrom(L.talkPersist(items)), L.talkPersist(items), "戻しても同じ");
  assert.deepEqual(L.talkFrom("x"), []);
  // JSON にできる
  assert.deepEqual(JSON.parse(JSON.stringify(L.talkPersist(items))), L.talkPersist(items));
});
test("pendPersist・pendFrom：文で答えるのを待っている問（相手の返事の種類・1問）だけ。相手の返事の種類は今の選択肢で戻す", () => {
  assert.equal(L.pendPersist(null), null);
  assert.equal(L.pendPersist({ type: "ask", q: {} }), null, "一手の前の問は残さない（一手の前は記録が無い）");
  assert.equal(L.pendPersist({ type: "safety" }), null);
  assert.deepEqual(L.pendPersist({ type: "replyKind", q: L.REPLY_KIND_Q, tries: 1, text: "ふーん" }), { type: "replyKind", tries: 1, text: "ふーん" });
  const rk = L.pendFrom({ type: "replyKind", tries: 0, text: "ふーん" });
  assert.equal(rk.q, L.REPLY_KIND_Q);
  const q = F.talkQuestion({ lastSender: "self", elapsed: "lt3h", partnerLast: "attack", ongoing: false, goal: "reconcile" }, []) ?? Q({ lastSender: "self", elapsed: "lt3h", partnerLast: "attack", ongoing: false, goal: "reconcile" }, "intent");
  const p = L.pendPersist({ type: "talkQ", q, tries: 0, text: "やっぱり不安" });
  assert.equal(p.q.id, q.id);
  assert.deepEqual(p.q.options, q.options.map(o => ({ label: o.label, patch: o.patch })));
  assert.deepEqual(L.pendFrom(p), p);
  assert.equal(L.pendPersist({ type: "talkQ", q: null }), null);
});
test("記録は ?cv=chat・?cv=card が読む形とぶつからない：fu.resumable・fu.thread は今の形のまま（talk は data.talk に足すだけ）", () => {
  // 画面の saveRecord と同じ組み立て（consult_talk.js）：data は v 2・text・accept・card・input・extra・fu ＋ talk
  const src = read("app/js/consult_talk.js");
  assert.match(src, /v: 2,\n\s+text: S\.text,\n\s+accept: S\.accept,\n\s+card: snapshotOf\(m\),\n\s+input,\n\s+extra: S\.extra,\n\s+fu: S\.fu,\n\s+talk: \{ v: 1, thread: L\.talkPersist\(S\.tk\), pending: L\.pendPersist\(S\.pend\) \},/);
  assert.match(src, /kind: "consult"/);
  // fu.pending は今の形（type・n・q・text）だけを入れる（?cv=chat・?cv=card が選択肢を出せる）
  assert.match(src, /S\.fu\.pending = \{ type: "replyKind", n: fuLast\(\), text: qt \};/);
  assert.match(src, /S\.fu\.pending = \{ type: "talkQ", n: fuLast\(\), q, text \};/);
  const now = NOON;
  const m = M.buildPoc({ known: { lastSender: "self" }, text: "t", now, tzOffset: JST });
  const fu = F.newFollow({ known: { lastSender: "self" } });
  fu.thread = [{ who: "card", at: now.toISOString(), card: snapshotOf(m), action: m.result.action }];
  const rec = { kind: "consult", data: { v: 2, text: "t", input: { known: {}, at: now.toISOString() }, fu, talk: { v: 1, thread: [], pending: null } } };
  assert.equal(F.resumable(rec), true);
});

// ---------------------------------------------------------------- 画面のコード（外した足し物・つなぎ・CSS）
test("consult_talk.js：選ぶボタンは安全の確かめだけ。外した足し物（返し方・例文・書き方の例・文を自分で直す・相談を終える・ちがうところがある・診断の案内）が無い", () => {
  const src = read("app/js/consult_talk.js").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*\*[\s\S]*?\*\//g, "");
  for (const no of ["CONSULT_EXAMPLES", "返し方", "例文", "書き方の例", "文を自分で直す", "相談を終える", "ちがうところがある", "#diagnose", "styleStore", "checkDraft", "どうなった？", "liveCard", "相手の返事を貼る", "もう少し話したい\""]) {
    assert.ok(!src.includes(no), `残っている：${no}`);
  }
  // ボタン（button）を作るのは：新しく相談・危ないときは・安全の確かめの3つ・帯の開け閉め・送る・コピー
  const buttons = [...src.matchAll(/h\("button", \{ type: "button", class: (\[?"[a-z-]+")/g)].map(m => m[1]).sort();
  assert.deepEqual(buttons, ['"a-cs-copy"', '"a-cs-danger"', '"a-tk-new"', '"a-tk-send"', '"a-tk-st-btn"', '["a-cs-chip"'].sort(), `ボタンの種類：${buttons.join(" ")}`);
  assert.match(src, /SAFETY_OPTS = \[\["stop", "今、危ない"\], \["ok", "大丈夫、続ける"\], \["other", "昔の話・人の話"\]\]/);
  // 今の部品を使い回す（読み取り・問・判定・往復・安全のカード・記録の写し）。consult_chat.js・consult.js は読まない
  assert.match(src, /from "\.\.\/\.\.\/js\/consult\/extract\.js"/);
  assert.match(src, /from "\.\.\/\.\.\/poc\/card\/model\.js"/);
  assert.match(src, /from "\.\/consult_followup\.js"/);
  assert.match(src, /import \{ statusRows, selfFromStatus, hasSide, joinConsult, preFrom \} from "\.\/consult_chat_logic\.js";/);
  assert.doesNotMatch(src, /from "\.\/consult_chat\.js"|from "\.\/consult\.js"/);
  assert.match(src, /export function renderSaved\(record\) \{\n  try \{ return savedView\(record\); \}/);
});
test("main.js・index.html・sw.js：talk → consult_talk.js。CSS は consult_chat.css のあと。殻に新しいファイル", () => {
  const main = read("app/js/main.js");
  assert.match(main, /return v === "card" \? import\("\.\/consult\.js"\) : v === "chat" \? import\("\.\/consult_chat\.js"\) : import\("\.\/consult_talk\.js"\);/);
  const html = read("app/index.html");
  const a = html.indexOf('href="./css/consult_chat.css"'), b = html.indexOf('href="./css/consult_talk.css"');
  assert.ok(a > 0 && b > a);
  const shell = read("app/sw.js").match(/const SHELL = \[([\s\S]*?)\];/)[1];
  for (const f of ["./css/consult_talk.css", "./js/consult_talk.js", "./js/consult_talk_logic.js", "./js/consult_chat.js", "./js/consult_chat_logic.js", "./js/consult_version.js"]) assert.ok(shell.includes(`"${f}"`), f);
});
test("consult_talk.css：色は app.css の変数だけ（直の色なし）。クラスは a-tk-。動きは transform と opacity だけで、動きを減らす設定で止める。焦点の輪を消さない", () => {
  const css = read("app/css/consult_talk.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "直の色（#…）");
  assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/, "直の色（rgb・名前）");
  const defined = new Set([...read("app/css/app.css").matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
  for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok(defined.has(m[1]) || m[1].startsWith("--a-tk-"), `app.css に無い変数：${m[1]}`);
  for (const m of css.matchAll(/(^|[\s,}(])\.([a-z][a-z0-9-]*)/g)) {
    if (m[2] === "a-tk" || m[2].startsWith("a-tk-")) continue;
    assert.ok(/^(a-(cs-|textarea|top|ic)|is-|has-)/.test(m[2]), `今の部品のクラスに a-tk- で足す：.${m[2]}`);
  }
  // a-tk- の付かない今の部品だけを選ぶ規則が無い（ボタンつきのチャット・今までの形に効かない）
  for (const rule of css.split("}")) {
    const sel = rule.split("{")[0].trim();
    if (!sel || sel.startsWith("@") || /^(from|to)\b/.test(sel) || !rule.includes("{")) continue;
    for (const one of sel.replace(/^@media[^{]*\{/, "").split(",")) assert.match(one, /a-tk/, `a-tk の無い選び方：${one.trim()}`);
  }
  for (const m of css.matchAll(/transition\s*:\s*([^;]+);/g)) assert.match(m[1].trim(), /^(transform|opacity|none)\b/, m[1]);
  const kf = css.match(/@keyframes a-tk-in \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(kf.replace(/opacity|transform/g, ""), /[a-z-]+\s*:/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.a-tk-in \{ animation: none; \}/);
  assert.doesNotMatch(css, /:focus-visible\s*\{[^}]*outline:\s*(none|0)/, "焦点の輪を消さない");
  // 押せる物（新しく相談・帯の開け閉め・送る）は 44px 以上
  for (const cls of ["a-tk-new", "a-tk-st-btn"]) assert.match(css, new RegExp(`\\.${cls} \\{[^}]*min-height: 44px`), cls);
  assert.match(css, /\.a-tk-send \{[^}]*width: 48px;[^}]*height: 48px/);
});

console.log(`\n${pass} OK / ${fail} FAIL`);
if (fail) process.exit(1);
