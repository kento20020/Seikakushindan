// node tests/consult_read.test.mjs
// 案D「書いて、足りない分だけ聞く」の中身（画面なし）のテスト。説明：docs/consult-reading.md、docs/ui-design-thinking.md §6
//  - 試作の10件（§6.3）：書いた文 → 規則で読めた項目 → 正解の入力から答える形で問に答える → 最後の一手が judge(正解) と同じ・問は3つまで
//  - 規則の読み取り：打ち消し・「言われた」・「」の発言者・時間の言葉・既読無視・安全の言葉
//  - clef.js：質問の組の形、返り値の読み方（高い確率・低い確率・unknown・noul）
//  - extract.js：規則と Clef の組み合わせ（一致・食い違い・Clef なし・確率が低い・安全は規則）
//  - needed.js：判定の写しが judge と同じ（総当たり・抜き取り）、一手の分かれ方が総当たりと同じ、聞く問の決まり、最悪の場合の速さ
// 時刻は使わない（深夜かどうかは入力 lateNight で渡す）ので、実行環境の時差に左右されない。
import assert from "node:assert/strict";
import { extractRules, elapsedOfHours, normalizeText } from "../js/consult/extract_rules.js";
import { clefQuestions, clefRequest, parseClefAnswers, CLEF_THRESHOLD, CLEF_QUESTION_TABLE, UNKNOWN } from "../js/consult/clef.js";
import { readText, READ_KEYS } from "../js/consult/extract.js";
import {
  nextQuestion, runQuestions, analyzeKnown, applyAnswer, finalInput, decide, fastPhase, fastAction, clearCache,
  ASKABLE, SAME_AS, SCENES, MAX_QUESTIONS,
} from "../js/consult/needed.js";
import { judge, classifyPhase, normalizeInput } from "../js/consult/judge.js";
import { SELF_HARM_RE, PARTNER_THREAT_RE } from "../js/consult/texts.js";
import { GROUPS } from "../js/ui/consult_state.js";
import { READ_CASES, answerFromTruth } from "./fixtures/consult_read_cases.mjs";
import { CASES as JUDGE_CASES } from "./fixtures/consult_cases.mjs";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

/** 決まった並びの乱数（mulberry32） */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- 1. 試作の10件（§6.3）
const summary = [];
for (const c of READ_CASES) {
  test(`10件：${c.name}「${c.text.length > 24 ? c.text.slice(0, 24) + "…" : c.text}」`, () => {
    const r = extractRules(c.text);
    const t = normalizeInput(c.truth);
    // 読めてほしい項目は読めている
    for (const [k, v] of Object.entries(c.read)) assert.equal(r.fields[k], v, `読めてほしい：${k}`);
    // 読めた項目は正解と同じ（読み違いがない）
    for (const [k, v] of Object.entries(r.fields)) assert.equal(v, t[k], `読み違い：${k}`);
    for (const k of Object.keys(r.fields)) assert.ok(typeof r.evidence[k] === "string" && r.evidence[k].length > 0, `根拠の言葉：${k}`);
    const run = runQuestions({ ...r.fields, ...c.context }, answerFromTruth(c.truth));
    const want = judge(c.truth).action;
    console.log(`     読めた：${JSON.stringify(r.fields)}`);
    console.log(`     問（${run.asked.length}）：${run.asked.map((q, i) => `${q.text}→${run.picks[i].label}`).join(" / ") || "なし"}`);
    console.log(`     一手：${run.result.action}（正解 ${want}）`);
    assert.ok(run.asked.length <= MAX_QUESTIONS, "問は3つまで");
    assert.equal(run.result.action, want);
    summary.push([c.id, run.asked.length, run.result.action === want]);
  });
}
test("10件：すべて正しい一手、問は平均3以下", () => {
  assert.equal(summary.length, READ_CASES.length);
  assert.ok(summary.every(([, , ok]) => ok));
  const n = summary.reduce((s, [, q]) => s + q, 0);
  console.log(`     問の合計 ${n}（平均 ${(n / summary.length).toFixed(1)}）：${summary.map(([id, q]) => `${id}=${q}`).join(" ")}`);
});

