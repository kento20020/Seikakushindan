// 三択（80問。v3）の結果の文を、24問と同じ持ち主の原稿の形（タイトル1つ・本文・補足0〜1文・相手に伝える一言）で選ぶ。決定 U49
// DOM を使わない（Node のテストでも動く）。文は js/data/result_copy4.js（原稿の写し。一字も変えない）。
// 組み立て（主軸 → 特別の組 → 本文と一言 → 補足 → 字数 → 主軸が無いとき）は js/result_copy4.js の resultCopyFromStates を使い回す。
// 三択の判定（js/engine3.js の domainStates3）・保存（js/ui/three_store.js）は変えない。ここは結果の r.states を読むだけ。
// 仕様：docs/diagnosis-v4.md §6.5
//
// 1. 領域ごとの原稿の状態（copyStateOf3）：domainStates3 の state（"1"〜"7"・"1w"・"3w"。原稿と同じ9種類）を、そのまま B{d}-{state} に当てる
//      state が null（判定なし：左右が拮抗し、強さが「両方強い・両方弱い・どちらかが中」のどれでもない）→ "7"（原稿 §7「上記にまとめない状態」）
//      領域の値が無い・形が違う → "incomplete"（三択では起きない。起きたら24問と同じ扱い）
//      向きの違いの専用の文（DIFFERENT_DIRECTIONS_COPY4）は使わない：三択の状態7は「左右が拮抗」が条件（engine3.js の basicParts3）で、
//      24問の「普段と場面の向きが逆」とは別の話なので、いつもの B{d}-7 のまま
// 2. 三択だけの足し（原稿 §5「選択側の評定、|p|、|a−b| の降順、最後に領域IDの昇順」「強い優勢＝選択側評定 ≧ 反対側」を、三択が持つ値で守る）
//      同じ段（1／3 → 2／4 → 1w／3w）の中の並び（order3）：選んだ側の強さ（A 側は LA、B 側は LB）の大きい順 → 選んだ側の左右の余裕
//        （A 側は mWA、B 側は mWB）の大きい順 → |LA − LB| の大きい順 → 領域の番号の順。主軸と補足の候補の両方に使う
//      補足の候補（bridgeOk3）：状態 1・2・3・4 のうち、選んだ側の強さ ≧ 反対側の強さ のものだけ（状態2・4 で反対側の方が強い領域は補足にしない）
//      特別の組 PAIR-7B-8B（pairOk3）：領域7と8がどちらも状態3か4・主軸が7か8（ここまでは24問と同じ）、かつ両方とも LB ≧ LA
// 3. 出力は24問と同じ形。copyVersion は "result-v3.1"（24問の "result-v4.1" と見分ける）。中の ID（B1-1・PAIR・テーマの名前）は画面に出さない
//
//   RESULT_COPY_VERSION3            … "result-v3.1"
//   copyStateOf3(st)                … 領域の原稿の状態（上の1）
//   copyStatesOf3(r)                … { 1: "1", 2: "7", … }（r は三択の結果。r.states を読む。r.states そのものを渡してもよい）
//   rankOf3(st, state)              … 並べ方の値 { side, strength, other, margin, diff }
//   order3(table)・bridgeOk3(table)・pairOk3(table) … resultCopyFromStates に渡す関数（table は domainStates3 の形）
//   resultCopyFromStates3(table)    … domainStates3 の形の表から結果の文（テストで状態の表を直接渡すときにも使う）
//   resultCopy3(r)                  … 三択の結果から結果の文 { copyVersion, copyId, kind, primaryDomain, side, title, paragraphs, bridge, bridgeDomain, action, claimTags }
import { DOMAIN_IDS4 } from "./engine4.js";
import { COPY_STATES4 } from "./data/result_copy4.js";
import { resultCopyFromStates, copySide4, COPY_MAX_CHARS4 } from "./result_copy4.js";

