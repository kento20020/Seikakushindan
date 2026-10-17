// 足りない項目のうち、一手を決めるのに要るものだけを聞く（案D。決定 U14）。説明：docs/consult-reading.md
// 分かっていない項目にありうる値を入れて判定を回し、一手（action）が変わる項目だけを、いちばん絞れる問から1つずつ聞く。
// 場面の問も含めて合計3問まで。3問で決まらなければ打ち切り、埋まった項目と既定値で判定する。
// 危ないサイン（danger）は聞かない（安全の確認は兆しがあるときだけ画面が別に聞き、3問に数えない。決定 U22）。同じ入力なら必ず同じ問（決定論）。DOM なし（node でテスト可能）。
//
// 速さ：judge は1回 50µs ほどかかり、ありうる組み合わせ（最大で数十万）を全部回すとスマホで遅い。そこで
//   (1) 局面を先に決める：局面だけに効く項目（PHASE_ONLY）は、局面ごとの重みにまとめて数える
//   (2) 点数に効く項目（SHARED・SCORE_ONLY）は、局面ごとに組み合わせ1つにつき1回だけ点を出して覚えておく（文脈が同じなら次の問でも使う）
//   (3) 判定で同じ扱いになる値（SAME_AS。例：落ち着いてきた／落ち着いている）は1つにまとめ、重みで数える
//   (4) 局面と点数は、judge.js の classifyPhase・scoreActions・pickAction と同じ手順の軽い写し（phaseOf・compilePhase）で出す。
//       補正のうち、点数に効く項目を読まないもの（局面と文脈だけで決まるもの）は、局面ごとに1回だけ確かめて使い回す
// (3)(4) が judge と同じ結果になることは tests/consult_read.test.mjs で総当たり・抜き取りで確かめる。判定表（rules.js）や judge.js を変えたらテストを流すこと。
import { normalizeInput, judge } from "./judge.js";
import { ACTIONS, ADJUSTMENTS, BASE, PRIORITY, SELF_CALM_PHASE, KEY_PARTNER_DOMAIN, PARTNER_CAP, CONF_WEIGHT, apologyGateOpen } from "./rules.js";

/** 合計で聞く問の上限（場面の問も含む。決定 U14） */
export const MAX_QUESTIONS = 3;

/** 聞ける項目と、ありうる値（docs/consult-scoring.md §1） */
export const ASKABLE = {
  lastSender: ["self", "partner", "none"],
  ongoing: [false, true],
  intent: ["none", "apologize", "tell", "request_space"],
  partnerLast: ["none", "casual", "explain", "attack", "talk_proposal", "apology", "space", "breakup"],
  elapsed: ["lt3h", "3h_12h", "12h_2d", "ge3d"],
  selfLast: ["none", "hold", "apology", "reconcile", "attack", "explain"],
  selfTemp: ["high", "cooling", "calm"],
  goal: ["reconcile", "understood", "settle", "space"],
  cause: ["unknown", "self", "both", "partner"],
  repeat: [false, true],
};
/** 判定（一手）で同じ扱いになる値 → 代表の値。数える回数を減らすためだけに使う（問の選択肢はまとめない） */
export const SAME_AS = {
  partnerLast: { breakup: "space" },                     // どちらも space.partner（違いは文面の指定 BRK だけ）
  selfLast: { reconcile: "apology", explain: "none" },   // 局面と補正 L3 で同じ扱い／どの補正にも出てこない
  selfTemp: { calm: "cooling" },                         // 補正は high かどうかだけ（calm は付け足し AO7 だけ）
};
/** 局面だけに効く項目／局面と点数の両方に効く項目／点数だけに効く項目 */
const PHASE_ONLY = ["lastSender", "ongoing", "intent", "partnerLast", "repeat"];
const SHARED = ["elapsed", "selfLast", "selfTemp"];
const SCORE_ONLY = ["cause", "goal"];
const SCORE_FIELDS = [...SHARED, ...SCORE_ONLY];
/** 同じだけ絞れるときに先に聞く順 */
const ORDER = ["intent", "lastSender", "ongoing", "partnerLast", "elapsed", "selfLast", "selfTemp", "goal", "cause", "repeat"];

