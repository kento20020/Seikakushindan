// node tests/consult_talk_samples_ai.test.mjs
// 相談のチャット（app/ の「ふつうのチャット」）の試し文100件（架空。tests/fixtures/consult_talk_samples_ai.mjs。決定 U58）で、
// 試作の DOM の無い関数が1通ずつをどう読むかを確かめる。説明：docs/consult-reading.md §10
//  - 見本の形：100件、id（t001〜t100）が重ならない、最初の1通だけ50件・会話50件、項目は決まった物だけ、文が空でない
//  - すべての通で readText（js/consult/extract.js）が落ちずに fields・safety を返す。2通目からは classifyFollow（app/js/consult_talk_logic.js）も落ちない
//  - しるし無しの86件で、どの通でも安全（selfHarm・partnerThreat）が true にならない（言葉を足したときの誤反応の見張り）
//  - 今拾えている件（MUST_CATCH）は、これからも拾う。拾えない件は「今の弱いところ」（KNOWN_MISSES）。数を出すだけで落とさない。
//    一覧に無いしるしありの件が拾えなくなったら落とす。会話は、どれかの通で拾えれば拾えたとする（試作の画面は2通目からも安全を見るため）
//  - あとの通の見分け（classifyFollow）：ねらいの決まった種類（相手の返事・送った・まだ来ない）でずれる通は KNOWN_FOLLOW_MISSES だけ。
//    ほかの種類は「どう読まれたか」の数を出すだけ（落とさない）
//  - 問いへの答え（matchAnswer）：選択肢に当てはまった数を種類ごとに出す（落とさない）
//  - 長さの印（S〜XL）が字数と合い、字数が最初の1通の空白と改行を除いた字数と合う
// 規則の言葉はこのテストのために変えない（足すのは持ち主と Website の決め事）。時刻は使わないので、実行環境の時差に左右されない。
import assert from "node:assert/strict";
import { readText, READ_KEYS } from "../js/consult/extract.js";
import { classifyFollow, matchAnswer } from "../app/js/consult_talk_logic.js";
import { CONSULT_TALK_SAMPLES_AI } from "./fixtures/consult_talk_samples_ai.mjs";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

/** 今の規則で拾えている、しるしありの件（これからも拾う） */
const MUST_CATCH = ["t018"];
/** 今の規則で拾えていない、しるしありの件（今の弱いところ。拾えるようになったら、ここから外して MUST_CATCH に足す） */
const KNOWN_MISSES = [
  "t004",   // 監視・つきまとい（位置情報で行き先を確かめる、来ないでと言われたあとも待つ・送り続ける）
  "t006",   // 従わせたい・罰したい（無視して謝らせる。相手がこわがっている兆し）
  "t009",   // 監視（スマホを勝手に見られる）
  "t027",   // 酔い・手を出しそう
  "t030",   // 物に当たる（そのときのこわさ）
  "t041",   // 人格否定が続く（酔っているとき）
  "t043",   // 監視（位置の見せ合いを求められる）・こわくて返事を迷う
  "t044",   // 法的な手続き（調停）・物を投げる・スマホを見られる
  "t050",   // こわさ（連絡が来るたびにびくっとする。怒らせないために先に謝る）
  "t063",   // 監視（位置情報の共有を求められる）
  "t071",   // お金の支配（使い道を細かく聞かれる・通帳を見せてと言われる）
  "t077",   // 物に当たる・顔色をうかがう
  "t099",   // つきまとい（返信しないと職場に電話してくる）
];
/** あとの通の種類（kind）→ classifyFollow のねらい。ここに無い種類は数を出すだけ */
const FOLLOW_TARGET = { "相手の返事（「」あり）": "reply", "返事が来た（「」）": "reply", "送った": "sent", "まだ来ない": "noreply" };
/** ねらいの決まった通のうち、今の読み方ではねらいとずれる通（"件:通の番号"。番号は turns の 0 から。直ったら外す） */
const KNOWN_FOLLOW_MISSES = [
  "t001:4",   // まだ来ない →「既読ついてから20分くらい、なんもなし」は来ない言い方の一覧に無く、話の続き
  "t021:4",   // 送った →「ライン送ってしまいました」は送った言い方の一覧に無く（「送ってしまった」はある）、話の続き
  "t031:4",   // 送った →「返しました」は一覧に無く、話の続き
  "t036:3",   // 送った →「」の中の送った文があるので、相手の返事
  "t061:3",   // 送った →「出した」は一覧に無く、『』で書いた下書きの一部があるので、相手の返事
  "t073:5",   // 送った →「打っといた」は一覧に無く、話の続き
  "t080:5",   // まだ来ない →「既読もつかなぃ」は一覧に無く、話の続き
  "t095:4",   // まだ来ない →「既読つかない」は一覧に無く、話の続き
];
/** 長さの印の字数（最初の1通の、空白と改行を除いた字数） */
const LEN_RANGES = { S: [1, 40], M: [41, 200], L: [201, 450], XL: [451, Infinity] };
const AFTERS = ["はじめ", "問いに答える", "一手のあと", "送ったあと", "どこでも"];
/** classifyFollow の読み方の呼び方 */
const SAY = { reply: "相手の返事", sent: "送った", noreply: "まだ来ない", talk: "話の続き" };

