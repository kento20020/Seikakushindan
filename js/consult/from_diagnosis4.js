// 24問版（v4）の診断結果 → 相談モードの入力。決定 U42・U44。仕様：docs/diagnosis-v4.md §8
// 判定（rules.js・judge.js）は変えない。三択の結果は今までどおり from_diagnosis.js の domainsFromProfile3。
//
//   domainsFromResult4(r) … 8領域の向き（from_diagnosis.js と同じ形 {1..8: { side: "A"|"B"|null, conf, source, reason? }}）
//     向きを付けるのは、強か寄りの領域だけ：A強・A寄り → "A"、B強・B寄り → "B"
//     まんなか・incomplete（まだ分からない）は不明（side null・conf "none"）
//     conf（判定が読む重みの名前。値は rules.js の CONF_WEIGHT）は新しい数を作らず、状態だけから決める：
//       強（3問とも、または答えた2問とも同じ側）→ "sure"（高め）、寄り（3問のうち2問）→ "est"（低め。reason "weak"。三択の「優勢（弱）」と同じ扱い）
//     source はどれも "diagnosis"（不明も「診断したが片方に決まらなかった」。三択と同じ）
//   consultClues4(r)      … 相談の手がかり（領域名・3問の答え・A の割合・状態・違いの印・欠けた問）。対人関係の事実として決めつけない
//     [{ domain, name, aName, bName, picks: { U, P, N }, n, a, b, share, state, differentDirections, missing: ["U1", …] }]
// 新しい画面（app/）の相談は、今のところ診断の結果を判定に使っていない（三択の結果も使っていない）。ここは、つなぐときの入口
import { DOMAINS } from "../engine.js";

const DOMAIN_KEYS = [1, 2, 3, 4, 5, 6, 7, 8];
const SIDE = Object.freeze({ strongA: "A", leanA: "A", leanB: "B", strongB: "B" });
const LEAN = new Set(["leanA", "leanB"]);

const isResult4 = (r) => !!r && typeof r === "object" && r.diagnosisVersion === "v4" && !!r.domains && typeof r.domains === "object";

/** 24問版の結果から、相談の8領域の向き。v4 の結果でなければ8領域すべて不明 */
export function domainsFromResult4(r) {
  const out = {};
  for (const d of DOMAIN_KEYS) {
    const st = isResult4(r) ? r.domains[d]?.state : undefined;
    const side = SIDE[st] ?? null;
    if (!side) { out[d] = { side: null, conf: "none", source: isResult4(r) ? "diagnosis" : "none" }; continue; }
    out[d] = LEAN.has(st) ? { side, conf: "est", source: "diagnosis", reason: "weak" } : { side, conf: "sure", source: "diagnosis" };
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
      picks: x.picks ? { ...x.picks } : { U: "unanswered", P: "unanswered", N: "unanswered" },
      n: x.n ?? 0, a: x.a ?? 0, b: x.b ?? 0, share: x.share ?? null,
      state: x.state ?? "incomplete", differentDirections: !!x.differentDirections,
      missing: Array.isArray(x.missing) ? x.missing.map((m) => m.id) : [],
    };
  });
}
