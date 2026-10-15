// node tests/consult_responder.test.mjs
// 相談モードの回答の層（js/consult/ の config・texts・timefmt・context・card・template_responder・prompt・ai_responder・respond）のテスト。
// 説明：docs/consult-ai.md、方針：docs/consult-answer-guide.md 第2部
//  - §10 の全ケース × 2つの文体：決まった文型のカードが点検（validateCard）を通る・文面は「届きやすい」・450字以内・理由3つまで・内部の名前なし
//  - 安全ゲート、同じ文脈なら同じカード、文の長さ（全差し込み）、決まった種の入力でのカードの点検
//  - プロンプト（l1 は固定・人ごとのデータなし、l2 に数字なし、l3 に一手と相談文）
//  - AI の回答（中継をまねた fetch）、失敗したら決まった文型に戻る
//  - 問い（refineQuestions）と差分（applyPatch）、時刻の言い方（timefmt）、中継の URL（config）
import assert from "node:assert/strict";
import { CASES, CASE_TEXTS, SAME, D } from "./fixtures/consult_cases.mjs";
import { CONSULT_CONFIG, resolveAiEndpoint, currentAiEndpoint } from "../js/consult/config.js";
import { buildContext, refineQuestions, applyPatch, applyPatchToContext } from "../js/consult/context.js";
import { templateRespond, rankReasonIds, extractQuote } from "../js/consult/template_responder.js";
import { CARD_JSON_SCHEMA, validateCard, cardLength, renderCardText, LIMITS, TIME_RE } from "../js/consult/card.js";
import { buildPrompt, estimateTokens, systemPrompt, CONSULT_TEXT_MAX } from "../js/consult/prompt.js";
import { aiRespond, AiResponseError } from "../js/consult/ai_responder.js";
import { respond } from "../js/consult/respond.js";
import { recheckText, draftTimeText, timingText, localIso } from "../js/consult/timefmt.js";
import { checkDraft } from "../js/consult/draft_check.js";
import { ADJUSTMENTS, ADDONS, ACTIONS, PHASES, AVOID, HEAVY } from "../js/consult/rules.js";
import * as T from "../js/consult/texts.js";

let fail = 0, pass = 0;
const pending = [];
function test(name, fn) {
  const done = (e) => {
    if (!e) { pass++; console.log("OK   " + name); return; }
    fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  "));
  };
  try {
    const r = fn();
    if (r && typeof r.then === "function") pending.push(r.then(() => done(), done));
    else done();
  } catch (e) { done(e); }
}

const len = (s) => [...String(s)].length;
const JST = 540;
/** ケースごとの現在時刻（日本時間）。§2.12 の例に合わせて S1・C1〜C3・T20 は23時、深夜の S12・T15 は2時、朝の連絡の S3・T14 は8時、ほかは20時 */
const NOW = {
  S1: "2026-10-15T23:00:00+09:00", C1: "2026-10-15T23:00:00+09:00", C2: "2026-10-15T23:00:00+09:00", C2b: "2026-10-15T23:00:00+09:00",
  C3: "2026-10-15T23:00:00+09:00", T17a: "2026-10-15T23:00:00+09:00", T20: "2026-10-15T23:00:00+09:00",
  S12: "2026-10-16T02:00:00+09:00", T15: "2026-10-16T02:00:00+09:00", S3: "2026-10-16T08:00:00+09:00", T14: "2026-10-16T08:00:00+09:00",
};
const DEFAULT_NOW = "2026-10-15T20:00:00+09:00";
const ctxOf = (id, input, extra = {}) => buildContext({
  input, consultText: CASE_TEXTS[id] ?? "", now: new Date(NOW[id] ?? DEFAULT_NOW), tzOffset: JST, ...extra,
});
/** 内部の名前（局面・行動・補正 ID）がカードの文に出ていないか */
const INTERNAL = /[a-z]+_[a-z]+|waiting_partner|partner_msg|cold_war|(?<![A-Za-z0-9])(?:P[1-8][AB]|S[1-8][AB]|AO\d{1,2}|C1h|L1b|R3d|HG|CAP|RR|BRK)(?![A-Za-z0-9])/;
const cardStrings = (card) => [card.headline, ...card.addonLines, card.timingLine, ...card.reasons, ...card.drafts.flatMap(d => [d.label, d.text]),
  ...card.variantLines, card.doNow, card.ifReply, card.ifNoReply, card.confidenceLine,
  ...(card.safety ? [card.safety.intro, ...card.safety.steps, card.safety.closing, ...card.safety.resources.map(r => r.note)] : [])].filter(Boolean);

// ---------------------------------------------------------------- 1. §10 の全ケース
assert.equal(CASES.length, 37);
for (const register of ["casual", "polite"]) {
  for (const [id, input, phase, action] of CASES) {
    test(`§10 ${id}（${register}）：カードが点検を通る・文面は届きやすい・450字以内・理由3つまで・内部の名前なし`, () => {
      const ctx = ctxOf(id, input, { register });
      assert.equal(ctx.result.phase, phase, "buildContext を通しても判定は同じ");
      assert.equal(ctx.result.action, action);
      const card = templateRespond(ctx);
      const v = validateCard(card, ctx);
      assert.ok(v.ok, v.errors.join("\n"));
      assert.equal(card.kind, action === "safety" ? "safety" : "card");
      if (card.kind === "card") {
        assert.ok(cardLength(card) <= LIMITS.total, `カード ${cardLength(card)} 字`);
        assert.ok(card.reasons.length >= 1 && card.reasons.length <= 3);
        for (const t of card.reasons) assert.ok(len(t) <= 50, t);
        assert.ok(card.confidenceLine && card.headline);
      }
      for (const d of card.drafts) {
        // 文面はどれも「届きやすい」（ふつう・届きにくいの文面は決まった文型に入れていない）
        const c = checkDraft(d.text, { action: ctx.result.action, avoid: ctx.result.avoid });
        assert.equal(c.level, "届きやすい", `${d.text} ${JSON.stringify(c.hits)}`);
        if (["pause_with_time", "request_space"].includes(ctx.result.action)) assert.ok(TIME_RE.test(d.text), `時刻がない：${d.text}`);
      }
      for (const s of cardStrings(card)) assert.ok(!INTERNAL.test(s), `内部の名前：${s}`);
    });
  }
}

test("§10 のケース：一手ごとに文面の数が決まりどおり（待つ・書き出す・安全ゲートは0、送る一手は1〜2、長い文面の一手は1）", () => {
  for (const [id, input] of CASES) {
    const ctx = ctxOf(id, input), card = templateRespond(ctx), a = ctx.result.action;
    if (["self_calm", "safety"].includes(a) || (a === "wait_until" && !ctx.result.addons.includes("ask_feeling"))) assert.equal(card.drafts.length, 0, id);
    else if (["apology_full", "accept_space", "request_space"].includes(a)) assert.equal(card.drafts.length, 1, id);
    else if (a !== "prepare_points") assert.ok(card.drafts.length >= 1 && card.drafts.length <= 2, id);
    if (card.drafts.length === 2) assert.equal(card.drafts[1].label, "別の言い方");
  }
});

