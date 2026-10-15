// 決まった文型で「次の一手カード」を作る（AI を呼ばない今の回答。AI が失敗したときの戻り先でもある）。説明：docs/consult-ai.md
// 同じ ctx なら必ず同じカード（乱数・現在時刻の読み出しなし。時刻は ctx.now だけ）。文はすべて texts.js から取る。
// 方針：docs/consult-answer-guide.md 第2部（§2.2 の形と長さ、§2.4 の言い切り方、§2.6 の文面の決まり、§2.7 の理由の作り方、§2.9 の安全ゲート）
import { scoreActions } from "./judge.js";
import { KEY_PARTNER_DOMAIN } from "./rules.js";
import { recheckText, draftTimeText, localHour } from "./timefmt.js";
import { refineQuestions } from "./context.js";
import { cardLength, LIMITS, FORBIDDEN_WORDS } from "./card.js";
import * as T from "./texts.js";

// ---------------------------------------------------------------- 時刻
/** カードに書く点検時刻（夜中は「明日の朝」）と、文面に入れる時刻 */
export function cardTimes(ctx) {
  const r = ctx.result, o = { tzOffset: ctx.tzOffset };
  let draft = draftTimeText(r.recheck, ctx.now, o);
  // 相手が向き合う寄り（short_return）で、戻る時刻が夜中に当たって「明日の朝」に読み替えたときは、朝いちばんに戻ると書く
  if (draft === "明日の朝" && r.styles.includes("short_return") && r.recheck !== "next_morning") draft = "明日の朝いちばん";
  return { recheck: recheckText(r.recheck, ctx.now, { ...o, clampNight: true }), draft };
}

// ---------------------------------------------------------------- 相談文の引用
/**
 * 相談文の最初の「」の中身（1〜max 字。英数字・使わない語を含むものは使わない）。なければ null
 * 相談文は本人の自由記述なので、使うのはこの短い引用だけ（相手の最後の一言・安全ゲートの出来事）
 */
export function extractQuote(text, max = T.PARTNER_LINE_MAX) {
  const m = String(text ?? "").match(/「([^「」\n]{1,40})」/);
  if (!m) return null;
  const q = m[1].trim();
  if (!q || [...q].length > max) return null;
  if (/[A-Za-z0-9０-９!！]/.test(q) || FORBIDDEN_WORDS.some(w => q.includes(w))) return null;
  return q;
}

// ---------------------------------------------------------------- 理由（guide §2.7）
/** 状況の理由に使う ID（同点のときはこの順） */
const SITUATION_IDS = ["C1", "C1h", "L2", "L1", "L1b", "L3", "HG", "BRK", "AO7", "R3", "R3d", "G4", "G2", "G3", "C3", "C2", "V1", "RR",
  "R4", "AO9", "AO10", "AO11", "R1", "R7", "E1", "AO1", "AO3", "AO5", "AO8"];
/** 相手の理由に使う ID（同点のときはこの順） */
const PARTNER_IDS = ["P2A_silent", "P2B", "P2A", "P1A", "P1B", "P3A", "R2", "P8B", "P8A", "AO6", "P4B", "P4A", "P5A", "P5B", "P3B", "P6A", "P6B", "P7A", "R8"];
/** 本人の理由に使う ID（同点のときはこの順） */
const SELF_IDS = ["S7A", "S3A", "S8A", "S2A", "S4A"];
/** 状況の理由：この強さ以上なら相手・本人の理由より先に入れる。WEAK 以上なら空きがあれば入れる */
const DECISIVE = 20, WEAK = 5;
const SENDS = new Set(["pause_with_time", "acknowledge", "ask_feeling", "short_feeling", "apology_partial", "apology_full",
  "accept_apology", "restore_routine", "propose_call", "propose_talk_plan", "accept_space", "request_space"]);

