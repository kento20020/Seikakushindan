// node tests/consult_ui_state.test.mjs
// 相談（試作）画面の「入力 → buildContext の引数」の変換と保存（js/ui/consult_state.js・consult_self.js。DOM なし）のテスト。
// 画面そのもの（js/ui/consult.js ほか）は Playwright で確かめる。説明：docs/consult-ai.md「画面」
import assert from "node:assert/strict";
import {
  STORAGE_KEY, TEXT_MAX, GROUPS, TOGGLES, DANGER_ITEMS, SELF_TYPES, defaultState, sanitizeState, loadState, saveState, clearSaved,
  dangerInfo, activeCorrections, buildInput, buildArgs, applyPatchToState,
} from "../js/ui/consult_state.js";
import { resolveSelf, effectiveType, domainRows, mainPattern, sampleResult, opposite } from "../js/ui/consult_self.js";
import { buildContext, refineQuestions, applyPatchToContext } from "../js/consult/context.js";
import { respond } from "../js/consult/respond.js";
import { templateRespond } from "../js/consult/template_responder.js";
import { validateCard } from "../js/consult/card.js";

let fail = 0, pass = 0;
const pending = [];
function test(name, fn) {
  const done = (e) => {
    if (!e) { pass++; console.log("OK   " + name); return; }
    fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  "));
  };
  try { const r = fn(); if (r && typeof r.then === "function") pending.push(r.then(() => done(), done)); else done(); } catch (e) { done(e); }
}

const NOW = new Date("2026-10-15T12:00:00+09:00");
const fakeStorage = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, _m: m }; };

// consult-scoring.md §1 の列挙（画面の選択肢の値はこれだけ）
const ENUMS = {
  lastSender: ["self", "partner", "none"], elapsed: ["lt3h", "3h_12h", "12h_2d", "ge3d"],
  partnerLast: ["apology", "casual", "explain", "attack", "talk_proposal", "space", "breakup", "none"],
  selfLast: ["hold", "apology", "reconcile", "attack", "explain", "none"], selfTemp: ["high", "cooling", "calm"],
  cause: ["self", "partner", "both", "unknown"], severity: ["small", "large"], intent: ["apologize", "tell", "request_space", "none"],
  medium: ["text", "call", "in_person"], goal: ["reconcile", "understood", "settle", "space"],
};

test("選択肢の値は judge の入力の列挙（consult-scoring.md §1）と同じ・表示名つき", () => {
  for (const [k, vals] of Object.entries(ENUMS)) {
    assert.deepEqual(GROUPS[k].options.map(o => o[0]).sort(), [...vals].sort(), k);
    assert.ok(GROUPS[k].options.every(o => typeof o[1] === "string" && o[1].length > 0), `${k} の表示名`);
  }
  assert.deepEqual(GROUPS.register.options.map(o => o[0]), ["casual", "polite"]);
  assert.deepEqual(GROUPS.lateNight.options.map(o => o[0]), ["auto", "yes", "no"]);
  assert.deepEqual(GROUPS.coupleMedium.options.map(o => o[0]), ["", "call", "text"]);
  assert.deepEqual(Object.keys(TOGGLES).sort(), ["afterMakeup", "livingTogether", "ongoing", "repeat", "talkScheduled"]);
  assert.deepEqual(SELF_TYPES.map(t => t[0]), ["three", "ishihara", "bekku", "none"]);
  assert.equal(DANGER_ITEMS.length, 7);
});

test("既定の状態：そのまま buildContext → 決まった文型のカードが点検を通る（押してすぐ出せる）", async () => {
  const st = defaultState();
  const ctx = buildContext(buildArgs(st, { now: NOW }));
  assert.equal(ctx.input.danger, false);
  assert.equal(ctx.result.gate, null);
  const card = templateRespond(ctx);
  assert.equal(validateCard(card, ctx).ok, true);
  const r = await respond(ctx, { endpoint: null });
  assert.equal(r.source, "template");
  assert.ok(r.card.headline.length > 5);
});

test("buildInput：画面の項目が judge の入力に対応する（深夜は自動なら入れない）", () => {
  const st = defaultState();
  Object.assign(st, { lastSender: "partner", elapsed: "12h_2d", ongoing: true, partnerLast: "attack", selfLast: "hold", selfTemp: "high",
    cause: "both", goal: "settle", severity: "large", repeat: true, afterMakeup: true, intent: "tell", talkScheduled: true, medium: "call" });
  const x = buildInput(st);
  assert.deepEqual(x, { danger: false, ongoing: true, lastSender: "partner", elapsed: "12h_2d", partnerLast: "attack", selfLast: "hold", selfTemp: "high",
    cause: "both", severity: "large", repeat: true, afterMakeup: true, intent: "tell", talkScheduled: true, medium: "call", goal: "settle" });
  assert.ok(!("lateNight" in x), "自動なら lateNight を入れない");
  st.lateNight = "yes"; assert.equal(buildInput(st).lateNight, true);
  st.lateNight = "no"; assert.equal(buildInput(st).lateNight, false);
});

