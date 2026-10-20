// node tests/app_v4.test.mjs
// 新しい画面（app/）の 24問版（v4。決定 U42）の DOM の無い部分。仕様：docs/diagnosis-v4.md
//  - app/js/diagnosis_version.js：既定は v4、?dv= で切り替え、今の診断の版（最後に触った版）、途中の三択は三択のまま、三択の結果を消さない
//  - app/js/summary4.js：冒頭の見出し・主な傾向・結果の key・履歴に足す形
//  - app/js/axis_art.js：v4 の絵（p＞0 は A寄り、p＜0 は B寄り、p＝0 はまんなか。答えがそろわない領域は絵なし）、heroArt・slotMarks・typeMarks が v4 も受け取る
//  - app/js/transfer.js：24問の診断も引き継げる（three と four の両方・four だけ）。壊れた four は読めない
//  - js/consult/from_diagnosis4.js：相談の8領域の向き（状態 1・2・3・4・1w・3w だけ向きを付ける）と手がかり
// Node には localStorage が無いので、globalThis.localStorage に入れ物（Map）を置く（三択・24問・記録・版の印がどれもそれを使う）
import assert from "node:assert/strict";
import { store3, start3, answer3, practice3, practicePending3, discard3, setFbMode3 } from "../js/ui/three_store.js";
import { store4, start4, answer4, back4, discard4, useStorage4, STORAGE_KEY4 } from "../js/ui/four_store.js";
import { QUESTION_ORDER4, ITEMS4 } from "../js/data/questions4.js";
import { computeResult4 } from "../js/engine4.js";
import { useStorage, loadRecords } from "../app/js/local.js";
import {
  DEFAULT_DIAGNOSIS_VERSION, ACTIVE_KEY, dvFromSearch, resolveCurrentVersion, newDiagnosisVersion, currentVersion, currentResult, currentStatus,
  setActiveVersion, activeMarker, discardCurrent, midV3,
} from "../app/js/diagnosis_version.js";
import { isResult4, leadOf4, tendencies4, resultKey4, diagnosisRecord4, recordDiagnosis4 } from "../app/js/summary4.js";
import { resultKey } from "../app/js/summary.js";
import { artSideOfP, axisArt4, heroArt4, heroArt, slotMarks, AXIS_ART } from "../app/js/axis_art.js";
import { typeMarks } from "../app/js/type_catalog.js";
import { makeTransferCode, readTransferCode, applyTransfer, PREFIX } from "../app/js/transfer.js";
import { domainsFromResult4, consultClues4 } from "../js/consult/from_diagnosis4.js";
import { buildContext } from "../js/consult/context.js";

let fail = 0, pass = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}
/** 入れ物を差し替える（＝別の端末）。三択・24問・版の印も空にする */
function device() {
  const s = memory();
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true });
  useStorage(null);
  useStorage4(null);
  setFbMode3(false);
  discard3();
  discard4();
  setActiveVersion(null);
  return s;
}
/** 三択 v3 を n 問（省略で最後まで）答える */
function answer3n(n = Infinity) {
  start3({ adaptive: true, version: "v3" });
  let i = 0;
  while (!store3.result && i < n) {
    if (practicePending3()) { practice3("left"); continue; }
    i++;
    answer3(i % 3 ? "left" : "right");
  }
  return i;
}
/** 24問を答える。pick(id, i) → 数か null */
function answer4all(pick = (id, i) => (ITEMS4[id].kind === "R" ? (i * 7) % 5 : ((i * 3) % 5) - 2), n = 24) {
  start4();
  for (let i = 0; i < n; i++) answer4(pick(QUESTION_ORDER4[i], i));
}
const ans = (v) => (v === null ? { status: "unknown", value: null } : { status: "answered", value: v });
const result4Of = (spec) => {
  const answers = {};
  for (const [d, [a, b, p]] of Object.entries(spec)) { answers[`R${d}A`] = ans(a); answers[`R${d}B`] = ans(b); answers[`P${d}`] = ans(p); }
  return computeResult4(answers);
};

// ---------------------------------------------------------------- 版の切り替え
await test("既定は v4。?dv=v3｜v4 で切り替え（知らない値は無視）", () => {
  assert.equal(DEFAULT_DIAGNOSIS_VERSION, "v4");
  assert.equal(dvFromSearch("?dv=v3"), "v3");
  assert.equal(dvFromSearch("?ui=v2&dv=V4"), "v4");
  assert.equal(dvFromSearch("?dv=v5"), null);
  assert.equal(dvFromSearch(""), null);
  assert.equal(newDiagnosisVersion({ url: null }), "v4");
  assert.equal(newDiagnosisVersion({ url: "v3" }), "v3");
  assert.equal(newDiagnosisVersion({ url: null, def: "v3" }), "v3", "既定を v3 に戻したとき");
});