/** 点を動かさない補正（指定・除外・付け足し）の強さ。0 なら理由にしない */
function fixedRelevance(id, ctx) {
  const r = ctx.result, a = r.action, acts = [a, ...r.addons], st = r.styles;
  switch (id) {
    case "BRK": return 50;
    case "AO7": case "R3d": case "L1b": return 40;
    case "HG": return a.startsWith("apology") ? 0 : 30;
    case "AO9": case "AO10": case "AO11": return 30;
    case "R4": return r.timing === "morning" ? 25 : 0;
    case "R1": return ["pause_with_time", "acknowledge", "accept_apology", "wait_until"].includes(a) ? 15 : 0;
    case "R7": return st.includes("spoken") ? 12 : 0;
    case "AO1": case "AO3": case "AO5": case "AO8": return 10;
    case "AO6": return 6;
    case "P5A": case "P5B": return ["apology_partial", "apology_full", "acknowledge", "accept_apology", "prepare_points"].includes(a) ? 4 : 0;
    case "P6A": case "P6B": return acts.includes("propose_talk_plan") ? 4 : 0;
    case "P1A": return st.includes("short_return") && acts.includes("pause_with_time") ? 4 : 0;
    case "P7A": return SENDS.has(a) ? 3 : 0;
    case "R8": return a === "pause_with_time" || a === "wait_until" ? 3 : 0;
    case "S3A": return 8;
    case "S8A": return 8;
    case "S2A": return 6;
    case "S7A": return 3;
    case "S4A": return SENDS.has(a) ? 3 : 0;
    default: return 0;
  }
}

/**
 * 理由に使う補正 ID を、強い順に並べる（状況・相手・本人の3つの列）。
 * 強さ ＝ max（一手を押し上げた点、2位の行動を押し下げた点、点を動かさない補正の決まった強さ）。
 * 相手・本人の ID は、その領域の確かさが none でないものだけ（判定で w > 0 のときだけ applied に入るので、いつも満たす）
 * @returns {{ situational: [string, number][], partner: [string, number][], self: [string, number][] }}
 */
export function rankReasonIds(ctx) {
  const r = ctx.result;
  const empty = { situational: [], partner: [], self: [] };
  if (!r || r.gate) return empty;
  const runner = r.scores.find(([a]) => a !== r.action)?.[0] ?? null;
  const all = scoreActions(ctx.input, r.phase).contributions;
  const cA = all[r.action] || {}, cR = runner ? all[runner] || {} : {};
  const rel = (id) => Math.max((cA[id] ?? 0), -(cR[id] ?? 0), fixedRelevance(id, ctx));
  const pick = (ids) => ids.filter(id => r.applied.includes(id) && reasonText(id, ctx))
    .map(id => [id, Math.round(rel(id) * 100) / 100]).filter(([, v]) => v > 0)
    .sort((p, q) => q[1] - p[1] || ids.indexOf(p[0]) - ids.indexOf(q[0]));
  return { situational: pick(SITUATION_IDS), partner: pick(PARTNER_IDS), self: pick(SELF_IDS) };
}

/** 補正 ID の理由の文（{確かさ}・{経過} を埋める）。確かさが none の領域の理由は null */
export function reasonText(id, ctx) {
  const t = T.REASON_TEMPLATES[id];
  if (!t) return null;
  let ins = "";
  const dom = T.REASON_DOMAIN[id];
  if (dom) {
    const k = T.confidenceKey(ctx.input?.[dom[0]]?.[dom[1]], dom[0]);
    if (!k) return null;
    ins = T.CONFIDENCE_INSERT[k];
  }
  return T.fill(t, { 確かさ: ins, 経過: T.ELAPSED_SPAN[ctx.input.elapsed] });
}

/** 局面の文（状況の理由の1つ目） */
export function phaseReason(ctx) {
  const r = ctx.result, x = ctx.input;
  const key = r.phase === "space.partner" && x.partnerLast === "breakup" ? "space.partner:breakup" : r.phase;
  const elapsed = r.phase === "waiting_partner" ? T.ELAPSED_SINCE[x.elapsed] : T.ELAPSED_STOP[x.elapsed];
  const q = x.partnerLast !== "none" ? extractQuote(ctx.consultText) : null;
  return T.fill(T.PHASE_REASONS[key], { 経過: elapsed, 相手の一言: q ? `「${q}」` : T.PARTNER_LINE_FALLBACK });
}

const REASON_ORDER = { sit: 0, partner: 1, self: 2, why: 3 };

