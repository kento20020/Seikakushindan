// 新しい画面（app/）で、どの版の診断を使うか（24問の v4 と、三択の v3）。DOM を使わない（Node のテストでも動く）。決定 U42
// 仕様：docs/diagnosis-v4.md §9（戻し方）・docs/app-screens.md §4.2。
//
// ■ 80問（三択 v3）に戻すとき：下の DEFAULT_DIAGNOSIS_VERSION を "v3" にする（この1行だけ）。
//   その場で試すだけなら URL に ?dv=v3（例 app/?dv=v3#diagnose）。?dv=v4 で 24問。
//   三択の中の設問の版（v1・v2・v3）は今までどおり js/three_version.js の DEFAULT_THREE_VERSION と ?qv=
//
// 決め方
//   新しく始める診断（#diagnose の開始画面）：URL の ?dv= ＞ DEFAULT_DIAGNOSIS_VERSION
//   今の診断（#diagnose/q・#result・ホーム・マイページ・履歴・#types・#images）：URL の ?dv= ＞ 最後に触った版（下の印）＞ v4 の保存がある ＞ v3 の保存がある ＞ 既定
//     途中の v3 は v3 のまま続く。v3 の結果は v3 の結果の画面で出る。古い答えを v4 に直さない
//   「最後に触った版」の印：localStorage の seikaku16:app:diagnosis（"v3" | "v4"）。app/ の中で三択か24問の診断が動いたとき（始めた・答えた・戻った・
//     引き継いだ）に書く。今の画面（../#three）で答えたときは書かない（そのときは、app/ で次にどちらかを触るまで前の印のまま）
//
//   currentVersion()     … 今の診断の版
//   newDiagnosisVersion() … 新しく始める診断の版
//   currentResult()      … 今の版の結果（v3 は store3.result、v4 は store4.result）か null
//   currentStatus()      … { version, state: "done"|"mid"|"before", answered, total, result }
//   discardCurrent()     … 今の版の診断を消す
//   setActiveVersion(v)  … 印を書く（引き継ぎのあとなど）
import { store3, restore3, onChange3, discard3 } from "../../js/ui/three_store.js";
import { store4, restore4, onChange4, progress4, discard4 } from "../../js/ui/four_store.js";

/** 新しく始める診断の既定の版。80問（三択 v3）に戻すときは "v3" にする */
export const DEFAULT_DIAGNOSIS_VERSION = "v4";

export const DIAGNOSIS_VERSIONS = Object.freeze(["v3", "v4"]);
export const ACTIVE_KEY = "seikaku16:app:diagnosis";
export const isDiagnosisVersion = (v) => typeof v === "string" && DIAGNOSIS_VERSIONS.includes(v);

/** URL の検索文字列（"?dv=v3" など）から版。無い・知らない値なら null */
export function dvFromSearch(search) {
  try {
    const v = new URLSearchParams(String(search ?? "")).get("dv");
    const k = v == null ? "" : v.trim().toLowerCase();
    return isDiagnosisVersion(k) ? k : null;
  } catch { return null; }
}

const urlVersion = () => { try { return dvFromSearch(globalThis.location?.search || ""); } catch { return null; } };
const fallback = () => (isDiagnosisVersion(DEFAULT_DIAGNOSIS_VERSION) ? DEFAULT_DIAGNOSIS_VERSION : "v3");

/**
 * 今の診断の版（DOM も保存も使わない形。テストで使う）
 *   url … ?dv= の版か null、marker … 最後に触った版か null、has3・has4 … その版の診断（途中・結果）が保存にあるか
 */
export function resolveCurrentVersion({ url = null, marker = null, has3 = false, has4 = false, def = fallback() } = {}) {
  if (isDiagnosisVersion(url)) return url;
  if (marker === "v4" && has4) return "v4";
  if (marker === "v3" && has3) return "v3";
  if (has4) return "v4";
  if (has3) return "v3";
  return isDiagnosisVersion(def) ? def : "v3";
}

/** 新しく始める診断の版（URL の ?dv= ＞ 既定） */
export function newDiagnosisVersion({ url = urlVersion(), def = fallback() } = {}) {
  return isDiagnosisVersion(url) ? url : isDiagnosisVersion(def) ? def : "v3";
}

// ---------------------------------------------------------------- 最後に触った版の印
function storage() { try { return globalThis.localStorage ?? null; } catch { return null; } }
function readMarker() {
  try { const v = storage()?.getItem(ACTIVE_KEY); return isDiagnosisVersion(v) ? v : null; } catch { return null; }
}
function writeMarker(v) {
  try {
    const s = storage();
    if (!s) return;
    if (isDiagnosisVersion(v)) s.setItem(ACTIVE_KEY, v); else s.removeItem(ACTIVE_KEY);
  } catch { /* 保存できなくても動く（そのときは保存の有る無しで決める） */ }
}
export function setActiveVersion(v) { writeMarker(isDiagnosisVersion(v) ? v : null); }
export function activeMarker() { return readMarker(); }

// 三択・24問の状態が変わったら印を書く（診断が無くなったら、その版の印だけ外す）
onChange3(() => { if (store3.session) writeMarker("v3"); else if (readMarker() === "v3") writeMarker(null); });
onChange4(() => { if (store4.session) writeMarker("v4"); else if (readMarker() === "v4") writeMarker(null); });

function load() { restore3(); restore4(); }

/** 今の診断の版。opts.url を null にすると URL の ?dv= を見ない（引き継ぎのコードに入れる版など） */
export function currentVersion({ url = urlVersion() } = {}) {
  load();
  return resolveCurrentVersion({ url, marker: readMarker(), has3: !!store3.session, has4: !!store4.session });
}

/** 今の版の結果か null */
export function currentResult(opts) {
  return currentVersion(opts) === "v4" ? store4.result : store3.result;
}

/** 三択の状態（home.js の diagnosisState と同じ決め方） */
function state3() {
  if (store3.result) return { state: "done", answered: null, total: null };
  const s = store3.session;
  try {
    if (s && !s.isDone()) {
      const p = s.progress();
      if (p.answered > 0) return { state: "mid", answered: p.answered, total: p.total };
    }
  } catch { /* 壊れたセッションは診断前として扱う */ }
  return { state: "before", answered: 0, total: null };
}

function state4() {
  if (store4.result) return { state: "done", answered: 24, total: 24 };
  const s = store4.session;
  if (s) {
    const p = progress4(s);
    if (p.answered > 0) return { state: "mid", answered: p.answered, total: p.total };
  }
  return { state: "before", answered: 0, total: 24 };
}

/** 今の診断の状態 { version, state: "done"|"mid"|"before", answered, total, result } */
export function currentStatus(opts) {
  const version = currentVersion(opts);
  const st = version === "v4" ? state4() : state3();
  return { version, ...st, result: version === "v4" ? store4.result : store3.result };
}

/** 三択の途中の診断（1問以上答えた）があるか。24問の開始画面に「続きから」を出すのに使う */
export function midV3() {
  load();
  const st = state3();
  return st.state === "mid" ? st : null;
}

/** 今の版の診断を消す（ほかの版の保存は残す） */
export function discardCurrent() {
  if (currentVersion() === "v4") discard4(); else discard3();
}
