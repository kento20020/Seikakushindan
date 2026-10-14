// 相談モードの判定（次の一手）。仕様：docs/consult-scoring.md、表の数字は js/consult/rules.js
// 同じ入力なら必ず同じ結果になる（乱数・時刻・外部の状態を使わない）。DOM なし（node でテスト可能）。
import { ACTIONS, BASE, PRIORITY, SELF_CALM_PHASE, HEAVY, KEY_PARTNER_DOMAIN, AVOID, CONF_WEIGHT,
  ADJUSTMENTS, ADDONS, MAX_ADDONS, PARTNER_CAP, apologyGateOpen, MARGIN_LOW, CONFIDENCE_DOWN, STYLE_KEY_BY_ACTION, STYLE_BY_DOMAIN_SIDE } from "./rules.js";

const DOMAIN_KEYS = [1, 2, 3, 4, 5, 6, 7, 8];
const noDomains = () => Object.fromEntries(DOMAIN_KEYS.map(d => [d, { side: null, conf: "none" }]));

/** 入力の既定値（§10 の冒頭）。書かれていない項目はこれで埋める */
export const DEFAULT_INPUT = Object.freeze({
  danger: false, ongoing: false, lastSender: "none", elapsed: "lt3h", partnerLast: "none", selfLast: "none",
  selfTemp: "cooling", cause: "unknown", severity: "small", repeat: false, afterMakeup: false, intent: "none",
  talkScheduled: false, medium: "text", lateNight: false, goal: "reconcile",
  self: Object.freeze(noDomains()), partner: Object.freeze(noDomains()),
});

const round = (x) => Math.round(x * 100) / 100;
const prio = (a) => { const i = PRIORITY.indexOf(a); return i < 0 ? PRIORITY.length : i; };

function normDomains(src) {
  const out = noDomains();
  for (const d of DOMAIN_KEYS) {
    const v = src?.[d];
    if (!v) continue;
    const side = v.side === "A" || v.side === "B" ? v.side : null;
    const conf = side && Object.hasOwn(CONF_WEIGHT, v.conf) ? v.conf : "none";
    out[d] = { side, conf };
  }
  return out;
}

/** 書かれていない項目を DEFAULT_INPUT で埋める（元の入力は変えない） */
export function normalizeInput(input = {}) {
  const x = { ...DEFAULT_INPUT, ...input };
  x.self = normDomains(input.self);
  x.partner = normDomains(input.partner);
  return x;
}

/** 領域 d が side なら確かさの係数 w、違えば 0 */
const weightOf = (doms, d, side) => { const v = doms[d]; return v && v.side === side ? CONF_WEIGHT[v.conf] ?? 0 : 0; };

// ---------------------------------------------------------------- §2 局面の判定
/** 局面キー。安全ゲート（danger）のときは null */
export function classifyPhase(input) {
  const x = normalizeInput(input);
  if (x.danger) return null;
  // 距離・別れ話が出ていれば、最後に送ったのがどちらでも（3日以内なら）space.partner
  if ((x.partnerLast === "space" || x.partnerLast === "breakup") && x.elapsed !== "ge3d") return "space.partner";
  if (x.intent === "request_space") return "space.self";
  if (x.partnerLast === "apology" && x.lastSender === "partner") return "got_apology";
  if (x.ongoing || (x.selfTemp === "high" && x.elapsed === "lt3h" && x.lastSender !== "partner")) return "heated";
  if (x.intent === "apologize") return "want_apologize";
  if (x.intent === "tell" || x.talkScheduled) return "before_talk";
  if (x.afterMakeup) return x.repeat ? "after_makeup.repeat" : "after_makeup.once";
  if (x.lastSender === "partner") {
    return { casual: "partner_msg.a", explain: "partner_msg.b", attack: "partner_msg.c", talk_proposal: "partner_msg.d" }[x.partnerLast] || "partner_msg.b";
  }
  if (x.lastSender === "self" && (x.elapsed === "lt3h" || x.elapsed === "3h_12h")) return "waiting_partner";
  if (x.lastSender === "self" && (x.selfLast === "reconcile" || x.selfLast === "apology")) return "cold_war.ignored";
  return x.elapsed === "ge3d" ? "cold_war.long" : "cold_war.short";
}

// ---------------------------------------------------------------- §3・§4 点数
function context(x, phase) {
  return { in: x, phase, pw: (d, s) => weightOf(x.partner, d, s), sw: (d, s) => weightOf(x.self, d, s) };
}

