// node tests/consult_samples_ai.test.mjs
// AI が書いた相談文の見本155件（架空。tests/fixtures/consult_samples_ai.mjs。決定 U48）で、書いた文の読み取り（readText）と
// 安全の規則（js/consult/texts.js の SELF_HARM_RE・PARTNER_THREAT_RE）を確かめる。説明：docs/consult-reading.md §9
//  - 見本の形：155件、id が重ならない、項目は id・len・chars・safety・text だけ
//  - 155件すべてで readText が落ちずに結果（fields・safety）を返す
//  - しるし無しの139件で、安全（selfHarm・partnerThreat）が1件も true にならない（言葉を足したときの誤反応の見張り）
//  - 今拾えている3件（MUST_CATCH）は、これからも拾う
//  - 拾えていない13件は「今の弱いところ」（KNOWN_MISSES）。数を出すだけで落とさない。一覧に無いしるしありの件が拾えなくなったら落とす
//  - 長さの印（S〜XL）が字数（空白と改行を除く）と合っている
//  - 読み取りの様子（項目ごとに埋まった件数）を出す（落とさない。今の姿を残すため）
// 規則の言葉はこのテストのために変えない（足すのは持ち主と Website の決め事）。時刻は使わないので、実行環境の時差に左右されない。
import assert from "node:assert/strict";
import { readText, READ_KEYS } from "../js/consult/extract.js";
import { CONSULT_SAMPLES_AI } from "./fixtures/consult_samples_ai.mjs";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

/** 今の規則で拾えている、しるしありの件（これからも拾う） */
const MUST_CATCH = ["c230", "c292", "c428"];
/** 今の規則で拾えていない、しるしありの件（今の弱いところ。拾えるようになったら、ここから外して MUST_CATCH に足す） */
const KNOWN_MISSES = [
  "c025",   // 酔い・薬の影響
  "c069",   // 暴力（腕をつかまれた）
  "c117",   // 手を出しそう
  "c125",   // 従わせたい・罰したい
  "c215",   // 法的な手続き
  "c255",   // 監視・居場所確認（位置情報・通知の確認）
  "c256",   // こわくて本音が言えない
  "c261",   // 従わせたい・罰したい
  "c263",   // つきまとい
  "c306",   // お金の支配（給料を預かる）
  "c328",   // 法的な手続き
  "c331",   // 人格否定が続く
  "c333",   // 手を出しそう
];
/** 長さの印の字数（空白と改行を除く。書くときの目安。境目の 200・450 はどちらでもよい） */
const LEN_RANGES = { S: [1, 40], M: [80, 200], L: [200, 450], XL: [450, 900] };
/** 読み取りの項目の呼び方（docs/consult-scoring.md §1） */
const LABEL = {
  lastSender: "最後に送ったのは", elapsed: "経過", partnerLast: "相手の最後の種類", ongoing: "最中か", selfTemp: "自分の温度",
  intent: "したいこと", goal: "ゴール", cause: "原因", repeat: "くり返し", afterMakeup: "仲直りした", selfLast: "自分の最後の種類",
};

const S = CONSULT_SAMPLES_AI;
const marked = S.filter(x => x.safety.expected);
const unmarked = S.filter(x => !x.safety.expected);
const hit = (r) => r.safety.selfHarm === true || r.safety.partnerThreat === true;
const charsOf = (text) => [...String(text).replace(/\s/g, "")].length;   // サロゲートの組は1字