/** 理由（最大3つ）：局面の文 → 状況 → 相手 → 本人。相手・本人の理由がなければ一手そのものの理由で2つにする */
function buildReasons(ctx) {
  const r = ctx.result;
  const rk = rankReasonIds(ctx);
  const sit = rk.situational[0];
  const decisive = sit && sit[1] >= DECISIVE ? sit[0] : null;
  const weak = sit && sit[1] >= WEAK && sit[1] < DECISIVE ? sit[0] : null;
  const partner = rk.partner[0]?.[0] ?? null, self = rk.self[0]?.[0] ?? null;
  const whyKey = r.action === "accept_space" && r.styles.includes("breakup") ? "accept_space:breakup" : r.action;
  const why = T.ACTION_WHY[whyKey] ?? null;
  const extras = [];
  if (decisive) extras.push(["sit", decisive]);
  if (partner) extras.push(["partner", partner]);
  if (self) extras.push(["self", self]);
  if (!extras.length) { if (why) extras.push(["why"]); else if (weak) extras.push(["sit", weak]); }
  else if (extras.length === 1 && (partner || self)) { if (weak) extras.push(["sit", weak]); else if (why) extras.push(["why"]); }
  const chosen = extras.slice(0, LIMITS.reasons - 1).sort((p, q) => REASON_ORDER[p[0]] - REASON_ORDER[q[0]]);
  const texts = [phaseReason(ctx), ...chosen.map(([k, id]) => k === "why" ? why : reasonText(id, ctx))];
  return [...new Set(texts.filter(Boolean))];
}

// ---------------------------------------------------------------- 見出し
function headline(ctx, tm) {
  const r = ctx.result, a = r.action, st = r.styles, ad = r.addons;
  let key = a;
  switch (a) {
    case "wait_until": if (ad.includes("ask_feeling")) key = "wait_until:ask"; break;
    case "pause_with_time":
      key = st.includes("spoken") ? "pause_with_time:spoken" : r.applied.includes("R3") ? "pause_with_time:hot" : r.phase === "heated" ? "pause_with_time:heated" : a;
      break;
    case "acknowledge": if (ad.includes("pause_with_time")) key = "acknowledge:pause"; break;
    case "short_feeling": if (st.includes("return_as_promised")) key = "short_feeling:promised"; break;
    case "apology_partial": key = r.notes.includes("confirm_cause") ? "apology_partial:confirm" : r.phase === "heated" ? "apology_partial:heated" : a; break;
    case "apology_full": if (ad.includes("propose_talk_plan")) key = "apology_full:plan"; break;
    case "accept_apology": if (st.includes("need_time")) key = "accept_apology:need_time"; break;
    case "restore_routine": if (ad.includes("propose_talk_plan")) key = "restore_routine:plan"; break;
    case "propose_talk_plan":
      key = st.includes("date_only") ? "propose_talk_plan:date_only" : r.phase === "partner_msg.d" ? "propose_talk_plan:reply"
        : r.phase === "after_makeup.repeat" ? "propose_talk_plan:repeat" : a;
      break;
    case "prepare_points": if (r.timing === "morning") key = "prepare_points:morning"; break;
    case "accept_space": if (st.includes("breakup")) key = "accept_space:breakup"; break;
  }
  const time = ["pause_with_time", "request_space", "propose_talk_plan"].includes(a) ? tm.draft : tm.recheck;
  let h = T.fill(T.HEADLINES[key], { 時刻: time });
  if (r.timing === "morning" && key !== "prepare_points:morning") h = T.HEADLINE_MORNING_PREFIX + h.replace(/^今日のうちに、/, "");
  return h;
}

// ---------------------------------------------------------------- 文面（guide §2.6）
const trimEnd = (s) => s.replace(/[。、\s]+$/, "");
/** 対面・同居（spoken）：返事・連絡の話の文を落とす（専用の言い方がない行動だけ） */
function toSpoken(text) {
  const parts = text.split("。").map(s => s.trim()).filter(Boolean);
  const kept = parts.filter(s => !/返事は|答えは急が/.test(s));
  return (kept.length ? kept : parts).join("。");
}

/** 話し合いの提案の文（場面 × 指定） */
function talkPlanText(ctx, reg) {
  const r = ctx.result, st = r.styles, p = T.DRAFTS.propose_talk_plan[reg];
  const kind = r.phase === "partner_msg.d" ? "reply" : r.phase === "after_makeup.repeat" ? "repeat" : r.phase === "before_talk" ? "tell" : "base";
  if (kind === "reply" && st.includes("date_only")) return p.reply_date_only;
  if (st.includes("offer_choices")) return p[`${kind}_offer_choices`];
  if (st.includes("propose_date")) return p[`${kind}_propose_date`];
  return p[kind];
}

