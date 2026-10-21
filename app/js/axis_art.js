// 軸の絵（8軸 × 3パターン）。新しい画面 app/ だけで使う。DOM を使わない（Node のテストでも動く）。
// 仕様：docs/app-screens.md §13（決定 U33・U36）。今の画面（/#three）の傾向の絵（js/data/type_images.js・img/types/）は変えない。
//
//   絵の中の、軸の色のリボン＝左の傾向（A）、紺のリボン＝右の傾向（B）。
//   パターンは3つ：a＝A寄り（75:25）、b＝B寄り（25:75）、mid＝まんなか（50:50。U36 で8軸ともそろった）。
//   どれを出すかは、結果の「8つの軸」の●（取り分。summary.js の axisView）で選ぶ：A を選んだ割合が 50% より多ければ a、少なければ b、ちょうど 50% は mid
//
//   AXIS_ART[d]          … 軸 d（1〜8）の色と絵 { domain, name, colorName, color, deep, a, b, mid }
//                          a・b・mid は { file, alt }（file は app/ からの相対パス）。絵が無いパターンは null にできる
//   NAVY                 … B 側の紺（8軸で共通）
//   artOf(d, side)       … 軸 d・パターン side（"a" | "b" | "mid"）の絵 { id, domain, side, file, alt, color, deep }。絵が無ければ file・alt は null
//   artSide(view)        … axisView の結果 → "a" | "b" | "mid" | null（答えなし）
//   axisArt(d, view)     … 8つの軸の1行の絵（artSide で選ぶ。答えなし・そのパターンの絵が無いときは file は null）。知らない軸なら null
//   heroArt(r)           … 結果の一番上・ホームの一番上（診断後）の絵。主軸に合う傾向の軸の、●で選んだパターン
//                          その軸に答えが無い（またはそのパターンの絵が無い）なら、主軸に合う傾向の側（A なら a、B なら b）
//                          { ...artOf の形, key: "2B", tendency: "熟考", reason, bySide }。出せなければ null
//   axisArtSlots()       … 絵の一覧の画面（#images。§14）の24枠。軸の順・各軸は a → mid → b の順。絵が無い枠は ready: false
//   slotMarks(r)         … 結果 r で選ばれる枠の id（8つの軸の行 picked・一番上の絵 hero）。一覧の画面の印に使う
//   24問版（v4。r.diagnosisVersion === "v4"。決定 U42・U44）：heroArt・slotMarks は v4 の結果も受け取る。絵の A/B の割り当ても選び方も三択と同じ：
//     領域の3問のうち A を選んだ割合（share）が 50% より多ければ a、少なければ b、ちょうど 50% は mid（artSideOfShare）。
//     incomplete（答えた数が2より少ない）の領域は絵を出さない（番号の丸）
//     axisArt4(d, dom) … 8つの領域の1行の絵。heroArt4(r) … 主軸の領域の絵（主軸が無ければ null）
//     結果の出し方（決定 U46。app/js/result_copy_version.js）：既定は結果の文（js/result_copy4.js）の主軸の、選ばれた側の絵
//       （A 側は A寄り、B 側は B寄り）。?rc=u44 では前のとおり js/engine4.js の主軸（primaryDomainId）の、A の割合で選んだ絵
//
// 絵を差し替えるときは、app/img/axes/ の同じ名前のファイルを上書きする（絵の中身が変われば、下の alt も直す）。
//   まんなかの絵（<軸>-mid.jpg）の作り方は tools/make_axis_mid.sh（横長の8枚並びのまとめ画像から切り出す。U36）
//   絵が無いパターン（AXIS_ART で null）があっても動く：8つの軸の行は番号の丸、一番上は主軸に合う傾向の側の絵、一覧（#images）は「準備中」
import { DOMAINS } from "../../js/engine3.js";
import { heroTendency, TYPE_IMAGES } from "../../js/data/type_images.js";
import { axisView } from "./summary.js";
import { resultCopy4 } from "../../js/result_copy4.js";
import { resultCopyVersion } from "./result_copy_version.js";

/** B 側の紺（絵の紺のリボン・8つの軸の B 側の●と帯） */
export const NAVY = "#22315A";

/** 絵の大きさ（まとめ画像から切り出した正方形） */
export const ART_SIZE = 521;

// color＝絵の色（帯）、deep＝点・印の色（面 #F8F3EE との比 3 以上。●に使う）。値は docs/app-screens.md §13.2
const T = (d, colorName, color, deep, altA, altB, altMid) => Object.freeze({
  domain: d,
  name: DOMAINS[d].name,
  colorName, color, deep,
  a: Object.freeze({ file: `img/axes/${d}-a.jpg`, alt: altA }),
  b: Object.freeze({ file: `img/axes/${d}-b.jpg`, alt: altB }),
  mid: Object.freeze({ file: `img/axes/${d}-mid.jpg`, alt: altMid }),   // まんなか（50:50。U36）
});

