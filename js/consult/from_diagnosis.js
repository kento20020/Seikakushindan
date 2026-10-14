// 診断結果 → 相談モードの8領域の入力 {1..8: { side: "A"|"B"|null, conf: "sure"|"est"|"none" }}。仕様：docs/consult-scoring.md §9
import { domainFlags3, DOMAINS } from "../engine3.js";

const DOMAIN_KEYS = Object.keys(DOMAINS).map(Number);

/**
 * 三択版の結果（profile3）から。domainFlags3 の lead（左右で優勢な傾向）を領域の A 側・B 側に直す。
 *   優勢あり・確度低の印（weak・conflict）なし → sure ／ 印あり → est ／ 拮抗（lead なし）→ side null・none
 */
export function domainsFromProfile3(profile3) {
  const out = {};
  for (const d of DOMAIN_KEYS) {
    const f = domainFlags3(profile3, d);
    if (!f.lead) { out[d] = { side: null, conf: "none" }; continue; }
    const side = f.lead === DOMAINS[d].a ? "A" : f.lead === DOMAINS[d].b ? "B" : null;
    out[d] = side ? { side, conf: f.weak || f.conflict ? "est" : "sure" } : { side: null, conf: "none" };
  }
  return out;
}

/** 利用者が相手について2択で答えたもの {領域: "A"|"B"} から。答えた領域は est、答えていない領域は none */
export function domainsFromChoices(choices = {}) {
  const out = {};
  for (const d of DOMAIN_KEYS) {
    const v = choices?.[d];
    out[d] = v === "A" || v === "B" ? { side: v, conf: "est" } : { side: null, conf: "none" };
  }
  return out;
}