// ---------------------------------------------------------------- 2. 規則の読み取り
const R = (text) => extractRules(text).fields;
test("打ち消し：「別れたいわけじゃない」は本人の希望にも別れ話にもしない", () => {
  const f = R("別れたいわけじゃないけど、彼に距離置きたいって言われた");
  assert.equal(f.partnerLast, "space");
  assert.equal(f.intent, undefined);
  assert.equal(R("彼から「別れたいわけじゃない」って来た").partnerLast, undefined);
  assert.equal(R("謝りたいわけじゃないけど話したい").intent, "tell");
  assert.equal(R("私が悪いとは思わない。彼が約束を破った").cause, "partner");
});
test("「言われた」は相手の言葉：本人の希望と取り違えない", () => {
  assert.deepEqual(R("彼に距離置きたいって言われた"), { lastSender: "partner", partnerLast: "space" });
  assert.equal(R("ちょっと距離置きたいと思ってる").intent, "request_space");
  assert.equal(R("彼に謝りたいって言われた").intent, undefined);
  assert.equal(R("彼に謝りたいって言われた").partnerLast, "apology");
  // 友達の言葉は恋人の言葉にしない
  assert.deepEqual(R("友達に謝ったほうがいいって言われた"), {});
  assert.equal(R("彼から「別れよう」って言われた").partnerLast, "breakup");
});
test("「」の発言者：前の主語と後ろの動詞で決める", () => {
  assert.deepEqual(R("最後に私が「もういいよ」って送った"), { lastSender: "self", selfLast: "attack" });
  assert.equal(R("彼から「もういい」って来た").lastSender, "partner");
  assert.equal(R("彼から「もういい」って来た").partnerLast, "attack");
  const f = R("彼に「ごめん」って送ったのに3時間既読無視");
  assert.equal(f.lastSender, "self"); assert.equal(f.selfLast, "apology"); assert.equal(f.elapsed, "lt3h"); assert.equal(f.ongoing, false);
  assert.equal(R("「落ち着いたら話そう」って送って半日たった").selfLast, "hold");
  assert.equal(R("「落ち着いたら話そう」って送って半日たった").lastSender, "self");
  assert.equal(R("彼から「明日話そう」ってきた").partnerLast, "talk_proposal");
  // 後のやりとりが最後：相手の謝罪 → 本人の謝罪 → 既読無視
  const g = R("彼から「ごめん」って来て、私も「こっちこそごめん」って返したけど、そこから既読無視");
  assert.equal(g.lastSender, "self"); assert.equal(g.partnerLast, "apology"); assert.equal(g.selfLast, "apology");
  // 「」なしの引用
  assert.equal(R("昨日彼からごめんって来たけど").partnerLast, "apology");
});
test("時間の言葉 → 経過の4区分（最後のやりとりからの時間を優先）", () => {
  assert.equal(R("さっき彼からLINEが来た").elapsed, "lt3h");
  assert.equal(R("送ってから2時間返事が来ない").elapsed, "lt3h");
  assert.equal(R("5時間既読無視されてる").elapsed, "3h_12h");
  assert.equal(R("昨日の夜に送ったけど既読無視").elapsed, "12h_2d");
  assert.equal(R("冷戦3日目。どうしたらいい").elapsed, "ge3d");
  assert.equal(R("1週間連絡してない").elapsed, "ge3d");
  assert.equal(R("3日くらい冷戦状態だったんだけど、さっき彼から「明日のごはんどうする？」って普通に来た").elapsed, "lt3h");
  assert.equal(R("1週間前に喧嘩して、昨日私から連絡したけど返事がない").elapsed, "12h_2d");
  // 付き合っている長さ・喧嘩していた長さは経過時間にしない
  assert.equal(R("付き合って2年。昨日から既読無視されてる").elapsed, "12h_2d");
  assert.equal(R("昨日、3時間くらい電話で喧嘩した").elapsed, "12h_2d");
  assert.equal(R("23時くらいに言い合いになった").elapsed, undefined);
  // 全角数字も読む
  assert.equal(R("２時間前に送ったけど未読のまま").elapsed, "lt3h");
  // 区切り（consult_state.js の GROUPS.elapsed：3時間以内／半日以内／1〜2日／3日以上）
  assert.deepEqual([0.5, 3, 3.5, 12, 13, 48, 71, 72].map(elapsedOfHours), ["lt3h", "lt3h", "3h_12h", "3h_12h", "12h_2d", "12h_2d", "12h_2d", "ge3d"]);
});
test("既読無視・未読無視・返事が来ない → 最後は自分、やりとりは止まっている", () => {
  for (const s of ["既読無視されてる", "未読無視が続いてる", "返事が来ない", "返ってこない", "既読スルーされた", "返事がない"]) {
    const f = R(s);
    assert.equal(f.lastSender, "self", s); assert.equal(f.ongoing, false, s);
  }
  // 返していない → 最後は相手
  assert.equal(R("彼からLINE来てるけど返せてない").lastSender, "partner");
  assert.equal(R("彼からLINE来てるけど返せてない").ongoing, false);
});
test("言い合いの最中／止まっている／仲直り／温度／くり返し", () => {
  assert.equal(R("今まさにLINEで言い合ってる。腹立つ").ongoing, true);
  assert.equal(R("今まさにLINEで言い合ってる。腹立つ").selfTemp, "high");
  assert.notEqual(R("今朝言い合いになって、そのまま仕事に来た").ongoing, true);
  assert.equal(R("会って喧嘩したあと、帰ってから彼から来た").ongoing, false);
  assert.equal(R("仲直りしたけど、またモヤモヤしてる").afterMakeup, true);
  assert.equal(R("仲直りしたい").afterMakeup, undefined);
  assert.equal(R("仲直りしたくて昨日LINE送ったけど返事がない").afterMakeup, undefined);
  assert.equal(R("仲直りしたかったのに、また言い返しちゃった").afterMakeup, undefined);
  assert.equal(R("仲直りしたら、ちゃんと話したい").afterMakeup, undefined);
  assert.equal(R("仲直りしたから安心してたのに、またモヤモヤ").afterMakeup, true);
  assert.equal(R("仲直りしたい").goal, "reconcile");
  assert.equal(R("彼が怒ってるけど私は冷静").selfTemp, "calm");
  assert.equal(R("怒ってたけど少し落ち着いてきた").selfTemp, "cooling");
  assert.equal(R("毎回同じことで喧嘩になる").repeat, true);
  assert.equal(R("初めての喧嘩").repeat, false);
  assert.equal(R("すぐ電話したい").intent, undefined, "「電話したい」は「話したい」ではない");
  assert.equal(R("お互い言いすぎた").cause, "both");
});
test("安全の言葉：texts.js の SELF_HARM_RE・PARTNER_THREAT_RE と同じ結果", () => {
  for (const s of ["死にたい", "消えたい…", "別れるなら死ぬって言われた", "普通の相談", "", "自殺したいくらいつらい"]) {
    const r = extractRules(s);
    assert.equal(r.safety.selfHarm, SELF_HARM_RE.test(s), s);
    assert.equal(r.safety.partnerThreat, PARTNER_THREAT_RE.test(s), s);
  }
  assert.equal(extractRules("死にたい").safety.selfHarm, true);
  assert.equal(extractRules("別れるなら死ぬって言われた").safety.partnerThreat, true);
});
test("読み取り：同じ文なら同じ結果、空の文は何も読まない、値は §1 の値だけ", () => {
  const s = "3日くらい冷戦状態だったんだけど、さっき彼から「明日のごはんどうする？」って普通に来た。";
  assert.deepEqual(extractRules(s), extractRules(s));
  assert.deepEqual(extractRules("").fields, {});
  assert.deepEqual(extractRules(null).fields, {});
  assert.equal(normalizeText("『２時間』"), "「2時間」");
  const ALLOWED = { ...ASKABLE, afterMakeup: [false, true] };
  for (const c of READ_CASES) for (const [k, v] of Object.entries(extractRules(c.text).fields)) {
    assert.ok(READ_KEYS.includes(k), k); assert.ok(ALLOWED[k].includes(v), `${k}=${v}`);
  }
});

