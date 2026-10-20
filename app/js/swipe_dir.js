// 新しい画面（app/）の診断の、回答とスワイプの向きの対応（決定 U41 の6）。DOM なし（tests/app_swipe_dir.test.mjs）
//   持ち主「下側が左に、上側が右にスワイプできるようにする」：
//     上のカード＝選択肢 "left"（設問の q.left。くすんだ赤）は 右へ スワイプ／→ キーで選ぶ
//     下のカード＝選択肢 "right"（設問の q.right。灰青）は 左へ スワイプ／← キーで選ぶ
//   記録する答えは今までどおり選択肢（"left" | "right"）。向きは見た目と操作だけで、点数は変わらない（同じカードを選べば同じ答え）
//   今の画面（js/ui/three.js。/#three）は前のまま（選択肢 "left" は左へ）。共有の js/ui/swipe_variants.js は変えず、ここで向きを読み替えて使う
import { swipePart, swipeAllows } from "../../js/ui/swipe_variants.js";

/** 選択肢 → それを選ぶスワイプの向き（とキー） */
export const DIR_OF = Object.freeze({ left: "right", right: "left" });
/** スワイプの向き → 選ぶ選択肢 */
export const OPTION_OF = Object.freeze({ right: "left", left: "right" });
/** キー → 選択肢（← → だけ。ほかは null） */
export function optionOfKey(key) {
  return key === "ArrowRight" ? OPTION_OF.right : key === "ArrowLeft" ? OPTION_OF.left : null;
}

/**
 * 何を動かすか（形は C「触った回答だけ」で固定。U28）
 * @param {{ axis?: "x"|"y", dir?: string, startOption?: "left"|"right"|null }} info  startOption は指を置いたカードの選択肢（カードの外なら null）
 * @returns {"card"|"left"|"right"}  "left"|"right" はそのカードの選択肢（"card" は問いと回答のまとまりごと）
 */
export function movingPart({ axis, dir, startOption = null } = {}) {
  const part = swipePart("c", { axis, dir, startSide: DIR_OF[startOption] ?? null });
  return part === "left" || part === "right" ? OPTION_OF[part] : "card";
}

/** その向きを有効にするか（カードをつかんだら、そのカードの向きだけ。上・下とカードの外から始めたときは常に有効） */
export function allows(dir, startOption = null) {
  return swipeAllows("c", dir, DIR_OF[startOption] ?? null);
}
