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
//       copy: { id: "B1-1", title, body, action },           // 持ち主の原稿の文（決定 U49。新しい一覧の既定。下の「原稿の文」）
//       art: { id, file, alt } }                             // 絵（AXIS_ART。app/ からの相対パス）。絵が無ければ file・alt は null
//   lead・leadFrom・near は前の一覧（?tc=old）だけが使う。新しい一覧（既定）は copy だけを使う
//
//   原稿の文（決定 U49。docs/app-screens.md §24。原稿 §7「領域を単独で説明する導線でも、同じ原稿を再利用し、新しい診断見出しの階層を増やさない」）
//     A寄り … js/data/result_copy4.js の DOMAIN_COPY4[軸]["1"]（B{軸}-1）の題と本文、一言は SIDE_COPY4["{軸}A"].action
//     まんなか … B{軸}-5 の題と本文（一言は出さない。action は null）
//     B寄り … B{軸}-3 の題と本文、一言は SIDE_COPY4["{軸}B"].action
//     どれも原稿の写しをそのまま読む（ここで文を書かない・変えない）
//
//   文の出どころ（新しい文は、まんなかの型の文 midLead だけ）
//     A寄り … lead は B<軸>-1（A が明確に優勢）の one。near は状態 1・2（A が明確に優勢／A が優勢だが B も強い）
//     B寄り … lead は B<軸>-3（B が明確に優勢）の one。near は状態 3・4（B が明確に優勢／B が優勢だが A も強い）
//     まんなか … lead は midLead（型の文）。near は状態 5・6・7（両方強い／両方弱い／場面による。どれも「拮抗」）
//     弱い版（B?-1w・B?-3w）は使わない
//
//   typeMarks(r, { tc }) … 結果 r の印 { yours: { 1: "1-a", 2: "2-mid", … }（印の無い軸は入れない）, ids: ["1-a", …]（軸の順）, hero: "2-b" | null }
//     あなたの型（yours）の決め方は一覧の形（result_copy_version.js の ?tc=）で変わる
//       新しい一覧（"copy"。既定。決定 U49）：カードの文と同じ「原稿の状態」で決める（copySideOf）
//         三択は js/result_copy3.js の copyStatesOf3（domainStates3 の state。null → 7）、24問は js/result_copy4.js の copyStatesOf4
//         状態 1・2・1w → A寄り（a）、3・4・3w → B寄り（b）、5・6・7（24問の向きの違い 7dd も）→ まんなか（mid）、incomplete → 印なし
//         （左右の数だけで決めると、状態7〔拮抗・向きの違い〕の軸で「A が明確に優勢」の文に印が付いてしまうため）
//       前の一覧（"old"）：axis_art.js の slotMarks と同じ選び方（8つの軸の行の絵＝artSide(axisView(r, d))。24問は A を選んだ割合）
//     hero … 結果とホームのいちばん上に出ている絵の型（heroArt）。どちらの一覧でも同じ。出せなければ null
import { DOMAINS } from "../../js/engine3.js";
import { PATTERN_META } from "../../js/data/patterns_meta.js";
import { BASIC_TEXT } from "../../js/data/patterns_text_basic.js";
import { AXIS_ART, artOf, slotMarks } from "./axis_art.js";
import { DOMAIN_COPY4, SIDE_COPY4 } from "../../js/data/result_copy4.js";
import { copyStatesOf3 } from "../../js/result_copy3.js";
import { copyStatesOf4 } from "../../js/result_copy4.js";
import { typeCopyVersion } from "./result_copy_version.js";

/** 1つの軸の3つの型の並び */
export const TYPE_SIDES = Object.freeze(["a", "mid", "b"]);
/** 型の比率（絵の題。A : B） */
export const TYPE_RATIO = Object.freeze({ a: "75:25", mid: "50:50", b: "25:75" });
/** 短い説明（lead）に使う基本パターンの状態（docs/design.md「7状態」。まんなかは型の文） */
export const LEAD_STATE = Object.freeze({ a: "1", b: "3" });
/** 原稿の文の状態（決定 U49）：A寄り＝1（A が明確に優勢）・まんなか＝5・B寄り＝3（B が明確に優勢） */
export const COPY_STATE = Object.freeze({ a: "1", mid: "5", b: "3" });
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

/** 型の原稿の文 { id, title, body, action }（action はまんなかでは null）。知らない軸・型なら null */
export function typeCopy(d, side) {
  const c = DOMAIN_COPY4[Number(d)]?.[COPY_STATE[side]];
  if (!c) return null;
  const s = side === "a" ? "A" : side === "b" ? "B" : null;
  return { id: c.id, title: c.title, body: c.body, action: s ? (SIDE_COPY4[`${Number(d)}${s}`]?.action ?? null) : null };
}

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
        copy: typeCopy(d, side),
        art: { id: art?.id ?? `${d}-${side}`, file: art?.file ?? null, alt: art?.alt ?? null },
      };
    });
  });
}

/** 原稿の状態 → 型（"a" | "b" | "mid"）。incomplete・知らない値は null（印なし）。決定 U49 */
const COPY_SIDE = Object.freeze({ 1: "a", 2: "a", "1w": "a", 3: "b", 4: "b", "3w": "b", 5: "mid", 6: "mid", 7: "mid", "7dd": "mid" });
export const copySideOf = (state) => COPY_SIDE[state] ?? null;

/** 結果 r の原稿の状態（24問は copyStatesOf4、三択は copyStatesOf3） */
export function copyStatesOfResult(r) {
  return r?.diagnosisVersion === "v4" ? copyStatesOf4(r) : copyStatesOf3(r);
}

/** 結果 r の印（あなたの型・いちばん上の絵の型）。r が無ければ印なし。tc は一覧の形（"copy" | "old"） */
export function typeMarks(r, { tc = typeCopyVersion() } = {}) {
  if (!r) return { yours: {}, ids: [], hero: null };
  const m = slotMarks(r);   // いちばん上の絵（と前の一覧の「あなたの型」）は、絵の一覧と同じ選び方
  let ids;
  if (tc === "old") ids = m.picked.slice();
  else {
    const states = copyStatesOfResult(r);
    ids = Object.keys(DOMAINS).map(Number).sort((x, y) => x - y)
      .map((d) => [d, copySideOf(states[d])]).filter(([, side]) => side).map(([d, side]) => `${d}-${side}`);
  }
  const yours = {};
  for (const id of ids) yours[parseInt(id, 10)] = id;
  return { yours, ids, hero: m.hero ?? null };
}