// ---------------------------------------------------------------- 問の言葉（js/ui/consult_state.js の GROUPS・TOGGLES の表示に合わせる）
/** 場面の問（docs/ui-design-thinking.md §3.1 の I4）。先頭の4つを1画面に出し、残りは「ほかの場面」 */
export const SCENES = [
  { id: "waiting", label: "送ったけど、返事が来ない", patch: { lastSender: "self", ongoing: false, intent: "none", afterMakeup: false } },
  { id: "partner_msg", label: "相手から連絡が来た（まだ返していない）", patch: { lastSender: "partner", ongoing: false, intent: "none", afterMakeup: false } },
  { id: "heated", label: "いま言い合いの最中", patch: { ongoing: true, intent: "none", afterMakeup: false } },
  { id: "cold_war", label: "お互い連絡していない", patch: { lastSender: "none", ongoing: false, intent: "none", afterMakeup: false } },
  { id: "apologize", label: "自分から謝りたい", patch: { intent: "apologize", ongoing: false, afterMakeup: false } },
  { id: "tell", label: "話す前・伝えたいことがある", patch: { intent: "tell", ongoing: false, afterMakeup: false } },
  { id: "after_makeup", label: "仲直りしたけどモヤモヤ", patch: { afterMakeup: true, ongoing: false, intent: "none", lastSender: "none", partnerLast: "none" } },
  { id: "space", label: "相手から距離・別れの話が出た", patch: { lastSender: "partner", partnerLast: "space", ongoing: false, intent: "none", afterMakeup: false } },
];
export const SCENE_QUESTION = { id: "scene", text: "いまの場面に近いのは？", primary: 4, moreLabel: "ほかの場面" };

const opt = (label, patch) => ({ label, patch });
/** 項目 → 問。known（分かっている項目）で言い方を変えるものがある */
const QUESTIONS = {
  lastSender: () => ({ text: "最後に送ったのは？", options: [
    opt("自分", { lastSender: "self" }), opt("相手", { lastSender: "partner" }), opt("どちらも送っていない（対面で終わった）", { lastSender: "none" })] }),
  ongoing: () => ({ text: "言い合いは今も続いている？", options: [
    opt("今も続いている", { ongoing: true }), opt("いまは止まっている", { ongoing: false })] }),
  intent: () => ({ text: "どうしたい？", options: [
    opt("謝りたい", { intent: "apologize" }), opt("伝えたいことがある", { intent: "tell" }),
    opt("距離を置きたいと伝えたい", { intent: "request_space" }), opt("特になし", { intent: "none" })] }),
  partnerLast: (k) => {
    // 返事待ち・対面で終わった人には、一手が変わる「距離・別れの話」だけを聞く（ほかの種類は判定で同じ扱い）
    if (k.lastSender === "self" || k.lastSender === "none") {
      return { text: "相手から「距離を置きたい」「別れたい」という話は出ている？", options: [
        opt("出ていない", { partnerLast: "none" }), opt("距離を置きたいと言われた", { partnerLast: "space" }), opt("別れ話をされた", { partnerLast: "breakup" })] };
    }
    const kinds = [
      opt("謝ってきた", { partnerLast: "apology" }), opt("普通の話題", { partnerLast: "casual" }), opt("説明・言い返し", { partnerLast: "explain" }),
      opt("責める・「もういい」", { partnerLast: "attack" }), opt("話し合いの提案", { partnerLast: "talk_proposal" }),
      opt("距離を置きたい", { partnerLast: "space" }), opt("別れ話", { partnerLast: "breakup" })];
    if (k.lastSender === "partner") return { text: "相手から来たのは、どんな内容？", options: kinds };
    return { text: "相手から最後に来たのは？", options: [...kinds, opt("まだ何も来ていない", { partnerLast: "none" })] };
  },
  elapsed: () => ({ text: "最後のやりとりから、どれくらい？", options: [
    opt("3時間以内", { elapsed: "lt3h" }), opt("半日以内", { elapsed: "3h_12h" }), opt("1〜2日", { elapsed: "12h_2d" }), opt("3日以上", { elapsed: "ge3d" })] }),
  selfLast: (k) => ({
    text: k.lastSender === "self" ? "最後に送ったのは、どんな内容？"
      : k.lastSender === "partner" ? "相手から来る前に、自分が最後に送ったのは？" : "自分が最後に送った（言った）のは、どんな内容？",
    options: [
      opt("「落ち着いたら話そう」など", { selfLast: "hold" }), opt("謝った", { selfLast: "apology" }), opt("仲直りしようとした", { selfLast: "reconcile" }),
      opt("責めた・言い返した", { selfLast: "attack" }), opt("説明した", { selfLast: "explain" }), opt("どれでもない", { selfLast: "none" })] }),
  selfTemp: () => ({ text: "いまの気持ちは？", options: [
    opt("まだ熱い", { selfTemp: "high" }), opt("落ち着いてきた", { selfTemp: "cooling" }), opt("落ち着いている", { selfTemp: "calm" })] }),
  goal: () => ({ text: "今回のゴールは？", options: [
    opt("仲直りしたい", { goal: "reconcile" }), opt("分かってほしい", { goal: "understood" }),
    opt("ちゃんと決着をつけたい", { goal: "settle" }), opt("少し距離を置きたい", { goal: "space" })] }),
  cause: () => ({ text: "今回の原因は？", options: [
    opt("自分", { cause: "self" }), opt("相手", { cause: "partner" }), opt("両方", { cause: "both" }), opt("分からない", { cause: "unknown" })] }),
  repeat: () => ({ text: "前にも同じことで喧嘩した？", options: [
    opt("初めて", { repeat: false }), opt("前にもあった（くり返し）", { repeat: true })] }),
};

