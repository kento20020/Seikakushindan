// 軸の絵（8軸 × 3パターン）。新しい画面 app/ だけで使う。DOM を使わない（Node のテストでも動く）。
// 仕様：docs/app-screens.md §13（決定 U33）。今の画面（/#three）の傾向の絵（js/data/type_images.js・img/types/）は変えない。
//
//   絵の中の、軸の色のリボン＝左の傾向（A）、紺のリボン＝右の傾向（B）。
//   パターンは3つ：a＝A寄り（75:25）、b＝B寄り（25:75）、mid＝まんなか（50:50。まだ無い）。
//   どれを出すかは、結果の「8つの軸」の●（取り分。summary.js の axisView）で選ぶ：A を選んだ割合が 50% より多ければ a、少なければ b、ちょうど 50% は mid
//
//   AXIS_ART[d]          … 軸 d（1〜8）の色と絵 { domain, name, colorName, color, deep, a, b, mid }
//                          a・b・mid は { file, alt } か null（file は app/ からの相対パス）
//   NAVY                 … B 側の紺（8軸で共通）
//   artOf(d, side)       … 軸 d・パターン side（"a" | "b" | "mid"）の絵 { id, domain, side, file, alt, color, deep }。絵が無ければ file・alt は null
//   artSide(view)        … axisView の結果 → "a" | "b" | "mid" | null（答えなし）
//   axisArt(d, view)     … 8つの軸の1行の絵（artSide で選ぶ。まんなかの絵がまだ無ければ file は null）。知らない軸なら null
//   heroArt(r)           … 結果の一番上・ホームの一番上（診断後）の絵。主軸に合う傾向の軸の、●で選んだパターン
//                          その軸がまんなか（絵がまだ無い）・答えなしなら、主軸に合う傾向の側（A なら a、B なら b）
//                          { ...artOf の形, key: "2B", tendency: "熟考", reason, bySide }。出せなければ null
//
// まんなかの絵が届いたら：下の AXIS_ART のその軸の mid: null を mid: { file: "img/axes/<軸>-mid.jpg", alt: "…" } にするだけで、
//   8つの軸の行・結果の一番上・ホームの一番上に出る（ほかは直さなくてよい）
import { DOMAINS } from "../../js/engine3.js";
import { heroTendency, TYPE_IMAGES } from "../../js/data/type_images.js";
import { axisView } from "./summary.js";

/** B 側の紺（絵の紺のリボン・8つの軸の B 側の●と帯） */
export const NAVY = "#22315A";

/** 絵の大きさ（まとめ画像から切り出した正方形） */
export const ART_SIZE = 521;

// color＝絵の色（帯）、deep＝点・印の色（面 #F8F3EE との比 3 以上。●に使う）。値は docs/app-screens.md §13.2
const T = (d, colorName, color, deep, altA, altB) => Object.freeze({
  domain: d,
  name: DOMAINS[d].name,
  colorName, color, deep,
  a: Object.freeze({ file: `img/axes/${d}-a.jpg`, alt: altA }),
  b: Object.freeze({ file: `img/axes/${d}-b.jpg`, alt: altB }),
  mid: null,   // まんなか（50:50）の絵はまだ無い。届いたら { file: `img/axes/${d}-mid.jpg`, alt: "…" }
});

export const AXIS_ART = Object.freeze({
  1: T(1, "青緑", "#2E9A8F", "#2E9188",
    "青緑の帯に手を添える人の絵。紺のリボンがなびいている",
    "大きくうねる紺のリボンの中で、小さな青緑の帯へ手を伸ばす人の絵"),
  2: T(2, "からし色", "#D9A23A", "#A47D38",
    "からし色のリボンへ腕を伸ばす人の絵。頭の上に小さな紺の輪",
    "頭の上に大きな紺の輪があり、あごに手を当てる人の絵"),
  3: T(3, "青", "#4F86CC", "#4E84C9",
    "青く染まった腕を前へ伸ばし、青いリボンを手のひらで受ける人の絵",
    "立ちのぼる青いリボンの下で、手のひらを上に向ける人の絵"),
  4: T(4, "ピンク", "#C06A92", "#BD6990",
    "胸もとから大きなピンクのリボンがあふれ出る人の絵",
    "胸もとの内側に、ピンクの色が小さくのぞく人の絵"),
  5: T(5, "紫", "#9468B6", "#9468B6",
    "紫のリボンをまとい、紺と紫のパズルのピースを合わせる人の絵",
    "何本もの紫のリボンに包まれて、手を差し出す人の絵"),
  6: T(6, "オレンジ", "#DB7A45", "#BF6D42",
    "オレンジの矢印のリボンを指さし、紺のリボンを手で受ける人の絵",
    "紺のリボンと、上へ向かうオレンジのリボンを両手で整える人の絵"),
  7: T(7, "緑", "#7F9545", "#768A43",
    "胸の前で、緑と紺のリボンをつなぐ人の絵",
    "緑と紺のリボンを、両手で分けて持つ人の絵"),
  8: T(8, "朱色", "#DE675F", "#D0625B",
    "肩から朱色と紺のリボンが何本も広がる人の絵",
    "胸もとで、紺と朱色のリボンを結ぶ人の絵"),
});

