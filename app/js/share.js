// 診断結果のシェア（24問 v4 と三択 v3 の両方）と、共有のリンクから来た人の印。仕様：docs/app-screens.md §21（決定 U45）
//   読み込んだだけでは document・window・navigator・sessionStorage を触らない（Node のテストでも読める）。DOM を触るのは shareResult と copyText だけ
//
//   shareUrl(base)          … 共有のリンク（app/ の入口に ?from=share。結果は載せない。?dv= などほかのクエリとハッシュは付けない）
//   shareTextCopy4(copy)    … 24問の共有の文（持ち主の原稿の形。決定 U46。既定。copy は summary4.js の copyOf4(r)）
//   shareText4(lead)        … 24問の共有の文（前の形。?rc=u44。lead は summary4.js の leadOf4(r)）
//   shareTextCopy3(copy)    … 三択の共有の文（持ち主の原稿の形。決定 U49。既定。copy は summary.js の copyOf3(r)。24問の shareTextCopy4 と同じ形）
//   shareText3(main)        … 三択の共有の文（前の形。?rc3=old。main は summary.js の mainPattern(r)。見出しは headline）
//   shareResult({ text })   … 端末の共有の窓（navigator.share）。閉じたら何もしない。使えない・失敗したら「文＋改行＋リンク」をコピーして知らせる
//   copyText(text)          … コピー（clipboard API → だめなら隠した textarea と execCommand）
//   readFromShare(href)     … URL に from=share があるか、と from を外した URL { shared, href }（ほかのクエリとハッシュはそのまま）
//   markFromShare()・fromShare() … 共有のリンクから来た印（このタブの間だけ。sessionStorage。使えないときはこの読み込みの間だけ覚える）
//
// 決まり：結果（傾向・回答）はリンクに一切載せない。印はどこにも送らない。タブを閉じれば消える
import { h, toast } from "./ui.js";

export const SHARE_TITLE = "喧嘩の答え";                     // 共有の窓の題（決定 U43）。アプリによっては捨てられるので、文の頭にもサービス名を入れる
export const SHARE_LEAD = "喧嘩の答えで診断しました。";        // 文の1行目
export const SHARE_PARAM = "from";
export const SHARE_VALUE = "share";
export const FROM_SHARE_KEY = "a-from-share";                 // sessionStorage のキー
export const COPY_OK = "共有する文とリンクをコピーしました";
export const COPY_NG = "コピーできませんでした";

const clean = (s) => (typeof s === "string" ? s.trim() : "");

/** 共有のリンク：base（既定は今の URL）から見た app/ の入口に ?from=share。例 https://kento20020.github.io/Seikakushindan/app/?from=share */
export function shareUrl(base = globalThis.location?.href) {
  return new URL(`./?${SHARE_PARAM}=${SHARE_VALUE}`, base).href;
}

/**
 * 24問（v4）の共有の文（持ち主の原稿の形。決定 U46）
 *   「喧嘩の答えで診断しました。\n{結果の画面のタイトル}」。答えがそろった領域が無い（kind "none"）・copy が無い・題が空は1行目だけ
 */
export function shareTextCopy4(copy) {
  const title = clean(copy?.title);
  if (!title || copy.kind === "none") return SHARE_LEAD;
  return `${SHARE_LEAD}\n${title}`;
}

/**
 * 24問（v4）の共有の文（前の形。?rc=u44）
 *   primary … 「喧嘩の答えで診断しました。\n今回の回答で目立つ傾向：{見出し}」
 *   flat    … 「喧嘩の答えで診断しました。\n{見出し}でした。」（見出しは engine4.js の LEAD_TITLE4.flat）
 *   none・lead が無い・見出しが空 … 「喧嘩の答えで診断しました。」
 */
export function shareText4(lead) {
  const title = clean(lead?.title);
  if (!title) return SHARE_LEAD;
  if (lead.kind === "primary") return `${SHARE_LEAD}\n今回の回答で目立つ傾向：${title}`;
  if (lead.kind === "flat") return `${SHARE_LEAD}\n${title}でした。`;
  return SHARE_LEAD;
}

/** 三択（v3）の共有の文（持ち主の原稿の形。決定 U49）：「喧嘩の答えで診断しました。\n{結果の画面のタイトル}」（24問と同じ形） */
export function shareTextCopy3(copy) {
  return shareTextCopy4(copy);
}