/**
 * 局面 phase での各行動の点数。
 * 返り値：{ scores: {行動: 点}（除外されていない行動だけ）, excluded: Set（空欄＋×）, blocked: Set（補正の × で除外したもの）,
 *          applied: [補正の ID], styles: [文面の指定] }
 * applied には、除外されていない行動の点を実際に動かした補正・候補を除外した補正・文面の指定を出した補正（と R4）だけを入れる。
 * 謝罪への加点（rule.apology）は門 HG を通す：開いていれば apology_partial、閉じていれば ask_feeling に足し、HG を applied に入れる。
 * 相手由来の補正（rule.w.domain がある）のうち w < 1.0 の分は、行動ごとに合計を ±PARTNER_CAP に抑える。抑えたら CAP を applied に入れる。
 */
export function scoreActions(input, phase) {
  const x = normalizeInput(input);
  const base = BASE[phase];
  if (!base) throw new Error("unknown phase: " + phase);
  const c = context(x, phase);

  // 適用される補正を集める（係数 w > 0 のものだけ）
  const fired = [];
  for (const r of ADJUSTMENTS) {
    if (r.when && !r.when(c)) continue;
    const w = r.w ? r.w(c) : 1;
    if (!(w > 0)) continue;
    fired.push({ r, w });
  }
  const blocked = new Set(fired.flatMap(({ r }) => r.exclude || []).filter(a => a in base));
  const excluded = new Set(ACTIONS.filter(a => !(a in base) || blocked.has(a)));

  const scores = {}, soft = {};   // soft：相手由来で w < 1.0 の補正の合計（上限をかける前）
  for (const a of ACTIONS) if (!excluded.has(a)) { scores[a] = base[a]; soft[a] = 0; }
  const applied = [], styles = [];
  const gateOpen = apologyGateOpen(x);
  for (const { r, w } of fired) {
    let effective = !!r.always || !!(r.exclude || []).some(a => blocked.has(a)) || !!(r.styles && r.styles.length);
    let redirected = false;
    const adds = Object.entries(r.add || {});
    if (r.apology) {
      if (gateOpen) adds.push(["apology_partial", r.apology]);
      else {
        adds.push(["ask_feeling", r.apology]);
        // 門が効いた（謝罪に入るはずの加点を止めた、または ask_feeling に振り替えた）
        redirected = !excluded.has("apology_partial") || !excluded.has("ask_feeling");
      }
    }
    const capped = r.w?.domain != null && w < 1;
    for (const [a, pts] of adds) {
      if (excluded.has(a) || pts * w === 0) continue;
      if (capped) soft[a] += pts * w; else scores[a] += pts * w;
      effective = true;
    }
    for (const s of r.styles || []) if (!styles.includes(s)) styles.push(s);
    if (effective && !applied.includes(r.id)) applied.push(r.id);
    if (redirected && !applied.includes("HG")) applied.push("HG");
  }
  let cap = false;
  for (const a of Object.keys(scores)) {
    const sv = round(soft[a]);
    const clamped = Math.max(-PARTNER_CAP, Math.min(PARTNER_CAP, sv));
    if (clamped !== sv) cap = true;
    scores[a] = round(scores[a] + clamped);
  }
  if (cap) applied.push("CAP");
  return { scores, excluded, blocked, applied, styles };
}

/** 点が最も高い行動（同点は §5 の優先順）。self_calm は after_makeup.once 以外では選ばない */
export function pickAction(scores, phase) {
  let best = null;
  for (const [a, v] of Object.entries(scores)) {
    if (a === "self_calm" && phase !== SELF_CALM_PHASE) continue;
    if (best == null || v > scores[best] || (v === scores[best] && prio(a) < prio(best))) best = a;
  }
  return best;
}

/** 点数の一覧（高い順、同点は優先順） */
const sortScores = (scores) => Object.entries(scores).sort((p, q) => q[1] - p[1] || prio(p[0]) - prio(q[0]));

/** 相手の領域 d を side（sure）にした入力 */
function withPartnerSide(x, d, side) {
  return { ...x, partner: { ...x.partner, [d]: { side, conf: "sure" } } };
}

// ---------------------------------------------------------------- §6 付け足し
function addonsFor(x, phase, action, base) {
  const c = { ...context(x, phase), action, scores: base.scores, blocked: base.blocked };
  const addons = [], applied = [], styles = [], notes = [];
  for (const r of ADDONS) {
    if (!r.when(c)) continue;
    let added = false;
    for (const a of r.acts) {
      if (addons.length >= MAX_ADDONS) break;
      if (a === action || addons.includes(a) || base.blocked.has(a)) continue;   // × で除外された行動は付け足さない
      addons.push(a);
      added = true;
    }
    const extra = [...(r.styles || []), ...(r.notes || [])];
    if (!added && !extra.length) continue;
    for (const s of r.styles || []) styles.push(s);
    for (const n of r.notes || []) notes.push(n);
    for (const id of r.because ? r.because(c) : []) applied.push(id);
    applied.push(r.id);
  }
  return { addons, applied, styles, notes };
}