// ---------------------------------------------------------------- 3. clef.js
test("Clef：質問の組の形（ID は英数字と _、choice には unknown、項目は読み取りの項目）", () => {
  const qs = clefQuestions();
  const ids = Object.keys(qs);
  assert.ok(ids.length >= 8 && ids.length <= 12, `約10問：${ids.length}`);
  for (const [id, q] of Object.entries(qs)) {
    assert.match(id, /^[A-Za-z0-9_]+$/, id);
    assert.ok(READ_KEYS.includes(id), id);
    assert.ok(typeof q.instructions === "string" && q.instructions.length > 10, id);
    assert.ok(["choice", "noul"].includes(q.type), id);
    if (q.type === "choice") {
      assert.ok(UNKNOWN in q.criteria, `${id} に unknown`);
      assert.ok(Object.keys(q.criteria).length >= 3 && Object.keys(q.criteria).length <= 255, id);
      // 選択肢の値は判定の入力の値（unknown を除く）
      for (const k of Object.keys(q.criteria)) if (k !== UNKNOWN) assert.ok(ASKABLE[id].includes(k), `${id}.${k}`);
    } else {
      assert.deepEqual(Object.keys(q.criteria), ["true", "false"]);
    }
  }
  assert.ok(Object.keys(qs).length <= 64, "公式の上限 64 問");
  assert.deepEqual(clefQuestions(), clefQuestions(), "毎回同じ");
  const body = clefRequest("既読無視されてる");
  assert.deepEqual(Object.keys(body), ["model", "state", "questions"]);
  assert.equal(body.model, "clef"); assert.equal(body.state, "既読無視されてる");
  assert.equal(clefRequest("a", { model: "clef-flash" }).model, "clef-flash");
  assert.throws(() => clefRequest("a", { model: "gpt" }));
  assert.equal(CLEF_THRESHOLD, 0.8);
  assert.equal(CLEF_QUESTION_TABLE.length, Object.keys(qs).length);
});
// 公式の出力スキーマの形（schema-output.json）
const choiceAns = (choice, p, rest = {}) => ({ type: "choice", choice, probabilities: { [choice]: p, ...rest }, confidence: p });
const SAMPLE = {
  model: "clef",
  answers: {
    lastSender: choiceAns("self", 0.93, { partner: 0.04, unknown: 0.03 }),
    elapsed: choiceAns("lt3h", 0.62, { "3h_12h": 0.3, unknown: 0.08 }),   // 低い → 埋めない
    partnerLast: choiceAns("unknown", 0.9, { none: 0.1 }),                 // 分からない → 埋めない
    selfTemp: choiceAns("high", 0.8),                                      // ちょうど基準 → 埋める
    cause: choiceAns("someone", 0.99),                                     // 知らない選択肢 → 使わない
    ongoing: { type: "noul", noul: 0.05 },                                 // いいえ → false
    repeat: { type: "noul", noul: 0.95 },                                  // はい → true
    afterMakeup: { type: "noul", noul: 0.5 },                              // 迷い → 埋めない
  },
  usage: { input_tokens: 1200, output_tokens: 0 },
};
test("Clef：返り値の読み方（高い確率・低い確率・unknown・noul）", () => {
  const r = parseClefAnswers(SAMPLE);
  assert.deepEqual(r.fields, { lastSender: "self", selfTemp: "high", ongoing: false, repeat: true });
  assert.deepEqual(r.low.sort(), ["afterMakeup", "elapsed"]);
  assert.deepEqual(r.unknown, ["partnerLast"]);
  assert.equal(r.confidence.lastSender, 0.93);
  assert.equal(r.confidence.elapsed, 0.62);
  assert.equal(r.confidence.ongoing, 0.95);
  assert.equal(r.confidence.afterMakeup, 0.5);
  assert.ok(!("cause" in r.fields));
  // 基準を変える
  assert.equal(parseClefAnswers(SAMPLE, { threshold: 0.6 }).fields.elapsed, "lt3h");
  assert.equal(parseClefAnswers(SAMPLE, { threshold: 0.95 }).fields.lastSender, undefined);
  assert.equal(parseClefAnswers(SAMPLE, { threshold: 0.95 }).fields.ongoing, false, "0.05 ≤ 1 − 0.95");
});
test("Clef：形の違いに強い（REST の包み・choice が無い・数だけの noul・空）", () => {
  assert.deepEqual(parseClefAnswers({ result: SAMPLE, success: true, errors: [], messages: [] }).fields, parseClefAnswers(SAMPLE).fields);
  const r = parseClefAnswers({ answers: { lastSender: { probabilities: { self: 0.1, partner: 0.85, unknown: 0.05 } }, ongoing: 0.9, repeat: { probability: 0.1 } } });
  assert.deepEqual(r.fields, { lastSender: "partner", ongoing: true, repeat: false });
  assert.deepEqual(parseClefAnswers(null).fields, {});
  assert.deepEqual(parseClefAnswers({}).fields, {});
  assert.deepEqual(parseClefAnswers({ answers: { lastSender: "self" } }).fields, {}, "確率が無い答えは使わない");
  assert.deepEqual(parseClefAnswers({ answers: { ongoing: { noul: 1.5 } } }).fields, {}, "0〜1 の外は使わない");
});

