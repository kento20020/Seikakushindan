// 新しい画面（app/）の24問（v4）の結果の出し方の版。DOM を使わない（Node のテストでも動く）。決定 U46
// 仕様：docs/diagnosis-v4.md §6.3・docs/app-screens.md §4.4
//
//   "v4.1" … 持ち主の原稿の形（既定）：絵・タイトル1つ・本文・補足0〜1文・相手に伝える一言・閉じた「回答の内訳を見る」・操作
//            文は js/result_copy4.js（原稿の写しは js/data/result_copy4.js）。ホームの診断後のカード・履歴の題・シェアの文・いちばん上の絵も同じ文から
//   "u44"  … 前の形（決定 U44）：見出し『今回の回答で目立つ傾向』・主軸と補足のカード・8つの領域の線と絵・状態の見出しと本文
//
// ■ 前の形に戻すとき：下の DEFAULT_RESULT_COPY を "u44" にする（この1行だけ）。その場で見るだけなら URL に ?rc=u44（例 app/?rc=u44#result）。
//   ?rc=v4.1 で新しい形。三択（v3）の結果の画面はどちらでも変わらない
//
//   rcFromSearch(search)   … URL の検索文字列から版（知らない値は null）
//   resultCopyVersion()    … 今の版（URL の ?rc= ＞ 既定）
//   isCopyResult()         … 新しい形（"v4.1"）か
export const DEFAULT_RESULT_COPY = "v4.1";
export const RESULT_COPY_VERSIONS = Object.freeze(["u44", "v4.1"]);
export const isResultCopyVersion = (v) => typeof v === "string" && RESULT_COPY_VERSIONS.includes(v);

/** URL の検索文字列（"?rc=u44" など）から版。無い・知らない値なら null */
export function rcFromSearch(search) {
  try {
    const v = new URLSearchParams(String(search ?? "")).get("rc");
    const k = v == null ? "" : v.trim().toLowerCase();
    return isResultCopyVersion(k) ? k : null;
  } catch { return null; }
}

const urlVersion = () => { try { return rcFromSearch(globalThis.location?.search || ""); } catch { return null; } };

/** 今の版（URL の ?rc= ＞ 既定）。def を渡すと既定の代わりに使う（テスト用） */
export function resultCopyVersion({ url = urlVersion(), def = DEFAULT_RESULT_COPY } = {}) {
  if (isResultCopyVersion(url)) return url;
  return isResultCopyVersion(def) ? def : "v4.1";
}

/** 新しい形（持ち主の原稿の形）か */
export const isCopyResult = (opts) => resultCopyVersion(opts) === "v4.1";