// ---------------------------------------------------------------- 1. 見本の形
test("見本：155件、id が重ならない、項目は id・len・chars・safety・text だけ", () => {
  assert.equal(S.length, 155, "見本の数（文を足したら、このテストと docs/consult-reading.md §9 の数も直す）");
  assert.equal(new Set(S.map(x => x.id)).size, S.length, "id が重なっている");
  for (const x of S) {
    assert.deepEqual(Object.keys(x).sort(), ["chars", "id", "len", "safety", "text"], x.id);
    assert.match(x.id, /^c\d{3}$/, x.id);
    assert.ok(typeof x.text === "string" && x.text.trim().length > 0, `${x.id}: 文が空`);
    assert.ok(x.len in LEN_RANGES, `${x.id}: 長さの印 ${x.len}`);
    assert.equal(typeof x.safety.expected, "boolean", `${x.id}: safety.expected`);
    assert.ok(Array.isArray(x.safety.kinds), `${x.id}: safety.kinds`);
    if (x.safety.expected) assert.ok(x.safety.kinds.length > 0 && x.safety.kinds.every(k => typeof k === "string" && k), `${x.id}: しるしありなのに種類が無い`);
    else assert.deepEqual(x.safety.kinds, [], `${x.id}: しるし無しなのに種類がある`);
  }
  assert.equal(marked.length, 16, "しるしありの数");
  assert.equal(unmarked.length, 139, "しるし無しの数");
  // 一覧の id は見本にあって、しるしありで、重ならない
  const ids = new Set(marked.map(x => x.id));
  for (const id of [...MUST_CATCH, ...KNOWN_MISSES]) assert.ok(ids.has(id), `${id} はしるしありの見本に無い`);
  assert.equal(new Set([...MUST_CATCH, ...KNOWN_MISSES]).size, MUST_CATCH.length + KNOWN_MISSES.length, "MUST_CATCH と KNOWN_MISSES が重なっている");
  const byLen = Object.keys(LEN_RANGES).map(k => `${k} ${S.filter(x => x.len === k).length}`).join("・");
  console.log(`     見本 ${S.length}件（${byLen}）、しるしあり ${marked.length}件・しるし無し ${unmarked.length}件`);
});

// ---------------------------------------------------------------- 2. 読み取りが落ちない
const results = new Map();   // id → readText の結果
test("readText：155件すべてで落ちずに結果（fields・safety）を返す", () => {
  const broken = [];
  for (const x of S) {
    try {
      const r = readText(x.text);
      assert.ok(r && typeof r === "object", "結果が無い");
      assert.ok(r.fields && typeof r.fields === "object", "fields が無い");
      assert.ok(r.safety && typeof r.safety.selfHarm === "boolean" && typeof r.safety.partnerThreat === "boolean", "safety の形");
      for (const k of Object.keys(r.fields)) assert.ok(READ_KEYS.includes(k), `知らない項目 ${k}`);
      for (const k of Object.keys(r.fields)) assert.ok(typeof r.evidence[k] === "string" && r.evidence[k].length > 0, `根拠の言葉が無い：${k}`);
      results.set(x.id, r);
    } catch (e) {
      broken.push(`${x.id}: ${e.message}`);
    }
  }
  assert.deepEqual(broken, [], "落ちた・形が違う件");
  assert.equal(results.size, S.length);
});

// ---------------------------------------------------------------- 3. 安全：誤反応しない
test("安全：しるし無しの139件で、selfHarm・partnerThreat が1件も true にならない", () => {
  assert.equal(results.size, S.length, "読み取りの結果がそろっていない");
  const wrong = unmarked.filter(x => hit(results.get(x.id))).map(x => `${x.id} ${JSON.stringify(results.get(x.id).safety)}`);
  console.log(`     しるし無し ${unmarked.length}件のうち、規則が反応したのは ${wrong.length}件`);
  assert.deepEqual(wrong, [], "しるし無しの文で安全の規則が反応した（言葉を足したときの誤反応）");
});

// ---------------------------------------------------------------- 4. 安全：拾えている件は拾い続ける
test("安全：今拾えている3件（c230・c292・c428）は、これからも拾う", () => {
  assert.equal(results.size, S.length, "読み取りの結果がそろっていない");
  for (const id of MUST_CATCH) {
    const r = results.get(id);
    const x = S.find(y => y.id === id);
    const which = [r.safety.selfHarm && "selfHarm", r.safety.partnerThreat && "partnerThreat"].filter(Boolean).join("・") || "なし";
    console.log(`     ${id}（${x.safety.kinds.join("・")}）→ ${which}`);
    assert.ok(hit(r), `${id} を拾えなくなった`);
  }
});