export const AXIS_ART = Object.freeze({
  1: T(1, "青緑", "#2E9A8F", "#2E9188",
    "青緑の帯に手を添える人の絵。紺のリボンがなびいている",
    "大きくうねる紺のリボンの中で、小さな青緑の帯へ手を伸ばす人の絵",
    "紺のリボンを首と腕にまといながら、離れた所に浮かぶ青緑のリボンへ手を伸ばす人の絵"),
  2: T(2, "からし色", "#D9A23A", "#A47D38",
    "からし色のリボンへ腕を伸ばす人の絵。頭の上に小さな紺の輪",
    "頭の上に大きな紺の輪があり、あごに手を当てる人の絵",
    "頭の上に大きな紺の輪、体のまわりにからし色のリボン。あごに手を当てる人の絵"),
  3: T(3, "青", "#4F86CC", "#4E84C9",
    "青く染まった腕を前へ伸ばし、青いリボンを手のひらで受ける人の絵",
    "立ちのぼる青いリボンの下で、手のひらを上に向ける人の絵",
    "肩から腕へ流れる青いリボンを、開いた手のひらで受ける人の絵"),
  4: T(4, "ピンク", "#C06A92", "#BD6990",
    "胸もとから大きなピンクのリボンがあふれ出る人の絵",
    "胸もとの内側に、ピンクの色が小さくのぞく人の絵",
    "胸もとに手を当て、そこから1本のピンクのリボンが肩の外へ流れ出る人の絵"),
  5: T(5, "紫", "#9468B6", "#9468B6",
    "紫のリボンをまとい、紺と紫のパズルのピースを合わせる人の絵",
    "何本もの紫のリボンに包まれて、手を差し出す人の絵",
    "何本もの紫のリボンに包まれ、胸の前で灰色と紫のパズルのピースを合わせる人の絵"),
  6: T(6, "オレンジ", "#DB7A45", "#BF6D42",
    "オレンジの矢印のリボンを指さし、紺のリボンを手で受ける人の絵",
    "紺のリボンと、上へ向かうオレンジのリボンを両手で整える人の絵",
    "肩にかかったオレンジの矢印のリボンを握り、紺のリボンも手のひらで受ける人の絵"),
  7: T(7, "緑", "#7F9545", "#768A43",
    "胸の前で、緑と紺のリボンをつなぐ人の絵",
    "緑と紺のリボンを、両手で分けて持つ人の絵",
    "扇のように広がる何本もの緑と紺のリボンを、両手でより分ける人の絵"),
  8: T(8, "朱色", "#DE675F", "#D0625B",
    "肩から朱色と紺のリボンが何本も広がる人の絵",
    "胸もとで、紺と朱色のリボンを結ぶ人の絵",
    "紺と朱色のリボンでそれぞれ輪を作り、胸の前で鎖のようにつないで持つ人の絵"),
});

const SIDES = new Set(["a", "b", "mid"]);

/** 軸 d・パターン side の絵。知らない軸・パターンなら null。そのパターンの絵が無い（AXIS_ART が null）なら file・alt は null */
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

/** 8つの軸の1行の絵。{ id, domain, side, file, alt, color, deep }（side が null〔答えなし〕か、そのパターンの絵が無ければ file は null）。知らない軸なら null */
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
 *      まんなか（●がちょうど 50%）なら、その軸の mid の絵（bySide: false）
 *   3. その軸に答えが無い（または選んだパターンの絵が無い）なら、主軸に合う傾向の側（A なら a、B なら b）の絵（bySide: true）
 *   返す形：{ id, domain, side, file, alt, color, deep, key, tendency, reason, bySide }。主軸が無い・選べないときは null
 */
