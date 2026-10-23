// 新しい画面（app/）の24問（v4）の結果の出し方の版。DOM を使わない（Node のテストでも動く）。決定 U46
// 仕様：docs/diagnosis-v4.md §6.3・docs/app-screens.md §4.4
//
//   "v4.1" … 持ち主の原稿の形（既定）：絵・タイトル1つ・本文・補足0〜1文・相手に伝える一言・閉じた「回答の内訳を見る」・操作
//            文は js/result_copy4.js（原稿の写しは js/data/result_copy4.js）。ホームの診断後のカード・履歴の題・シェアの文・いちばん上の絵も同じ文から
//   "u44"  … 前の形（決定 U44）：見出し『今回の回答で目立つ傾向』・主軸と補足のカード・8つの領域の線と絵・状態の見出しと本文
//
// ■ 前の形に戻すとき：下の DEFAULT_RESULT_COPY を "u44" にする（この1行だけ）。その場で見るだけなら URL に ?rc=u44（例 app/?rc=u44#result）。
//   ?rc=v4.1 で新しい形。三択（v3）の結果の画面は ?rc= では変わらない（三択は下の ?rc3=。決定 U49）
//
//   rcFromSearch(search)   … URL の検索文字列から版（知らない値は null）
//   resultCopyVersion()    … 今の版（URL の ?rc= ＞ 既定）
//   isCopyResult()         … 新しい形（"v4.1"）か
//
// ■ 三択（80問。v3）の結果と、診断結果の一覧（#types）の出し方（決定 U49。docs/app-screens.md §24）
//   三択の結果：DEFAULT_RESULT_COPY3 = "copy"（持ち主の原稿の形。js/result_copy3.js）。URL の ?rc3=old で前の形（今までの result.js の画面）、?rc3=copy で新しい形
//     結果の画面・ホームの診断後のカード・履歴の題・シェアの文・いちばん上の絵（#images・#types の「いちばん上の絵」の印）がそろって切り替わる
//   診断結果の一覧：DEFAULT_TYPE_COPY = "copy"（24タイプの説明を原稿の文に）。URL の ?tc=old で前の一覧（BASIC_TEXT の one と「この型に近い見出し」）、?tc=copy で新しい形
//   すぐに戻すときは、下の DEFAULT_RESULT_COPY3・DEFAULT_TYPE_COPY を "old" にする（それぞれ1行）
//
//   rc3FromSearch(search)・resultCopy3Version()・isCopyResult3() … 三択の結果の出し方（"copy" | "old"）
//   tcFromSearch(search)・typeCopyVersion()・isCopyTypes()       … 診断結果の一覧の出し方（"copy" | "old"）
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

// ================================================================ 三択の結果・診断結果の一覧（決定 U49）
export const DEFAULT_RESULT_COPY3 = "copy";
export const DEFAULT_TYPE_COPY = "copy";
export const COPY_FORMS = Object.freeze(["old", "copy"]);
export const isCopyForm = (v) => typeof v === "string" && COPY_FORMS.includes(v);

/** URL の検索文字列から name の値（"old" | "copy"）。無い・知らない値なら null */
function formFromSearch(search, name) {
  try {
    const v = new URLSearchParams(String(search ?? "")).get(name);
    const k = v == null ? "" : v.trim().toLowerCase();
    return isCopyForm(k) ? k : null;
  } catch { return null; }
}
const urlForm = (name) => { try { return formFromSearch(globalThis.location?.search || "", name); } catch { return null; } };
const pick = (url, def) => (isCopyForm(url) ? url : isCopyForm(def) ? def : "copy");

/** "?rc3=old" など → "old" | "copy" | null */
export const rc3FromSearch = (search) => formFromSearch(search, "rc3");
/** 三択の結果の出し方（URL の ?rc3= ＞ 既定）。def を渡すと既定の代わりに使う（テスト用） */
export function resultCopy3Version({ url = urlForm("rc3"), def = DEFAULT_RESULT_COPY3 } = {}) { return pick(url, def); }
/** 三択の結果が持ち主の原稿の形か */
export const isCopyResult3 = (opts) => resultCopy3Version(opts) === "copy";

/** "?tc=old" など → "old" | "copy" | null */
export const tcFromSearch = (search) => formFromSearch(search, "tc");
/** 診断結果の一覧の出し方（URL の ?tc= ＞ 既定） */
export function typeCopyVersion({ url = urlForm("tc"), def = DEFAULT_TYPE_COPY } = {}) { return pick(url, def); }
/** 診断結果の一覧が原稿の文か */
export const isCopyTypes = (opts) => typeCopyVersion(opts) === "copy";