// ---------------------------------------------------------------- 問いの表（数を出すためだけの写し）
// js/consult/needed.js の QUESTIONS（問いの文と選択肢）を書き写した物。needed.js は外に出していないので、数を出すためだけにここに写す。
// 見本の app（アプリの問いの文。想定）を上から順に当て、最初に合った問いを使う（「最後に送ったのは、どんな内容？」を先に見る）。
// needed.js の問いが変わっても、このテストは落ちない（数が変わるだけ）。そのときはここも写し直す。
const o = (label, patch) => ({ label, patch });
const PARTNER_KINDS = [
  o("謝ってきた", { partnerLast: "apology" }), o("普通の話題", { partnerLast: "casual" }), o("説明・言い返し", { partnerLast: "explain" }),
  o("責める・「もういい」", { partnerLast: "attack" }), o("話し合いの提案", { partnerLast: "talk_proposal" }),
  o("距離を置きたい", { partnerLast: "space" }), o("別れ話", { partnerLast: "breakup" }),
];
const QUESTION_TABLE = [
  [/最後に送ったのは、どんな|自分が最後に送った|相手から来る前に/, { id: "selfLast", options: [
    o("「落ち着いたら話そう」など", { selfLast: "hold" }), o("謝った", { selfLast: "apology" }), o("仲直りしようとした", { selfLast: "reconcile" }),
    o("責めた・言い返した", { selfLast: "attack" }), o("説明した", { selfLast: "explain" }), o("どれでもない", { selfLast: "none" })] }],
  [/最後に送ったのは/, { id: "lastSender", options: [
    o("自分", { lastSender: "self" }), o("相手", { lastSender: "partner" }), o("どちらも送っていない（対面で終わった）", { lastSender: "none" })] }],
  [/言い合いは今も/, { id: "ongoing", options: [o("今も続いている", { ongoing: true }), o("いまは止まっている", { ongoing: false })] }],
  [/どうしたい/, { id: "intent", options: [
    o("謝りたい", { intent: "apologize" }), o("伝えたいことがある", { intent: "tell" }),
    o("距離を置きたいと伝えたい", { intent: "request_space" }), o("特になし", { intent: "none" })] }],
  [/別れたい」という話/, { id: "partnerLast", options: [
    o("出ていない", { partnerLast: "none" }), o("距離を置きたいと言われた", { partnerLast: "space" }), o("別れ話をされた", { partnerLast: "breakup" })] }],
  [/相手から来たのは/, { id: "partnerLast", options: PARTNER_KINDS }],
  [/相手から最後に来たのは/, { id: "partnerLast", options: [...PARTNER_KINDS, o("まだ何も来ていない", { partnerLast: "none" })] }],
  [/どれくらい/, { id: "elapsed", options: [
    o("3時間以内", { elapsed: "lt3h" }), o("半日以内", { elapsed: "3h_12h" }), o("1〜2日", { elapsed: "12h_2d" }), o("3日以上", { elapsed: "ge3d" })] }],
  [/いまの気持ち/, { id: "selfTemp", options: [o("まだ熱い", { selfTemp: "high" }), o("落ち着いてきた", { selfTemp: "cooling" }), o("落ち着いている", { selfTemp: "calm" })] }],
  [/ゴール/, { id: "goal", options: [
    o("仲直りしたい", { goal: "reconcile" }), o("分かってほしい", { goal: "understood" }),
    o("ちゃんと決着をつけたい", { goal: "settle" }), o("少し距離を置きたい", { goal: "space" })] }],
  [/原因/, { id: "cause", options: [o("自分", { cause: "self" }), o("相手", { cause: "partner" }), o("両方", { cause: "both" }), o("分からない", { cause: "unknown" })] }],
  [/前にも同じ/, { id: "repeat", options: [o("初めて", { repeat: false }), o("前にもあった（くり返し）", { repeat: true })] }],
];
const questionOf = (app) => QUESTION_TABLE.find(([re]) => re.test(app || ""))?.[1] ?? null;