// ---------------------------------------------------------------- 4. extract.js（規則＋Clef）
test("組み合わせ：Clef なしは規則だけ", () => {
  const r = readText("既読無視されてる");
  assert.deepEqual(r.fields, { lastSender: "self", ongoing: false });
  assert.deepEqual(r.sources, { lastSender: "rules", ongoing: "rules" });
  assert.deepEqual(r.conflicts, []); assert.deepEqual(r.lowConfidence, []); assert.deepEqual(r.confidence, {});
  assert.equal(r.evidence.lastSender, "既読無視され");
});
test("組み合わせ：一致は both、食い違いは埋めない、片方だけは埋める、確率が低いものは目立たせる", () => {
  const clef = { fields: { lastSender: "self", ongoing: true, elapsed: "12h_2d" }, confidence: { lastSender: 0.9, ongoing: 0.85, elapsed: 0.88, selfTemp: 0.6 }, low: ["selfTemp"], unknown: [] };
  const r = readText("既読無視されてる", { clef });
  assert.deepEqual(r.fields, { lastSender: "self", elapsed: "12h_2d" });
  assert.deepEqual(r.sources, { lastSender: "both", elapsed: "clef" });
  assert.deepEqual(r.conflicts, ["ongoing"]);
  assert.deepEqual(r.conflictValues, { ongoing: { rules: false, clef: true } });
  assert.deepEqual(r.lowConfidence, ["selfTemp"]);
  assert.equal(r.confidence.elapsed, 0.88);
  assert.ok(!("ongoing" in r.evidence), "食い違った項目の根拠は出さない");
  // Clef の生の返り値も読める
  const raw = readText("既読無視されてる", { clef: SAMPLE });
  assert.equal(raw.sources.lastSender, "both");
  assert.equal(raw.sources.repeat, "clef");
  assert.deepEqual(raw.conflicts, []);
  assert.ok(raw.lowConfidence.includes("elapsed"));
});
test("組み合わせ：安全は規則が常に効く（Clef の答えに関係なく）", () => {
  const clef = { fields: { ongoing: false }, confidence: {}, low: [], unknown: [] };
  assert.equal(readText("もう死にたい", { clef }).safety.selfHarm, true);
  assert.equal(readText("もう死にたい").safety.selfHarm, true);
  assert.equal(readText("別れるなら死ぬって言われた", { clef: SAMPLE }).safety.partnerThreat, true);
  assert.deepEqual(readText("普通の相談", { clef: SAMPLE }).safety, { selfHarm: false, partnerThreat: false });
});