// ---------------------------------------------------------------- 値の代表と番号
const rep = (f, v) => SAME_AS[f]?.[v] ?? v;
/** 項目 → 代表の値の並び（ASKABLE の順） */
const REPS = Object.fromEntries(Object.entries(ASKABLE).map(([f, vs]) => [f, [...new Set(vs.map(v => rep(f, v)))]]));
/** 点数に効く項目の値 → 覚えの番号（0〜511） */
const STRIDE = (() => { const out = {}; let s = 1; for (const f of [...SCORE_FIELDS].reverse()) { out[f] = s; s *= REPS[f].length; } return out; })();
const MEMO_SIZE = SCORE_FIELDS.reduce((n, f) => n * REPS[f].length, 1);
const keyPart = (f, v) => REPS[f].indexOf(rep(f, v)) * STRIDE[f];
const ACT_INDEX = Object.fromEntries(ACTIONS.map((a, i) => [a, i]));
const PHASE_LIST = Object.keys(BASE);
const PHASE_INDEX = Object.fromEntries(PHASE_LIST.map((p, i) => [p, i]));

// ---------------------------------------------------------------- 判定の軽い写し（速さのため。judge.js と同じ結果になることをテストで確かめる）
const PARTNER_MSG = { casual: "partner_msg.a", explain: "partner_msg.b", attack: "partner_msg.c", talk_proposal: "partner_msg.d" };
/** classifyPhase と同じ手順（既定値で埋めた入力 x を受け取る。危ないサインは見ない） */
function phaseOf(x) {
  if ((x.partnerLast === "space" || x.partnerLast === "breakup") && x.elapsed !== "ge3d") return "space.partner";
  if (x.intent === "request_space") return "space.self";
  if (x.partnerLast === "apology" && x.lastSender === "partner") return "got_apology";
  if (x.ongoing || (x.selfTemp === "high" && x.elapsed === "lt3h" && x.lastSender !== "partner")) return "heated";
  if (x.intent === "apologize") return "want_apologize";
  if (x.intent === "tell" || x.talkScheduled) return "before_talk";
  if (x.afterMakeup) return x.repeat ? "after_makeup.repeat" : "after_makeup.once";
  if (x.lastSender === "partner") return PARTNER_MSG[x.partnerLast] || "partner_msg.b";
  if (x.lastSender === "self" && (x.elapsed === "lt3h" || x.elapsed === "3h_12h")) return "waiting_partner";
  if (x.lastSender === "self" && (x.selfLast === "reconcile" || x.selfLast === "apology")) return "cold_war.ignored";
  return x.elapsed === "ge3d" ? "cold_war.long" : "cold_war.short";
}
const round = (v) => Math.round(v * 100) / 100;
const weightOf = (doms, d, side) => { const v = doms[d]; return v && v.side === side ? CONF_WEIGHT[v.conf] ?? 0 : 0; };
/** 除外されうる行動。行動が1つだけで除外されない局面は、どの値でも一手が同じ */
const EXCLUDABLE = new Set(ADJUSTMENTS.flatMap(r => r.exclude || []));
const CONSTANT = Object.fromEntries(PHASE_LIST.map(p => {
  const acts = Object.keys(BASE[p]);
  return [p, acts.length === 1 && !EXCLUDABLE.has(acts[0]) && acts[0] !== "self_calm" ? acts[0] : null];
}));
const CONSTANT_IDX = PHASE_LIST.map(p => (CONSTANT[p] ? ACT_INDEX[CONSTANT[p]] : -1));