const S = CONSULT_TALK_SAMPLES_AI;
const first = S.filter(x => x.mode === "first");
const convo = S.filter(x => x.mode === "convo");
const marked = S.filter(x => x.safety.expected);
const unmarked = S.filter(x => !x.safety.expected);
const hit = (r) => r.safety.selfHarm === true || r.safety.partnerThreat === true;
const charsOf = (text) => [...String(text).replace(/\s/g, "")].length;   // サロゲートの組は1字
const tally = (xs) => xs.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
const tallyText = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join("・");
const turnKey = (x, i) => `${x.id}:${i}`;

// ---------------------------------------------------------------- 1. 見本の形
test("見本：100件、id（t001〜t100）が重ならない、最初の1通だけ50件・会話50件、項目は決まった物だけ、文が空でない", () => {
  assert.equal(S.length, 100, "見本の数（文を足したら、このテストと docs/consult-reading.md §10 の数も直す）");
  assert.equal(new Set(S.map(x => x.id)).size, S.length, "id が重なっている");
  assert.deepEqual(S.map(x => x.id).sort(), Array.from({ length: 100 }, (_, i) => `t${String(i + 1).padStart(3, "0")}`), "id は t001〜t100");
  for (const x of S) {
    assert.deepEqual(Object.keys(x).sort(), ["chars", "id", "len", "mode", "safety", "test", "turns"], x.id);
    assert.deepEqual(Object.keys(x.safety), ["expected"], `${x.id}: safety の項目`);
    assert.equal(typeof x.safety.expected, "boolean", `${x.id}: safety.expected`);
    assert.ok(x.mode === "first" || x.mode === "convo", `${x.id}: mode ${x.mode}`);
    assert.ok(x.len in LEN_RANGES, `${x.id}: 長さの印 ${x.len}`);
    assert.ok(Number.isInteger(x.chars) && x.chars > 0, `${x.id}: chars`);
    assert.ok(typeof x.test === "string" && x.test.trim().length > 0, `${x.id}: test が空`);
    assert.ok(Array.isArray(x.turns), `${x.id}: turns`);
    if (x.mode === "first") assert.equal(x.turns.length, 1, `${x.id}: 最初の1通だけなのに turns が ${x.turns.length}`);
    else assert.ok(x.turns.length >= 2 && x.turns.length <= 6, `${x.id}: 会話なのに turns が ${x.turns.length}`);
    x.turns.forEach((t, i) => {
      const at = turnKey(x, i);
      assert.deepEqual(Object.keys(t).sort(), ["after", "app", "kind", "text"], at);
      assert.ok(AFTERS.includes(t.after), `${at}: after ${t.after}`);
      if (i === 0) assert.equal(t.after, "はじめ", `${at}: 最初の通の after`);
      else assert.notEqual(t.after, "はじめ", `${at}: 2通目からの after が「はじめ」`);
      assert.ok(typeof t.kind === "string" && t.kind.trim().length > 0, `${at}: kind が空`);
      assert.equal(typeof t.app, "string", `${at}: app`);
      assert.ok(typeof t.text === "string" && t.text.trim().length > 0, `${at}: 文が空`);
    });
  }
  assert.equal(first.length, 50, "最初の1通だけの数");
  assert.equal(convo.length, 50, "会話の数");
  assert.equal(marked.length, 14, "しるしありの数");
  assert.equal(unmarked.length, 86, "しるし無しの数");
  // 一覧の id は見本にあって、しるしありで、重ならない
  const ids = new Set(marked.map(x => x.id));
  for (const id of [...MUST_CATCH, ...KNOWN_MISSES]) assert.ok(ids.has(id), `${id} はしるしありの見本に無い`);
  assert.equal(new Set([...MUST_CATCH, ...KNOWN_MISSES]).size, MUST_CATCH.length + KNOWN_MISSES.length, "MUST_CATCH と KNOWN_MISSES が重なっている");
  // KNOWN_FOLLOW_MISSES は、ねらいの決まった種類の通を指している
  assert.equal(new Set(KNOWN_FOLLOW_MISSES).size, KNOWN_FOLLOW_MISSES.length, "KNOWN_FOLLOW_MISSES が重なっている");
  for (const k of KNOWN_FOLLOW_MISSES) {
    const [id, n] = k.split(":");
    const t = S.find(x => x.id === id)?.turns[Number(n)];
    assert.ok(t && Number(n) > 0 && FOLLOW_TARGET[t.kind], `${k} は、ねらいの決まった種類の通ではない`);
  }
  const convoTurns = convo.reduce((s, x) => s + x.turns.length, 0);
  const byTurns = Object.entries(tally(convo.map(x => x.turns.length))).map(([n, c]) => `${n}通 ${c}件`).join("・");
  const byLen = (xs) => Object.keys(LEN_RANGES).map(k => `${k} ${xs.filter(x => x.len === k).length}`).join("・");
  console.log(`     見本 ${S.length}件：最初の1通だけ ${first.length}件（${byLen(first)}）・会話 ${convo.length}件（${byLen(convo)}。${byTurns}、合わせて ${convoTurns}通）`);
  console.log(`     しるしあり ${marked.length}件（最初の1通だけ ${marked.filter(x => x.mode === "first").length}・会話 ${marked.filter(x => x.mode === "convo").length}）・しるし無し ${unmarked.length}件`);
});

