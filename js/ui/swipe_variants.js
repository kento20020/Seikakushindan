// 三択の質問カードの「スワイプの形」（?sw=card|a|b|c。判定は js/ui_flags.js の resolveUiFlags）。DOM を使わない純粋関数（tests/swipe_variants.test.mjs）
//
//   card … 今の形（既定）。質問カード全体が動く
//   a    … 回答をまとめて。質問文は動かず、回答2枚の入れ物（.t3-pair）だけが1枚のカードのように動く
//   b    … 向きの側だけ。左へ → 左の回答だけが左へ、右へ → 右の回答だけが右へ（指を置いた場所は関係ない。途中で向きが変われば入れ替わる）
//   c    … 触った回答だけ。指を置いた回答だけが、その側へだけ動く（逆向きは無効な向きと同じ抵抗）。回答の外から始めたときは b と同じ
//   上（問題を変える／答えずに進む）・下（戻る）は、どの形でもカード全体が動く（質問そのものが入れ替わるので）
//
// js/ui/three.js がこれで attachSwipe（js/ui/swipe.js）の target・allow を組み立てる。
import { SWIPE_VARIANTS, DEFAULT_SWIPE } from "../ui_flags.js";

/** 開発用の表示（?dev=1 の開始画面の欄・質問画面のバッジ）に使う名前と一言の説明 */
export const SWIPE_LABEL = { card: "カード", a: "A", b: "B", c: "C" };
export const SWIPE_NAME = { card: "今の形", a: "回答をまとめて", b: "向きの側だけ", c: "触った回答だけ" };
export const SWIPE_DESC = {
  card: "質問カード全体が動く。",
  a: "質問文は動かず、回答2枚がまとめて1枚のカードのように動く。",
  b: "左へスワイプすると左の回答だけが左へ、右へなら右の回答だけが右へ動く（指を置いた場所は関係ない）。",
  c: "指を置いた回答だけが動く。左の回答は左へだけ、右の回答は右へだけ。回答の外から始めたときは B と同じ。",
};
/** 操作説明の箱（t3-swipe-tip。一度だけ出る）の文の前半。このあとに「問題を変える／答えずに進む」「、下へ＝戻る。」が続く */
export const SWIPE_TIP = {
  card: "カードを左右にスワイプ（マウスならドラッグ）して答えられます。上へ＝",
  a: "回答を左右にスワイプ（マウスならドラッグ）して答えられます。上へ＝",
  b: "左を選ぶなら左へ、右を選ぶなら右へスワイプ（マウスならドラッグ）して答えられます。上へ＝",
  c: "選ぶ回答をつかんで、その側へスワイプ（左の回答は左へ、右の回答は右へ）して答えられます。上へ＝",
};

/** 知らない値は既定（card） */
export const normSwipe = (variant) => SWIPE_VARIANTS.includes(variant) ? variant : DEFAULT_SWIPE;
const isSide = (x) => x === "left" || x === "right";

/**
 * 何を動かすか
 * @param {string} variant  "card"|"a"|"b"|"c"
 * @param {{ axis?: "x"|"y", dir?: "left"|"right"|"up"|"down", startSide?: "left"|"right"|null }} info  startSide は指を置いた回答（回答の外なら null）
 * @returns {"card"|"pair"|"left"|"right"}
 */
export function swipePart(variant, { axis, dir, startSide } = {}) {
  const v = normSwipe(variant);
  if (v === "card" || axis === "y" || !isSide(dir)) return "card";   // 上・下はどの形でもカード全体
  if (v === "a") return "pair";
  if (v === "c" && isSide(startSide)) return startSide;               // 逆向きでも、つかんだ回答が（抵抗つきで）動く
  return dir;                                                         // b、c で回答の外から始めたとき
}

/** その向きを有効にするか（c で回答をつかんだときの逆向きだけ無効。ほかは常に true） */
export function swipeAllows(variant, dir, startSide) {
  if (normSwipe(variant) !== "c" || !isSide(startSide) || !isSide(dir)) return true;
  return dir === startSide;
}

/** ?dev=1 の開始画面のリンク：いまのクエリ（ui・dev・qv・fb など）を残して sw だけ差し替え、ハッシュは #three */
export function swipeHref(variant, search = "") {
  let q;
  try { q = new URLSearchParams(typeof search === "string" ? search : ""); } catch { q = new URLSearchParams(); }
  q.set("sw", normSwipe(variant));
  return `./?${q}#three`;
}
