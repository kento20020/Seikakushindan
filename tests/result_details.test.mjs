import assert from "node:assert/strict";
import { test } from "node:test";
import { computeResult4 } from "../js/engine4.js";
import { resultCopy4 } from "../js/result_copy4.js";
import { resultCopy3 } from "../js/result_copy3.js";
import { resultDetails } from "../js/result_details.js";
import { DOMAIN_COPY4, UNANSWERED_COPY4, DIFFERENT_DIRECTIONS_COPY4 } from "../js/data/result_copy4.js";
import { showResultDetails } from "../app/js/result_details.js";

function result(spec) {
  const answers = {};
  for (let d = 1; d <= 8; d++) {
    [...(spec[d] || "???")].forEach((p, i) => {
      if (p === "-") return;
      answers[`${["U", "P", "N"][i]}${d}`] = p === "?"
        ? { status: "unknown", value: null }
        : { status: "answered", value: p === "A" ? 1 : -1 };
    });
  }
  return computeResult4(answers);
}

test("主結果と同じテーマの補足は飛ばし、異なる長所を全文で読める", () => {
  const r = result({ 1: "AAA", 2: "AAA", 3: "AAA", 4: "AAA", 5: "AAA", 8: "AAA" });
  const c = resultCopy4(r), before = JSON.stringify({ r, c });
  const detail = resultDetails(r, c);
  assert.deepEqual(detail.supports.map(x => x.domain), [4, 5]);
  assert.equal(detail.supports[0].body, DOMAIN_COPY4[4][1].body);
  assert.equal(detail.supports[1].body, DOMAIN_COPY4[5][1].body);
  assert.equal(detail.rows.length, 8);
  for (const d of [1, 4, 5]) {
    assert.equal(detail.rows[d - 1].body, null, "説明済みの本文を繰り返さない");
    assert.ok(detail.rows[d - 1].ref);
  }
  assert.equal(JSON.stringify({ r, c }), before, "採点と主結果を変えない");
  assert.deepEqual(resultCopy4(r), c);
});

test("特殊ペアは2領域の説明を重ねず、各領域の実際の回答は読める", () => {
  const r = result({ 7: "BBB", 8: "BBB", 4: "AB?" });
  const c = resultCopy4(r), detail = resultDetails(r, c);
  assert.equal(c.kind, "pair");
  assert.deepEqual(detail.supports, []);
  for (const d of [7, 8]) {
    const row = detail.rows[d - 1];
    assert.equal(row.body, null);
    assert.equal(row.ref, "result-main-copy");
    assert.deepEqual(row.counts, { a: 0, b: 3 });
    assert.equal(row.answers.length, 3);
  }
});

test("普段と場面の違いは専用の説明で扱い、元の選択を明示する", () => {
  const r = result({ 1: "ABB", 2: "BAA" });
  const detail = resultDetails(r, resultCopy4(r));
  assert.equal(detail.rows[0].body, DIFFERENT_DIRECTIONS_COPY4.body);
  assert.match(detail.rows[0].text, /普段の自分では「向き合う」、2つの場面ではどちらも「距離を取る」/);
  assert.equal(detail.rows[1].ref, "result-axis-1", "同じ専用本文を何度も出さない");
  assert.match(detail.rows[1].text, /普段の自分では「熟考」、2つの場面ではどちらも「即応」/);
  assert.equal(detail.supports.length, 0);
});

test("欠損・判断できない・未回答は埋めずに読み分ける", () => {
  const r = result({ 1: "A?-", 2: "AA?", 3: "AB?" });
  const detail = resultDetails(r, resultCopy4(r));
  assert.deepEqual(detail.rows[0].counts, { a: 1, b: 0 });
  assert.equal(detail.rows[0].body, UNANSWERED_COPY4.body);
  assert.deepEqual(detail.rows[0].answers.map(a => a.label), ["普段の自分", "場面1", "場面2"]);
  assert.equal(detail.rows[0].answers[1].text, "判断できない");
  assert.equal(detail.rows[0].answers[2].text, "未回答");
  assert.match(detail.rows[1].text, /3問すべての回答ではない/);
  assert.match(detail.rows[2].text, /両方の動き方を1回ずつ/);
  assert.equal(detail.supports.length, 0, "弱い傾向を強い補足にしない");
});

test("全て判断できない場合も、原稿を8回繰り返さず補足を作らない", () => {
  const r = result({}), c = resultCopy4(r), detail = resultDetails(r, c);
  assert.equal(c.kind, "none");
  assert.equal(detail.supports.length, 0);
  assert.equal(detail.rows.filter(x => x.body === UNANSWERED_COPY4.body).length, 1);
  assert.ok(detail.rows.every(x => x.answers.every(a => a.text === "判断できない")));
});

test("三択版も既存の結果と原稿を使い、異なる比較の向きは説明に残す", () => {
  const r = { states: {
    1: { state: "1", a: 4, b: 0, LA: 90, LB: 20, mWA: 30, mWB: -40 },
    4: { state: "2", a: 4, b: 0, LA: 70, LB: 80, mWA: 30, mWB: -40, check: true },
    5: { state: "3", a: 0, b: 4, LA: 20, LB: 80, mWA: -40, mWB: 30 },
  } };
  const c = resultCopy3(r), before = JSON.stringify(r), detail = resultDetails(r, c);
  assert.deepEqual(detail.supports.map(x => x.domain), [5], "反対側のほうが強い領域を補足にしない");
  assert.match(detail.rows[3].text, /傾向に違いがあります/);
  assert.equal(detail.rows[3].body, DOMAIN_COPY4[4][2].body);
  assert.deepEqual(detail.rows[0].counts, { a: 4, b: 0 });
  assert.equal(detail.rows[0].answers.length, 0, "24問の場面を捏造しない");
  assert.equal(detail.rows[1].counts, null, "記録なしを0票と見せない");
  assert.equal(JSON.stringify(r), before);
  assert.deepEqual(resultCopy3(r), c);
});

test("短い表示へ戻せる。旧版の切り替えとは独立", () => {
  assert.equal(showResultDetails(""), true);
  assert.equal(showResultDetails("?dv=v4&rd=compact"), false);
  assert.equal(showResultDetails("?rd=full"), true);
});
