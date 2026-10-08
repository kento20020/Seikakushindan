// 解釈パターン172本の「構造（patterns_meta）」と「本文（basic / cross / special）」を結合する。
// UI はこのモジュールだけを見ればよい。
import { PATTERN_META } from "./patterns_meta.js";
import { BASIC_TEXT } from "./patterns_text_basic.js";
import { CROSS_TEXT } from "./patterns_text_cross.js";
import { SPECIAL_TEXT, CROSS_GROUP_INTRO, SPECIAL_GROUP_INTRO } from "./patterns_text_special.js";

const WEAK_RE = /^(B\d-[13])w$/;

/**
 * 本文を共通形に正規化して返す。未知の id は null。
 *   { one, detail, scenes: [s1, s2], unique, caveat, cond?, weak }
 *   - basic : unique = null、cond は付かない。弱い版（B?-1w / B?-3w）は状態1/3の本文を流用し weak:true
 *   - cross : unique = 掛け合わせで初めて言えること、cond = 条件（文書記載のまま）
 *   - special: unique = 基本・クロスとの違い、cond = 条件（文書記載のまま）
 * headline / importance / 構造化 cond は PATTERN_META 側（PATTERNS[i].headline / .cond）にある。
 */
export function getText(id) {
  const weakMatch = WEAK_RE.exec(id);
  const baseId = weakMatch ? weakMatch[1] : id;

  const b = BASIC_TEXT[baseId];
  if (b) {
    return {
      one: b.one,
      detail: b.detail,
      scenes: b.scenes.slice(),
      unique: null,
      caveat: b.caveat,
      weak: Boolean(weakMatch),
    };
  }
  if (weakMatch) return null; // 弱い版は基本本文がなければ成立しない

  const x = CROSS_TEXT[id];
  if (x) {
    return {
      one: x.one,
      detail: x.detail,
      scenes: x.scenes.slice(),
      unique: x.unique,
      caveat: x.caveat,
      cond: x.cond,
      weak: false,
    };
  }
  const s = SPECIAL_TEXT[id];
  if (s) {
    return {
      one: s.one,
      detail: s.detail,
      scenes: s.scenes.slice(),
      unique: s.unique,
      caveat: s.caveat,
      cond: s.cond,
      weak: false,
    };
  }
  return null;
}

export const PATTERNS = PATTERN_META.map(m => ({ ...m, text: getText(m.id) }));
export const PATTERN_BY_ID = Object.fromEntries(PATTERNS.map(p => [p.id, p]));

export const KIND_LABEL = { basic: "基本解釈", cross: "クロス解釈", special: "特殊・矛盾" };
export const GROUP_LABEL = {
  A: "特殊A 3領域の流れ型",
  B: "特殊B 行動と要求がねじれる型",
  C: "特殊C 両方強いが複数領域で重なる型",
  D: "特殊D プロファイル形状",
};

export { CROSS_GROUP_INTRO, SPECIAL_GROUP_INTRO };