test("深夜：自動は now から決まる（12時は深夜でない・2時は深夜）。手動が優先", () => {
  const st = defaultState();
  assert.equal(buildContext(buildArgs(st, { now: NOW })).input.lateNight, false);
  assert.equal(buildContext(buildArgs(st, { now: new Date("2026-10-15T02:00:00+09:00") })).input.lateNight, true);
  st.lateNight = "no";
  assert.equal(buildContext(buildArgs(st, { now: new Date("2026-10-15T02:00:00+09:00") })).input.lateNight, false);
  st.lateNight = "yes";
  assert.equal(buildContext(buildArgs(st, { now: NOW })).input.lateNight, true);
});

test("相手の8問：A／B は observed、分からないは none（domainsFromChoices）", () => {
  const st = defaultState();
  st.partner[2] = "B"; st.partner[1] = "B"; st.partner[5] = "A";
  const a = buildArgs(st, { now: NOW });
  assert.deepEqual(a.partner[2], { side: "B", conf: "observed", source: "observed" });
  assert.deepEqual(a.partner[5], { side: "A", conf: "observed", source: "observed" });
  assert.equal(a.partner[3].conf, "none");
  const ctx = buildContext(a);
  assert.equal(ctx.person.partner.domains.length, 3);
});

test("couple・文体・呼び方：書いた分だけ渡す。同居はオンのときだけ true（オフは言い切らない）", () => {
  const st = defaultState();
  let a = buildArgs(st, { now: NOW });
  assert.deepEqual(a.couple, {});
  assert.equal(a.register, "casual");
  assert.ok(!("partnerCall" in a));
  Object.assign(st, { calmDownTime: "  半日くらい ", coupleMedium: "call", livingTogether: true, register: "polite", partnerCall: " ゆうくん " });
  a = buildArgs(st, { now: NOW });
  assert.deepEqual(a.couple, { calmDownTime: "半日くらい", medium: "call", livingTogether: true });
  assert.equal(a.register, "polite");
  assert.equal(a.partnerCall, "ゆうくん");
  const ctx = buildContext(a);
  assert.equal(ctx.register, "polite");
  assert.equal(ctx.partnerCall, "ゆうくん");
  assert.equal(ctx.couple.livingTogether, true);
  st.livingTogether = false;
  assert.ok(!("livingTogether" in buildArgs(st, { now: NOW }).couple));
});

test("危ないサイン：1つでも danger → 安全のカード。窓口の選び方は safety で決める", async () => {
  for (const item of DANGER_ITEMS) {
    const st = defaultState();
    st.danger[item.id] = true;
    const a = buildArgs(st, { now: NOW });
    assert.equal(a.input.danger, true, item.id);
    const ctx = buildContext(a);
    assert.equal(ctx.result.gate, "danger", item.id);
    const r = await respond(ctx);
    assert.equal(r.card.kind, "safety", item.id);
    assert.equal(r.card.drafts.length, 0);
    assert.equal(r.card.avoid.length, 0);
    assert.ok(r.card.safety.resources.some(x => x.contact === "#8008"));
    assert.equal(ctx.safety.selfHarm, item.safety === "selfHarm", `${item.id} selfHarm`);
    assert.equal(ctx.safety.partnerThreat, item.safety === "partnerThreat", `${item.id} partnerThreat`);
  }
  const st = defaultState(); st.danger.selfHarm = true;
  const r = await respond(buildContext(buildArgs(st, { now: NOW })));
  assert.equal(r.card.safety.resources[0].name, "よりそいホットライン", "本人向けはよりそいを先頭に");
});

test("相談文に自分を傷つける言葉（死にたい・消えたい など）があれば、チェックがなくても安全のカード", async () => {
  const st = defaultState();
  st.text = "もう消えたい";
  const info = dangerInfo(st);
  assert.equal(info.danger, true); assert.equal(info.textSelfHarm, true); assert.equal(info.checked.length, 0);
  const ctx = buildContext(buildArgs(st, { now: NOW }));
  assert.equal(ctx.result.gate, "danger");
  assert.equal(ctx.safety.selfHarm, true);
  // 「死ぬほど」のような言い方では止めない（相手の脅しはチェックのときだけ）
  const st2 = defaultState(); st2.text = "死ぬほど腹が立った";
  assert.equal(dangerInfo(st2).danger, false);
  assert.equal(buildContext(buildArgs(st2, { now: NOW })).result.gate, null);
});