await test("今の診断の版：URL ＞ 最後に触った版（その保存があるとき）＞ v4 の保存 ＞ v3 の保存 ＞ 既定", () => {
  const R = resolveCurrentVersion;
  assert.equal(R({}), "v4");
  assert.equal(R({ def: "v3" }), "v3");
  assert.equal(R({ has3: true }), "v3", "前からの三択だけ（印なし）");
  assert.equal(R({ has3: true, has4: true }), "v4");
  assert.equal(R({ marker: "v3", has3: true, has4: true }), "v3");
  assert.equal(R({ marker: "v3", has3: false, has4: true }), "v4", "印の版の保存が無ければ使わない");
  assert.equal(R({ url: "v3", marker: "v4", has4: true }), "v3");
});

await test("途中の三択は三択のまま。24問を始めると v4 が今の診断に。三択の保存は消さない。v4 を消すと三択に戻る", () => {
  device();
  assert.equal(currentVersion({ url: null }), "v4");
  answer3n(5);
  assert.equal(activeMarker(), "v3");
  assert.equal(currentVersion({ url: null }), "v3");
  assert.deepEqual(midV3() && { state: midV3().state, answered: midV3().answered }, { state: "mid", answered: 5 });
  assert.equal(currentStatus({ url: null }).state, "mid");
  start4();
  assert.equal(activeMarker(), "v4");
  assert.equal(currentVersion({ url: null }), "v4");
  assert.equal(currentStatus({ url: null }).state, "before");
  assert.ok(store3.session, "三択の途中の回答は残る");
  answer4(3); answer4(null);
  assert.deepEqual([currentStatus({ url: null }).state, currentStatus({ url: null }).answered], ["mid", 2]);
  assert.equal(currentVersion({ url: "v3" }), "v3", "?dv=v3 なら三択");
  discardCurrent();   // 今の版（v4）だけ消す
  assert.equal(store4.session, null);
  assert.equal(activeMarker(), null);
  assert.equal(currentVersion({ url: null }), "v3");
  assert.equal(currentStatus({ url: null }).answered, 5);
});

await test("三択の結果は、24問を始めても消えない。24問が終われば今の結果は v4、?dv=v3 では三択の結果", () => {
  device();
  answer3n();
  const r3 = store3.result;
  assert.ok(r3);
  assert.equal(currentResult({ url: null }), r3);
  start4();
  assert.equal(currentResult({ url: null }), null, "24問の途中は結果なし（三択で新しく始めたときと同じ）");
  assert.equal(store3.result, r3);
  for (let i = 0; i < 24; i++) answer4(ITEMS4[QUESTION_ORDER4[i]].kind === "R" ? 3 : 1);
  assert.ok(isResult4(currentResult({ url: null })));
  assert.equal(currentResult({ url: "v3" }), r3);
  assert.equal(currentStatus({ url: null }).state, "done");
  assert.ok(localStorage.getItem("seikaku16:three:v1"));
  assert.ok(localStorage.getItem(STORAGE_KEY4));
  assert.equal(localStorage.getItem(ACTIVE_KEY), "v4");
});

// ---------------------------------------------------------------- summary4
await test("冒頭の見出し：primary（主軸の状態の見出し）・multiple・flat・none", () => {
  const all = (abp, over = {}) => result4Of(Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((d) => [d, over[d] ?? abp])));
  const p = leadOf4(all([0, 0, 0], { 2: [0, 4, -2] }));
  assert.deepEqual(p, { kind: "primary", title: "「熟考」を選びやすい", body: "普段の回答では「熟考」の当てはまりが多く、今回の場面でも「熟考」を選ぶ傾向が見られます。", domain: 2 });
  const m = leadOf4(all([0, 0, 0], { 4: [3, 3, 0] }));
  assert.equal(m.kind, "multiple"); assert.equal(m.title, "複数の傾向を持つ"); assert.ok(m.body.includes("感情表出"));
  assert.equal(leadOf4(all([1, 1, 0])).title, "今回の回答では、片側に強く寄らない傾向");
  const n = leadOf4(all([4, 0, null]));
  assert.equal(n.kind, "none"); assert.equal(n.title, "");
  assert.equal(leadOf4(null), null);
});

