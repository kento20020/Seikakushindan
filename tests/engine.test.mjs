// node tests/engine.test.mjs
// Python 参照実装（q80/selector_v2.py, 推奨案）の出力 tests/expected_v2.json と JS エンジンの一致を確認する
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
  console.log(`${same ? "OK  " : "FAIL"} ${c.name}  hits=${res.hits.length}/${c.hits}`);
  if (!same) { fail++; console.log("  got:", got); console.log("  exp:", exp); }
}
console.log(fail ? `${fail} case(s) failed` : "all cases match the Python reference");
process.exit(fail ? 1 : 0);
