// 書いた文の読み取りの共通の形と、規則と Clef の組み合わせ（案D。決定 U14・U17）。説明：docs/consult-reading.md
// 規則（extract_rules.js）は端末の中で毎回動く。Clef（clef.js）の答えは、呼べたときだけ渡す（無ければ規則だけ）。
// 組み合わせの決まり（U17）：
//   両方にあって同じ → 埋める（sources: "both"）／両方にあって違う → 埋めずに conflicts へ（分からない扱い。足りない問で聞く）
//   片方だけ → 埋める（"rules" か "clef"。Clef は確率が基準以上のものだけが来る）／Clef が迷った項目 → lowConfidence（確認の画面で目立たせる）
//   安全（自分を傷つける言葉・相手の脅し）は、規則の結果を常に使う（Clef に頼らない）
import { extractRules } from "./extract_rules.js";
import { parseClefAnswers } from "./clef.js";

/** 読み取る項目（docs/consult-scoring.md §1 の値） */
export const READ_KEYS = ["lastSender", "elapsed", "partnerLast", "ongoing", "selfTemp", "intent", "goal", "cause", "repeat", "afterMakeup", "selfLast"];

/**
 * 書いた文を読む。
 * @param {string} text
 * @param {{ clef?: object, threshold?: number }} [opts]
 *   clef：parseClefAnswers の結果（{ fields, confidence, low, unknown }）。Clef の生の返り値（{ answers } など）を渡してもよい（ここで読む）
 * @returns {{
 *   fields: object,                        判定の入力の一部（読めたものだけ）
 *   sources: { [key: string]: "rules"|"clef"|"both" },
 *   conflicts: string[],                   規則と Clef が食い違って埋めなかった項目
 *   conflictValues: { [key: string]: { rules: any, clef: any } },
 *   lowConfidence: string[],               Clef の確率が低かった項目（規則で埋まっていても入れる）
 *   confidence: { [key: string]: number }, Clef の確からしさ（Clef を使ったときだけ）
 *   evidence: { [key: string]: string },   規則が根拠にした言葉（確認の画面で見せる）
 *   safety: { selfHarm: boolean, partnerThreat: boolean }
 * }}
 */
export function readText(text, { clef, threshold } = {}) {
  const r = extractRules(text);
  const c = clef && (clef.answers || clef.result) ? parseClefAnswers(clef, threshold != null ? { threshold } : {}) : clef || null;
  const cf = c?.fields || {};
  const fields = {}, sources = {}, conflicts = [], conflictValues = {};
  for (const k of READ_KEYS) {
    const a = r.fields[k], b = cf[k];
    if (a !== undefined && b !== undefined) {
      if (a === b) { fields[k] = a; sources[k] = "both"; }
      else { conflicts.push(k); conflictValues[k] = { rules: a, clef: b }; }
    } else if (a !== undefined) { fields[k] = a; sources[k] = "rules"; }
    else if (b !== undefined) { fields[k] = b; sources[k] = "clef"; }
  }
  const lowConfidence = READ_KEYS.filter(k => (c?.low || []).includes(k));
  const evidence = {};
  for (const [k, v] of Object.entries(r.evidence)) if (k in fields) evidence[k] = v;
  return { fields, sources, conflicts, conflictValues, lowConfidence, confidence: { ...(c?.confidence || {}) }, evidence, safety: { ...r.safety } };
}