await test("主な傾向（主軸と補足）・結果の key・履歴に足す形（同じ結果は2回足さない）", () => {
  device();
  const r = result4Of({ 1: [4, 0, 2], 2: [0, 4, -1], 3: [3, 2, 1], 4: [3, 3, 0], 5: [0, 0, 0], 6: [2, 0, 1], 7: [1, 1, 0], 8: [4, 4, 0] });
  assert.deepEqual(tendencies4(r).map((t) => [t.key, t.name, t.role]), [["1A", "向き合う", "主軸"], ["2B", "熟考", "補足"], ["3A", "追う", "補足"]]);
  const k = resultKey4(r);
  assert.ok(k.startsWith("d4-v4-24-2026-10-20-"));
  assert.equal(resultKey4(result4Of({ 1: [4, 0, 2], 2: [0, 4, -1], 3: [3, 2, 1], 4: [3, 3, 0], 5: [0, 0, 0], 6: [2, 0, 1], 7: [1, 1, 0], 8: [4, 4, 0] })), k);
  assert.notEqual(resultKey4(result4Of({ 1: [4, 0, 2], 2: [0, 4, -1], 3: [3, 2, 1], 4: [3, 3, 0], 5: [0, 0, 0], 6: [2, 0, 1], 7: [1, 1, 0], 8: [4, 4, null] })), k);
  const rec = diagnosisRecord4(r);
  assert.equal(rec.kind, "diagnosis");
  assert.equal(rec.title, "「向き合う」を選びやすい");
  assert.equal(rec.data.version, "v4");
  assert.equal(rec.data.key, k);
  assert.equal(rec.data.tendencies.length, 3);
  const id = recordDiagnosis4(r);
  assert.ok(id);
  assert.equal(recordDiagnosis4(r), id);
  assert.equal(loadRecords().items.length, 1);
});

// ---------------------------------------------------------------- 絵
await test("絵：p＞0 は A寄り、p＜0 は B寄り、p＝0 はまんなか。答えがそろわない領域は絵なし", () => {
  assert.deepEqual([2, 1, 0, -1, -2, null, undefined, 0.5].map(artSideOfP), ["a", "a", "mid", "b", "b", null, null, null]);
  const r = result4Of({ 1: [4, 0, 2], 2: [0, 4, -1], 3: [3, 3, 0], 4: [4, 0, null], 5: [0, 0, 1], 6: [1, 1, -2], 7: [2, 2, 0], 8: [0, 3, -2] });
  assert.equal(axisArt4(1, r.domains[1]).id, "1-a");
  assert.equal(axisArt4(2, r.domains[2]).id, "2-b");
  assert.equal(axisArt4(3, r.domains[3]).id, "3-mid");
  assert.equal(axisArt4(4, r.domains[4]).file, null, "答えがそろわない");
  assert.equal(axisArt4(5, r.domains[5]).id, "5-a", "状態6でも p で選ぶ");
  assert.equal(axisArt4(9, r.domains[1]), null);
  const hero = heroArt(r);
  assert.deepEqual(hero, heroArt4(r));
  assert.equal(hero.id, `${r.primaryDomainId}-${artSideOfP(r.domains[r.primaryDomainId].p)}`);
  assert.equal(hero.file, AXIS_ART[r.primaryDomainId][artSideOfP(r.domains[r.primaryDomainId].p)].file);
  const m = slotMarks(r);
  assert.deepEqual(m.picked, ["1-a", "2-b", "3-mid", "5-a", "6-b", "7-mid", "8-b"]);
  assert.equal(m.hero, hero.id);
  const t = typeMarks(r);
  assert.deepEqual(t.yours, { 1: "1-a", 2: "2-b", 3: "3-mid", 5: "5-a", 6: "6-b", 7: "7-mid", 8: "8-b" });
  // 主軸が無ければいちばん上の絵は無い
  assert.equal(heroArt(result4Of(Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((d) => [d, [1, 1, 0]])))), null);
});