export const RESULT_COPY_VERSION3 = "result-v3.1";

const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);

/** 領域の原稿の状態。domainStates3 の state をそのまま。null・知らない値は "7"、領域の値が無ければ "incomplete" */
export function copyStateOf3(st) {
  if (!isObj(st)) return "incomplete";
  const s = st.state == null ? "" : String(st.state);
  return COPY_STATES4.includes(s) ? s : "7";
}

/** 三択の結果（r.states）か、domainStates3 の表そのものから、表を取り出す */
function tableOf(r) {
  if (!isObj(r)) return {};
  if (isObj(r.states)) return r.states;
  return DOMAIN_IDS4.some((d) => isObj(r[d]) && "state" in r[d]) ? r : {};
}

/** 8領域の原稿の状態 { 1: "1", … } */
export function copyStatesOf3(r) {
  const t = tableOf(r);
  return Object.fromEntries(DOMAIN_IDS4.map((d) => [d, copyStateOf3(t[d])]));
}

const num = (x, def) => (x !== null && x !== "" && Number.isFinite(+x) ? +x : def);

/**
 * 並べ方の値（領域の表の値 st と、原稿の状態 state から）
 *   side … 選んだ側（"A" | "B" | null）、strength … 選んだ側の強さ（LA か LB）、other … 反対側の強さ、
 *   margin … 選んだ側の左右の余裕（mWA か mWB）、diff … |LA − LB|
 *   強さが無ければ 50（engine3.js と同じ）、余裕が無ければ −100（未測定と同じ）
 */
export function rankOf3(st, state) {
  const side = copySide4(state);
  const LA = num(st?.LA, 50), LB = num(st?.LB, 50);
  const mWA = num(st?.mWA, -100), mWB = num(st?.mWB, -100);
  return {
    side,
    strength: side === "B" ? LB : LA,
    other: side === "B" ? LA : LB,
    margin: side === "B" ? mWB : mWA,
    diff: Math.abs(LA - LB),
  };
}

/** 同じ段の中の並べ方：強さ → 左右の余裕 → 差 → 領域の番号 */
export function order3(table) {
  const t = isObj(table) ? table : {};
  const memo = new Map();
  const rank = (d) => {
    if (!memo.has(d)) memo.set(d, rankOf3(t[d], copyStateOf3(t[d])));
    return memo.get(d);
  };
  return (x, y) => {
    const a = rank(x), b = rank(y);
    return (b.strength - a.strength) || (b.margin - a.margin) || (b.diff - a.diff) || (x - y);
  };
}

/** 補足の候補にしてよいか：選んだ側の強さ ≧ 反対側の強さ */
export function bridgeOk3(table) {
  const t = isObj(table) ? table : {};
  return (d, state) => {
    const k = rankOf3(t[d], state);
    return !!k.side && k.strength >= k.other;
  };
}

/** 特別の組にしてよいか：領域7と8の両方で LB ≧ LA */
export function pairOk3(table) {
  const t = isObj(table) ? table : {};
  return () => [7, 8].every((d) => num(t[d]?.LB, 50) >= num(t[d]?.LA, 50));
}

/** domainStates3 の形の表（{ 1: { state, LA, LB, mWA, mWB, … }, … }）から、結果の文を1セット */
export function resultCopyFromStates3(table, { maxChars = COPY_MAX_CHARS4 } = {}) {
  const t = isObj(table) ? table : {};
  return resultCopyFromStates(copyStatesOf3(t), {
    maxChars,
    copyVersion: RESULT_COPY_VERSION3,
    order: order3(t),
    bridgeOk: bridgeOk3(t),
    pairOk: pairOk3(t),
  });
}

/** 三択の結果（js/adaptive3.js の Session3.result()。r.states＝domainStates3）から、結果の文を1セット */
export function resultCopy3(r, opts) {
  return resultCopyFromStates3(tableOf(r), opts);
}
