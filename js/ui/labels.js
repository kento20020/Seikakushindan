// パターン・役割の表示名（結果タブとロジックタブで共通）
import { DOMAINS } from "../engine.js";
import { KIND_LABEL, GROUP_LABEL } from "../data/patterns.js";

export const ROLE_CLASS = { "主軸": "main", "補強": "support", "矛盾": "contra", "地（形状）": "shape" };

/** 種別の表示：「基本解釈 領域1」「クロス解釈 衝突への向き合い方×反応速度」「特殊A 3領域の流れ型」など */
export function kindLabel(meta) {
  if (meta.kind === "basic") return `${KIND_LABEL.basic}・領域${meta.domains[0]}`;
  if (meta.kind === "cross") return `${KIND_LABEL.cross}・${meta.id.split("-")[0]}`;
  return GROUP_LABEL[meta.group] || KIND_LABEL.special;
}

/** 関わる領域名を「×」でつなぐ。形状（全体）は「16傾向の全体」 */
export function domainLine(meta) {
  if (meta.kind === "special" && meta.group === "D") return "16傾向の全体の形";
  return meta.domains.map(d => `${d} ${DOMAINS[d].name}`).join(" × ");
}

/** 「掛け合わせで初めて言えること」/「基本・クロスとの違い」 */
export function uniqueLabel(meta) {
  return meta.kind === "cross" ? "掛け合わせで初めて言えること" : "基本・クロスとの違い";
}
