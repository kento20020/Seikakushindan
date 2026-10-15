// 相談1回分の「文脈」：判定の入力・判定の結果・人ごとの層・相談文・文体・現在時刻をまとめる。説明：docs/consult-ai.md
// 決まった文型の回答（template_responder.js）・プロンプト（prompt.js）・AI の回答（ai_responder.js）は、どれもこの ctx だけを読む。
import { judge, normalizeInput } from "./judge.js";
import { CONF_WEIGHT, KEY_PARTNER_DOMAIN } from "./rules.js";
import { buildPersonLayer } from "./person_layer.js";
import { isLateNight } from "./timefmt.js";
import { PARTNER_QUESTIONS, CAUSE_QUESTION, SELF_HARM_RE, PARTNER_THREAT_RE } from "./texts.js";

const DOMAIN_KEYS = [1, 2, 3, 4, 5, 6, 7, 8];
const SOURCES = new Set(["diagnosis", "observed", "stated"]);
const REASONS = new Set(["weak", "conflict"]);
const REGISTERS = new Set(["casual", "polite"]);
/** 問いは2つまで（consult-mode.md §1 ③） */
export const MAX_REFINE_QUESTIONS = 2;

/** 8領域を { side, conf, source, reason? } にそろえる（judge は side・conf だけを使い、source・reason は言い方に使う） */
function normDomains(src) {
  const out = {};
  for (const d of DOMAIN_KEYS) {
    const v = src?.[d];
    const side = v?.side === "A" || v?.side === "B" ? v.side : null;
    const conf = side && Object.hasOwn(CONF_WEIGHT, v.conf) && v.conf !== "none" ? v.conf : "none";
    if (conf === "none") { out[d] = { side: null, conf: "none", source: "none" }; continue; }
    const source = SOURCES.has(v.source) ? v.source : conf === "observed" ? "observed" : "diagnosis";
    out[d] = { side, conf, source };
    if (conf === "est" && REASONS.has(v.reason)) out[d].reason = v.reason;
  }
  return out;
}

const freeText = (v, max = 20) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/**
 * 相談1回分の文脈。
 * @typedef {Object} ConsultContext
 * @property {object} input        判定の入力（既定値で埋めたもの。self・partner は { side, conf, source, reason? }）
 * @property {object} result       judge(input) の出力（§11）
 * @property {object} person       人ごとの層（person_layer.js の buildPersonLayer）
 * @property {string} consultText  本人の相談文（そのまま。プロンプトでは600字まで）
 * @property {object} couple       カップルの事実（person.couple と同じ）
 * @property {"casual"|"polite"} register  文面の文体（タメ口／敬語）
 * @property {string|null} partnerCall     相手の呼び方（20字まで）
 * @property {Date} now            現在時刻（これだけを時刻の計算に使う）
 * @property {number} tzOffset     時差（分。東が正。日本は 540）
 * @property {{ selfHarm: boolean, partnerThreat: boolean }} safety  安全ゲートの窓口の選び方（相談文の言葉か、引数 safety で決める）
 * @property {object} args         buildContext に渡した引数（applyPatchToContext で作り直すため）
 */

/**
 * 相談1回分の文脈を作る。
 * @param {Object} args
 * @param {object} [args.input]       判定の入力（consult-scoring.md §1。self・partner を入れてもよい）。lateNight を省くと now から決める（0時〜6時前）
 * @param {string} [args.consultText] 本人の相談文
 * @param {object} [args.self]        本人の8領域（from_diagnosis.js の形）。渡すと input.self より優先
 * @param {object} [args.partner]     相手の8領域。渡すと input.partner より優先
 * @param {object} [args.couple]      カップルの事実 { calmDownTime, medium, livingTogether, register, partnerCall }
 * @param {"casual"|"polite"} [args.register]  文面の文体（省くと couple.register、それもなければ casual）
 * @param {string} [args.partnerCall] 相手の呼び方（省くと couple.partnerCall）
 * @param {{ id: string, confirmed: boolean }} [args.selfMain]  本人の主軸（「当たっている」と答えたときだけ使われる）
 * @param {Date|string|number} [args.now]  現在時刻。省くと new Date()（そのときは同じ結果にならない）
 * @param {number} [args.tzOffset]    時差（分）。省くと now の実行環境の時差
 * @param {{ selfHarm?: boolean, partnerThreat?: boolean }} [args.safety]  安全ゲートの種類（省くと相談文から推定）
 * @returns {ConsultContext}
 */
