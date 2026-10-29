// node tools/make_fictional_samples.mjs
// 架空の例1・2（js/data/samples.js の SAMPLES）の答えを、下の DESIGN（傾向ごとに手で決めた答え）から組み立て、
// 今の JS の判定（js/adaptive.js の scoreFromAnswerMap → js/engine.js の select）で出した値を表示する道具。決定 U61。
// 実在の人の答えではない（実在の2人の答えは 2026-10-29 に外した）。乱数は使わない。
// CI では動かさない（tests/ には置かない）。判定を変えて tests/adaptive.test.mjs・engine.test.mjs が落ちたときに、
// 変わったのが意図どおりなら、ここで出し直して次の4か所を書き替える：
//   js/data/samples.js の answers・expected、js/data/samples3.js の EXPECTED5、tests/expected_v2.json の「架空の例」の2件
// 出る値は「JS の判定で出した値」で、Python の参照実装（q80/、このリポジトリには無い）との照合ではない。
import { QUESTIONS } from "../js/data/questions.js";
import { scoreFromAnswerMap, BASIC_BY_TRAIT } from "../js/adaptive.js";

// 基本：傾向ごとの4問（設問番号の小さい順）。一貫性：傾向ごとの1問（一貫性の設問がある8傾向だけ）。
// 対決：Q73〜Q80（1＝その設問の a 側に強く、5＝b 側に強く。設問ごとに a/b の向きが違う）。
export const DESIGN = [
  {
    // その場で向き合い、すぐ返し、自分から連絡する。気持ちを分かってほしい・話を広げがち・普段の空気に戻れば終われる。
    // 一貫性の Q51（向き合う）だけ、わざと基本の4問と逆（1）にしてある（tests/adaptive.test.mjs の「一貫性」の確かめ用）。
    name: "架空の例1（表現A）", wording: 0,
    basic: {
      "向き合う": [5, 4, 5, 5], "距離を取る": [2, 1, 2, 1],
      "即応": [5, 5, 4, 5], "熟考": [2, 1, 2, 2],
      "追う": [4, 5, 5, 4], "待つ": [1, 2, 2, 1],
      "表に出す": [4, 4, 3, 4], "内に置く": [3, 2, 3, 2],
      "理由・具体": [2, 2, 3, 2], "気持ち・共感": [5, 4, 5, 5],
      "主導する": [4, 5, 4, 4], "調整する": [2, 2, 1, 3],
      "広げる": [4, 4, 5, 3], "切り分ける": [2, 2, 3, 1],
      "解決する": [2, 3, 2, 2], "関係を戻す": [5, 5, 4, 5],
    },
    consist: { "向き合う": 1, "熟考": 2, "追う": 5, "内に置く": 3, "気持ち・共感": 4, "主導する": 4, "切り分ける": 2, "解決する": 2 },
    duel: { 73: 1, 74: 5, 75: 2, 76: 4, 77: 5, 78: 4, 79: 2, 80: 1 },
  },
  {
    // いったん離れて考え、気持ちは内に置く。相手に合わせ、一件に絞って、きちんと決めたい。
    // 領域3（追う／待つ）はどちらとも言えない（対決も 3）、領域5 は理由も気持ちも強い（対決は理由寄り）。
    name: "架空の例2（表現B）", wording: 1,
    basic: {
      "向き合う": [3, 2, 3, 3], "距離を取る": [5, 4, 5, 4],
      "即応": [2, 1, 2, 2], "熟考": [5, 5, 4, 5],
      "追う": [3, 3, 2, 4], "待つ": [3, 4, 3, 3],
      "表に出す": [2, 1, 1, 2], "内に置く": [5, 5, 4, 4],
      "理由・具体": [5, 4, 5, 5], "気持ち・共感": [4, 5, 4, 4],
      "主導する": [2, 2, 3, 1], "調整する": [4, 5, 5, 4],
      "広げる": [1, 2, 2, 1], "切り分ける": [5, 4, 5, 5],
      "解決する": [5, 5, 4, 5], "関係を戻す": [2, 3, 2, 2],
    },
    consist: { "向き合う": 3, "熟考": 5, "追う": 3, "内に置く": 5, "気持ち・共感": 4, "主導する": 2, "切り分ける": 4, "解決する": 5 },
    duel: { 73: 4, 74: 1, 75: 3, 76: 2, 77: 2, 78: 1, 79: 5, 80: 5 },
  },
];

/** DESIGN の1件 → 80問シート形式 {設問番号: 回答1〜5} */
export function buildAnswers(d) {
  const ans = {};
  for (const [t, vs] of Object.entries(d.basic)) BASIC_BY_TRAIT[t].forEach((it, i) => { ans[it.no] = vs[i]; });
  for (const it of QUESTIONS.items.filter(i => i.role === "consist")) ans[it.no] = d.consist[it.trait];
  for (const [no, v] of Object.entries(d.duel)) ans[no] = v;
  return Object.fromEntries(Object.keys(ans).map(Number).sort((a, b) => a - b).map(n => [n, ans[n]]));
}

/** tests/expected_v2.json の1件の形（P1〜P5 と同じキー ＋ source・note） */
export function expectedEntry(d) {
  const answers = buildAnswers(d);
  const r = scoreFromAnswerMap(answers, d.wording);
  return {
    name: d.name.split(/[（ ]/)[0],
    source: "js",
    note: "架空の答え（tools/make_fictional_samples.mjs）。scores・duel・expected・hits は JS の判定（js/adaptive.js の scoreFromAnswerMap）で出した値。Python の参照実装との照合ではない",
    answers,
    scores: r.scores,
    duel: Object.fromEntries(Object.entries(r.profile.duel).map(([dom, v]) => [dom, [v.side, v.strength]])),
    quality_ok: r.quality.ok,
    expected: r.select.chosen.map(h => ({ id: h.meta.id, role: h.role, score: +h.score.toFixed(4) })),
    hits: r.select.hits.length,
  };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  for (const d of DESIGN) {
    const e = expectedEntry(d);
    console.log(`// ${d.name}  samples.js の answers / expected、samples3.js の EXPECTED5`);
    console.log(`answers: ${JSON.stringify(e.answers).replace(/"(\d+)":/g, "$1: ").replace(/,/g, ", ")},`);
    console.log(`expected: ${JSON.stringify(e.expected.map(x => x.id))},`);
    console.log(`EXPECTED5: ${JSON.stringify(e.expected.map(x => [x.id, x.role])).replace(/\],\[/g, "], [").replace(/","/g, "\", \"")}`);
    console.log("// tests/expected_v2.json の1件");
    console.log(JSON.stringify(e, null, 2));
    console.log();
  }
}