// ---------------------------------------------------------------- 2. 落ちない
const reads = new Map();   // id → 通ごとの readText の結果
test("落ちない：すべての通で readText が fields・safety を返し、2通目からは classifyFollow も落ちない", () => {
  const broken = [];
  for (const x of S) {
    const rs = [];
    x.turns.forEach((t, i) => {
      const at = turnKey(x, i);
      try {
        const r = readText(t.text);
        assert.ok(r && typeof r === "object", "結果が無い");
        assert.ok(r.fields && typeof r.fields === "object", "fields が無い");
        assert.ok(r.safety && typeof r.safety.selfHarm === "boolean" && typeof r.safety.partnerThreat === "boolean", "safety の形");
        for (const k of Object.keys(r.fields)) assert.ok(READ_KEYS.includes(k), `知らない項目 ${k}`);
        rs.push(r);
      } catch (e) {
        broken.push(`${at} readText: ${e.message}`);
      }
      if (i === 0) return;
      for (const sent of [false, true]) {
        try {
          const c = classifyFollow(t.text, { sent });
          assert.ok(c && c.kind in SAY, `読み方 ${c?.kind}`);
          assert.ok(Array.isArray(c.quoted) && typeof c.rest === "string", "quoted・rest の形");
        } catch (e) {
          broken.push(`${at} classifyFollow（sent: ${sent}）: ${e.message}`);
        }
      }
    });
    if (rs.length === x.turns.length) reads.set(x.id, rs);
  }
  assert.deepEqual(broken, [], "落ちた・形が違う通");
  assert.equal(reads.size, S.length);
});

const caughtBy = (x) => reads.get(x.id).some(hit);   // どれかの通で安全の確かめが出る

