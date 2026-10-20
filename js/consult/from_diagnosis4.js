// 24問版（v4）の診断結果 → 相談モードの入力。決定 U42。仕様：docs/diagnosis-v4.md §8（持ち主の仕様書（2026-10-20）§7.1 の「相談に渡す情報」）
// 判定（rules.js・judge.js）は変えない。三択の結果は今までどおり from_diagnosis.js の domainsFromProfile3。
//
//   domainsFromResult4(r) … 8領域の向き（from_diagnosis.js と同じ形 {1..8: { side: "A"|"B"|null, conf, source, reason? }}）
//     向きを付けるのは、答えがそろい、向きがはっきりした領域だけ：状態 1・2・1w → "A"、3・4・3w → "B"
//     それ以外（5 どちらの傾向もある・6 どちらも強くは当てはまらない・7 片側だけにはまとまらない・incomplete まだ分からない）は不明（side null・conf "none"）
//     conf（判定が読む重みの名前。値は rules.js の CONF_WEIGHT）は新しい数を作らず、状態だけから決める：
//       1・2・3・4 → "sure"、1w・3w → "est"（reason "weak"。三択の「優勢（弱）」と同じ扱い）
//     source はどれも "diagnosis"（不明も「診断したが片方に決まらなかった」。三択と同じ）
//   consultClues4(r)      … 相談の手がかり（仕様書 §7.1：領域名・A/B の当てはまり・p・状態・欠けた項目）。対人関係の事実として決めつけない
//     [{ domain, name, aName, bName, a, b, p, state, differentDirections, missing: ["R1A", …] }]
// 新しい画面（app/）の相談は、今のところ診断の結果を判定に使っていない（三択の結果も使っていない）。ここは、つなぐときの入口
import { DOMAINS } from "../engine.js";

const DOMAIN_KEYS = [1, 2, 3, 4, 5, 6, 7, 8];
const SIDE = Object.freeze({ 1: "A", 2: "A", "1w": "A", 3: "B", 4: "B", "3w": "B" });
const WEAK = new Set(["1w", "3w"]);

const isResult4 = (r) => !!r && typeof r === "object" && r.diagnosisVersion === "v4" && !!r.domains && typeof r.domains === "object";

/** 24問版の結果から、相談の8領域の向き。v4 の結果でなければ8領域すべて不明 */
export function domainsFromResult4(r) {
  const out = {};
  for (const d of DOMAIN_KEYS) {
    const st = isResult4(r) ? r.domains[d]?.state : undefined;
    const side = SIDE[st] ?? null;
    if (!side) { out[d] = { side: null, conf: "none", source: isResult4(r) ? "diagnosis" : "none" }; continue; }
    out[d] = WEAK.has(st) ? { side, conf: "est", source: "diagnosis", reason: "weak" } : { side, conf: "sure", source: "diagnosis" };
  }
  return out;
}

/** 相談に渡す手がかり（領域ごと）。v4 の結果でなければ [] */
export function consultClues4(r) {
  if (!isResult4(r)) return [];
  return DOMAIN_KEYS.map((d) => {
    const x = r.domains[d] || {};
    const D = DOMAINS[d];
    return {
      domain: d, name: D.name, aName: D.a, bName: D.b,
      a: x.a ?? null, b: x.b ?? null, p: x.p ?? null,
      state: x.state ?? "incomplete", differentDirections: !!x.differentDirections,
      missing: Array.isArray(x.missing) ? x.missing.map((m) => m.id) : [],
    };
  });
}