export function buildContext(args = {}) {
  const { input = {}, consultText = "", self, partner, couple = {}, register, partnerCall, selfMain, tzOffset, safety } = args;
  const now = args.now instanceof Date ? new Date(args.now.getTime()) : args.now != null ? new Date(args.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("now が日時として読めない");
  const tz = Number.isFinite(tzOffset) ? tzOffset : -now.getTimezoneOffset();

  const raw = { ...input };
  if (self) raw.self = self;
  if (partner) raw.partner = partner;
  if (raw.lateNight === undefined) raw.lateNight = isLateNight(now, tz);
  const x = normalizeInput(raw);
  x.self = normDomains(raw.self);
  x.partner = normDomains(raw.partner);

  const text = String(consultText ?? "");
  const reg = REGISTERS.has(register) ? register : REGISTERS.has(couple?.register) ? couple.register : "casual";
  const person = buildPersonLayer({ self: x.self, partner: x.partner, couple, selfMain });
  return {
    input: x,
    result: judge(x),
    person,
    consultText: text,
    couple: person.couple,
    register: reg,
    partnerCall: freeText(partnerCall) ?? person.couple.partnerCall ?? null,
    now,
    tzOffset: tz,
    safety: {
      selfHarm: typeof safety?.selfHarm === "boolean" ? safety.selfHarm : SELF_HARM_RE.test(text),
      partnerThreat: typeof safety?.partnerThreat === "boolean" ? safety.partnerThreat : PARTNER_THREAT_RE.test(text),
    },
    args: { ...args },
  };
}

/**
 * 判定の入力に差分を当てた新しいオブジェクト（元は変えない）。self・partner は領域ごとに上書きする。
 *   applyPatch({ cause: "unknown", partner: { 1: {...} } }, { cause: "self", partner: { 2: { side: "A", conf: "observed", source: "observed" } } })
 *   → { cause: "self", partner: { 1: {...}, 2: {...} } }
 * @param {object} inputLike
 * @param {object} patch
 */
export function applyPatch(inputLike = {}, patch = {}) {
  const out = { ...inputLike };
  for (const [k, v] of Object.entries(patch || {})) {
    if ((k === "self" || k === "partner") && v && typeof v === "object") {
      const merged = { ...(inputLike?.[k] || {}) };
      for (const [d, dv] of Object.entries(v)) merged[d] = dv && typeof dv === "object" ? { ...dv } : dv;
      out[k] = merged;
    } else out[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...v } : v;
  }
  return out;
}

/**
 * 問いに答えたあとの文脈を作り直す（画面で選択肢を押したとき）。元の ctx は変えない。
 * buildContext に self・partner を別に渡していても、input に入れ直してから差分を当てる
 * @param {ConsultContext} ctx
 * @param {object} patch  refineQuestions の options[].patch
 * @returns {ConsultContext}
 */
export function applyPatchToContext(ctx, patch) {
  const a = ctx.args || {};
  const base = { ...(a.input || {}) };
  if (a.self) base.self = a.self;
  if (a.partner) base.partner = a.partner;
  return buildContext({ ...a, input: applyPatch(base, patch), self: undefined, partner: undefined });
}

/**
 * カードの下に出す問い（コードが決める。最大2つ）。
 *   (a) メモ confirm_cause（原因が分からないのに謝る一手）→「言い方がきつかったと、自分でも思う？」
 *   (b) 相手のタイプで一手（variants）か文面の指定（styleVariants）が変わる → その領域の2択（外から見える行動）。答えは observed
 * @param {ConsultContext} ctx
 * @returns {{ id: string, text: string, options: { label: string, patch: object }[] }[]}
 */
export function refineQuestions(ctx) {
  const r = ctx.result, out = [];
  if (!r || r.gate) return out;
  if (r.notes.includes("confirm_cause")) {
    out.push({ id: "cause", text: CAUSE_QUESTION.text, options: [
      { label: CAUSE_QUESTION.yes, patch: { cause: "self" } },
      { label: CAUSE_QUESTION.no, patch: { cause: "partner" } },
    ] });
  }
  const d = r.variants ? KEY_PARTNER_DOMAIN[r.phase] : r.styleVariants ? r.styleVariants.domain : null;
  if (d != null && ctx.input.partner[d]?.conf === "none") {
    const q = PARTNER_QUESTIONS[d];
    out.push({ id: `partner${d}`, text: q.text, options: ["A", "B"].map(side => ({
      label: q[side], patch: { partner: { [d]: { side, conf: "observed", source: "observed" } } },
    })) });
  }
  return out.slice(0, MAX_REFINE_QUESTIONS);
}
