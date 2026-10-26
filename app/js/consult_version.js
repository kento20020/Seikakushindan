// 新しい画面（app/）の相談（#consult）の形の版。DOM を使わない（Node のテストでも動く）。決定 U51・U54
//
//   "talk" … ふつうのチャットの形（既定。決定 U54）：選ぶボタンなし（安全の確かめだけ）、一手は吹き出しの文章、足りないことは文で聞く。
//            上に「いまの状況」の3行だけ（app/js/consult_talk.js）
//   "chat" … ボタンつきのチャットの形（決定 U51〜U53。app/js/consult_chat.js。見た目と動きは変えていない）
//   "card" … 段階ごとの画面と次の一手カード（app/js/consult.js。見た目と動きは変えていない）
//
// ■ 戻すとき：下の DEFAULT_CONSULT_VERSION を "chat"（U51〜U53 のボタンつきのチャット）か "card"（段階ごとの画面）にする（この1行だけ）。
//   その場で見るだけなら URL に ?cv=chat か ?cv=card（例 app/?cv=chat#consult）。?cv=talk でふつうのチャットの形。
//   どの形で作った相談も、記録の形は同じ（履歴の詳細は今までの savedView で出る。続きもどの形でも開ける）
//
//   consultVersionFrom(search) … URL の検索文字列から版（無い・知らない値なら既定）
//   consultVersion()           … 今の版（location.search から）
export const DEFAULT_CONSULT_VERSION = "talk";
export const CONSULT_VERSIONS = Object.freeze(["talk", "chat", "card"]);
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
