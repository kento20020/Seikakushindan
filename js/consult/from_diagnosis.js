// 診断結果 → 相談モードの8領域の入力 {1..8: { side: "A"|"B"|null, conf, source, reason? }}。仕様：docs/consult-scoring.md §9
//   conf   … "sure"（1.0）／"observed"（0.8）／"est"（0.6）／"none"（0）。判定（judge.js）が使うのはこれだけ
//   source … "diagnosis"（診断）／"observed"（利用者の見立て）／"stated"（本人が直した）／"none"
//   reason … conf が est のときの理由 "weak"（優勢（弱））／"conflict"（W と X の向きが逆）
// source・reason は AI に渡す人ごとの層（person_layer.js）で言い方を変えるためのもの（decisions.md D1・D2）
import { domainFlags3, DOMAINS } from "../engine3.js";

const DOMAIN_KEYS = Object.keys(DOMAINS).map(Number);
const none = () => ({ side: null, conf: "none", source: "none" });
const allNone = () => Object.fromEntries(DOMAIN_KEYS.map(d => [d, none()]));

/**
 * 三択版の結果（profile3）から。domainFlags3 の lead（左右で優勢な傾向）を領域の A 側・B 側に直す。
 *   優勢あり・確度低の印（weak・conflict）なし → sure ／ 印あり → est（reason は conflict を優先）／ 拮抗（lead なし）→ side null・none
 * source はどれも "diagnosis"（拮抗も「診断したが決まらなかった」）
 */
export function domainsFromProfile3(profile3) {
  const out = {};
  for (const d of DOMAIN_KEYS) {
    const f = domainFlags3(profile3, d);
    const side = !f.lead ? null : f.lead === DOMAINS[d].a ? "A" : f.lead === DOMAINS[d].b ? "B" : null;
    if (!side) { out[d] = { side: null, conf: "none", source: "diagnosis" }; continue; }
    out[d] = f.conflict ? { side, conf: "est", source: "diagnosis", reason: "conflict" }
      : f.weak ? { side, conf: "est", source: "diagnosis", reason: "weak" }
      : { side, conf: "sure", source: "diagnosis" };
  }
  return out;
}

/** 利用者が相手について2択で答えたもの {領域: "A"|"B"} から。答えた領域は observed（0.8）、答えていない領域は none */
export function domainsFromChoices(choices = {}) {
  const out = {};
  for (const d of DOMAIN_KEYS) {
    const v = choices?.[d];
    out[d] = v === "A" || v === "B" ? { side: v, conf: "observed", source: "observed" } : none();
  }
  return out;
}

/**
 * 招待で受け取った相手の診断結果（D4(c)）。相手が「相談モードで使われる」ことに同意したとき（consent === true）だけ取り込む。
 * 同意がなければ8領域すべて不明
 */
export function domainsFromInvite(profile3, { consent } = {}) {
  if (consent !== true || !profile3) return allNone();
  return domainsFromProfile3(profile3);
}

/** 相手が取り込みを外したとき：出どころが診断の領域だけ不明に戻す（利用者の見立ては残す）。元の値は変えない */
export function removePartnerDiagnosis(partner = {}) {
  const out = {};
  for (const d of DOMAIN_KEYS) {
    const v = partner?.[d];
    out[d] = !v || v.source === "diagnosis" ? none() : { ...v };
  }
  return out;
}

/**
 * 本人が自分の結果を領域ごとに直したもの（D5）。corrections = {領域: "A"|"B"}。
 * 直した領域は { side, conf: "sure", source: "stated" }（重み 1.0）。領域・値が正しくない項目は無視する。元の値は変えない
 */
export function applySelfCorrections(selfDomains = {}, corrections = {}) {
  const out = {};
  for (const d of DOMAIN_KEYS) {
    const v = selfDomains?.[d];
    out[d] = v ? { ...v } : none();
  }
  for (const [k, v] of Object.entries(corrections || {})) {
    const d = Number(k);
    if (!DOMAIN_KEYS.includes(d) || (v !== "A" && v !== "B")) continue;
    out[d] = { side: v, conf: "sure", source: "stated" };
  }
  return out;
}
