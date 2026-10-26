// 新しい画面（app/）の相談（#consult）の形の版。DOM を使わない（Node のテストでも動く）。決定 U51
//
//   "chat" … チャットの形（既定）：やりとりを1本の列に、下に固定の入力の欄。返事は今の規則と決まった文（app/js/consult_chat.js）
//   "card" … 今までの形（段階ごとの画面と次の一手カード。app/js/consult.js。見た目と動きは変えていない）
//
// ■ 今までの形に戻すとき：下の DEFAULT_CONSULT_VERSION を "card" にする（この1行だけ）。その場で見るだけなら URL に ?cv=card（例 app/?cv=card#consult）。
//   ?cv=chat でチャットの形。どちらの形で作った相談も、記録の形は同じ（履歴の詳細は今までの savedView で出る。続きもどちらの形でも開ける）
//
//   consultVersionFrom(search) … URL の検索文字列から版（無い・知らない値なら既定）
//   consultVersion()           … 今の版（location.search から）
export const DEFAULT_CONSULT_VERSION = "chat";
export const CONSULT_VERSIONS = Object.freeze(["chat", "card"]);
export const isConsultVersion = (v) => typeof v === "string" && CONSULT_VERSIONS.includes(v);

const fallback = () => (isConsultVersion(DEFAULT_CONSULT_VERSION) ? DEFAULT_CONSULT_VERSION : "card");

/** URL の検索文字列（"?cv=card" など）から版。無い・知らない値なら既定 */
export function consultVersionFrom(search) {
  try {
    const v = new URLSearchParams(String(search ?? "")).get("cv");
    const k = v == null ? "" : v.trim().toLowerCase();
    return isConsultVersion(k) ? k : fallback();
  } catch { return fallback(); }
}

/** 今の版（URL の ?cv= ＞ 既定） */
export function consultVersion() {
  try { return consultVersionFrom(globalThis.location?.search || ""); } catch { return fallback(); }
}
