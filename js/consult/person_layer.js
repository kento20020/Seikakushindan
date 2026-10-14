// 相談モードで AI に渡す「人ごとの層」（2層目）。決定：docs/decisions.md D2、中身：docs/consult-answer-guide.md §1.5
// 判定表が使った情報と同じものだけを渡す：8領域の向き・確かさ・出どころ（確度低の理由）、カップルの事実、
// 本人が「当たっている」と答えたときだけ本人の主軸の見出しと注意点（1行ずつ）。
// 入れないもの：X の level、W の数、パターンの詳細・場面例・独自性、補強・矛盾・地のパターン、相手のパターン、点数。
import { DOMAINS } from "../engine3.js";
import { getText } from "../data/patterns.js";
import { PATTERN_META } from "../data/patterns_meta.js";

const DOMAIN_KEYS = Object.keys(DOMAINS).map(Number);
const CONFS = new Set(["sure", "observed", "est"]);
const SOURCES = new Set(["diagnosis", "observed", "stated", "none"]);
const REASONS = new Set(["weak", "conflict"]);
const HEADLINE = Object.fromEntries(PATTERN_META.map(m => [m.id, m.headline]));
/** 自由記述の項目（落ち着くまでの時間・呼び方）の長さの上限 */
const FREE_TEXT_MAX = 20;

/** 8領域 → { domains: [{ d, name, tendency, conf, source, reason? }], unknown: [d…] }（領域の番号順） */
function domainsLayer(doms) {
  const domains = [], unknown = [];
  for (const d of DOMAIN_KEYS) {
    const v = doms?.[d];
    const side = v?.side === "A" || v?.side === "B" ? v.side : null;
    if (!side || !CONFS.has(v.conf)) { unknown.push(d); continue; }
    // 出どころが書かれていなければ、observed は見立て、それ以外は診断とみなす
    const source = SOURCES.has(v.source) && v.source !== "none" ? v.source : v.conf === "observed" ? "observed" : "diagnosis";
    const item = { d, name: DOMAINS[d].name, tendency: side === "A" ? DOMAINS[d].a : DOMAINS[d].b, conf: v.conf, source };
    if (v.conf === "est" && REASONS.has(v.reason)) item.reason = v.reason;
    domains.push(item);
  }
  return { domains, unknown };
}

const freeText = (v) => typeof v === "string" && v.trim() ? v.trim().slice(0, FREE_TEXT_MAX) : null;

function coupleLayer(c = {}) {
  return {
    calmDownTime: freeText(c?.calmDownTime),
    medium: c?.medium === "call" || c?.medium === "text" ? c.medium : null,
    livingTogether: typeof c?.livingTogether === "boolean" ? c.livingTogether : null,
    register: c?.register === "casual" || c?.register === "polite" ? c.register : null,
    partnerCall: freeText(c?.partnerCall),
  };
}

/** 本人の主軸：本人が「当たっている」と答えたとき（confirmed === true）だけ、見出しと注意点 */
function selfMainLayer(m) {
  if (!m || m.confirmed !== true || typeof m.id !== "string") return null;
  const t = getText(m.id);
  if (!t) return null;
  return { id: m.id, headline: HEADLINE[m.id] ?? null, caveat: t.caveat };
}

/**
 * 人ごとの層（素のオブジェクト）。
 *   self / partner … 8領域（judge の入力と同じ形。source・reason があれば使う）
 *   couple         … { calmDownTime, medium: "call"|"text", livingTogether, register: "casual"|"polite", partnerCall }（どれも省略可）
 *   selfMain       … { id, confirmed }（本人の主軸のパターン ID と「当たっている」と答えたか）
 */
export function buildPersonLayer({ self, partner, couple, selfMain } = {}) {
  return {
    self: domainsLayer(self),
    partner: domainsLayer(partner),
    couple: coupleLayer(couple),
    selfMain: selfMainLayer(selfMain),
  };
}

// ---------------------------------------------------------------- プロンプト用の文字列
const CONF_LABEL = { sure: "確か", observed: "見立て", est: "仮" };
const SOURCE_LABEL = {
  self: { diagnosis: "診断", stated: "本人が直した", observed: "見立て" },
  partner: { diagnosis: "相手の診断", observed: "あなたの見立て", stated: "本人が直した" },
};
const REASON_LABEL = { weak: "優勢が弱い", conflict: "向きが逆" };
const MEDIUM_LABEL = { call: "電話", text: "文字" };
const REGISTER_LABEL = { casual: "タメ口", polite: "敬語" };

function domainsText(who, layer) {
  // 見立て（observed）は出どころの「あなたの見立て」だけで確かさも伝わるので、確かさの語は重ねない
  const lines = layer.domains.map(x =>
    `${x.d} ${x.name}：${x.tendency}（${[x.conf !== "observed" && CONF_LABEL[x.conf], SOURCE_LABEL[who][x.source], x.reason && REASON_LABEL[x.reason]].filter(Boolean).join("・")}）`);
  if (layer.unknown.length) lines.push(`不明：${layer.unknown.map(d => `${d} ${DOMAINS[d].name}`).join("、")}`);
  return lines;
}

/** 人ごとの層を、プロンプトに入れる短い文字列にする（同じ層なら必ず同じ文字列） */
export function personLayerText(layer) {
  const out = ["[本人]", ...domainsText("self", layer.self)];
  if (layer.selfMain) {
    const m = layer.selfMain;
    if (m.headline) out.push(`主軸の見出し：${m.headline}`);
    out.push(`主軸の注意点：${m.caveat}`);
  }
  out.push("[相手]", ...domainsText("partner", layer.partner));
  const c = layer.couple, facts = [];
  if (c.calmDownTime) facts.push(`落ち着くまで：${c.calmDownTime}`);
  if (c.medium) facts.push(`話しやすいのは：${MEDIUM_LABEL[c.medium]}`);
  if (c.livingTogether != null) facts.push(`同居：${c.livingTogether ? "している" : "していない"}`);
  if (c.register) facts.push(`文体：${REGISTER_LABEL[c.register]}`);
  if (c.partnerCall) facts.push(`相手の呼び方：${c.partnerCall}`);
  if (facts.length) out.push("[ふたり]", ...facts);
  return out.join("\n");
}