/**
 * 1つの入力（文脈 x と局面）での補正の準備。補正の when・w を、点数に効く項目を読んだかどうかを見張りながら1回だけ呼び、
 * どれも読まなかったもの（局面と文脈だけで決まる）は答えを覚えて、以後は呼ばない。決まって効かない補正は外す。
 */
function prepareVariant(x, phase, idx, exclOnly) {
  const ctxOf = (inp) => ({ in: inp, phase, pw: (d, s) => weightOf(inp.partner, d, s), sw: (d, s) => weightOf(inp.self, d, s) });
  const c = ctxOf(x);
  // 見張り役：点数に効く項目を読むと touched が立つ
  let touched = false;
  const probeIn = { ...x };
  for (const f of SCORE_FIELDS) Object.defineProperty(probeIn, f, { get() { touched = true; return x[f]; }, enumerable: true });
  const probe = ctxOf(probeIn);
  const fixedOf = (fn) => { touched = false; const v = fn(probe); return touched ? undefined : v; };
  const rules = [];
  for (const r of ADJUSTMENTS) {
    if (exclOnly && !(r.exclude && r.exclude.length)) continue;
    const when = r.when ? fixedOf(r.when) : true;
    if (when === false) continue;
    const w = r.w ? fixedOf(r.w) : 1;
    if (w !== undefined && !(w > 0)) continue;
    const adds = Object.entries(r.add || {}).filter(([a]) => a in idx);
    let exclMask = 0;
    for (const a of r.exclude || []) if (a in idx) exclMask |= 1 << idx[a];
    rules.push({ r, when, w, capped: r.w?.domain != null, apology: r.apology || 0,
      addI: Int32Array.from(adds, ([a]) => idx[a]), addP: Float64Array.from(adds, ([, p]) => p), exclMask });
  }
  return { x, c, rules, fired: [], ws: new Float64Array(rules.length), sc: new Float64Array(Object.keys(idx).length), so: new Float64Array(Object.keys(idx).length) };
}

/**
 * 局面 phase の一手を出す関数（judge の action と同じ結果）。ctx は既定値で埋めた入力（文脈）で、点数に効く項目（vals）だけを毎回入れ替える。
 * scoreActions と同じ手順・同じ足し算の順番（小数の誤差まで合わせる）を、使い回しの配列で行う。
 * 相手の鍵の領域（§8）が分からなければ A・B 両方で点を出し、行動ごとに低いほうで選ぶ（judge と同じ）
 */
