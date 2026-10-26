// 結果の詳しい説明。採点・主結果・保存形式は変えず、既存の原稿と回答を読む。
// 旧版の「主な傾向＋補足＋8つの軸」の情報量を戻す。仕様：docs/result-details.md
import { DOMAINS } from "./engine.js";
import { DOMAIN_IDS4 } from "./engine4.js";
import { copyStatesOf4, domainCopy4, primaryOf4, claimTagsOf4, sameTheme4 } from "./result_copy4.js";
import { copyStatesOf3, order3, bridgeOk3 } from "./result_copy3.js";
import { idsOfDomain4, ITEMS4 } from "./data/questions4.js";

const STRONG = ["1", "2", "3", "4"];
const count = (v) => Number.isInteger(v) && v >= 0 ? v : null;
const choice = (D, p) => p === "A" ? D.a : p === "B" ? D.b : p === "unknown" ? "判断できない" : "未回答";

function evidence4(r, d) {
  const x = r.domains?.[d], D = DOMAINS[d];
  if (!x) return { counts: null, text: "この領域の回答は保存されていません。", answers: [] };
  const a = count(x.a), b = count(x.b);
  const ids = idsOfDomain4(d);
  const answers = ["U", "P", "N"].map(k => {
    const q = ITEMS4[ids[k]], pick = x.picks?.[k];
    return { label: k === "U" ? "普段の自分" : k === "P" ? "場面1" : "場面2",
      scene: q.scene || null, text: pick === "A" ? q.a : pick === "B" ? q.b : choice(D, pick) };
  });
  let text;
  if (x.differentDirections) {
    text = `普段の自分では「${choice(D, x.picks?.U)}」、2つの場面ではどちらも「${choice(D, x.picks?.P)}」を選びました。今回は片側にまとめず、普段と場面での違いを残しています。`;
  } else if (a === null || b === null || a + b < 2) {
    text = "答えられた問が少ないため、この領域の傾向はまだ決めていません。判断できない回答を、どちらかの選択肢に置き換えることはしません。";
  } else if (a + b < 3) {
    text = a === b
      ? "答えた2問では、両方の動き方を1回ずつ選びました。残りの問は無理に埋めず、今回は片側にまとめていません。"
      : "答えた2問では、同じ動き方を選びました。3問すべての回答ではないので、答えられた範囲での傾向として読んでください。";
  } else {
    text = a === 0 || b === 0
      ? "普段の自分についても、2つの場面でも、同じ動き方を選びました。相手や状況が変われば、別の選び方になることもあります。"
      : "3問の中で、両方の動き方を選んでいます。多く選んだほうを中心に読みながら、もう一方も選択肢にあることを残しています。";
  }
  return { counts: a === null || b === null ? null : { a, b }, text, answers };
}

function evidence3(r, d) {
  const x = r.states?.[d];
  if (!x) return { counts: null, text: "この領域の回答は保存されていません。", answers: [] };
  const a = count(x.a), b = count(x.b);
  return {
    counts: a === null || b === null ? null : { a, b },
    text: x.check
      ? "同じ場面で選んだ動き方と、ほかの領域と比べたときの傾向に違いがあります。一つの答えにそろえず、両方を手掛かりに読んでください。"
      : "同じ場面でどちらを選んだかに加え、ほかの領域の行動と比べた回答も合わせて読んでいます。選んだ数だけで、性格の強さやよしあしが決まるわけではありません。",
    answers: [],
  };
}

/**
 * { supports, rows }。本文は全画面で1回だけ。説明済みの領域はその場所を参照する。
 * 補足は主結果と異なるテーマの完成原稿を最大2本。PAIR と保留には足さない。
 */
export function resultDetails(r, copy) {
  const four = r?.diagnosisVersion === "v4";
  const states = four ? copyStatesOf4(r) : copyStatesOf3(r);
  const order = four ? undefined : order3(r?.states);
  const eligible = four ? () => true : bridgeOk3(r?.states);
  const supports = [];
  const usedTags = [...(copy?.claimTags || [])];
  const candidates = { ...states };
  if (copy?.primaryDomain) delete candidates[copy.primaryDomain];
  if (copy?.kind === "primary") {
    for (let i = 0; i < DOMAIN_IDS4.length && supports.length < 2; i++) {
      const p = primaryOf4(candidates, { order });
      if (!p) break;
      delete candidates[p.domain];
      if (!STRONG.includes(p.state) || !eligible(p.domain, p.state)) continue;
      const tags = claimTagsOf4(p.domain, p.state);
      if (tags.some(t => sameTheme4(t, usedTags))) continue;
      const body = domainCopy4(p.domain, p.state)?.body;
      if (!body || copy.paragraphs.includes(body) || supports.some(s => s.body === body)) continue;
      supports.push({ domain: p.domain, name: DOMAINS[p.domain].name, body, anchor: `result-support-${p.domain}` });
      usedTags.push(...tags);
    }
  }
  const seen = new Map((copy?.paragraphs || []).map(p => [p, "result-main-copy"]));
  for (const s of supports) seen.set(s.body, s.anchor);
  // 専用のペア本文に含まれる2領域は、別々の似た本文を重ねない。
  const pair = copy?.kind === "pair" ? new Set([7, 8]) : new Set();
  const rows = DOMAIN_IDS4.map(d => {
    const D = DOMAINS[d], state = states[d];
    const source = domainCopy4(d, state)?.body || "";
    const ref = pair.has(d) ? "result-main-copy" : seen.get(source) || null;
    const body = ref ? null : source;
    if (body) seen.set(body, `result-axis-${d}`);
    return { domain: d, name: D.name, aName: D.a, bName: D.b, state, body, ref,
      ...(four ? evidence4(r, d) : evidence3(r, d)) };
  });
  return { supports, rows };
}