// ---------------------------------------------------------------- 引き継ぎ
await test("引き継ぎ：三択の結果と24問の結果を両方移す。今の診断の版（v4）も移る", async () => {
  device();
  answer3n();
  const k3 = resultKey(store3.result);
  answer4all((id, i) => (i === 11 ? null : ITEMS4[id].kind === "R" ? (i * 7) % 5 : ((i * 3) % 5) - 2));
  const k4 = resultKey4(store4.result);
  recordDiagnosis4(store4.result);
  const code = await makeTransferCode({ compress: false });
  const o = JSON.parse(Buffer.from(code.slice(PREFIX.length), "base64url").toString("utf8"));
  assert.ok(o.session && o.four);
  assert.equal(o.active, "v4");
  assert.equal(o.four.answers[QUESTION_ORDER4[11]].status, "unknown");
  device();
  const res = await readTransferCode(code);
  assert.ok(res.ok);
  const out = applyTransfer(res.data);
  assert.ok(out.ok && out.session && out.done);
  assert.equal(resultKey4(store4.result), k4);
  assert.equal(resultKey(store3.result), k3);
  assert.equal(currentVersion({ url: null }), "v4");
  assert.equal(loadRecords().items.filter((x) => x.data?.version === "v4").length, 1);
});

await test("引き継ぎ：24問の途中だけを移す（三択の保存がある端末でも、三択はそのまま）。壊れた four は読めない", async () => {
  device();
  answer4all(undefined, 7);
  const code = await makeTransferCode();
  device();
  answer3n(4);
  const before = JSON.stringify(store3.session.toJSON());
  const res = await readTransferCode(code);
  assert.ok(res.ok);
  assert.ok(!res.data.session);
  applyTransfer(res.data);
  assert.equal(JSON.stringify(store3.session.toJSON()), before);
  assert.equal(store4.session.currentIndex, 7);
  assert.equal(currentVersion({ url: null }), "v4");
  const bad = PREFIX + Buffer.from(JSON.stringify({ t: "seikaku16-move", v: 1, four: { schemaVersion: 1 }, records: [], marks: {} }), "utf8").toString("base64url");
  assert.equal((await readTransferCode(bad)).ok, false);
});

// ---------------------------------------------------------------- 相談への入口
await test("相談の8領域の向き：状態 1・2・1w は A、3・4・3w は B（1w・3w は est）。5・6・7・incomplete は不明。v4 でなければ全部不明", () => {
  const r = result4Of({ 1: [4, 0, 2], 2: [3, 2, 1], 3: [2, 0, 1], 4: [0, 4, -2], 5: [2, 3, -1], 6: [0, 2, -1], 7: [3, 3, 0], 8: [0, 0, 0] });
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((d) => r.domains[d].state), ["1", "2", "1w", "3", "4", "3w", "5", "6"]);
  const s = domainsFromResult4(r);
  assert.deepEqual(s[1], { side: "A", conf: "sure", source: "diagnosis" });
  assert.deepEqual(s[2], { side: "A", conf: "sure", source: "diagnosis" });
  assert.deepEqual(s[3], { side: "A", conf: "est", source: "diagnosis", reason: "weak" });
  assert.deepEqual(s[4], { side: "B", conf: "sure", source: "diagnosis" });
  assert.deepEqual(s[5], { side: "B", conf: "sure", source: "diagnosis" });
  assert.deepEqual(s[6], { side: "B", conf: "est", source: "diagnosis", reason: "weak" });
  assert.deepEqual(s[7], { side: null, conf: "none", source: "diagnosis" });
  assert.deepEqual(s[8], { side: null, conf: "none", source: "diagnosis" });
  const dd = domainsFromResult4(result4Of({ 1: [4, 1, -1], 2: [4, 0, null] }));
  assert.equal(dd[1].side, null, "状態7（differentDirections）");
  assert.equal(dd[2].side, null, "答えがそろわない");
  for (const x of [null, {}, store3.result]) assert.ok(Object.values(domainsFromResult4(x)).every((v) => v.side === null && v.conf === "none"));
  // 相談の判定にそのまま渡せる（judge は side・conf だけを使う）
  const ctx = buildContext({ input: {}, consultText: "", self: s, now: "2026-10-20T03:00:00Z", tzOffset: 540 });
  assert.equal(ctx.input.self[1].side, "A");
  assert.equal(ctx.input.self[3].conf, "est");
  assert.ok(ctx.result && typeof ctx.result.action === "string");
});

await test("相談の手がかり：領域名・A/B の当てはまり・p・状態・欠けた項目", () => {
  const r = result4Of({ 1: [4, null, 1] });
  const c = consultClues4(r);
  assert.equal(c.length, 8);
  assert.deepEqual(c[0], { domain: 1, name: "衝突への向き合い方", aName: "向き合う", bName: "距離を取る", a: 4, b: null, p: 1, state: "incomplete", differentDirections: false, missing: ["R1B"] });
  assert.deepEqual(c[1].missing, ["R2A", "R2B", "P2"]);
  assert.deepEqual(consultClues4(null), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