// ---------------------------------------------------------------- §7 期限とタイミング
function timingOf(x, action) { return x.lateNight && HEAVY.has(action) ? "morning" : "now"; }

function recheckOf(x, phase, action, addons) {
  if (phase === "after_makeup.once") return "+7d";
  if (phase === "cold_war.ignored") return "+24h";
  if (phase === "heated") return x.lateNight ? "next_morning" : weightOf(x.partner, 1, "A") > 0 ? "+30m" : "+2h";
  const acts = [action, ...addons];
  if (acts.includes("wait_until") || acts.includes("pause_with_time")) {
    if (x.lateNight) return "next_morning";
    if (weightOf(x.partner, 2, "A") > 0) return "+3h";
    if (weightOf(x.partner, 2, "B") > 0) return "next_noon";
    return "next_morning";
  }
  return "+24h";
}

const uniq = (arr) => [...new Set(arr)];

// ---------------------------------------------------------------- §11 確かさ・差・文面の2通り
/** 一手の点 − 2位の点（相手が分からないときは低いほうの点で）。候補が1つだけなら null */
function marginOf(scores, action) {
  const others = Object.entries(scores).filter(([a]) => a !== action).map(([, v]) => v);
  return others.length ? round(scores[action] - Math.max(...others)) : null;
}

/** 鍵の領域の確かさ（none → provisional、est・observed → est、sure → sure、鍵なし → situational）。差が MARGIN_LOW 未満なら1段下げる */
function confidenceOf(x, phase, margin) {
  const key = KEY_PARTNER_DOMAIN[phase];
  const c = key == null ? "situational" : { none: "provisional", est: "est", observed: "est", sure: "sure" }[x.partner[key].conf];
  return margin != null && margin < MARGIN_LOW ? CONFIDENCE_DOWN[c] : c;
}

/** 一手の文面を左右する相手の領域が分からないとき、A・B それぞれの文面の指定 */
function styleVariantsOf(x, action) {
  const d = STYLE_KEY_BY_ACTION[action];
  if (d == null || x.partner[d].conf !== "none") return null;
  const v = STYLE_BY_DOMAIN_SIDE[d];
  return { domain: d, A: [...v.A], B: [...v.B] };
}

// ---------------------------------------------------------------- 判定（§11 の出力）
/**
 * 次の一手。
 * { gate, phase, action, addons, timing, recheck, styles, styleVariants, notes, variants, confidence, margin,
 *   scores:[[行動, 点]…], applied, avoid }
 * 相手の鍵の領域（§8）が分からないときは、A・B 両方で点数を出して行動ごとの低いほうで選ぶ（scores はその低いほう）。
 * A と B で一手が違えば variants = { A: 一手, B: 一手 }。付け足し・期限・applied・styles は元の入力（鍵の領域は不明のまま）で決める。
 */
export function judge(input) {
  const x = normalizeInput(input);
  if (x.danger) {
    return { gate: "danger", phase: null, action: "safety", addons: [], timing: "now", recheck: null,
      styles: [], styleVariants: null, notes: [], variants: null, confidence: null, margin: null, scores: [], applied: [], avoid: [] };
  }
  const phase = classifyPhase(x);
  const base = scoreActions(x, phase);
  let scores = base.scores, action, variants = null;

  const key = KEY_PARTNER_DOMAIN[phase];
  if (key != null && x.partner[key].conf === "none") {
    const sA = scoreActions(withPartnerSide(x, key, "A"), phase).scores;
    const sB = scoreActions(withPartnerSide(x, key, "B"), phase).scores;
    scores = {};
    for (const a of Object.keys(base.scores)) if (a in sA && a in sB) scores[a] = Math.min(sA[a], sB[a]);
    action = pickAction(scores, phase);
    const aA = pickAction(sA, phase), aB = pickAction(sB, phase);
    if (aA !== aB) variants = { A: aA, B: aB };
  } else {
    action = pickAction(scores, phase);
  }

  const ao = addonsFor(x, phase, action, base);
  const margin = marginOf(scores, action);
  // 謝る一手で、原因が分からず自分が責めたわけでもない → 謝る文を書く前に原因を確かめる
  const notes = [];
  if ((action === "apology_partial" || action === "apology_full") && x.cause === "unknown" && x.selfLast !== "attack") notes.push("confirm_cause");
  return {
    gate: null,
    phase,
    action,
    addons: ao.addons,
    timing: timingOf(x, action),
    recheck: recheckOf(x, phase, action, ao.addons),
    styles: uniq([...base.styles, ...ao.styles]),
    styleVariants: styleVariantsOf(x, action),
    notes: uniq([...notes, ...ao.notes]),
    variants,
    confidence: confidenceOf(x, phase, margin),
    margin,
    scores: sortScores(scores),
    applied: uniq([...base.applied, ...ao.applied]),
    avoid: [...(AVOID[phase] || [])],
  };
}