// ---------------------------------------------------------------- 5. needed.js：判定の写しが judge と同じ
test("局面の写し：classifyPhase と全部の組み合わせで同じ", () => {
  let n = 0;
  for (const lastSender of ASKABLE.lastSender) for (const ongoing of ASKABLE.ongoing) for (const intent of ASKABLE.intent)
    for (const partnerLast of ASKABLE.partnerLast) for (const elapsed of ASKABLE.elapsed) for (const selfLast of ASKABLE.selfLast)
      for (const selfTemp of ASKABLE.selfTemp) for (const afterMakeup of [false, true]) for (const repeat of [false, true]) for (const talkScheduled of [false, true]) {
        const x = { lastSender, ongoing, intent, partnerLast, elapsed, selfLast, selfTemp, afterMakeup, repeat, talkScheduled };
        assert.equal(fastPhase(x), classifyPhase(x), JSON.stringify(x));
        n++;
      }
  assert.equal(fastPhase({ danger: true }), null);
  console.log(`     ${n} 通り`);
});
const DOMAIN_SIDES = [null, ["A", "sure"], ["B", "sure"], ["A", "observed"], ["B", "observed"], ["A", "est"], ["B", "est"]];
function randomInput(rand, withContext) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const x = {};
  for (const [f, vs] of Object.entries(ASKABLE)) x[f] = pick(vs);
  x.afterMakeup = rand() < 0.2; x.talkScheduled = rand() < 0.1;
  if (withContext) {
    x.lateNight = rand() < 0.3; x.severity = pick(["small", "large"]); x.medium = pick(["text", "call", "in_person"]);
    for (const who of ["partner", "self"]) {
      x[who] = {};
      for (let d = 1; d <= 8; d++) { const s = rand() < (who === "partner" ? 0.5 : 0.35) ? pick(DOMAIN_SIDES) : null; if (s) x[who][d] = { side: s[0], conf: s[1] }; }
    }
  }
  return x;
}
test("一手の写し：judge と同じ（§10 の37件＋抜き取り 12,000 件。8領域・深夜・喧嘩の大きさ・場を含む）", () => {
  for (const [id, input] of JUDGE_CASES) assert.equal(fastAction(input), judge(input).action, id);
  const rand = rng(20261017);
  for (let i = 0; i < 12000; i++) {
    const x = randomInput(rand, i % 2 === 1);
    assert.equal(fastAction(x), judge(x).action, JSON.stringify(x));
  }
  assert.equal(fastAction({ danger: true }), "safety");
});
test("値のまとめ（SAME_AS）：まとめた値どうしは、どの入力でも同じ一手", () => {
  const rand = rng(7);
  for (let i = 0; i < 1500; i++) {
    const x = randomInput(rand, true);
    for (const [f, map] of Object.entries(SAME_AS)) for (const [v, r] of Object.entries(map)) {
      assert.equal(judge({ ...x, [f]: v }).action, judge({ ...x, [f]: r }).action, `${f}: ${v} と ${r}`);
    }
  }
});