/** 三択（v3）の共有の文（前の形。?rc3=old）。見出しがあれば「喧嘩の答えで診断しました。\n今回の主軸：{見出し}」、無ければ1行目だけ */
export function shareText3(main) {
  const headline = clean(main?.headline);
  return headline ? `${SHARE_LEAD}\n今回の主軸：${headline}` : SHARE_LEAD;
}

/** コピーする中身（共有の窓が使えないとき）：文＋改行＋リンク */
export const copyBody = (text, url) => `${text}\n${url}`;

/**
 * 結果のシェア（結果の画面の「シェア」のボタン）→ "shared" | "aborted" | "copied" | "failed"
 *   navigator.share({ title, text, url })。閉じた（AbortError）ときは何もしない。
 *   共有の機能が無い・ほかのエラーのときは「文＋改行＋リンク」をコピーして、トーストで知らせる
 */
export async function shareResult({ text = SHARE_LEAD, url = shareUrl() } = {}) {
  const nav = globalThis.navigator;
  if (typeof nav?.share === "function") {
    try { await nav.share({ title: SHARE_TITLE, text, url }); return "shared"; }
    catch (err) { if (err?.name === "AbortError") return "aborted"; }   // 閉じただけなら何もしない。ほかはコピーへ
  }
  const ok = await copyText(copyBody(text, url));
  toast(ok ? COPY_OK : COPY_NG);
  return ok ? "copied" : "failed";
}

/** 文をコピーする → できたか。clipboard API が使えないときは、隠した textarea を選んで execCommand("copy") */
export async function copyText(text) {
  try {
    if (globalThis.navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 下の方法で */ }
  try {
    const ta = h("textarea", { readonly: true, "aria-hidden": "true", tabindex: "-1", style: { position: "fixed", top: "0", left: "0", opacity: "0" } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

// ---------------------------------------------------------------- 共有のリンクから来た人
const keyOf = (part) => {
  const i = part.indexOf("=");
  const raw = i < 0 ? part : part.slice(0, i);
  try { return decodeURIComponent(raw.replace(/\+/g, " ")); } catch { return raw; }
};
const valueOf = (part) => {
  const i = part.indexOf("=");
  if (i < 0) return "";
  const raw = part.slice(i + 1);
  try { return decodeURIComponent(raw.replace(/\+/g, " ")); } catch { return raw; }
};

/**
 * URL に from=share があるか、と from を外した URL（DOM を使わない）
 *   from=share があるとき：{ shared: true, href: from を（いくつあっても）外した URL }。ほかのクエリの書き方とハッシュはそのまま
 *   無いとき（from=other・クエリなし・読めない URL）：{ shared: false, href: そのまま }
 *   例 …/app/?dv=v3&from=share#home → { shared: true, href: "…/app/?dv=v3#home" }
 */
export function readFromShare(href) {
  const src = String(href ?? "");
  let u;
  try { u = new URL(src); } catch { return { shared: false, href: src }; }
  const parts = u.search.replace(/^\?/, "").split("&").filter(Boolean);
  const shared = parts.some((p) => keyOf(p) === SHARE_PARAM && valueOf(p) === SHARE_VALUE);
  if (!shared) return { shared: false, href: src };
  const keep = parts.filter((p) => keyOf(p) !== SHARE_PARAM);
  const head = u.href.slice(0, u.href.length - u.search.length - u.hash.length);
  return { shared: true, href: `${head}${keep.length ? `?${keep.join("&")}` : ""}${u.hash}` };
}

let memMark = false;   // sessionStorage が使えないとき（この読み込みの間だけ）
function session() { try { return globalThis.sessionStorage ?? null; } catch { return null; } }

/** 共有のリンクから来た印を付ける（このタブの間だけ） */
export function markFromShare() {
  memMark = true;
  try { session()?.setItem(FROM_SHARE_KEY, "1"); } catch { /* この読み込みの間だけ覚える */ }
}

/** 共有のリンクから来たか（このタブの間） */
export function fromShare() {
  if (memMark) return true;
  try { return session()?.getItem(FROM_SHARE_KEY) === "1"; } catch { return false; }
}

/** 印を外す（テスト用） */
export function clearFromShare() {
  memMark = false;
  try { session()?.removeItem(FROM_SHARE_KEY); } catch { /* 無視 */ }
}