test("§2.12 の例に近い言い方：S1 は「明日の昼」に戻る1通、理由は 局面 → 相手（P2B・診断結果）→ 自分（S3A）", () => {
  const [, input] = CASES.find(c => c[0] === "S1");
  const ctx = ctxOf("S1", input), card = templateRespond(ctx);
  assert.equal(card.headline, "これ以上は送らず、「明日の昼に話したい」と1通だけ");
  assert.equal(card.drafts[0].text, "いったんここで止めて、明日の昼にちゃんと話したい。返事はいらないよ");
  assert.equal(card.reasons.length, 3);
  assert.ok(card.reasons[1].startsWith("相手は持ち帰って考える寄りです（診断結果）"));
  assert.ok(card.reasons[2].startsWith("あなたは不安なとき確かめにいきやすい傾向です（診断結果）"));
  assert.deepEqual(card.avoid, ["既読ついてるよね", "なんで無視するの", "もういい"]);
  assert.ok(card.ifNoReply.startsWith("明日の12時まで来なければ"));
  assert.ok(/はっきり/.test(card.confidenceLine));
  const rk = rankReasonIds(ctx);
  assert.equal(rk.partner[0][0], "P2B");
  assert.equal(rk.self[0][0], "S3A");
});

test("C2：原因が分からないのに謝る一手 → 文面は「きつかったと思うなら」の条件つき、謝る理由は P2A_silent、電話は付け足しの一行", () => {
  const [, input] = CASES.find(c => c[0] === "C2");
  const ctx = ctxOf("C2", input), card = templateRespond(ctx);
  assert.equal(card.drafts[0].label, "きつかったと思うなら、この1通");
  assert.ok(card.reasons.some(t => t.startsWith("相手はふだんすぐ返す寄りです（診断結果）")));
  assert.deepEqual(card.addonLines, ["そのあと『電話していい？』と聞く形で1回だけ"]);
  assert.equal(rankReasonIds(ctx).partner[0][0], "P2A_silent");
});

test("C3・S2：相手が分からないときは相手のタイプを書かず、2通りの行と「仮」の確かさ。S2 は相談文の「もういい」を引用", () => {
  const c3 = templateRespond(ctxOf("C3", SAME));
  assert.equal(c3.variantLines.length, 2);
  assert.ok(c3.variantLines[0].startsWith("相手がすぐ返すほうなら → きつかったと自分でも思う点だけ"));
  assert.ok(c3.variantLines[1].includes("上の言い方のまま"));
  assert.ok(/仮/.test(c3.confidenceLine));
  assert.ok(!c3.reasons.some(t => /相手は[^。]*寄り/.test(t)));
  const [, s2in] = CASES.find(c => c[0] === "S2");
  const s2 = templateRespond(ctxOf("S2", s2in));
  assert.ok(s2.reasons[0].startsWith("相手の最後が「もういい」で"));
  assert.ok(templateRespond(ctxOf("S2", s2in, { consultText: "相手から責められた" })).reasons[0].startsWith("相手の最後が強い言葉で"));
});

test("深夜（S12・T15）：送るのは朝。見出し・タイミングの行・文面の label が朝向け", () => {
  for (const id of ["S12", "T15"]) {
    const [, input] = CASES.find(c => c[0] === id);
    const ctx = ctxOf(id, input), card = templateRespond(ctx);
    assert.equal(ctx.result.timing, "morning");
    assert.equal(card.timingLine, T.TIMING_LINE_MORNING);
    assert.equal(card.drafts[0].label, "朝に送るならこの1通");
  }
});

// ---------------------------------------------------------------- 2. 安全ゲート
test("安全ゲート（S11）：安全のカード。#8008 があり、文面・避けたい言葉・その後・確かさは出さない。相手の「死ぬ」の脅しにはよりそいホットライン", () => {
  const ctx = ctxOf("S11", { danger: true }), card = templateRespond(ctx);
  assert.equal(card.kind, "safety");
  assert.equal(card.headline, "まず、あなたの安全が最優先です");
  assert.ok(card.safety.resources.some(r => r.contact === "#8008"));
  assert.ok(card.safety.resources.some(r => r.contact === "0120-279-889"));
  assert.ok(card.safety.resources.some(r => r.name === "よりそいホットライン"), "「死ぬ」の脅し");
  assert.ok(card.safety.intro.includes("「別れるなら死ぬ」という言葉は"));
  assert.ok(card.safety.intro.includes("仲直りの進め方や文面は出しません"));
  assert.ok(card.safety.steps.length <= 2);
  assert.equal(card.safety.closing, "安全のことなら、ここでもう少し一緒に整理できます。");
  for (const k of ["drafts", "avoid", "reasons", "variantLines", "addonLines"]) assert.deepEqual(card[k], [], k);
  for (const k of ["ifReply", "ifNoReply", "confidenceLine", "doNow", "timingLine"]) assert.equal(card[k], null, k);
  assert.ok(validateCard(card, ctx).ok);
  assert.ok(!/モラハラ|DV(?!相談)/.test(JSON.stringify(card)), "相手を分類しない");
});
test("安全ゲート：本人の自傷の示唆ならよりそいホットラインを先に、引用せず本人向けの言葉。何もなければ DV の窓口2つ", () => {
  const self = templateRespond(buildContext({ input: { danger: true }, consultText: "もう死にたい。「お前が悪い」と言われ続けてる", now: new Date(DEFAULT_NOW), tzOffset: JST }));
  assert.equal(self.safety.resources[0].name, "よりそいホットライン");
  assert.ok(!self.safety.intro.includes("お前が悪い"));
  assert.ok(self.safety.steps.some(t => t.includes("119番")));
  const plain = templateRespond(buildContext({ input: { danger: true }, consultText: "スマホを毎日見せろと言われる", now: new Date(DEFAULT_NOW), tzOffset: JST }));
  assert.deepEqual(plain.safety.resources.map(r => r.contact), ["#8008", "0120-279-889"]);
  assert.ok(plain.safety.intro.startsWith("書いてくれたこと、読みました。"));
  const forced = buildContext({ input: { danger: true }, safety: { selfHarm: true }, now: new Date(DEFAULT_NOW), tzOffset: JST });
  assert.equal(templateRespond(forced).safety.resources[0].name, "よりそいホットライン");
});

// ---------------------------------------------------------------- 3. 同じ文脈なら同じカード
test("同じ文脈なら同じカード（§10 の全ケース × 2つの文体。作り直した文脈でも、structuredClone した入力でも）", () => {
  for (const register of ["casual", "polite"]) for (const [id, input] of CASES) {
    const a = templateRespond(ctxOf(id, input, { register }));
    const b = templateRespond(ctxOf(id, structuredClone(input), { register }));
    assert.deepEqual(a, b, id);
    const ctx = ctxOf(id, input, { register });
    assert.deepEqual(templateRespond(ctx), templateRespond(ctx), id);
  }
});
test("文脈を作っても入力・引数は書き換えない", () => {
  for (const [id, input] of CASES) {
    const before = structuredClone(input);
    templateRespond(ctxOf(id, input));
    assert.deepEqual(input, before, id);
  }
});