function compilePhase(ctx, phase) {
  const base = BASE[phase];
  const acts = ACTIONS.filter(a => a in base);
  const n = acts.length;
  const idx = Object.fromEntries(acts.map((a, i) => [a, i]));
  const baseArr = Float64Array.from(acts, a => base[a]);
  const prio = acts.map(a => { const i = PRIORITY.indexOf(a); return i < 0 ? PRIORITY.length : i; });
  const calmOk = phase === SELF_CALM_PHASE;
  const iPartial = idx.apology_partial ?? -1, iAsk = idx.ask_feeling ?? -1;
  const key = KEY_PARTNER_DOMAIN[phase];
  const twoSided = key != null && ctx.partner[key].conf === "none";
  const variants = (twoSided ? ["A", "B"].map(side => ({ ...ctx.partner, [key]: { side, conf: "sure" } })) : [ctx.partner])
    .map(partner => prepareVariant({ ...ctx, partner }, phase, idx, false));
  const v0 = twoSided ? prepareVariant({ ...ctx }, phase, idx, true) : null;   // 除外（×）を決める元の入力
  const all = v0 ? [...variants, v0] : variants;
  const out = new Float64Array(n);

  /** 点（V.sc）を出し、× で除外された行動の印（ビット）を返す */
  function score(V) {
    const { c, rules, fired, ws, sc, so } = V;
    let blocked = 0, nf = 0;
    for (const R of rules) {
      if (R.when === undefined ? !R.r.when(c) : !R.when) continue;
      const w = R.w === undefined ? (R.r.w ? R.r.w(c) : 1) : R.w;
      if (!(w > 0)) continue;
      fired[nf] = R; ws[nf] = w; nf++;
      blocked |= R.exclMask;
    }
    sc.set(baseArr); so.fill(0);
    let gate = -1;
    for (let k = 0; k < nf; k++) {
      const R = fired[k], w = ws[k], capped = R.capped && w < 1;
      for (let j = 0; j < R.addI.length; j++) {
        const i = R.addI[j], pw = R.addP[j] * w;
        if (blocked & (1 << i) || pw === 0) continue;
        if (capped) so[i] += pw; else sc[i] += pw;
      }
      if (R.apology) {
        if (gate < 0) gate = apologyGateOpen(V.x) ? 1 : 0;
        const i = gate ? iPartial : iAsk, pw = R.apology * w;
        if (i >= 0 && !(blocked & (1 << i)) && pw !== 0) { if (capped) so[i] += pw; else sc[i] += pw; }
      }
    }
    for (let i = 0; i < n; i++) if (!(blocked & (1 << i))) sc[i] = round(sc[i] + Math.max(-PARTNER_CAP, Math.min(PARTNER_CAP, round(so[i]))));
    return blocked;
  }
  function blockedOf(V) {
    let blocked = 0;
    for (const R of V.rules) {
      if (R.when === undefined ? !R.r.when(V.c) : !R.when) continue;
      const w = R.w === undefined ? (R.r.w ? R.r.w(V.c) : 1) : R.w;
      if (w > 0) blocked |= R.exclMask;
    }
    return blocked;
  }
  /** vals：点数に効く項目の値 { elapsed, selfLast, selfTemp, cause, goal } → 一手 */
  return function actionOf(vals) {
    for (const V of all) { const x = V.x; x.elapsed = vals.elapsed; x.selfLast = vals.selfLast; x.selfTemp = vals.selfTemp; x.cause = vals.cause; x.goal = vals.goal; }
    let mask;
    if (!twoSided) { mask = score(variants[0]); out.set(variants[0].sc); }
    else {
      mask = blockedOf(v0) | score(variants[0]) | score(variants[1]);
      for (let i = 0; i < n; i++) out[i] = Math.min(variants[0].sc[i], variants[1].sc[i]);
    }
    // pickAction と同じ：点が最も高い行動。同点は優先順。self_calm は after_makeup.once 以外では選ばない
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i) || (!calmOk && acts[i] === "self_calm")) continue;
      if (best < 0 || out[i] > out[best] || (out[i] === out[best] && prio[i] < prio[best])) best = i;
    }
    return best < 0 ? null : acts[best];
  };
}

/**
 * 文脈（聞ける項目を除いた入力）ごとの、局面別の一手の関数と覚え。直近のものだけ取っておく。
 * 局面だけに効く項目（誰が最後か など）は点数に効かない（補正が読まない）ので、文脈の見分けに入れない。
 * 補正がそれらを読むように rules.js を変えたら、ここも見直す（tests の「一手の分かれ方が総当たりと同じ」が落ちる）
 */