// ---------------------------------------------------------------- 5. 安全：今の弱いところ（落とさない）と、拾える件が減っていないか
test("安全：しるしありの16件 — 拾えない件は KNOWN_MISSES のものだけ（数を出す）", () => {
  assert.equal(results.size, S.length, "読み取りの結果がそろっていない");
  const caught = marked.filter(x => hit(results.get(x.id)));
  const missed = marked.filter(x => !hit(results.get(x.id)));
  console.log(`     しるしあり ${marked.length}件のうち、規則が拾ったのは ${caught.length}件、残り ${missed.length}件`);
  for (const x of missed) console.log(`       拾えない ${x.id}（${x.safety.kinds.join("・")}）${KNOWN_MISSES.includes(x.id) ? "" : " ← KNOWN_MISSES に無い"}`);
  const nowCaught = KNOWN_MISSES.filter(id => hit(results.get(id)));
  if (nowCaught.length) console.log(`     拾えるようになった：${nowCaught.join("・")}（KNOWN_MISSES から外し、MUST_CATCH に足す）`);
  const unexpected = missed.filter(x => !KNOWN_MISSES.includes(x.id)).map(x => x.id);
  assert.deepEqual(unexpected, [], "KNOWN_MISSES に無いしるしありの件が拾えなくなった");
});

// ---------------------------------------------------------------- 6. 長さの印
test("長さの印：S〜XL が字数（空白と改行を除く）と合っている", () => {
  const ranges = {};
  for (const x of S) {
    const n = charsOf(x.text);
    assert.equal(x.chars, n, `${x.id}: 字数 ${x.chars} と数え直した ${n} が違う`);
    const [lo, hi] = LEN_RANGES[x.len];
    assert.ok(n >= lo && n <= hi, `${x.id}: ${x.len} なのに ${n}字（${lo}〜${hi}字）`);
    const r = ranges[x.len] || (ranges[x.len] = [Infinity, -Infinity]);
    r[0] = Math.min(r[0], n); r[1] = Math.max(r[1], n);
  }
  console.log(`     字数の幅：${Object.keys(LEN_RANGES).map(k => `${k} ${ranges[k][0]}〜${ranges[k][1]}字`).join("・")}`);
});

// ---------------------------------------------------------------- 7. 読み取りの様子（落とさない）
test("読み取りの様子：項目ごとに埋まった件数（今の姿。落とさない）", () => {
  assert.equal(results.size, S.length, "読み取りの結果がそろっていない");
  for (const k of READ_KEYS) {
    const vals = {};
    let n = 0;
    for (const x of S) {
      const v = results.get(x.id).fields[k];
      if (v === undefined) continue;
      n++; vals[String(v)] = (vals[String(v)] || 0) + 1;
    }
    const detail = Object.entries(vals).sort((a, b) => b[1] - a[1]).map(([v, c]) => `${v} ${c}`).join("・");
    console.log(`     ${k}（${LABEL[k]}）${n}件${detail ? `：${detail}` : ""}`);
  }
  const count = (x) => Object.keys(results.get(x.id).fields).length;
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + count(x), 0) / xs.length : 0).toFixed(1);
  const none = S.filter(x => count(x) === 0).length;
  const conflicts = S.filter(x => results.get(x.id).conflicts.length > 0).length;
  console.log(`     1件あたり埋まった項目 平均 ${avg(S)}（${Object.keys(LEN_RANGES).map(k => `${k} ${avg(S.filter(x => x.len === k))}`).join("・")}）、何も埋まらない ${none}件、食い違い ${conflicts}件（Clef なし）`);
});

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} consult sample tests passed`);
process.exit(fail ? 1 : 0);
