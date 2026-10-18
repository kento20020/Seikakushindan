// 見た目の版（?ui=v1|v2）と、開発・検証用の表示（?dev=1）、テスト協力モード（?fb=1）、スワイプの形（?sw=）の判定。docs/design-tokens.md §5
//
//   ui  … "v1"（今の見た目）か "v2"（新しい見た目。css/tokens.css と css/ui2.css）。URL の ?ui= が無い・知らない値なら既定。
//         既定は index.html の <html data-ui-default="…">（DEFAULT_UI と同じ値にしておく。tests/ui_flags.test.mjs で確かめる）
//   dev … ?dev=1 のときだけ true。開発・検証用の表示（クラス dev-only）を出す（機能は消さず、利用者向けの既定では隠すだけ）
//   fb  … ?fb=1 のときだけ true（テスト協力モード。三択の開始画面にチェックを出す）
//   sw  … 三択の質問カードのスワイプの形。"c"（触った回答だけ。既定。決定 U28）・"card"（カードごと。前の既定）・"a"（回答をまとめて）・"b"（向きの側だけ）。
//         ?sw= が無い・知らない値なら既定。中身は js/ui/swipe_variants.js（カードの data-sw は js/ui/three.js が描くときに付ける）
//
// 実際に <html> へ data-ui・data-dev を付けるのは index.html の先頭の小さなスクリプト（CSS より前に走らせて、ちらつかせないため）。
// ここの resolveUiFlags はそのスクリプトと同じ判定の純粋関数。localStorage には保存しない（URL だけで決める）。

export const UI_VERSIONS = ["v1", "v2"];
export const DEFAULT_UI = "v1";
export const SWIPE_VARIANTS = ["card", "a", "b", "c"];
export const DEFAULT_SWIPE = "c";   // 決定 U28（2026-10-17）。前の形に戻すときは "card"（?sw=card でいつでも開ける）

/**
 * @param {string} search  location.search（"?ui=v2&dev=1" など。先頭の ? は無くてもよい）
 * @param {string} [defaultUi]  ?ui= が無い・知らない値のときの版（index.html の data-ui-default）
 * @returns {{ ui: "v1"|"v2", dev: boolean, fb: boolean, sw: "card"|"a"|"b"|"c" }}
 */
export function resolveUiFlags(search = "", defaultUi = DEFAULT_UI) {
  let q;
  try { q = new URLSearchParams(typeof search === "string" ? search : ""); } catch { q = new URLSearchParams(); }
  const def = UI_VERSIONS.includes(defaultUi) ? defaultUi : DEFAULT_UI;
  const u = q.get("ui"), sw = q.get("sw");
  return { ui: UI_VERSIONS.includes(u) ? u : def, dev: q.get("dev") === "1", fb: q.get("fb") === "1", sw: SWIPE_VARIANTS.includes(sw) ? sw : DEFAULT_SWIPE };
}

/** いま開いているページの判定（ブラウザの中だけ。Node では既定値） */
export function currentUiFlags() {
  let search = "", def = DEFAULT_UI;
  try { search = globalThis.location?.search || ""; } catch { /* 無視 */ }
  try { def = globalThis.document?.documentElement?.dataset?.uiDefault || DEFAULT_UI; } catch { /* 無視 */ }
  return resolveUiFlags(search, def);
}

/** 開発・検証用の表示か（?dev=1） */
export const isDev = () => currentUiFlags().dev;

/** サイト内の別ページへのリンクに、いまの ?ui= ?dev= ?sw= を引き継ぐ（ハッシュだけのリンクはそのままでクエリが残る） */
export function keepUiParams(params, search = "") {
  const out = new URLSearchParams(params);
  let q;
  try { q = new URLSearchParams(search); } catch { q = new URLSearchParams(); }
  for (const k of ["ui", "dev", "sw"]) if (q.has(k) && !out.has(k)) out.set(k, q.get(k));
  return out;
}