// ---------------------------------------------------------------- 3. 安全：誤反応しない
test("安全：しるし無しの86件で、どの通でも selfHarm・partnerThreat が true にならない", () => {
  assert.equal(reads.size, S.length, "読み取りの結果がそろっていない");
  const wrong = [];
  for (const x of unmarked) reads.get(x.id).forEach((r, i) => { if (hit(r)) wrong.push(`${turnKey(x, i)} ${JSON.stringify(r.safety)}`); });
  console.log(`     しるし無し ${unmarked.length}件（${unmarked.reduce((s, x) => s + x.turns.length, 0)}通）のうち、規則が反応した通は ${wrong.length}`);
  assert.deepEqual(wrong, [], "しるし無しの文で安全の規則が反応した（言葉を足したときの誤反応）");
});

// ---------------------------------------------------------------- 4. 安全：拾えている件は拾い続ける
test(`安全：今拾えている${MUST_CATCH.length}件（${MUST_CATCH.join("・")}）は、これからも拾う`, () => {
  assert.equal(reads.size, S.length, "読み取りの結果がそろっていない");
  for (const id of MUST_CATCH) {
    const x = S.find(y => y.id === id);
    const where = reads.get(id).map((r, i) => {
      const which = [r.safety.selfHarm && "selfHarm", r.safety.partnerThreat && "partnerThreat"].filter(Boolean).join("・");
      return which ? `${i + 1}通目で ${which}` : "";
    }).filter(Boolean).join("、") || "なし";
    console.log(`     ${id}（${x.mode === "first" ? "最初の1通だけ" : "会話"}）→ ${where}`);
    assert.ok(caughtBy(x), `${id} を拾えなくなった`);
  }
});

// ---------------------------------------------------------------- 5. 安全：今の弱いところ（落とさない）と、拾える件が減っていないか
test("安全：しるしありの14件 — 拾えない件は KNOWN_MISSES のものだけ（数を出す）", () => {
  assert.equal(reads.size, S.length, "読み取りの結果がそろっていない");
  const caught = marked.filter(caughtBy);
  const missed = marked.filter(x => !caughtBy(x));
  console.log(`     しるしあり ${marked.length}件のうち、どこかの通で安全の確かめが出るのは ${caught.length}件、残り ${missed.length}件`);
  console.log(`       拾えない：${missed.map(x => x.id + (KNOWN_MISSES.includes(x.id) ? "" : "（KNOWN_MISSES に無い）")).join("・") || "なし"}`);
  const nowCaught = KNOWN_MISSES.filter(id => caughtBy(S.find(x => x.id === id)));
  if (nowCaught.length) console.log(`     拾えるようになった：${nowCaught.join("・")}（KNOWN_MISSES から外し、MUST_CATCH に足す）`);
  const unexpected = missed.filter(x => !KNOWN_MISSES.includes(x.id)).map(x => x.id);
  assert.deepEqual(unexpected, [], "KNOWN_MISSES に無いしるしありの件が拾えなくなった");
});

// ---------------------------------------------------------------- 6. あとの通の見分け
// 会話を順にたどる。sent は、それより前の通が "sent" と読まれたら true。問いに答える通は classifyFollow に通さない（sent も変えない）
const follows = [];   // { at, kind, want, got, text }
for (const x of convo) {
  let sent = false;
  x.turns.forEach((t, i) => {
    if (i === 0 || t.after === "問いに答える") return;
    let got;
    try { got = classifyFollow(t.text, { sent }).kind; } catch { got = "（落ちた）"; }
    if (got === "sent") sent = true;
    follows.push({ at: turnKey(x, i), kind: t.kind, want: FOLLOW_TARGET[t.kind] ?? null, got, text: t.text });
  });
}
test("あとの通の見分け：相手の返事・送った・まだ来ない — ねらいとずれる通は KNOWN_FOLLOW_MISSES のものだけ", () => {
  const targeted = follows.filter(f => f.want);
  const missed = targeted.filter(f => f.got !== f.want);
  for (const kind of Object.keys(FOLLOW_TARGET)) {
    const xs = targeted.filter(f => f.kind === kind);
    console.log(`     ${kind}（${xs.length}通。ねらいは${SAY[FOLLOW_TARGET[kind]]}）：${tallyText(tally(xs.map(f => SAY[f.got] ?? f.got)))}`);
  }
  console.log(`     ねらいの決まった ${targeted.length}通のうち、ねらいどおり ${targeted.length - missed.length}通・ずれた ${missed.length}通`);
  for (const f of missed) {
    console.log(`       ずれた ${f.at}（${f.kind}）→ ${SAY[f.got] ?? f.got}${KNOWN_FOLLOW_MISSES.includes(f.at) ? "" : " ← KNOWN_FOLLOW_MISSES に無い"}`);
  }
  const fixed = KNOWN_FOLLOW_MISSES.filter(k => targeted.some(f => f.at === k && f.got === f.want));
  if (fixed.length) console.log(`     ねらいどおりになった：${fixed.join("・")}（KNOWN_FOLLOW_MISSES から外す）`);
  const unexpected = missed.filter(f => !KNOWN_FOLLOW_MISSES.includes(f.at)).map(f => `${f.at}（${f.kind} → ${f.got}）`);
  assert.deepEqual(unexpected, [], "KNOWN_FOLLOW_MISSES に無い通が、ねらいとずれた");
});