/** 文面（0〜2）。2つ目は「別の言い方」（同じ中身・同じ文体）で、入れてもカードが450字に収まるときだけ */
function buildDrafts(ctx, tm) {
  const r = ctx.result, x = ctx.input, reg = ctx.register, a = r.action, st = r.styles, ad = r.addons;
  const D = T.DRAFTS, spoken = st.includes("spoken");
  const vars = { 時刻: tm.draft, いつ: ["heated", "waiting_partner"].includes(r.phase) ? "さっき" : "この前" };
  let text = null, alt = null, label = T.DRAFT_LABELS.send, ownSpoken = false;
  switch (a) {
    case "pause_with_time": {
      const p = D.pause_with_time[reg];
      if (spoken) { text = p.spoken; ownSpoken = true; }
      else if (r.applied.includes("R3")) text = p.hot;
      else if (st.includes("short_return")) text = p.short_return;
      else { text = p.base; alt = p.alt; }
      break;
    }
    case "acknowledge": {
      const p = D.acknowledge[reg], attack = r.phase === "partner_msg.c";
      const opener = attack ? p.attack : st.includes("feeling_first") ? p.feeling_first : st.includes("concrete") ? p.concrete : p.base;
      const tail = ad.includes("pause_with_time") ? p.tail_time : attack ? p.tail_attack : st.includes("feeling_first") ? "" : p.tail;
      text = opener + tail;
      break;
    }
    case "apology_partial": {
      const p = D.apology_partial[reg];
      const opener = x.selfLast === "attack" ? p.attack : st.includes("feeling_first") ? p.feeling_first
        : st.includes("concrete") ? p.concrete : x.cause === "both" ? p.both : p.base;
      const tail = ad.includes("pause_with_time") ? (spoken ? p.tail_pause_spoken : p.tail_pause)
        : ad.includes("propose_talk_plan") ? p.tail_plan
        : ["heated", "waiting_partner", "cold_war.short", "cold_war.long"].includes(r.phase) ? p.tail_listen : p.tail_none;
      text = opener + tail;
      ownSpoken = true;
      if (r.notes.includes("confirm_cause")) label = T.DRAFT_LABELS.confirm;
      break;
    }
    case "apology_full": {
      const p = D.apology_full[reg];
      let opener = st.includes("feeling_first") ? p.feeling_first : st.includes("concrete") ? p.concrete : p.base;
      if (st.includes("tone_down")) opener = opener.replace("本当に", "");
      const plan = !ad.includes("propose_talk_plan") ? "" : st.includes("offer_choices") ? p.tail_plan_offer_choices
        : st.includes("propose_date") ? p.tail_plan_propose_date : p.tail_plan;
      text = opener + p.next + plan;
      if (r.notes.includes("confirm_cause")) label = T.DRAFT_LABELS.confirm;
      break;
    }
    case "accept_apology": {
      const p = D.accept_apology[reg];
      text = st.includes("need_time") ? p.need_time : p.base;
      break;
    }
    case "restore_routine": {
      const p = D.restore_routine[reg], h = localHour(ctx.now, ctx.tzOffset);
      const morning = h >= 5 && h <= 10, reply = r.phase === "partner_msg.a";
      text = p[`${morning ? "morning" : "day"}${reply ? "_reply" : ""}`];
      break;
    }
    case "short_feeling": {
      const p = D.short_feeling[reg];
      if (st.includes("return_as_promised")) text = p.return_as_promised;
      else { text = p.base; alt = p.alt; }
      break;
    }
    case "ask_feeling": {
      const p = D.ask_feeling[reg];
      text = r.phase === "cold_war.ignored" ? p.later : r.applied.includes("HG") ? p.worried : p.base;
      break;
    }
    case "propose_call": text = D.propose_call[reg].base; break;
    case "propose_talk_plan": text = talkPlanText(ctx, reg); break;
    case "accept_space": text = st.includes("breakup") ? D.accept_space[reg].breakup : D.accept_space[reg].base; break;
    case "request_space": text = D.request_space[reg].base; break;
    case "wait_until":
      if (ad.includes("ask_feeling")) { text = D.ask_feeling[reg].later; label = T.DRAFT_LABELS.later; }
      break;
    case "prepare_points":
      if (ad.includes("propose_talk_plan")) text = talkPlanText(ctx, reg);
      break;
    default: break;   // self_calm：文面なし
  }
  if (!text) return [];
  const finish = (s) => {
    let t = trimEnd(T.fill(s, vars));
    if (spoken && !ownSpoken) t = toSpoken(t);
    return t;
  };
  if (spoken && label === T.DRAFT_LABELS.send) label = T.DRAFT_LABELS.spoken;
  if (r.timing === "morning" && label === T.DRAFT_LABELS.send) label = T.DRAFT_LABELS.morning;
  const out = [{ label, text: finish(text) }];
  if (alt && !spoken) out.push({ label: T.DRAFT_LABELS.alt, text: finish(alt) });
  return out;
}