// ---------------------------------------------------------------- 4. 文の置き場所（texts.js）
test("理由の文型：judge が applied に出しうる全 ID に文がある。差し込んだあとも50字以内（相手は sure/observed/est、本人は sure/stated/est）", () => {
  const ids = new Set([...ADJUSTMENTS.map(r => r.id), ...ADDONS.map(r => r.id), "HG", "CAP", "S2A", "S8A"]);
  for (const id of ids) assert.ok(T.REASON_TEMPLATES[id], `理由の文がない：${id}`);
  for (const [id, t] of Object.entries(T.REASON_TEMPLATES)) {
    const dom = T.REASON_DOMAIN[id];
    const ins = !dom ? [""] : dom[0] === "self" ? [T.CONFIDENCE_INSERT.sure, T.CONFIDENCE_INSERT.stated, T.CONFIDENCE_INSERT.est]
      : [T.CONFIDENCE_INSERT.sure, T.CONFIDENCE_INSERT.observed, T.CONFIDENCE_INSERT.est];
    assert.equal(t.includes("{確かさ}"), !!dom, `${id}：{確かさ} と REASON_DOMAIN が合わない`);
    for (const i of ins) for (const e of Object.values(T.ELAPSED_SPAN)) {
      const s = T.fill(t, { 確かさ: i, 経過: e });
      assert.ok(len(s) <= 50, `${id}：${len(s)}字 ${s}`);
      assert.ok(!/\{/.test(s), `${id}：埋まっていない差し込み口`);
    }
  }
  for (const [k, t] of Object.entries(T.PHASE_REASONS)) {
    for (const e of [...Object.values(T.ELAPSED_SINCE), ...Object.values(T.ELAPSED_STOP)]) {
      const s = T.fill(t, { 経過: e, 相手の一言: `「${"あ".repeat(T.PARTNER_LINE_MAX)}」` });
      assert.ok(len(s) <= 50, `${k}：${len(s)}字`);
    }
  }
  for (const p of PHASES) assert.ok(T.PHASE_REASONS[p], p);
  for (const [k, t] of Object.entries(T.ACTION_WHY)) assert.ok(len(t) <= 50, k);
});
test("決まった文の長さと網羅：見出し・やること・その後・避けたい言葉・確かさ・付け足し。全行動に定義と見出しがある", () => {
  // いちばん長い時刻の言い方（日付をまたぐ時刻は、カードでは夜中の読み替えで「明日の朝」になるので、これが最長）
  const worst = { 時刻: "30分後（23時50分ごろ）", 文面の時刻: "23時50分ごろ" };
  // 見出し：深夜に朝へ回る重い行動は「朝になってから、」が付いても上限内。self_calm の時刻は日付（「10月22日」）
  for (const [k, t] of Object.entries(T.HEADLINES)) {
    const a = k.split(":")[0], time = a === "self_calm" ? "12月31日" : "明日の同じ時間ごろ";
    const h = T.fill(t, { 時刻: time });
    assert.ok(len((HEAVY.has(a) ? T.HEADLINE_MORNING_PREFIX : "") + h.replace(/^今日のうちに、/, "")) <= LIMITS.headline, `${k} ${h}`);
  }
  for (const [k, t] of Object.entries(T.DO_NOW)) assert.ok(len(T.fill(t, worst)) <= LIMITS.doNow, `${k} ${len(T.fill(t, worst))}`);
  for (const [k, t] of Object.entries(T.AFTER)) for (const f of ["reply", "noReply"]) assert.ok(len(T.fill(t[f], worst)) <= LIMITS.after, `${k}.${f} ${len(T.fill(t[f], worst))}`);
  for (const [k, t] of Object.entries(T.AVOID_EXAMPLES)) assert.ok(len(t) <= LIMITS.avoidItem, k);
  for (const [k, t] of Object.entries(T.CONFIDENCE_LINES)) assert.ok(len(t) <= LIMITS.confidenceLine, k);
  for (const [k, t] of Object.entries(T.ADDON_LINES)) assert.ok(len(T.fill(t, worst)) <= LIMITS.addonLine, k);
  for (const d of Object.keys(T.PARTNER_SIDE_TEXT)) for (const side of ["A", "B"]) {
    for (const t of [...Object.values(T.VARIANT_ACTION_TEXT), ...Object.values(T.STYLE_HINTS), T.VARIANT_SAME]) {
      assert.ok(len(`相手が${T.PARTNER_SIDE_TEXT[d][side]}なら → ${t}`) <= LIMITS.variantLine, `${d}${side} ${t}`);
    }
  }
  for (const a of ACTIONS) { assert.ok(T.ACTION_DEFS[a], a); assert.ok(T.HEADLINES[a], a); assert.ok(T.ACTION_WHY[a], a); assert.ok(T.AFTER[a], a); }
  for (const ids of Object.values(AVOID)) for (const id of ids) assert.ok(T.AVOID_EXAMPLES[id] && T.AVOID_DEFS[id], id);
  for (let d = 1; d <= 8; d++) {
    const q = T.PARTNER_QUESTIONS[d];
    assert.ok(q.text && q.A && q.B && T.PARTNER_STEMS[d] && T.SELF_LABELS[d], d);
  }
  assert.equal(T.SELF_LABELS[3].A, "不安なとき自分から確かめにいきやすい");
  assert.equal(T.ADDON_LINES.propose_call, "そのあと『電話していい？』と聞く形で1回だけ");
});
test("文面の型：どの行動 × 文体 × 指定でも、送る前チェックで届きにくいにならない。タメ口に です・ます がない、敬語にはある", () => {
  const vars = { 時刻: "明日の昼", いつ: "この前" };
  for (const [a, regs] of Object.entries(T.DRAFTS)) for (const [reg, parts] of Object.entries(regs)) for (const [k, t] of Object.entries(parts)) {
    const s = T.fill(t, vars);
    assert.notEqual(checkDraft(s, { action: a }).level, "届きにくい", `${a}.${reg}.${k}`);
    if (reg === "casual") assert.ok(!/(?:です|ます)(?=[。、？\s]|$)/.test(s), `${a}.${reg}.${k}`);
    if (reg === "polite" && !k.startsWith("tail") && !["attack", "base", "both", "concrete", "feeling_first"].includes(k)) assert.ok(/です|ます|ません|ましょう|ください/.test(s), `${a}.${reg}.${k}`);
    assert.ok(!/絶対|必ず|すべき|いつも|！|!/.test(s), `${a}.${reg}.${k}`);
  }
});

// ---------------------------------------------------------------- 5. 決まった種の入力で
function* randomArgs(n, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const dom = () => pick([{ side: null, conf: "none" }, { side: null, conf: "none" }, { side: "A", conf: "sure" }, { side: "B", conf: "sure" },
    { side: "A", conf: "est", reason: "weak" }, { side: "B", conf: "est", reason: "conflict" }, { side: "A", conf: "observed" }, { side: "B", conf: "observed" }]);
  const doms = (self) => Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(d => { const v = dom(); return [d, self && v.conf === "observed" ? { ...v, conf: "sure", source: "stated" } : v]; }));
  for (let i = 0; i < n; i++) {
    const input = {
      danger: rnd() < 0.03, ongoing: rnd() < 0.15, lastSender: pick(["self", "partner", "none"]), elapsed: pick(["lt3h", "3h_12h", "12h_2d", "ge3d"]),
      partnerLast: pick(["apology", "casual", "explain", "attack", "talk_proposal", "space", "breakup", "none"]),
      selfLast: pick(["hold", "apology", "reconcile", "attack", "explain", "none"]), selfTemp: pick(["high", "cooling", "calm"]),
      cause: pick(["self", "partner", "both", "unknown"]), severity: pick(["small", "large"]), repeat: rnd() < 0.5, afterMakeup: rnd() < 0.15,
      intent: pick(["apologize", "tell", "request_space", "none", "none", "none"]), talkScheduled: rnd() < 0.1,
      medium: pick(["text", "call", "in_person"]), goal: pick(["reconcile", "understood", "settle", "space"]), self: doms(true), partner: doms(false),
    };
    const now = new Date(Date.UTC(2026, 9, 15, Math.floor(rnd() * 24) - 9, Math.floor(rnd() * 60)));
    yield { input, now, tzOffset: JST, register: pick(["casual", "polite"]),
      consultText: pick(["", "相手から「もういい」と来た", "「なんでそんなこと言うの、もう知らない」と言われた", "「別れるなら死ぬ」と言われた"]) };
  }
}
test("決まった種の入力2000件 × 時刻：どのカードも点検を通り、文面はすべて「届きやすい」", () => {
  let cards = 0, drafts = 0;
  for (const args of randomArgs(2000, 20261015)) {
    const ctx = buildContext(args), card = templateRespond(ctx);
    const v = validateCard(card, ctx);
    assert.ok(v.ok, `${ctx.result.phase} ${ctx.result.action} ${JSON.stringify(ctx.result.styles)}：${v.errors.join(" / ")}`);
    for (const d of card.drafts) { drafts++; assert.equal(checkDraft(d.text, { action: ctx.result.action, avoid: ctx.result.avoid }).level, "届きやすい", d.text); }
    cards++;
  }
  console.log(`     ${cards} 枚・文面 ${drafts} 通`);
});