const SIDES = new Set(["a", "b", "mid"]);

/** 軸 d・パターン side の絵。知らない軸・パターンなら null。絵が無い（まんなか）なら file・alt は null */
export function artOf(d, side) {
  const t = AXIS_ART[Number(d)];
  if (!t || !SIDES.has(side)) return null;
  const p = t[side];
  return { id: `${t.domain}-${side}`, domain: t.domain, side, file: p?.file ?? null, alt: p?.alt ?? null, color: t.color, deep: t.deep };
}

/**
 * axisView の結果 → どのパターンか。pos は B を選んだ割合（0〜1）なので、A の割合が 50% より多い＝pos が 0.5 より小さい
 *   答えが無い（pos が null）なら null
 */
export function artSide(view) {
  if (!view) return null;
  const pos = view.pos;
  if (typeof pos === "number" && Number.isFinite(pos)) return pos < 0.5 ? "a" : pos > 0.5 ? "b" : "mid";
  return null;
}

/** 8つの軸の1行の絵。{ id, domain, side, file, alt, color, deep }（side が null か、まんなかの絵がまだ無ければ file は null）。知らない軸なら null */
export function axisArt(d, view) {
  const t = AXIS_ART[Number(d)];
  if (!t) return null;
  const side = artSide(view);
  if (!side) return { id: null, domain: t.domain, side: null, file: null, alt: null, color: t.color, deep: t.deep };
  return artOf(t.domain, side);
}

// 16の傾向すべてに絵がある前提で heroTendency に渡す（js/data/type_images.js の TYPE_IMAGES の形のまま、status と file だけ替える）
//   今の TYPE_IMAGES は8つにしか絵が無いので、そのまま渡すと絵のある8つの中から選んでしまう
const ALL_READY = Object.freeze(Object.fromEntries(Object.entries(TYPE_IMAGES).map(([k, e]) =>
  [k, Object.freeze({ ...e, status: "ready", file: AXIS_ART[e.domain][e.side === "A" ? "a" : "b"].file })])));

const chosenOf = (r) => (Array.isArray(r?.select?.chosen) ? r.select.chosen.filter(x => x && x.meta) : []);

/**
 * 結果の一番上・ホームの一番上（診断後）の絵
 *   1. 主軸に合う傾向を heroTendency で選ぶ（16すべてに絵がある前提）。例 "2B"（熟考）
 *   2. その軸の●で選んだパターンの絵（axisArt）
 *   3. その軸がまんなか（絵がまだ無い）・答えなしなら、主軸に合う傾向の側（A なら a、B なら b）の絵（bySide: true）
 *   返す形：{ id, domain, side, file, alt, color, deep, key, tendency, reason, bySide }。主軸が無い・選べないときは null
 */
export function heroArt(r) {
  let pick = null;
  try { pick = r?.profile3 ? heroTendency(r.profile3, chosenOf(r), ALL_READY) : null; } catch { pick = null; }
  if (!pick || !/^[1-8][AB]$/.test(String(pick.key))) return null;
  const d = parseInt(pick.key, 10);
  const lead = pick.key.slice(-1);
  const D = DOMAINS[d];
  let art = null;
  try { art = axisArt(d, axisView(r, d)); } catch { art = null; }
  const bySide = !art?.file;
  if (bySide) art = artOf(d, lead === "A" ? "a" : "b");
  return { ...art, key: pick.key, tendency: lead === "A" ? D.a : D.b, reason: pick.reason, bySide };
}