test("本人のタイプ：サンプル石原・別宮は8領域と主軸を持つ。診断なしは self を渡さない", () => {
  for (const [type, name] of [["ishihara", "サンプル：石原"], ["bekku", "サンプル：別宮"]]) {
    const st = defaultState(); st.selfType = type;
    const self = resolveSelf(st);
    assert.equal(self.type, type); assert.equal(self.name, name);
    assert.equal(Object.keys(self.domains).length, 8);
    assert.ok(self.main && /^[A-Z]/.test(self.main.id) && self.main.headline.length > 3, `${type} の主軸`);
    const a = buildArgs(st, { selfDomains: self.domains, selfMain: self.main, now: NOW });
    assert.equal(a.selfMain.confirmed, false, "チェックするまでは confirmed: false");
    st.mainConfirmed = true;
    const ctx = buildContext(buildArgs(st, { selfDomains: self.domains, selfMain: self.main, now: NOW }));
    assert.equal(ctx.person.selfMain?.id, self.main.id);
    assert.ok(ctx.person.selfMain.headline.length > 3);
  }
  const st = defaultState(); st.selfType = "none";
  const self = resolveSelf(st);
  assert.equal(self.type, "none"); assert.equal(self.domains, null);
  assert.ok(!("self" in buildArgs(st, { selfDomains: self.domains, selfMain: self.main, now: NOW })));
  assert.equal(sampleResult("none"), null);
  assert.equal(sampleResult("ishihara"), sampleResult("ishihara"), "サンプルは使い回す");
});

test("effectiveType：選んでいなければ（端末の結果があれば三択・なければ診断なし）。三択を選んでも結果がなければ診断なし", () => {
  const st = defaultState();
  assert.equal(effectiveType(st, true), "three");
  assert.equal(effectiveType(st, false), "none");
  st.selfType = "three"; assert.equal(effectiveType(st, false), "none"); assert.equal(effectiveType(st, true), "three");
  st.selfType = "bekku"; assert.equal(effectiveType(st, true), "bekku");
  st.selfType = null; st.selfType = "none"; assert.equal(effectiveType(st, true), "none");
});

test("「これは違う」：反対の向き・conf sure・source stated。直す前の向きが変わったら無効（activeCorrections）", () => {
  const st = defaultState(); st.selfType = "ishihara";
  const base = resolveSelf(st).base;
  const d = 2;
  assert.equal(base[d].side, "A");
  st.corrections[d] = { from: base[d].side, to: opposite(base[d].side) };
  const fixed = resolveSelf(st);
  assert.deepEqual(fixed.domains[d], { side: "B", conf: "sure", source: "stated" });
  assert.deepEqual(fixed.corrections, { 2: "B" });
  assert.equal(fixed.base[d].side, "A", "診断のままの値は変えない");
  const rows = domainRows(fixed);
  assert.equal(rows.length, 8);
  assert.equal(rows.find(r => r.d === d).tag, "直した");
  assert.equal(rows.find(r => r.d === d).fixed, true);
  assert.ok(rows.every(r => ["確か", "弱め", "不明", "直した"].includes(r.tag)));
  assert.ok(rows.filter(r => r.d !== d).every(r => r.tag !== "直した"));
  // 診断が変わって、直す前の向きが合わなくなった直しは使わない
  st.corrections[3] = { from: "B", to: "A" };   // 石原の領域3 は A（from: B は合わない）
  assert.equal(activeCorrections(st, base)[3], undefined);
  // 直した領域は L2（本人が直した）に出る
  const ctx = buildContext(buildArgs(st, { selfDomains: fixed.domains, now: NOW }));
  const dom2 = ctx.person.self.domains.find(x => x.d === 2);
  assert.equal(dom2.source, "stated"); assert.equal(dom2.conf, "sure");
});

test("不明な領域（診断で決まらなかった）は row.known が false（「これは違う」を出さない）", () => {
  const st = defaultState(); st.selfType = "bekku";
  const self = resolveSelf(st);
  const rows = domainRows(self);
  for (const r of rows) assert.equal(r.known, !!self.base[r.d].side);
  assert.ok(rows.every(r => r.text.length > 0));
  assert.ok(rows.every(r => r.known || r.tag === "不明"));
  assert.equal(mainPattern(null), null);
});