// ---------------------------------------------------------------- 6. カードの形と点検
test("CARD_JSON_SCHEMA：structured outputs で使える形（全 object が additionalProperties:false・全項目 required、長さ・数の制約なし、型の組み合わせは16まで）", () => {
  let unions = 0;
  const walk = (s, path) => {
    for (const bad of ["minLength", "maxLength", "minimum", "maximum", "maxItems", "minItems", "pattern"]) assert.ok(!(bad in s), `${path}.${bad}`);
    if (Array.isArray(s.type) || s.anyOf) unions++;
    if (s.anyOf) s.anyOf.forEach((x, i) => walk(x, `${path}.anyOf[${i}]`));
    if (s.type === "object") {
      assert.equal(s.additionalProperties, false, path);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), path);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`);
    }
    if (s.items) walk(s.items, `${path}[]`);
  };
  walk(CARD_JSON_SCHEMA, "card");
  assert.ok(unions <= 16, `型の組み合わせ ${unions}`);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(CARD_JSON_SCHEMA)));
});
test("validateCard：決まりを破ったカードを止める", () => {
  const ctx = ctxOf("S1", CASES.find(c => c[0] === "S1")[1]);
  const good = templateRespond(ctx);
  const bad = (mut, re) => {
    const c = structuredClone(good); mut(c);
    const v = validateCard(c, ctx);
    assert.ok(!v.ok, `止まらなかった：${re}`);
    assert.ok(v.errors.some(e => re.test(e)), `${re} が errors にない：${v.errors.join(" / ")}`);
  };
  assert.ok(validateCard(good, ctx).ok);
  bad(c => { c.extra = 1; }, /余分な項目/);
  bad(c => { delete c.doNow; }, /doNow：ない/);
  bad(c => { c.headline = null; }, /headline：型/);
  bad(c => { c.kind = "other"; }, /使えない値/);
  bad(c => { c.headline = "今夜は送らない！"; }, /感嘆符/);
  bad(c => { c.reasons[0] = "局面 waiting_partner なので待ちます"; }, /内部の名前/);
  bad(c => { c.reasons[0] = "P2B の補正が効いています"; }, /内部の名前/);
  bad(c => { c.reasons[0] = "保留の点が80点で一番です"; }, /点数/);
  bad(c => { c.reasons[1] = "相手は回避型なので、時間を置きましょう"; }, /使わない語/);
  bad(c => { c.reasons[1] = "相手は気持ちを内に置く寄りです（診断結果）。話す場を作ります"; }, /分かっていないのに/);
  bad(c => { c.reasons.push("4つ目の理由です"); }, /reasons：4 個/);
  bad(c => { c.reasons[0] = "あ".repeat(51); }, /51 字/);
  bad(c => { c.drafts[0].text = "なんで無視するの？既読ついてるよね"; }, /届きにくい/);
  bad(c => { c.drafts[0].text = "いったんここで止めて、少し時間をおいて話したい。返事はいらないよ"; }, /戻る時刻がない/);
  bad(c => { c.drafts[0].text = "いったんここで止めて、明日の昼にちゃんと話したいです。返事はいりません"; }, /タメ口のはずが敬語/);
  bad(c => { c.drafts.push({ label: "別の言い方", text: "明日の昼に話そう" }); }, /drafts：3 個/);
  bad(c => { c.drafts[1].label = "やわらかめ"; }, /別の言い方/);
  bad(c => { c.drafts = []; }, /送る一手なのに文面がない/);
  bad(c => { c.confidenceLine = "相手のタイプが分からないので仮です"; }, /確かさ（sure）/);
  bad(c => { c.doNow = "あ".repeat(400); }, /カード全体/);
  bad(c => { c.ifReply = "友達がそう言ってたと伝える"; }, /第三者/);
  bad(c => { c.headline = "大丈夫 😊"; }, /絵文字/);
  bad(c => { c.safety = { intro: "x", resources: [], steps: [], closing: "y" }; }, /通常のカードなのに/);
  bad(c => { c.headline = "相手はそういう性格です"; }, /使わない語/);
  // 見立て（observed）なのに（診断結果）
  const obs = ctxOf("T18", CASES.find(c => c[0] === "T18")[1]);
  const oc = templateRespond(obs);
  assert.ok(validateCard(oc, obs).ok);
  oc.reasons[1] = "相手は普段のやりとりが戻れば終わりにする寄りです（診断結果）。まず普段の一言で十分です";
  assert.ok(validateCard(oc, obs).errors.some(e => /（診断結果）/.test(e)));
  // 安全ゲート
  const sctx = ctxOf("S11", { danger: true }), sc = templateRespond(sctx);
  const sbad = (mut, re) => { const c = structuredClone(sc); mut(c); const v = validateCard(c, sctx); assert.ok(!v.ok && v.errors.some(e => re.test(e)), `${re}：${v.errors}`); };
  sbad(c => { c.safety.resources = c.safety.resources.filter(r => r.contact !== "#8008"); }, /#8008/);
  sbad(c => { c.drafts = [{ label: "送るならこの1通", text: "ごめんね" }]; }, /文面を出している/);
  sbad(c => { c.kind = "card"; }, /kind/);
  sbad(c => { c.confidenceLine = "状況から決めた一手です"; }, /確かさを出している/);
  sbad(c => { c.safety.intro = "相手はモラハラです。" + c.safety.intro; }, /使わない語/);
  // 文脈なしでも形と文の決まりは見る
  assert.ok(validateCard(good).ok);
  assert.ok(!validateCard(null).ok && !validateCard([]).ok);
});
test("renderCardText：欄の名前つきの素の文字列（安全ゲートは窓口つき）", () => {
  const [, input] = CASES.find(c => c[0] === "S1");
  const ctx = ctxOf("S1", input);
  const t = renderCardText(templateRespond(ctx), { action: ctx.result.action });
  for (const s of ["■ これ以上は送らず", "【理由】", "【送るならこの1通】", "【待つ間に】", "【避けたい言葉】", "【その後】", "【確かさ】"]) assert.ok(t.includes(s), s);
  const st = renderCardText(templateRespond(ctxOf("S11", { danger: true })));
  assert.ok(st.includes("DV相談ナビ #8008") && st.includes("【今できること】"));
});

// ---------------------------------------------------------------- 7. プロンプト
const S1in = CASES.find(c => c[0] === "S1")[1], S2in = CASES.find(c => c[0] === "S2")[1];
test("buildPrompt：l1 はどの相談でも同じ文字列で、相談文・人ごとの層を含まない。キャッシュの最小（512トークン）を超える", () => {
  const a = buildContext({ input: S1in, consultText: CASE_TEXTS.S1, couple: { calmDownTime: "数時間", medium: "text", livingTogether: false }, partnerCall: "ゆうくん", now: new Date(NOW.S1), tzOffset: JST });
  const b = buildContext({ input: S2in, consultText: CASE_TEXTS.S2, register: "polite", now: new Date(DEFAULT_NOW), tzOffset: JST });
  const pa = buildPrompt(a), pb = buildPrompt(b);
  assert.equal(pa.l1, pb.l1);
  assert.equal(pa.l1, systemPrompt());
  assert.equal(pa.version, CONSULT_CONFIG.promptVersion);
  for (const [ctx, p] of [[a, pa], [b, pb]]) {
    assert.ok(!p.l1.includes(ctx.consultText), "相談文");
    assert.ok(!p.l1.includes(p.l2), "人ごとの層");
    assert.ok(!p.l1.includes("ゆうくん"));
  }
  assert.ok(estimateTokens(pa.l1) >= 512, `l1 ${estimateTokens(pa.l1)} トークン`);
  // 1層目は texts.js から作る（文の置き場所は1つ）
  for (const s of [T.REASON_TEMPLATES.P2B, T.PHASE_REASONS.got_apology, T.ACTION_DEFS.pause_with_time, T.AVOID_EXAMPLES.read_receipt, T.CONFIDENCE_LINES.sure, T.STYLE_DEFS.date_only]) {
    assert.ok(pa.l1.includes(s), s);
  }
  console.log(`     l1 ${len(pa.l1)} 字（約 ${estimateTokens(pa.l1)} トークン）、l2 ${len(pa.l2)} 字、l3 ${len(pa.l3)} 字`);
});
test("buildPrompt：l2 は人ごとの層だけ（数字は領域の番号だけ。level などの数を入れない）。カップルの事実を含む", () => {
  const ctx = buildContext({ input: S1in, couple: { calmDownTime: "数時間", medium: "call", livingTogether: true }, now: new Date(NOW.S1), tzOffset: JST });
  const { l2 } = buildPrompt(ctx);
  assert.ok(l2.startsWith("[本人]"));
  assert.ok(l2.includes("[ふたり]") && l2.includes("落ち着くまで：数時間"));
  for (const line of l2.split("\n")) assert.ok(!/[0-9０-９]/.test(line.replace(/^[1-8] /, "").replace(/、[1-8] /g, "、").replace(/：[1-8] /, "：")), line);
});
test("buildPrompt：l3 に一手・判定の出力・決まった文・相談文（600字まで）・現在時刻・文体・呼び方", () => {
  const long = "あ".repeat(CONSULT_TEXT_MAX) + "ここから先は入らない";
  const ctx = buildContext({ input: S1in, consultText: long, partnerCall: "ゆうくん", now: new Date(NOW.S1), tzOffset: JST });
  const { l3 } = buildPrompt(ctx);
  for (const s of ["一手：pause_with_time", "付け足し：self_calm", "点検時刻：next_noon（言い方「明日の12時」）", "文面に入れる時刻：明日の昼",
    "applied：", "避ける言葉：read_receipt、interrogate、ultimatum", "確かさ：sure", "現在時刻：2026-10-15T23:00+09:00（木）", "文体：タメ口", "相手の呼び方：ゆうくん",
    "あ".repeat(CONSULT_TEXT_MAX)]) assert.ok(l3.includes(s), s);
  assert.ok(!l3.includes("ここから先は入らない"));
  const c3 = buildPrompt(ctxOf("C3", SAME)).l3;
  assert.ok(c3.includes("2通り（variants）：鍵の領域 2 反応速度") && c3.includes("画面でカードの下に出す問い：喧嘩中、相手はすぐ返す？"));
  assert.ok(buildPrompt(ctxOf("S1", S1in, { register: "polite" })).l3.includes("文体：敬語"));
});
test("estimateTokens：字数 ÷ 1.5 の切り上げ", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("あいう"), 2);
  assert.equal(estimateTokens("a".repeat(150)), 100);
});

// ---------------------------------------------------------------- 8. AI の回答（中継をまねる）
/** 中継をまねた fetch。calls に呼ばれ方を残す */
function mockFetch(handler) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return handler(url, init, calls.length); };
  f.calls = calls;
  return f;
}
const okResponse = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => obj });
const ENDPOINT = "https://consult-proxy.example.workers.dev/";

test("aiRespond：中継が正しいカードを返せばそのカード。送る本体は { version, model, l1, l2, l3, schema, maxTokens }", async () => {
  const ctx = ctxOf("S1", S1in);
  const aiCard = structuredClone(templateRespond(ctx));
  aiCard.drafts = [{ label: "送るならこの1通", text: "今日はここまでにして、明日の昼にちゃんと話したい。返事はいらないよ" }];
  const f = mockFetch(() => okResponse({ card: aiCard }));
  const card = await aiRespond(ctx, { endpoint: ENDPOINT, fetchImpl: f });
  assert.deepEqual(card, aiCard);
  assert.equal(f.calls.length, 1);
  const { url, init, body } = f.calls[0];
  assert.equal(url, ENDPOINT);
  assert.equal(init.method, "POST");
  assert.equal(init.headers["content-type"], "application/json");
  assert.deepEqual(Object.keys(body).sort(), ["l1", "l2", "l3", "maxTokens", "model", "schema", "version"]);
  assert.equal(body.model, "claude-haiku-5-5");
  assert.equal(body.maxTokens, 1200);
  assert.deepEqual(body.schema, CARD_JSON_SCHEMA);
  assert.equal(body.l1, systemPrompt());
  assert.ok(!JSON.stringify(body).includes("x-api-key"), "ブラウザから API キーを送らない");
});
test("respond：中継の URL があり AI が正しいカードを返せば source は ai。prompt はいつも返す", async () => {
  const ctx = ctxOf("S2", S2in);
  const f = mockFetch(() => okResponse({ card: templateRespond(ctx) }));
  const r = await respond(ctx, { endpoint: ENDPOINT, fetchImpl: f });
  assert.equal(r.source, "ai");
  assert.deepEqual(r.errors, []);
  assert.ok(r.prompt.l1 && r.prompt.l2 && r.prompt.l3 && r.prompt.version);
});
test("respond：中継の URL がなければ決まった文型（fetch を呼ばない）。安全ゲートも URL があっても決まった文型", async () => {
  const f = mockFetch(() => okResponse({}));
  const ctx = ctxOf("S1", S1in);
  const r = await respond(ctx, { fetchImpl: f });
  assert.equal(r.source, "template");
  assert.deepEqual(r.card, templateRespond(ctx));
  assert.ok(r.prompt.l3.includes("一手：pause_with_time"));
  const s = await respond(ctxOf("S11", { danger: true }), { endpoint: ENDPOINT, fetchImpl: f });
  assert.equal(s.source, "template"); assert.equal(s.card.kind, "safety");
  assert.equal(f.calls.length, 0);
  await assert.rejects(aiRespond(ctxOf("S11", { danger: true }), { endpoint: ENDPOINT, fetchImpl: f }), AiResponseError);
});
test("respond：点検を通らないカード・HTTP 500・中継のエラー・通信の失敗・時間切れ → 決まった文型に戻り、errors に理由", async () => {
  const ctx = ctxOf("S1", S1in), tpl = templateRespond(ctx);
  const broken = { ...structuredClone(tpl), headline: "今すぐ謝ろう！", extra: true };
  const cases = [
    [mockFetch(() => okResponse({ card: broken })), /余分な項目|感嘆符/],
    [mockFetch(() => okResponse({ card: { ...structuredClone(tpl), drafts: [{ label: "送るならこの1通", text: "なんで無視するの？" }] } })), /届きにくい|戻る時刻/],
    [mockFetch(() => okResponse({ error: "boom" }, 500)), /HTTP 500/],
    [mockFetch(() => okResponse({ error: "rate limited" })), /中継のエラー/],
    [mockFetch(() => okResponse("not an object")), /object ではない/],
    [mockFetch(() => { throw new TypeError("Failed to fetch"); }), /通信の失敗/],
    [mockFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } })), /通信の失敗/],
    [mockFetch((url, init) => new Promise((resolve, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))), /時間切れ/],
    [mockFetch(() => new Promise(() => {})), /時間切れ/],   // signal を見ない fetch でも止まる
  ];
  for (const [f, re] of cases) {
    const r = await respond(ctx, { endpoint: ENDPOINT, fetchImpl: f, timeoutMs: 30 });
    assert.equal(r.source, "template", String(re));
    assert.deepEqual(r.card, tpl);
    assert.ok(r.errors.length > 0 && r.errors.some(e => re.test(e)), `${re}：${r.errors.join(" / ")}`);
    assert.ok(r.prompt.l1);
  }
});
test("respond：retries を指定すると、その回数まで試し直す（1回目が失敗・2回目が成功なら ai、errors に1回目の理由）", async () => {
  const ctx = ctxOf("S1", S1in);
  const f = mockFetch((url, init, n) => n === 1 ? okResponse({ error: "x" }, 503) : okResponse({ card: templateRespond(ctx) }));
  const r = await respond(ctx, { endpoint: ENDPOINT, fetchImpl: f, retries: 1 });
  assert.equal(r.source, "ai"); assert.equal(f.calls.length, 2); assert.deepEqual(r.errors, ["HTTP 503"]);
  const g = mockFetch(() => okResponse({ error: "x" }, 500));
  const r2 = await respond(ctx, { endpoint: ENDPOINT, fetchImpl: g, retries: 2 });
  assert.equal(r2.source, "template"); assert.equal(g.calls.length, 3); assert.equal(r2.errors.length, 3);
});

// ---------------------------------------------------------------- 9. 問いと差分
test("refineQuestions（C3）：相手のタイプで一手が変わる → 領域2の2択。答えると判定し直して一手が絞れる（A → 謝る、B → 保留）", () => {
  const ctx = ctxOf("C3", SAME);
  const qs = refineQuestions(ctx);
  assert.equal(qs.length, 1);
  assert.equal(qs[0].id, "partner2");
  assert.equal(qs[0].text, "喧嘩中、相手はすぐ返す？");
  assert.deepEqual(qs[0].options.map(o => o.label), ["すぐ言い返す・すぐ返信する", "しばらく考えてから返す"]);
  assert.deepEqual(qs[0].options[0].patch, { partner: { 2: { side: "A", conf: "observed", source: "observed" } } });
  const a = applyPatchToContext(ctx, qs[0].options[0].patch), b = applyPatchToContext(ctx, qs[0].options[1].patch);
  assert.equal(a.result.action, "apology_partial"); assert.equal(a.result.variants, null);
  assert.equal(b.result.action, "pause_with_time"); assert.equal(b.result.variants, null);
  assert.equal(a.input.partner[2].source, "observed");
  // 判定の入力に直接当てても同じ
  const { judge } = { judge: (x) => buildContext({ input: x, now: new Date(NOW.C3), tzOffset: JST }).result };
  assert.equal(judge(applyPatch(SAME, qs[0].options[0].patch)).action, "apology_partial");
  // 見立てで答えた理由は「あなたは見ています」で言う
  assert.ok(templateRespond(a).reasons.some(t => t.includes("だとあなたは見ています")));
  assert.ok(validateCard(templateRespond(a), a).ok && validateCard(templateRespond(b), b).ok);
});
test("refineQuestions（C2）：原因の確認が先、次に文面の2通り（領域5）。「思わない」→ 原因は相手 → 保留（C2b と同じ）、「思う」→ 謝る（確認なし）", () => {
  const [, input] = CASES.find(c => c[0] === "C2");
  const ctx = ctxOf("C2", input);
  const qs = refineQuestions(ctx);
  assert.deepEqual(qs.map(q => q.id), ["cause", "partner5"]);
  assert.equal(qs[0].text, "言い方がきつかったと、自分でも思う？");
  assert.deepEqual(qs[0].options, [{ label: "思う", patch: { cause: "self" } }, { label: "思わない", patch: { cause: "partner" } }]);
  const no = applyPatchToContext(ctx, qs[0].options[1].patch);
  assert.equal(no.result.action, "pause_with_time");
  assert.ok(no.result.applied.includes("HG"));
  const yes = applyPatchToContext(ctx, qs[0].options[0].patch);
  assert.equal(yes.result.action, "apology_partial");
  assert.ok(!yes.result.notes.includes("confirm_cause"));
  assert.equal(templateRespond(yes).drafts[0].label, "送るならこの1通");
  assert.ok(refineQuestions(yes).every(q => q.id !== "cause"));
  // 2問まで、安全ゲート・2通りのない局面では問いなし
  assert.ok(qs.length <= 2);
  assert.deepEqual(refineQuestions(ctxOf("S6", { lastSender: "partner", partnerLast: "space" })), []);
  assert.deepEqual(refineQuestions(ctxOf("S11", { danger: true })), []);
});
test("applyPatch：元を変えずに新しいオブジェクトを返す。self・partner は領域ごとに上書き", () => {
  const base = { cause: "unknown", partner: { 1: { side: "B", conf: "sure" } }, self: { 3: { side: "A", conf: "sure" } } };
  const before = structuredClone(base);
  const out = applyPatch(base, { cause: "self", partner: { 2: { side: "A", conf: "observed", source: "observed" } } });
  assert.deepEqual(base, before);
  assert.notEqual(out, base); assert.notEqual(out.partner, base.partner);
  assert.deepEqual(out, { cause: "self", partner: { 1: { side: "B", conf: "sure" }, 2: { side: "A", conf: "observed", source: "observed" } }, self: { 3: { side: "A", conf: "sure" } } });
  assert.deepEqual(applyPatch(undefined, { cause: "both" }), { cause: "both" });
  // self・partner を input と別に渡した文脈でも、作り直しで差分が当たる
  const ctx = buildContext({ input: SAME, partner: { 1: { side: "A", conf: "sure" } }, now: new Date(NOW.C3), tzOffset: JST });
  const ctx2 = applyPatchToContext(ctx, { partner: { 2: { side: "A", conf: "sure" } } });
  assert.equal(ctx2.result.action, "apology_partial");
  assert.equal(ctx2.input.partner[1].side, "A");
  assert.equal(ctx.input.partner[2].conf, "none", "元の文脈は変わらない");
});
test("buildContext：lateNight を省くと現在時刻から決める（0時〜6時前）。文体は引数 → couple → タメ口。確かさの出どころを残す", () => {
  assert.equal(buildContext({ input: { intent: "tell" }, now: new Date("2026-10-16T02:00:00+09:00"), tzOffset: JST }).input.lateNight, true);
  assert.equal(buildContext({ input: { intent: "tell" }, now: new Date("2026-10-16T06:00:00+09:00"), tzOffset: JST }).input.lateNight, false);
  assert.equal(buildContext({ input: { intent: "tell", lateNight: false }, now: new Date("2026-10-16T02:00:00+09:00"), tzOffset: JST }).input.lateNight, false);
  assert.equal(buildContext({ now: new Date(DEFAULT_NOW), tzOffset: JST }).register, "casual");
  assert.equal(buildContext({ couple: { register: "polite" }, now: new Date(DEFAULT_NOW), tzOffset: JST }).register, "polite");
  assert.equal(buildContext({ couple: { register: "polite" }, register: "casual", now: new Date(DEFAULT_NOW), tzOffset: JST }).register, "casual");
  const ctx = buildContext({ partner: { 2: { side: "B", conf: "est", reason: "weak" }, 3: { side: "A", conf: "observed" }, 4: { side: "A", conf: "bogus" } }, now: new Date(DEFAULT_NOW), tzOffset: JST });
  assert.deepEqual(ctx.input.partner[2], { side: "B", conf: "est", source: "diagnosis", reason: "weak" });
  assert.deepEqual(ctx.input.partner[3], { side: "A", conf: "observed", source: "observed" });
  assert.deepEqual(ctx.input.partner[4], { side: null, conf: "none", source: "none" });
  assert.throws(() => buildContext({ now: "not a date" }));
});
test("extractQuote：相談文の最初の「」の中身（9字まで、英数字・使わない語は使わない）", () => {
  assert.equal(extractQuote("相手から「もういい」と来た"), "もういい");
  assert.equal(extractQuote("「なんでそんなこと言うの、もう知らない」と言われた"), null);
  assert.equal(extractQuote("「OK」と来た"), null);
  assert.equal(extractQuote("「絶対許さない」と来た"), null);
  assert.equal(extractQuote("引用なし"), null);
  assert.equal(extractQuote("「別れるなら死ぬ」と言われた", 20), "別れるなら死ぬ");
});

// ---------------------------------------------------------------- 10. 時刻の言い方
const at = (iso) => new Date(iso);
test("recheckText：30分後・2〜3時間後（日付をまたぐと「明日の」）・明日の昼・明日の朝・明日の同じ時間・7日後の日付", () => {
  const o = { tzOffset: JST };
  assert.equal(recheckText("+30m", at("2026-10-15T14:10:00+09:00"), o), "30分後（14時40分ごろ）");
  assert.equal(recheckText("+30m", at("2026-10-15T14:32:00+09:00"), o), "30分後（15時ごろ）");
  assert.equal(recheckText("+30m", at("2026-10-15T23:50:00+09:00"), o), "30分後（明日の0時20分ごろ）");
  assert.equal(recheckText("+2h", at("2026-10-15T20:00:00+09:00"), o), "22時ごろ");
  assert.equal(recheckText("+2h", at("2026-10-15T20:20:00+09:00"), o), "22時半ごろ");
  assert.equal(recheckText("+2h", at("2026-10-15T20:50:00+09:00"), o), "23時ごろ");
  assert.equal(recheckText("+2h", at("2026-10-15T22:30:00+09:00"), o), "明日の0時半ごろ");
  assert.equal(recheckText("+3h", at("2026-10-15T23:00:00+09:00"), o), "明日の2時ごろ");
  assert.equal(recheckText("+3h", at("2026-10-15T14:00:00+09:00"), o), "17時ごろ");
  assert.equal(recheckText("next_noon", at("2026-10-15T23:00:00+09:00"), o), "明日の12時");
  assert.equal(recheckText("next_noon", at("2026-10-16T02:00:00+09:00"), o), "今日の12時");
  assert.equal(recheckText("next_morning", at("2026-10-15T23:00:00+09:00"), o), "明日の朝");
  assert.equal(recheckText("+24h", at("2026-10-15T23:00:00+09:00"), o), "明日の同じ時間ごろ");
  assert.equal(recheckText("+7d", at("2026-10-15T20:00:00+09:00"), o), "10月22日");
  assert.equal(recheckText("+7d", at("2026-12-28T23:30:00+09:00"), o), "1月4日");
  assert.equal(recheckText(null, at(DEFAULT_NOW), o), null);
  assert.equal(recheckText("+9y", at(DEFAULT_NOW), o), null);
  // カード用：夜中（0〜6時前）に当たる時刻は「明日の朝」
  assert.equal(recheckText("+3h", at("2026-10-15T23:00:00+09:00"), { ...o, clampNight: true }), "明日の朝");
  assert.equal(recheckText("+2h", at("2026-10-15T20:00:00+09:00"), { ...o, clampNight: true }), "22時ごろ");
});
test("draftTimeText・timingText・localIso：文面に入れる時刻と、送るタイミング", () => {
  const o = { tzOffset: JST };
  assert.equal(draftTimeText("next_noon", at("2026-10-15T23:00:00+09:00"), o), "明日の昼");
  assert.equal(draftTimeText("+30m", at("2026-10-15T14:10:00+09:00"), o), "14時40分ごろ");
  assert.equal(draftTimeText("+2h", at("2026-10-15T23:30:00+09:00"), o), "明日の朝", "夜中は明日の朝");
  assert.equal(draftTimeText("+2h", at("2026-10-15T21:40:00+09:00"), o), "23時半ごろ");
  assert.equal(draftTimeText("+24h", at("2026-10-15T08:00:00+09:00"), o), "明日の朝");
  assert.equal(draftTimeText("+24h", at("2026-10-15T13:00:00+09:00"), o), "明日の昼");
  assert.equal(draftTimeText("+24h", at("2026-10-15T20:00:00+09:00"), o), "明日の夜");
  assert.ok(TIME_RE.test(draftTimeText("+30m", at("2026-10-15T14:10:00+09:00"), o)));
  assert.equal(timingText("now"), "今"); assert.equal(timingText("morning"), "朝になってから"); assert.equal(timingText(null), null);
  assert.equal(localIso(at("2026-10-15T23:00:00+09:00"), JST), "2026-10-15T23:00+09:00（木）");
  // 実行環境の時差によらない（同じ瞬間・同じ tzOffset なら同じ文字列）
  assert.equal(recheckText("+2h", at("2026-10-15T13:00:00Z"), o), "明日の0時ごろ");
});

// ---------------------------------------------------------------- 11. 中継の URL
test("resolveAiEndpoint：?ai= は aiEndpointHosts に載っているホストの https だけ受け付ける。既定（空）では何も受け付けない", () => {
  // 既定：一覧は空なので ?ai= はどんな URL でも無視する（細工したリンクから相談文が他人のサーバーに送られない）
  assert.deepEqual([...CONSULT_CONFIG.aiEndpointHosts], [], "既定は空");
  assert.ok(Object.isFrozen(CONSULT_CONFIG.aiEndpointHosts), "一覧は書き換えられない");
  for (const s of ["?ai=https://consult-proxy.example.workers.dev/", "ai=https%3A%2F%2Fx.example.com%2Fapi", "?five=1&ai=https://x.example.com", "?ai=https://evil.example.org"]) {
    assert.equal(resolveAiEndpoint(s), null, `既定では無視：${s}`);
    assert.equal(currentAiEndpoint(s), null, `既定では無視（currentAiEndpoint）：${s}`);
  }
  // allowHosts を渡す（config の一覧に入れたのと同じ）と、載っているホストだけが通る
  const ok = { allowHosts: ["consult-proxy.example.workers.dev"] };
  assert.equal(resolveAiEndpoint("?ai=https://consult-proxy.example.workers.dev/", ok), "https://consult-proxy.example.workers.dev/");
  assert.equal(resolveAiEndpoint("ai=https%3A%2F%2Fconsult-proxy.example.workers.dev%2Fapi", ok), "https://consult-proxy.example.workers.dev/api");
  assert.equal(resolveAiEndpoint("?five=1&ai=https://CONSULT-proxy.example.workers.dev", ok), "https://consult-proxy.example.workers.dev/", "ホスト名の大文字小文字は区別しない");
  assert.equal(currentAiEndpoint("?ai=https://consult-proxy.example.workers.dev/", ok), "https://consult-proxy.example.workers.dev/");
  // 載っていないホストは null（サブドメイン・親ドメイン・似た名前も。完全一致のみ）
  const ex = { allowHosts: ["example.com"] };
  assert.equal(resolveAiEndpoint("?ai=https://evil.example.org", ex), null);
  assert.equal(resolveAiEndpoint("?ai=https://a.example.com/x", ex), null, "サブドメインは別のホスト");
  assert.equal(resolveAiEndpoint("?ai=https://example.com.evil.org/", ex), null);
  assert.equal(resolveAiEndpoint("?ai=https://badexample.com", ex), null);
  assert.equal(resolveAiEndpoint("?ai=https://example.com", ex), "https://example.com/");
  assert.equal(resolveAiEndpoint("?ai=https://example.com@evil.org/", ex), null, "@ で隠した別ホスト");
  // 一覧が空・null・配列でない・空文字だけ → 何も受け付けない
  for (const allowHosts of [[], null, undefined, "example.com", ["", "  "], [42]]) {
    assert.equal(resolveAiEndpoint("?ai=https://example.com", { allowHosts }), null, JSON.stringify(allowHosts));
  }
  // ホストが載っていても、ない・読めない・http・認証情報つきは null
  for (const s of ["", "?", "?ai=", "?ai=http://example.com", "?ai=javascript:alert(1)", "?ai=not a url", "?ai=https://user:pw@example.com", "?other=https://example.com", null, undefined, 42]) {
    assert.equal(resolveAiEndpoint(s, ex), null, String(s));
  }
  assert.equal(CONSULT_CONFIG.aiEndpoint, null, "今は AI を呼ばない");
  assert.equal(currentAiEndpoint(""), null);
  assert.deepEqual({ model: CONSULT_CONFIG.model, maxTokens: CONSULT_CONFIG.maxTokens, timeoutMs: CONSULT_CONFIG.timeoutMs, promptVersion: CONSULT_CONFIG.promptVersion },
    { model: "claude-haiku-5-5", maxTokens: 1200, timeoutMs: 20000, promptVersion: "2026-10-15" });
  assert.ok(Object.isFrozen(CONSULT_CONFIG));
});

await Promise.all(pending);
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} consult responder tests passed`);
process.exit(fail ? 1 : 0);