// ---------------------------------------------------------------- 付け足し・やること・その後
/** 文面に入れていない付け足しの一行（最大2） */
function addonLines(ctx, tm) {
  const r = ctx.result, a = r.action, ad = r.addons, out = [];
  if (ad.includes("propose_call")) out.push(T.ADDON_LINES.propose_call);
  // 話し合いの提案は、謝る・受け取る文面や「伝えることの整理」の文面に入れてある。普段の返事（restore_routine）とは分ける
  if (ad.includes("propose_talk_plan") && !["apology_full", "apology_partial", "accept_apology", "prepare_points"].includes(a)) {
    out.push(a === "restore_routine" ? T.ADDON_LINES["propose_talk_plan:evening"] : T.ADDON_LINES.propose_talk_plan);
  }
  if (ad.includes("pause_with_time") && !["acknowledge", "apology_partial"].includes(a)) out.push(T.fill(T.ADDON_LINES.pause_with_time, { 時刻: tm.draft }));
  if (r.notes.includes("use_diagnosis")) out.push(T.ADDON_LINES.use_diagnosis);
  return out.slice(0, LIMITS.addonLines);
}

function doNow(ctx, tm) {
  const r = ctx.result, a = r.action, ad = r.addons;
  const t = (k) => T.fill(T.DO_NOW[k], { 時刻: tm.recheck });
  if (a === "self_calm") return t("self_calm:main");
  if (a === "wait_until") return t("wait_until");
  if (a === "prepare_points") return t(r.styles.includes("one_topic") ? "prepare_points:one_topic" : "prepare_points");
  if (ad.includes("self_calm")) return t(r.phase === "heated" ? "self_calm:heated" : ctx.input.lateNight ? "self_calm:night" : "self_calm");
  if (ad.includes("prepare_points")) return t(r.phase === "after_makeup.repeat" ? "prepare_points:addon" : "prepare_points");
  return null;
}

function afterLines(ctx, tm) {
  const r = ctx.result, a = r.action, st = r.styles, ad = r.addons;
  let key = a;
  if (a === "pause_with_time" && st.includes("spoken")) key = "pause_with_time:spoken";
  else if (a === "pause_with_time" && r.applied.includes("R3")) key = "pause_with_time:hot";
  else if (a === "wait_until" && ad.includes("ask_feeling")) key = "wait_until:ask";
  else if (a === "acknowledge" && !ad.includes("pause_with_time")) key = "acknowledge:none";
  else if (a === "apology_full" && ad.includes("propose_talk_plan")) key = "apology_full:plan";
  else if (a === "accept_apology" && st.includes("need_time")) key = "accept_apology:need_time";
  else if (a === "restore_routine" && ad.includes("propose_talk_plan")) key = "restore_routine:plan";
  else if (a === "accept_space" && st.includes("breakup")) key = "accept_space:breakup";
  const t = T.AFTER[key] ?? T.AFTER[a];
  if (!t) return { ifReply: null, ifNoReply: null };
  const vars = { 時刻: tm.recheck, 文面の時刻: tm.draft };
  return { ifReply: T.fill(t.reply, vars), ifNoReply: T.fill(t.noReply, vars) };
}