test("sanitizeState：壊れた保存値は既定に戻る・範囲外の値は捨てる・文字数は切る", () => {
  assert.deepEqual(sanitizeState(null), defaultState());
  assert.deepEqual(sanitizeState([1, 2]), defaultState());
  assert.deepEqual(sanitizeState("x"), defaultState());
  const s = sanitizeState({
    selfType: "evil", lastSender: "xxx", elapsed: "ge3d", partner: { 1: "A", 2: "C", 9: "A" }, text: "あ".repeat(900),
    partnerCall: "ア".repeat(50), ongoing: "yes", register: "polite", danger: { selfHarm: true, violence: "true" },
    corrections: { 1: { from: "A", to: "B" }, 2: { from: "A", to: "A" }, 3: { from: "X", to: "B" } },
  });
  assert.equal(s.selfType, null);
  assert.equal(s.lastSender, "none"); assert.equal(s.elapsed, "ge3d");
  assert.equal(s.partner[1], "A"); assert.equal(s.partner[2], null); assert.ok(!("9" in s.partner));
  assert.equal([...s.text].length, TEXT_MAX);
  assert.equal([...s.partnerCall].length, 20);
  assert.equal(s.ongoing, false); assert.equal(s.register, "polite");
  assert.equal(s.danger.selfHarm, true); assert.equal(s.danger.violence, false);
  assert.deepEqual(s.corrections, { 1: { from: "A", to: "B" } });
  assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(defaultState()))), defaultState(), "既定は往復で変わらない");
});

test("保存：consult-form-v1 に書いて読める。壊れた JSON・storage なし・例外を投げる storage でも動く", () => {
  const st = fakeStorage();
  const s = defaultState(); s.selfType = "bekku"; s.partner[4] = "A"; s.text = "メモ";
  assert.equal(saveState(s, st), true);
  assert.ok(st._m.has("consult-form-v1")); assert.equal(STORAGE_KEY, "consult-form-v1");
  assert.deepEqual(loadState(st), s);
  st.setItem("consult-form-v1", "{broken");
  assert.deepEqual(loadState(st), defaultState());
  assert.equal(clearSaved(st), true); assert.equal(st._m.has("consult-form-v1"), false);
  assert.deepEqual(loadState(null), defaultState());
  assert.equal(saveState(s, null), false);
  const boom = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("denied"); } };
  assert.deepEqual(loadState(boom), defaultState());
  assert.equal(saveState(s, boom), false);
  assert.equal(clearSaved(boom), false, "例外が出ても投げずに false");
  assert.deepEqual(loadState(), defaultState(), "node には localStorage がない");
});

test("問いの答え（refineQuestions の patch）：画面の状態に映したあとの再計算が、applyPatchToContext と同じ結果になる", async () => {
  const st = defaultState(); st.selfType = "ishihara";
  Object.assign(st, { lastSender: "self", elapsed: "lt3h", selfLast: "explain" });
  const self = resolveSelf(st);
  const ctx0 = buildContext(buildArgs(st, { selfDomains: self.domains, selfMain: self.main, now: NOW }));
  const qs = refineQuestions(ctx0);
  assert.ok(qs.length >= 1, "相手の答えがないと問いが出る");
  for (const q of qs) for (const opt of q.options) {
    const viaPatch = applyPatchToContext(ctx0, opt.patch);
    const st2 = structuredClone(st);
    const changed = applyPatchToState(st2, opt.patch);
    assert.ok(changed.length >= 1, `${q.id}/${opt.label} が状態に映る`);
    const viaForm = buildContext(buildArgs(st2, { selfDomains: self.domains, selfMain: self.main, now: NOW }));
    assert.equal(viaForm.result.action, viaPatch.result.action, `${q.id}/${opt.label} action`);
    assert.equal(viaForm.result.phase, viaPatch.result.phase);
    assert.deepEqual(viaForm.result.scores, viaPatch.result.scores);
    assert.deepEqual(viaForm.result.variants, viaPatch.result.variants);
    assert.deepEqual(templateRespond(viaForm), templateRespond(viaPatch), `${q.id}/${opt.label} カード`);
  }
  // cause の問いも映る
  const st3 = defaultState(); st3.intent = "apologize";
  const ctx3 = buildContext(buildArgs(st3, { now: NOW }));
  const cq = refineQuestions(ctx3).find(q => q.id === "cause");
  assert.ok(cq, "原因が分からないのに謝る一手 → 原因の問い");
  assert.deepEqual(applyPatchToState(st3, cq.options[0].patch), ["cause"]);
  assert.equal(st3.cause, "self");
  assert.deepEqual(applyPatchToState(st3, { cause: "bogus", foo: 1, partner: { 99: { side: "A" } } }), [], "映せないものは無視");
});

test("カードは入力が同じ・now が同じなら毎回同じ（画面の再計算で内容が揺れない）", async () => {
  const st = defaultState(); st.selfType = "bekku"; st.partner[1] = "A";
  const self = resolveSelf(st);
  const mk = () => templateRespond(buildContext(buildArgs(st, { selfDomains: self.domains, selfMain: self.main, now: NOW })));
  assert.deepEqual(mk(), mk());
});

await Promise.all(pending);
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} consult ui state tests passed`);
process.exit(fail ? 1 : 0);