const EVALUATORS = new Map();
const EVALUATORS_MAX = 4;
/** テスト用：覚えを捨てる（速さを「初めての文脈」で測るため） */
export function clearCache() { EVALUATORS.clear(); }
function evaluatorFor(ctx) {
  const sig = JSON.stringify(Object.entries(ctx).filter(([k]) => !(k in ASKABLE)).sort(([a], [b]) => (a < b ? -1 : 1)));
  let ev = EVALUATORS.get(sig);
  if (!ev) {
    const compiled = [], memo = [];
    /** 局面の番号・行（点数に効く項目の値。s は SHARED、c は SCORE_ONLY）→ 一手の番号（ACTIONS の並び） */
    ev = (pi, s, c) => {
      if (CONSTANT_IDX[pi] >= 0) return CONSTANT_IDX[pi];
      const m = memo[pi] ??= new Int8Array(MEMO_SIZE), k = s.k + c.k;
      if (!m[k]) {
        const phase = PHASE_LIST[pi];
        m[k] = ACT_INDEX[(compiled[pi] ??= compilePhase(ctx, phase))({ ...s.v, ...c.v })] + 1;
      }
      return m[k] - 1;
    };
    EVALUATORS.set(sig, ev);
    if (EVALUATORS.size > EVALUATORS_MAX) EVALUATORS.delete(EVALUATORS.keys().next().value);
  }
  return ev;
}

/** テスト用：classifyPhase の写し */
export function fastPhase(input) { const x = normalizeInput(input); return x.danger ? null : phaseOf(x); }
/** テスト用：judge(input).action の写し（analyzeKnown と同じ計算の道すじ） */
export function fastAction(input) {
  const x = normalizeInput(input);
  if (x.danger) return "safety";
  const phase = phaseOf(x);
  return CONSTANT[phase] || compilePhase(x, phase)(x);
}

// ---------------------------------------------------------------- 分かっていることの整理
const isKnown = (known, f) => known?.[f] !== undefined && ASKABLE[f].includes(known[f]);
/** 項目の数える値：[代表の値, 重み]。分かっていればその値（代表）だけ */
function valuesOf(f, known) {
  if (isKnown(known, f)) return [[rep(f, known[f]), 1]];
  return REPS[f].map(r => [r, ASKABLE[f].filter(v => rep(f, v) === r).length]);
}
/** 全部の組み合わせ（[{ v: {項目: 値}, w: 重み }]） */
function product(fields, known) {
  let out = [{ v: {}, w: 1 }];
  for (const f of fields) {
    const vals = valuesOf(f, known), next = [];
    for (const o of out) for (const [v, w] of vals) next.push({ v: { ...o.v, [f]: v }, w: o.w * w });
    out = next;
  }
  return out;
}
/** 聞ける項目以外（文脈：深夜・場・8領域・仲直り済みなど）と、分かっている聞ける項目だけを残した入力 */
function contextOf(known) {
  const out = {};
  for (const [k, v] of Object.entries(known || {})) if (!(k in ASKABLE) || isKnown(known, k)) out[k] = v;
  return out;
}

/**
 * 分かっていない項目にありうる値を入れたときの、一手の分かれ方。
 * @param {object} known 判定の入力の一部（分からない項目は入れない）
 * @returns {{ actions: Map<string, number>, fields: { [f: string]: { counts: Map<any, Map<string, number>>, weights: Map<any, number> } } }}
 *   actions：一手 → 重み（組み合わせの数）。fields：分からない項目ごと、値（代表）→ 一手 → 重み。weights：値（代表）→ まとめた値の数
 */