test("あとの通の見分け：ほかの種類は、どう読まれたかの数（落とさない）", () => {
  const others = follows.filter(f => !f.want);
  const kinds = Object.entries(tally(others.map(f => f.kind))).sort((a, b) => b[1] - a[1]);
  for (const [kind, n] of kinds) {
    console.log(`     ${kind}（${n}通）：${tallyText(tally(others.filter(f => f.kind === kind).map(f => SAY[f.got] ?? f.got)))}`);
  }
});

// ---------------------------------------------------------------- 7. 問いへの答え
test("問いへの答え：アプリの問いから問いを当て、matchAnswer で選択肢に当てはまった数（種類ごと。落とさない）", () => {
  const rows = [];
  for (const x of convo) x.turns.forEach((t, i) => {
    if (i === 0 || t.after !== "問いに答える") return;
    const q = questionOf(t.app);
    const m = q ? matchAnswer(q, t.text) : null;
    rows.push({ at: turnKey(x, i), kind: t.kind, q: q?.id ?? null, hit: !!m });
  });
  const noQ = rows.filter(r => !r.q).map(r => r.at);
  const kinds = Object.entries(tally(rows.map(r => r.kind))).sort((a, b) => b[1] - a[1]);
  const per = kinds.map(([kind, n]) => `${kind} ${rows.filter(r => r.kind === kind && r.hit).length}/${n}`).join("・");
  console.log(`     選択肢に当てはまった数／通の数：${per}。合わせて ${rows.filter(r => r.hit).length}/${rows.length}`);
  console.log(`     問いの種類：${tallyText(tally(rows.map(r => r.q ?? "（表に無い）")))}`);
  if (noQ.length) console.log(`     問いが表に無い通（数えたが、当てはめていない）：${noQ.join("・")}`);
  assert.ok(rows.length > 0, "問いに答える通が無い");
});

// ---------------------------------------------------------------- 8. 長さの印
test("長さの印：S〜XL が字数と合い、字数が最初の1通の空白と改行を除いた字数と合う", () => {
  const ranges = {};
  for (const x of S) {
    const n = charsOf(x.turns[0].text);
    assert.equal(x.chars, n, `${x.id}: 字数 ${x.chars} と数え直した ${n} が違う`);
    const [lo, hi] = LEN_RANGES[x.len];
    assert.ok(n >= lo && n <= hi, `${x.id}: ${x.len} なのに ${n}字（${lo}〜${hi}字）`);
    const r = ranges[x.len] || (ranges[x.len] = [Infinity, -Infinity]);
    r[0] = Math.min(r[0], n); r[1] = Math.max(r[1], n);
  }
  console.log(`     字数の幅：${Object.keys(LEN_RANGES).filter(k => ranges[k]).map(k => `${k} ${ranges[k][0]}〜${ranges[k][1]}字`).join("・")}`);
});

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} consult talk sample tests passed`);
process.exit(fail ? 1 : 0);
