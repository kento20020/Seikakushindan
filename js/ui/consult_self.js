// 相談（試作）の「あなたのタイプ」：どの診断結果を使うか決めて、8領域（直した分を含む）と主軸を取り出す。DOM なし。
//  - この端末の三択の結果：三択画面が持っている結果（store3.result。localStorage の seikaku16:three:v1 から復元）。三択画面の状態は変えない
//  - サンプル：5択回答を三択に変換して流した結果（adaptive3.js の fromLikertAnswers）。三択画面の runSample3 は使わない（この端末の結果を上書きしないため）
import { store3, restore3 } from "./three_store.js";
import { SAMPLES3 } from "../data/samples3.js";
import { fromLikertAnswers } from "../adaptive3.js";
import { DEFAULT_THREE_VERSION } from "../three_version.js";
import { PATTERN_BY_ID } from "../data/patterns.js";
import { DOMAINS } from "../engine3.js";
import { domainsFromProfile3, applySelfCorrections } from "../consult/from_diagnosis.js";
import { SELF_LABELS } from "../consult/texts.js";
import { SAMPLE_KEY, activeCorrections } from "./consult_state.js";

const sampleCache = new Map();

/** この端末に終わった三択の結果があれば { result, name }。なければ null */
export function deviceResult() {
  try {
    restore3();
    const r = store3.result;
    if (!r || !r.profile3) return null;
    return { result: r, name: r.source?.name || "あなたの回答", estimated: !!r.source?.estimated };
  } catch { return null; }
}

/** サンプル（架空の例1・2）の結果。一度作ったら使い回す */
export function sampleResult(type) {
  const key = SAMPLE_KEY[type];
  if (!key) return null;
  if (sampleCache.has(key)) return sampleCache.get(key);
  const s = SAMPLES3.find(x => x.key === key);
  let out = null;
  if (s) {
    const result = fromLikertAnswers(s.answers, s.wording, { version: DEFAULT_THREE_VERSION }).result();
    out = { result, name: `サンプル：${key}`, estimated: true };
  }
  sampleCache.set(key, out);
  return out;
}

/** 使う種類。選んでいなければ、この端末の結果があればそれ、なければ診断なし。三択を選んだのに結果がなければ診断なし */
export function effectiveType(state, hasDevice = !!deviceResult()) {
  const t = state.selfType ?? (hasDevice ? "three" : "none");
  return t === "three" && !hasDevice ? "none" : t;
}

/** 結果から主軸のパターン { id, headline }。なければ null */
export function mainPattern(result) {
  const hit = result?.select?.chosen?.find(x => x.role === "主軸");
  if (!hit) return null;
  return { id: hit.meta.id, headline: PATTERN_BY_ID[hit.meta.id]?.headline ?? hit.meta.headline ?? "" };
}

/**
 * 画面が使うまとめ。
 * @returns {{ type: string, name: string|null, estimated: boolean, base: object|null, domains: object|null, corrections: object, main: {id: string, headline: string}|null }}
 *   base … 診断のままの8領域、domains … 直したあとの8領域（buildContext の self に渡す）、corrections … 今有効な直し {領域: 向き}
 */
export function resolveSelf(state) {
  const dev = deviceResult();
  const type = effectiveType(state, !!dev);
  const src = type === "three" ? dev : (type === "sample1" || type === "sample2") ? sampleResult(type) : null;
  if (!src) return { type: "none", name: null, estimated: false, base: null, domains: null, corrections: {}, main: null };
  const base = domainsFromProfile3(src.result.profile3);
  const corrections = activeCorrections(state, base);
  return { type, name: src.name, estimated: src.estimated, base, domains: applySelfCorrections(base, corrections), corrections, main: mainPattern(src.result) };
}

const TAG = { sure: "確か", est: "弱め", none: "不明" };
const EST_WHY = { weak: "左右は優勢だが、強さが弱め", conflict: "左右と強さの向きが逆" };

/** 8領域の表示用の行。known＝診断で向きが決まった（「これは違う」を出す）。tag＝確かさの札 */
export function domainRows(self) {
  if (!self?.base) return [];
  return Object.keys(DOMAINS).map(Number).map(d => {
    const b = self.base[d], v = self.domains[d];
    const known = !!b.side;
    const fixed = known && v.source === "stated";
    const tag = !known ? TAG.none : fixed ? "直した" : TAG[v.conf] ?? TAG.none;
    const text = !v.side ? "診断では決まりませんでした" : SELF_LABELS[d][v.side];
    const why = fixed ? "あなたが直しました" : v.reason ? EST_WHY[v.reason] : null;
    return { d, name: DOMAINS[d].name, text, tag, known, fixed, why, conf: v.conf, side: v.side };
  });
}

/** 「これは違う」の向きの反転 */
export const opposite = (side) => side === "A" ? "B" : "A";