export function analyzeKnown(known = {}) {
  const ctx = normalizeInput(contextOf(known));
  // くり返しは、仲直りしたあと（afterMakeup）のときだけ局面に効く。それ以外は数えない
  const unknown = Object.keys(ASKABLE).filter(f => !isKnown(known, f) && (f !== "repeat" || ctx.afterMakeup));
  const fixed = { ...known };
  if (!unknown.includes("repeat") && !isKnown(known, "repeat")) fixed.repeat = ctx.repeat;
  const NA = ACTIONS.length;
  const vlist = Object.fromEntries(unknown.map(f => [f, REPS[f]]));
  const viOf = (f, v) => vlist[f].indexOf(v);
  const P = PHASE_ONLY.filter(f => unknown.includes(f));
  const uS = SHARED.filter(f => unknown.includes(f)), uC = SCORE_ONLY.filter(f => unknown.includes(f));
  const pRows = product(PHASE_ONLY, fixed).map(p => ({ ...p, vi: P.map(f => viOf(f, p.v[f])) }));
  const sRows = product(SHARED, fixed).map(s => ({ ...s, k: SHARED.reduce((k, f) => k + keyPart(f, s.v[f]), 0), vi: uS.map(f => viOf(f, s.v[f])) }));
  const cRows = product(SCORE_ONLY, fixed).map(c => ({ ...c, k: SCORE_ONLY.reduce((k, f) => k + keyPart(f, c.v[f]), 0), vi: uC.map(f => viOf(f, c.v[f])) }));
  const ev = evaluatorFor(ctx);

  const total = new Float64Array(NA);
  const counts = Object.fromEntries(unknown.map(f => [f, new Float64Array(vlist[f].length * NA)]));
  // 局面の重みは配列で数える：W[局面]、WP[q][局面 × 値の数 + 値]（q は分からない局面の項目）
  const NP = PHASE_LIST.length;
  const W = new Float64Array(NP), WP = P.map(f => new Float64Array(NP * vlist[f].length));
  const hist = new Float64Array(NA), histC = uC.map(f => new Float64Array(vlist[f].length * NA));
  const x = { ...ctx };
  for (const s of sRows) {
    Object.assign(x, s.v);
    W.fill(0);
    for (const a of WP) a.fill(0);
    for (const p of pRows) {
      Object.assign(x, p.v);
      const pi = PHASE_INDEX[phaseOf(x)];
      W[pi] += p.w;
      for (let q = 0; q < P.length; q++) WP[q][pi * vlist[P[q]].length + p.vi[q]] += p.w;
    }
    for (let pi = 0; pi < NP; pi++) {
      const wph = W[pi];
      if (!wph) continue;
      // 点数だけに効く項目（原因・ゴール）の組み合わせごとの一手
      hist.fill(0);
      for (const h of histC) h.fill(0);
      for (const c of cRows) {
        const a = ev(pi, s, c);
        hist[a] += c.w;
        for (let q = 0; q < uC.length; q++) histC[q][c.vi[q] * NA + a] += c.w;
      }
      for (let a = 0; a < NA; a++) {
        const h = hist[a];
        if (!h) continue;
        total[a] += s.w * wph * h;
        for (let q = 0; q < uS.length; q++) counts[uS[q]][s.vi[q] * NA + a] += s.w * wph * h;
        for (let q = 0; q < P.length; q++) {
          const len = vlist[P[q]].length, arr = WP[q], cnt = counts[P[q]];
          for (let vi = 0; vi < len; vi++) { const wv = arr[pi * len + vi]; if (wv) cnt[vi * NA + a] += s.w * wv * h; }
        }
      }
      for (let q = 0; q < uC.length; q++) {
        const cnt = counts[uC[q]], hc = histC[q];
        for (let i = 0; i < hc.length; i++) if (hc[i]) cnt[i] += s.w * wph * hc[i];
      }
    }
  }
  // 返り値は読みやすい形（Map）に直す
  const toMap = (arr, off) => { const m = new Map(); for (let a = 0; a < NA; a++) if (arr[off + a]) m.set(ACTIONS[a], arr[off + a]); return m; };
  const fields = {};
  for (const f of unknown) {
    const cm = new Map();
    vlist[f].forEach((v, vi) => cm.set(v, toMap(counts[f], vi * NA)));
    fields[f] = { counts: cm, weights: new Map(valuesOf(f, {})) };
  }
  return { actions: toMap(total, 0), fields };
}

