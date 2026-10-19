// 診断結果の一覧（#types。8軸 × 3のタイプ図鑑）のデータ。DOM を使わない（Node のテストでも動く）。
// 仕様：docs/app-screens.md §16（決定 U38）。画面は app/js/types.js。判定はしない（js/ の結果と文を読むだけ。js/ の中身は直さない）。
//
//   typeCatalog() … 24件（8つの軸 × 3つの型）。軸の順（1〜8）、各軸は A寄り → まんなか → B寄り の順
//     { id: "1-a", domain: 1, side: "a" | "mid" | "b",
//       axisName: "衝突への向き合い方", aName: "向き合う", bName: "距離を取る", color, deep,   // 色は AXIS_ART（§13.2）
//       label: "向き合う" | "まんなか" | "距離を取る",       // A寄りは DOMAINS.a、B寄りは DOMAINS.b
//       sideLabel: "A寄り" | "まんなか" | "B寄り",
//       title: "A寄り：向き合う" | "まんなか" | "B寄り：距離を取る",
//       ratio: "75:25" | "50:50" | "25:75",
//       lead: 短い説明（1文）, leadFrom: "B1-1" | "B1-3" | null（まんなかの型の文は新しい型の文なので null）,
//       near: [{ id: "B1-1", headline }, …],                 // この型に近い基本パターンの見出し（PATTERN_META の headline のまま）
//       art: { id, file, alt } }                             // 絵（AXIS_ART。app/ からの相対パス）。絵が無ければ file・alt は null
//
//   文の出どころ（新しい文は、まんなかの型の文 midLead だけ）
//     A寄り … lead は B<軸>-1（A が明確に優勢）の one。near は状態 1・2（A が明確に優勢／A が優勢だが B も強い）
//     B寄り … lead は B<軸>-3（B が明確に優勢）の one。near は状態 3・4（B が明確に優勢／B が優勢だが A も強い）
//     まんなか … lead は midLead（型の文）。near は状態 5・6・7（両方強い／両方弱い／場面による。どれも「拮抗」）
//     弱い版（B?-1w・B?-3w）は使わない
//
//   typeMarks(r) … 結果 r の印。axis_art.js の slotMarks と同じ選び方（8つの軸の行の絵＝artSide(axisView(r, d))）
//     { yours: { 1: "1-a", 2: "2-mid", … }（答えの無い軸は入れない）, ids: ["1-a", …]（軸の順）, hero: "2-b" | null }
//     hero … 結果とホームのいちばん上に出ている絵の型（heroArt）。出せなければ null
import { DOMAINS } from "../../js/engine3.js";
import { PATTERN_META } from "../../js/data/patterns_meta.js";
import { BASIC_TEXT } from "../../js/data/patterns_text_basic.js";
import { AXIS_ART, artOf, slotMarks } from "./axis_art.js";

/** 1つの軸の3つの型の並び */
export const TYPE_SIDES = Object.freeze(["a", "mid", "b"]);
/** 型の比率（絵の題。A : B） */
export const TYPE_RATIO = Object.freeze({ a: "75:25", mid: "50:50", b: "25:75" });
/** 短い説明（lead）に使う基本パターンの状態（docs/design.md「7状態」。まんなかは型の文） */
export const LEAD_STATE = Object.freeze({ a: "1", b: "3" });
/** この型に近い基本パターンの状態 */
export const NEAR_STATES = Object.freeze({ a: Object.freeze(["1", "2"]), mid: Object.freeze(["5", "6", "7"]), b: Object.freeze(["3", "4"]) });

const SIDE_LABEL = Object.freeze({ a: "A寄り", mid: "まんなか", b: "B寄り" });
const META = new Map(PATTERN_META.map((m) => [m.id, m]));

/** まんなかの型の文（この画面だけの新しい型の文。人を評価しない言い方で） */
export function midLead(d) {
  const D = DOMAINS[d];
  return D ? `「${D.a}」と「${D.b}」が半々で、どちらか一方には寄っていない。` : "";
}

/** 基本パターンの id（"B1-3"） */
const basicId = (d, state) => `B${d}-${state}`;

/** 24件（8つの軸 × 3つの型）。軸の順・各軸は A寄り → まんなか → B寄り */
export function typeCatalog() {
  return Object.keys(DOMAINS).map(Number).sort((x, y) => x - y).flatMap((d) => {
    const D = DOMAINS[d];
    const t = AXIS_ART[d];
    return TYPE_SIDES.map((side) => {
      const art = artOf(d, side);
      const label = side === "a" ? D.a : side === "b" ? D.b : "まんなか";
      const leadFrom = side === "mid" ? null : basicId(d, LEAD_STATE[side]);
      return {
        id: `${d}-${side}`,
        domain: d,
        side,
        axisName: D.name,
        aName: D.a,
        bName: D.b,
        color: t?.color ?? null,
        deep: t?.deep ?? null,
        label,
        sideLabel: SIDE_LABEL[side],
        title: side === "mid" ? label : `${SIDE_LABEL[side]}：${label}`,
        ratio: TYPE_RATIO[side],
        lead: leadFrom ? (BASIC_TEXT[leadFrom]?.one ?? "") : midLead(d),
        leadFrom,
        near: NEAR_STATES[side].map((s) => basicId(d, s)).filter((id) => META.has(id))
          .map((id) => ({ id, headline: META.get(id).headline })),
        art: { id: art?.id ?? `${d}-${side}`, file: art?.file ?? null, alt: art?.alt ?? null },
      };
    });
  });
}

/** 結果 r の印（あなたの型・いちばん上の絵の型）。r が無ければ印なし */
export function typeMarks(r) {
  if (!r) return { yours: {}, ids: [], hero: null };
  const m = slotMarks(r);   // 8つの軸の行の絵・いちばん上の絵と同じ選び方
  const yours = {};
  for (const id of m.picked) yours[parseInt(id, 10)] = id;
  return { yours, ids: m.picked.slice(), hero: m.hero ?? null };
}