// ---------------------------------------------------------------- 6. needed.js：一手の分かれ方と聞く問の決まり（総当たりで確かめる）
/** 分からない項目を、まとめずに全部の値で judge に通した一手の分かれ方（項目ごと・値の代表ごと） */
function bruteForce(known) {
  const ctx = normalizeInput(Object.fromEntries(Object.entries(known).filter(([k]) => !(k in ASKABLE) || known[k] !== undefined)));
  const unknown = Object.keys(ASKABLE).filter(f => known[f] === undefined && (f !== "repeat" || ctx.afterMakeup));
  const total = new Map(), per = Object.fromEntries(unknown.map(f => [f, new Map()]));
  const rep = (f, v) => SAME_AS[f]?.[v] ?? v;
  const rows = [];
  (function rec(i, cur) {
    if (i === unknown.length) {
      const a = judge({ ...known, ...cur }).action;
      rows.push([cur, a]);
      total.set(a, (total.get(a) || 0) + 1);
      for (const f of unknown) { const m = per[f]; const v = rep(f, cur[f]); if (!m.has(v)) m.set(v, new Map()); m.get(v).set(a, (m.get(v).get(a) || 0) + 1); }
      return;
    }
    for (const v of ASKABLE[unknown[i]]) rec(i + 1, { ...cur, [unknown[i]]: v });
  })(0, {});
  return { total, per, rows, unknown };
}
const sortMap = (m) => [...m].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
const STATES = [
  { name: "P1 の読み取り", known: { lastSender: "self", selfLast: "attack", elapsed: "lt3h", ongoing: false, lateNight: true } },
  { name: "紛らわしい2 の読み取り", known: { lastSender: "partner", partnerLast: "apology", elapsed: "12h_2d", ongoing: false } },
  { name: "返事待ち・8領域あり・深夜", known: { lastSender: "self", ongoing: false, intent: "none", selfLast: "none", lateNight: true,
    partner: { 1: { side: "A", conf: "observed" }, 2: { side: "A", conf: "est" }, 3: { side: "A", conf: "sure" } }, self: { 3: { side: "A", conf: "sure" } } } },
  { name: "仲直りしたけどモヤモヤ", known: { afterMakeup: true, lastSender: "none", partnerLast: "none", ongoing: false, intent: "none" } },
  { name: "謝りたい・原因は自分・喧嘩は大きい", known: { intent: "apologize", cause: "self", ongoing: false, severity: "large", selfTemp: "cooling" } },
];
for (const st of STATES) {
  test(`一手の分かれ方が総当たりと同じ：${st.name}`, () => {
    clearCache();
    const an = analyzeKnown(st.known), bf = bruteForce(st.known);
    assert.deepEqual(sortMap(an.actions), sortMap(bf.total));
    assert.deepEqual(Object.keys(an.fields).sort(), [...bf.unknown].sort());
    for (const f of bf.unknown) {
      assert.deepEqual(sortMap(an.fields[f].counts).map(([v, m]) => [v, sortMap(m)]), sortMap(bf.per[f]).map(([v, m]) => [v, sortMap(m)]), f);
    }
    // 聞く問の項目は、その項目だけを変えると一手が変わる組み合わせがある（一手が変わらない項目は聞かない）
    const q = nextQuestion(st.known);
    console.log(`     一手の候補 ${an.actions.size}、次の問：${q ? q.id : "なし"}（${bf.rows.length} 通り）`);
    if (q && q.id !== "scene") {
      const f = q.id, key = (cur) => JSON.stringify(Object.entries(cur).filter(([k]) => k !== f).sort());
      const groups = new Map();
      for (const [cur, a] of bf.rows) { const k = key(cur); if (!groups.has(k)) groups.set(k, new Set()); groups.get(k).add(a); }
      assert.ok([...groups.values()].some(s => s.size > 1), `${f} を変えても一手が変わらない`);
    }
  });
}
test("一手が変わらない項目は聞かない（総当たり：どの値でも一手が同じ項目は選ばれない）", () => {
  // 原因だけが分からず、原因で一手が変わらない場面：相手から距離・別れの話（space.partner）
  const k = { lastSender: "partner", partnerLast: "space", elapsed: "lt3h", ongoing: false, intent: "none", selfLast: "none", selfTemp: "cooling", goal: "reconcile" };
  assert.equal(nextQuestion(k), null);
  // 全部分かっていれば聞かない
  assert.equal(nextQuestion(finalInput({})), null);
  // 抜き取り：返ってきた問の項目は、総当たりで一手を変えうる
  const rand = rng(99);
  let checked = 0;
  for (let i = 0; i < 25; i++) {
    const full = randomInput(rand, i % 3 === 0);
    const known = { ...full };
    // 3〜4項目を分からないことにする（総当たりが重くならないよう、点数に効く項目を中心に）
    const hide = ["cause", "goal", "selfTemp", "elapsed", "selfLast", "partnerLast"].filter(() => rand() < 0.55).slice(0, 4);
    for (const f of hide) delete known[f];
    const q = nextQuestion(known);
    if (!q || q.id === "scene") continue;
    const bf = bruteForce(known), f = q.id;
    const key = (cur) => JSON.stringify(Object.entries(cur).filter(([kk]) => kk !== f).sort());
    const groups = new Map();
    for (const [cur, a] of bf.rows) { const kk = key(cur); if (!groups.has(kk)) groups.set(kk, new Set()); groups.get(kk).add(a); }
    assert.ok([...groups.values()].some(s => s.size > 1), `${f}：${JSON.stringify(known)}`);
    checked++;
  }
  console.log(`     ${checked} 件で確かめた`);
  assert.ok(checked >= 5);
});
test("分かっている項目は聞かない・危ないサインは聞かない・同じ入力なら同じ問", () => {
  const rand = rng(3);
  for (let i = 0; i < 200; i++) {
    const full = randomInput(rand, i % 2 === 0);
    const known = Object.fromEntries(Object.entries(full).filter(([k]) => !(k in ASKABLE) || rand() < 0.5));
    const q = nextQuestion(known);
    if (q && q.id !== "scene") assert.equal(known[q.id], undefined, q.id);
    if (q) assert.notEqual(q.id, "danger");
    clearCache();
    assert.deepEqual(nextQuestion(known), q, "覚えを捨てても同じ問");
  }
  assert.equal(nextQuestion({ danger: true }), null);
  assert.equal(nextQuestion({ danger: true, lastSender: "self" }), null);
});
test("場面の問：場面が分からないときに最初に聞く（4つ＋ほかの場面）、答えると場面の項目が埋まる", () => {
  for (const k of [{}, { ongoing: false }, { elapsed: "12h_2d", ongoing: false }, { selfTemp: "high" }, { cause: "self" }]) {
    const q = nextQuestion(k);
    assert.equal(q.id, "scene", JSON.stringify(k));
    assert.equal(q.options.length, 8); assert.equal(q.primary, 4); assert.equal(q.moreLabel, "ほかの場面");
  }
  // 場面が分かれば場面の問は出ない
  for (const k of [{ lastSender: "self" }, { intent: "apologize" }, { ongoing: true }, { afterMakeup: true }, { partnerLast: "space" }]) {
    assert.notEqual(nextQuestion(k)?.id, "scene", JSON.stringify(k));
  }
  assert.notEqual(nextQuestion({}, ["scene"])?.id, "scene", "一度聞いたら聞かない");
  assert.deepEqual(SCENES.slice(0, 4).map(s => s.label), ["送ったけど、返事が来ない", "相手から連絡が来た（まだ返していない）", "いま言い合いの最中", "お互い連絡していない"]);
  for (const s of SCENES) {
    const k = applyAnswer({}, s.patch);
    assert.notEqual(nextQuestion(k, ["scene"])?.id, "scene");
    for (const [f, v] of Object.entries(s.patch)) assert.ok((ASKABLE[f] || [false, true]).includes(v), `${s.id}.${f}`);
  }
  // 場面ごとの局面（docs/ui-design-thinking.md §3.1 の I4 の表）
  const phase = (id, extra = {}) => classifyPhase({ ...SCENES.find(s => s.id === id).patch, ...extra });
  assert.equal(phase("waiting", { elapsed: "lt3h" }), "waiting_partner");
  assert.equal(phase("partner_msg", { partnerLast: "casual" }), "partner_msg.a");
  assert.equal(phase("heated"), "heated");
  assert.equal(phase("cold_war", { elapsed: "ge3d" }), "cold_war.long");
  assert.equal(phase("apologize"), "want_apologize");
  assert.equal(phase("tell"), "before_talk");
  assert.equal(phase("after_makeup"), "after_makeup.once");
  assert.equal(phase("space"), "space.partner");
});
test("合計3問まで（場面の問も含む）。決まらなければ打ち切り、埋まった項目と既定値で判定", () => {
  assert.equal(nextQuestion({}, ["scene", "intent", "elapsed"]), null);
  assert.equal(nextQuestion({ lastSender: "self" }, [{ id: "a" }, { id: "b" }, { id: "c" }]), null);
  assert.equal(nextQuestion({ lastSender: "self" }, ["a"], { maxTotal: 1 }), null);
  const rand = rng(11);
  for (let i = 0; i < 60; i++) {
    const truth = randomInput(rand, i % 2 === 0);
    const known = Object.fromEntries(Object.entries(truth).filter(([k]) => !(k in ASKABLE) || rand() < 0.3));
    const run = runQuestions(known, answerFromTruth(truth));
    assert.ok(run.asked.length <= MAX_QUESTIONS);
    assert.equal(new Set(run.asked.map(q => q.id)).size, run.asked.length, "同じ問は2度聞かない");
    assert.deepEqual(run.result, decide(run.known));
    assert.deepEqual(decide(run.known), judge(finalInput(run.known)));
  }
});
test("問の言葉と選択肢：consult_state.js の GROUPS の表示に合わせる、patch は判定の入力の値", () => {
  const labelsOf = (g, values) => values.map(v => GROUPS[g].options.find(o => o[0] === v)[1]);
  // 経過・したいこと：GROUPS と同じ表示
  const check = (known, id, group, values) => {
    const qq = nextQuestion(known);
    assert.equal(qq?.id, id, JSON.stringify(known));
    assert.deepEqual(qq.options.map(o => o.label), labelsOf(group, values));
    assert.deepEqual(qq.options.map(o => o.patch[id]), values);
  };
  check({ lastSender: "partner", partnerLast: "space", ongoing: false, intent: "none" }, "elapsed", "elapsed", ["lt3h", "3h_12h", "12h_2d", "ge3d"]);
  check({ lastSender: "partner", partnerLast: "apology", ongoing: false, elapsed: "12h_2d", selfLast: "none", selfTemp: "cooling", cause: "unknown", goal: "reconcile" }, "intent", "intent", ["apologize", "tell", "request_space", "none"]);
  // 返事待ちの人に「相手の最後の一言」を聞くときは、一手が変わる距離・別れの話だけを、自然な言い方で
  const wait = nextQuestion({ lastSender: "self", ongoing: false, intent: "none", selfLast: "none", elapsed: "lt3h", selfTemp: "cooling", cause: "unknown", goal: "reconcile" });
  assert.equal(wait?.id, "partnerLast");
  assert.match(wait.text, /距離|別れ/);
  assert.deepEqual(wait.options.map(o => o.patch.partnerLast), ["none", "space", "breakup"]);
  // すべての問：選択肢の patch は判定の入力の値だけ
  const rand = rng(5);
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const full = randomInput(rand, false);
    const known = Object.fromEntries(Object.entries(full).filter(() => rand() < 0.5));
    const qq = nextQuestion(known);
    if (!qq) continue;
    seen.add(qq.id);
    assert.ok(qq.text && qq.options.length >= 2, qq.id);
    for (const o of qq.options) for (const [f, v] of Object.entries(o.patch)) assert.ok((ASKABLE[f] || [false, true]).includes(v), `${qq.id}: ${f}=${v}`);
  }
  console.log(`     出た問：${[...seen].sort().join(", ")}`);
});

