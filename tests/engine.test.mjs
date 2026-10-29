// node tests/engine.test.mjs
// tests/expected_v2.json と JS エンジン（select）の一致を確認する。
//  - P1〜P5：Python 参照実装（q80/selector_v2.py, 推奨案）の出力。参照実装との照合
//  - 架空の例1・2（source: "js"）：JS の判定で出した値（tools/make_fictional_samples.mjs）。参照実装との照合ではなく、判定が変わっていないことの確かめ（決定 U61）
import { readFileSync } from "node:fs";
import { select, evaluateAll } from "../js/engine.js";

const cases = JSON.parse(readFileSync(new URL("./expected_v2.json", import.meta.url), "utf-8"));
let fail = 0;
for (const c of cases) {
  const duel = {};
  for (const [d, [side, strength]] of Object.entries(c.duel || {})) duel[d] = { side, strength };
  const profile = { scores: c.scores, duel, qualityOk: c.quality_ok };
  const res = select(profile);
  const got = res.chosen.map(h => ({ id: h.meta.id, role: h.role, score: +h.score.toFixed(4) }));
  const exp = c.expected;
  const same = JSON.stringify(got) === JSON.stringify(exp) && res.hits.length === c.hits;
  console.log(`${same ? "OK  " : "FAIL"} ${c.name}  hits=${res.hits.length}/${c.hits}  （${c.source === "js" ? "JS の判定で出した値" : "Python 参照実装"}）`);
  if (!same) { fail++; console.log("  got:", got); console.log("  exp:", exp); }
}
const nPy = cases.filter(c => c.source !== "js").length;
console.log(fail ? `${fail} case(s) failed` : `all cases match（Python reference ${nPy}, JS-made values ${cases.length - nPy}）`);
process.exit(fail ? 1 : 0);