const entropy = (m) => {
  let n = 0, h = 0;
  for (const c of m.values()) n += c;
  for (const c of m.values()) if (c > 0) { const p = c / n; h -= p * Math.log2(p); }
  return h;
};
/** 値によって一手の分かれ方が変わるか（値の重みで割ってくらべる。整数のまま） */
function informative({ counts, weights }) {
  const vals = [...counts.keys()];
  const acts = new Set();
  for (const m of counts.values()) for (const a of m.keys()) acts.add(a);
  for (let i = 1; i < vals.length; i++) {
    const m0 = counts.get(vals[0]), mi = counts.get(vals[i]), w0 = weights.get(vals[0]), wi = weights.get(vals[i]);
    for (const a of acts) if ((m0.get(a) || 0) * wi !== (mi.get(a) || 0) * w0) return true;
  }
  return false;
}
/** 答えたあとの一手の散らばりの見込み（小さいほどよく絞れる） */
function expectedEntropy({ counts }) {
  let n = 0, h = 0;
  for (const m of counts.values()) for (const c of m.values()) n += c;
  for (const m of counts.values()) { let nv = 0; for (const c of m.values()) nv += c; if (nv) h += (nv / n) * entropy(m); }
  return h;
}

/** 場面が分からない：誰が最後に送ったか・したいことが分からず、言い合いの最中・仲直り済み・距離や別れの話でもない */
function sceneUnknown(known) {
  return !isKnown(known, "lastSender") && !isKnown(known, "intent") && known.ongoing !== true
    && known.afterMakeup !== true && known.partnerLast !== "space" && known.partnerLast !== "breakup";
}
const idOf = (q) => typeof q === "string" ? q : q?.id;

/**
 * 次に聞く問（なければ null）。
 * @param {object} known  分かっている判定の入力（書いた文の読み取り＋答え＋文脈。分からない項目は入れない）。
 *   深夜かどうか（lateNight）・8領域（self・partner）など文から決まらないものも入れてよい（判定に使う）
 * @param {(string|{id: string})[]} [asked]  もう聞いた問（id か問そのもの）。数が上限に届いたら null
 * @param {{ maxTotal?: number }} [opts]
 * @returns {{ id: string, text: string, options: { label: string, patch: object }[], primary?: number, moreLabel?: string } | null}
 *   options[].patch は判定の入力への差分（applyAnswer で known に当てる）。場面の問は primary（先に出す数）と moreLabel を持つ
 */
export function nextQuestion(known = {}, asked = [], { maxTotal = MAX_QUESTIONS } = {}) {
  const askedIds = (asked || []).map(idOf);
  if (askedIds.length >= maxTotal) return null;
  if (known.danger) return null;
  // 場面が分からなければ、まず場面を1タップで（このときは一手が決まっていることはない）
  if (sceneUnknown(known) && !askedIds.includes("scene")) {
    return { ...SCENE_QUESTION, options: SCENES.map(s => ({ id: s.id, label: s.label, patch: { ...s.patch } })) };
  }
  const an = analyzeKnown(known);
  if (an.actions.size <= 1) return null;
  let best = null, bestH = Infinity;
  for (const f of ORDER) {
    const info = an.fields[f];
    if (!info || askedIds.includes(f) || !informative(info)) continue;
    const h = expectedEntropy(info);
    if (h < bestH - 1e-12) { best = f; bestH = h; }
  }
  if (!best) return null;
  return { id: best, ...QUESTIONS[best](known) };
}

/** 答え（選んだ選択肢の patch）を当てた新しい known（元は変えない） */
export function applyAnswer(known = {}, patch = {}) { return { ...known, ...patch }; }

/** 判定に渡す入力（分からない項目は既定値で埋める）と、その判定 */
export function finalInput(known = {}) { return normalizeInput(contextOf(known)); }
export function decide(known = {}) { return judge(finalInput(known)); }

/**
 * 問を上限まで順に聞いて答える（画面の流れと同じ。テスト・道具用）。
 * @param {object} known
 * @param {(q) => object} answer  問 → 選んだ選択肢（{ label, patch }）。null を返したら打ち切り
 * @param {{ maxTotal?: number }} [opts]
 * @returns {{ known: object, asked: object[], picks: object[], result: object }}
 */
export function runQuestions(known = {}, answer, opts = {}) {
  let k = { ...known };
  const asked = [], picks = [];
  for (;;) {
    const q = nextQuestion(k, asked, opts);
    if (!q) break;
    const o = answer(q);
    asked.push(q);
    if (!o) break;
    picks.push(o);
    k = applyAnswer(k, o.patch);
  }
  return { known: k, asked, picks, result: decide(k) };
}