// ---------------------------------------------------------------- 7. 速さ
test("速さ：最悪の場合でも1回 30ms 未満（初めての文脈で。5回の真ん中の値）", () => {
  const states = [{}, ...SCENES.map(s => s.patch), { afterMakeup: true }, { lateNight: true, intent: "none" },
    { intent: "none", partner: { 1: { side: "A", conf: "observed" }, 2: { side: "B", conf: "est" }, 3: { side: "A", conf: "sure" } }, self: { 3: { side: "A", conf: "sure" } } }];
  for (const [f, vs] of Object.entries(ASKABLE)) for (const v of vs) states.push({ [f]: v });
  for (let i = 0; i < 3; i++) { clearCache(); analyzeKnown({ lateNight: true, severity: "large" }); }   // 暖める
  const median = (fn) => { const ts = []; for (let r = 0; r < 5; r++) { clearCache(); const t0 = performance.now(); fn(); ts.push(performance.now() - t0); } return ts.sort((a, b) => a - b)[2]; };
  // 何も分からない：画面では場面の問が先に出るので数えないが、数える計算そのものの最悪として測る
  const worstAll = median(() => analyzeKnown({}));
  let worst = 0, worstState = null;
  for (const s of states) { const t = median(() => nextQuestion(s)); if (t > worst) { worst = t; worstState = s; } }
  console.log(`     何も分からないときの数え上げ ${worstAll.toFixed(1)}ms、次の問のいちばん遅い場合 ${worst.toFixed(1)}ms（${JSON.stringify(worstState)}）`);
  assert.ok(worstAll < 30, `数え上げ ${worstAll.toFixed(1)}ms`);
  assert.ok(worst < 30, `次の問 ${worst.toFixed(1)}ms`);
});

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} consult read tests passed`);
process.exit(fail ? 1 : 0);