export function heroArt(r) {
  if (r?.diagnosisVersion === "v4") return heroArt4(r);
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

// ---------------------------------------------------------------- 絵の一覧の画面（#images。§14）
const SLOT_SIDES = ["a", "mid", "b"];
const RATIO = Object.freeze({ a: "75:25", mid: "50:50", b: "25:75" });

/**
 * 24枠（8軸 × 3パターン）。軸の順（1〜8）、各軸は a（A寄り）→ mid（まんなか）→ b（B寄り）の順
 *   { id: "1-a", domain, side, ratio: "75:25", label: "向き合う寄り" | "まんなか", file, alt, ready, path, color, deep }
 *   ready … 絵がある（AXIS_ART に file がある）。無ければ file・alt は null
 *   path  … 絵の場所（app/ からの相対パス）。絵が無ければ、置く場所（img/axes/<軸>-<パターン>.jpg）
 *   今は24枠すべてに絵がある（U36）。AXIS_ART のどれかを null にすると、その枠は ready: false（「準備中」）になる
 */
export function axisArtSlots() {
  return Object.values(AXIS_ART).flatMap(t => SLOT_SIDES.map(side => {
    const art = artOf(t.domain, side);
    const D = DOMAINS[t.domain];
    return {
      ...art,
      ratio: RATIO[side],
      label: side === "a" ? `${D.a}寄り` : side === "b" ? `${D.b}寄り` : "まんなか",
      ready: !!art.file,
      path: art.file ?? `img/axes/${t.domain}-${side}.jpg`,
    };
  }));
}

/**
 * 結果 r で選ばれる枠（一覧の画面の印）
 *   picked … 8つの軸の行に選ばれる枠の id（artSide(axisView(r, d))。軸の順。答えの無い軸は入れない）。
 *            まんなかの軸は "<軸>-mid"（例 "1-mid"）。絵が無い枠でも入る（そのとき行には番号の丸が出る）
 *   hero   … 結果の一番上・ホームの一番上（診断後）の絵の枠の id（heroArt。代わりの側の絵ならその枠）。出せなければ null
 *   art    … heroArt(r) の結果そのもの（bySide などを見るため）か null
 */
export function slotMarks(r) {
  if (!r) return { picked: [], hero: null, art: null };
  if (r.diagnosisVersion === "v4") return slotMarks4(r);
  const picked = [];
  for (const t of Object.values(AXIS_ART)) {
    let side = null;
    try { side = artSide(axisView(r, t.domain)); } catch { side = null; }
    if (side) picked.push(`${t.domain}-${side}`);
  }
  let art = null;
  try { art = heroArt(r); } catch { art = null; }
  return { picked, hero: art?.id ?? null, art };
}

// ---------------------------------------------------------------- 24問版（v4。決定 U42・U44。docs/diagnosis-v4.md §6）
/** A を選んだ割合（0〜100）→ "a"（50 より多い）| "b"（50 より少ない）| "mid"（50）| null（答えなし） */
export function artSideOfShare(share) {
  if (typeof share !== "number" || !Number.isFinite(share)) return null;
  return share > 50 ? "a" : share < 50 ? "b" : "mid";
}

const complete4 = (dom) => !!dom && dom.state !== "incomplete";

/** v4 の8つの領域の1行の絵。答えがそろっていない領域は file が null（番号の丸）。知らない軸なら null */
export function axisArt4(d, dom) {
  const t = AXIS_ART[Number(d)];
  if (!t) return null;
  const side = complete4(dom) ? artSideOfShare(dom.share) : null;
  if (!side) return { id: null, domain: t.domain, side: null, file: null, alt: null, color: t.color, deep: t.deep };
  return artOf(t.domain, side);
}

/**
 * v4 の結果の一番上・ホームの一番上の絵。主軸が無ければ null
 *   既定（結果の文の形。決定 U46）：結果の文の主軸（resultCopy4 の primaryDomain）の、選ばれた側の絵（A 側は a、B 側は b）
 *   rc "u44"（前の形）：js/engine4.js の主軸（primaryDomainId）の、A の割合で選んだ絵
 *   key・tendency は選ばれた側。主軸はまんなかにならないので、mid にはならない
 */
export function heroArt4(r, { rc = resultCopyVersion() } = {}) {
  if (rc === "u44") return heroArt4U44(r);
  let copy = null;
  try { copy = r?.domains ? resultCopy4(r) : null; } catch { copy = null; }
  const d = Number(copy?.primaryDomain);
  if (!AXIS_ART[d] || (copy.side !== "A" && copy.side !== "B")) return null;
  const art = artOf(d, copy.side === "A" ? "a" : "b");
  if (!art?.file) return null;
  const D = DOMAINS[d];
  return { ...art, key: `${d}${copy.side}`, tendency: copy.side === "A" ? D.a : D.b, reason: "主軸の領域（24問）", bySide: false };
}

/** 前の形（?rc=u44。決定 U44）のいちばん上の絵：js/engine4.js の主軸の領域の、A の割合で選んだ絵 */
function heroArt4U44(r) {
  const d = Number(r?.primaryDomainId);
  const dom = r?.domains?.[d];
  if (!AXIS_ART[d] || !complete4(dom)) return null;
  const art = axisArt4(d, dom);
  if (!art?.file) return null;
  const lead = ["strongA", "leanA"].includes(dom.state) ? "A" : "B";
  const D = DOMAINS[d];
  return { ...art, key: `${d}${lead}`, tendency: lead === "A" ? D.a : D.b, reason: "主軸の領域（24問）", bySide: false };
}

/** v4 の結果で選ばれる枠（一覧の画面の印）。答えがそろっている領域だけ */
export function slotMarks4(r) {
  const picked = [];
  for (const t of Object.values(AXIS_ART)) {
    const dom = r?.domains?.[t.domain];
    const side = complete4(dom) ? artSideOfShare(dom.share) : null;
    if (side) picked.push(`${t.domain}-${side}`);
  }
  let art = null;
  try { art = heroArt4(r); } catch { art = null; }
  return { picked, hero: art?.id ?? null, art };
}