// ---------------------------------------------------------------- 2通り・確かさ（guide §2.4・§2.5）
function variantLines(ctx) {
  const r = ctx.result;
  if (r.variants) {
    const d = KEY_PARTNER_DOMAIN[r.phase];
    return ["A", "B"].map(side => {
      const act = r.variants[side];
      return `相手が${T.PARTNER_SIDE_TEXT[d][side]}なら → ${act === r.action ? T.VARIANT_SAME : T.VARIANT_ACTION_TEXT[act]}`;
    });
  }
  if (r.styleVariants) {
    const d = r.styleVariants.domain;
    return ["A", "B"].map(side => {
      const s = r.styleVariants[side][0];
      const hint = !s ? T.VARIANT_SAME : T.STYLE_HINTS_BY_ACTION[r.action]?.[s] ?? T.STYLE_HINTS[s];
      return `相手が${T.PARTNER_SIDE_TEXT[d][side]}なら → ${hint}`;
    });
  }
  return [];
}

function confidenceLine(ctx) {
  const r = ctx.result, key = KEY_PARTNER_DOMAIN[r.phase];
  const kv = key != null ? ctx.input.partner[key] : null;
  const L = T.CONFIDENCE_LINES;
  switch (r.confidence) {
    case "sure": return L.sure;
    case "est": return kv?.conf === "sure" ? L.est_close : kv?.conf === "observed" ? L.est_observed : L.est_weak;
    case "provisional":
      if (kv && kv.conf !== "none") return kv.conf === "observed" ? L.provisional_observed : L.provisional_weak;
      return refineQuestions(ctx).some(q => q.id.startsWith("partner")) ? L.provisional_ask : L.provisional;
    default: return L.situational;
  }
}

// ---------------------------------------------------------------- 安全ゲート（guide §2.9）
function safetyCard(ctx) {
  const s = ctx.safety || {}, S = T.SAFETY_TEXT, R = T.SAFETY_RESOURCES;
  const quote = s.selfHarm ? null : extractQuote(ctx.consultText, 20);
  const intro = (s.selfHarm ? S.introSelf : quote ? T.fill(S.introQuote, { 引用: quote }) : S.intro) + S.noAdvice;
  // 窓口は2〜3つ。番号は公開前に公式サイトで確かめ直す（texts.js の SAFETY_RESOURCES）
  const resources = s.selfHarm ? [R.yorisoi_self, R.dv_navi, R.dv_plus]
    : s.partnerThreat ? [R.dv_navi, R.dv_plus, R.yorisoi_partner] : [R.dv_navi, R.dv_plus];
  return {
    kind: "safety", headline: S.headline, addonLines: [], timingLine: null, reasons: [], drafts: [], variantLines: [],
    doNow: null, avoid: [], ifReply: null, ifNoReply: null, confidenceLine: null,
    safety: { intro, resources: resources.map(x => ({ ...x })), steps: [...(s.selfHarm ? S.stepsSelf : S.steps)], closing: S.closing },
  };
}

// ---------------------------------------------------------------- 本体
/**
 * 決まった文型で次の一手カードを作る（同期・決定的）。
 * @param {import("./context.js").ConsultContext} ctx  buildContext の返り値
 * @returns {import("./card.js").ConsultCard}
 */
export function templateRespond(ctx) {
  const r = ctx.result;
  if (r.action === "safety") return safetyCard(ctx);
  const tm = cardTimes(ctx);
  const after = afterLines(ctx, tm);
  const card = {
    kind: "card",
    headline: headline(ctx, tm),
    addonLines: addonLines(ctx, tm),
    timingLine: r.timing === "morning" ? T.TIMING_LINE_MORNING : null,
    reasons: buildReasons(ctx),
    drafts: buildDrafts(ctx, tm),
    variantLines: variantLines(ctx),
    doNow: doNow(ctx, tm),
    avoid: r.avoid.map(id => T.AVOID_EXAMPLES[id]).filter(Boolean).slice(0, LIMITS.avoid),
    ifReply: after.ifReply,
    ifNoReply: after.ifNoReply,
    confidenceLine: confidenceLine(ctx),
    safety: null,
  };
  // 450字に収める：「別の言い方」→ 3つ目の理由 → 2通りの行 の順に外す
  if (card.drafts.length > 1 && cardLength(card) > LIMITS.total) card.drafts = card.drafts.slice(0, 1);
  if (card.reasons.length > 2 && cardLength(card) > LIMITS.total) card.reasons = card.reasons.slice(0, 2);
  if (card.variantLines.length && cardLength(card) > LIMITS.total) card.variantLines = [];
  return card;
}
