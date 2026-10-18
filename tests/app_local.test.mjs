// node tests/app_local.test.mjs
// 新しい画面（app/）の DOM の無い部分のテスト。仕様：docs/app-screens.md §6.3
//  - app/js/local.js：記録の出し入れ（新しい順・同じ診断結果は2回足さない・消す・すべて消す）、結果の印、保存できないときも落ちない
//  - app/js/summary.js：主軸の見出し・主な傾向・結果の key・履歴に足す形（サンプルの結果で）、8つの軸の1本（axisView。§12 の2）
// Node には localStorage が無いので、useStorage で入れ物を差し替える。時刻は ISO（UTC）で渡すので時差に依存しない
import assert from "node:assert/strict";
import { STORAGE_KEY, useStorage, loadRecords, getRecord, addRecord, removeRecord, clearRecords, clearAll, getMarks, setMarks, MAX_ITEMS } from "../app/js/local.js";
import { mainPattern, topTendencies, resultKey, diagnosisRecord, recordDiagnosis, heroKey, axisView } from "../app/js/summary.js";
import { fromLikertAnswers, fromScores } from "../js/adaptive3.js";
import { SAMPLES3, PROFILE_SAMPLES3 } from "../js/data/samples3.js";
import { TYPE_IMAGES, isReady } from "../js/data/type_images.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

/** localStorage の代わり（Map に入れるだけ） */
function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}
/** 何をしても投げる入れ物（保存できない環境） */
const broken = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };

// ---------------------------------------------------------------- local.js
test("空のときは items が空", () => {
  useStorage(memory());
  assert.deepEqual(loadRecords(), { items: [] });
  assert.equal(getRecord("x"), null);
});

test("足すと id が返り、新しい順に並ぶ（at は ISO の UTC で残る）", () => {
  const s = memory(); useStorage(s);
  const a = addRecord({ kind: "consult", at: "2026-10-01T10:00:00Z", title: "古い相談", sub: "待つ", data: { text: "古い" } });
  const b = addRecord({ kind: "consult", at: "2026-10-03T10:00:00Z", title: "新しい相談", sub: "送る" });
  const c = addRecord({ kind: "diagnosis", at: "2026-10-02T10:00:00Z", title: "真ん中", data: { key: "k1" } });
  assert.ok(a && b && c && new Set([a, b, c]).size === 3);
  const { items } = loadRecords();
  assert.deepEqual(items.map(x => x.title), ["新しい相談", "真ん中", "古い相談"]);
  assert.equal(items[2].at, "2026-10-01T10:00:00.000Z");
  assert.deepEqual(items[2].data, { text: "古い" });
  assert.equal(getRecord(c).kind, "diagnosis");
  assert.ok(s._m.has(STORAGE_KEY));
});

test("同じ診断結果（data.key が同じ）は2回足さず、前の id を返す。相談は同じ文でも足す", () => {
  useStorage(memory());
  const a = addRecord({ kind: "diagnosis", title: "主軸", data: { key: "same" } });
  const b = addRecord({ kind: "diagnosis", title: "主軸", data: { key: "same" } });
  assert.equal(a, b);
  addRecord({ kind: "diagnosis", title: "別の結果", data: { key: "other" } });
  addRecord({ kind: "consult", title: "同じ文" });
  addRecord({ kind: "consult", title: "同じ文" });
  assert.equal(loadRecords().items.length, 4);
});

test("知らない種類は足さない（null）。title・sub は文字にして前後の空白を落とす", () => {
  useStorage(memory());
  assert.equal(addRecord({ kind: "other", title: "x" }), null);
  assert.equal(addRecord(), null);
  const id = addRecord({ kind: "consult", title: "  書いた文  ", sub: 12 });
  const r = getRecord(id);
  assert.equal(r.title, "書いた文");
  assert.equal(r.sub, "12");
  assert.equal(r.data, null);
});

test("1件消す・すべて消す（clearRecords は印を残し、clearAll は全部消す）", () => {
  const s = memory(); useStorage(s);
  const a = addRecord({ kind: "consult", title: "a" });
  addRecord({ kind: "consult", title: "b" });
  setMarks("k", { off: [1] });
  assert.equal(removeRecord(a), true);
  assert.equal(removeRecord(a), false);
  assert.deepEqual(loadRecords().items.map(x => x.title), ["b"]);
  assert.equal(clearRecords(), true);
  assert.equal(loadRecords().items.length, 0);
  assert.deepEqual(getMarks("k"), { off: [1] });
  assert.equal(clearAll(), true);
  assert.equal(getMarks("k"), null);
  assert.equal(s._m.has(STORAGE_KEY), false);
});

test("結果の印：保存・読み出し・null で消す。読み出した物を直しても保存は変わらない", () => {
  useStorage(memory());
  assert.equal(getMarks("r1"), null);
  assert.equal(setMarks("r1", { off: { B1: [0, 2] }, scenes: { "B1-1": "yes" } }), true);
  const m = getMarks("r1");
  assert.deepEqual(m, { off: { B1: [0, 2] }, scenes: { "B1-1": "yes" } });
  m.off.B1.push(9);
  assert.deepEqual(getMarks("r1").off.B1, [0, 2]);
  setMarks("r1", null);
  assert.equal(getMarks("r1"), null);
});

test("記録は上限まで（古いものから消える）", () => {
  useStorage(memory());
  const base = Date.UTC(2026, 0, 1);
  for (let i = 0; i < MAX_ITEMS + 5; i++) addRecord({ kind: "consult", at: base + i * 60000, title: `t${i}` });
  const { items } = loadRecords();
  assert.equal(items.length, MAX_ITEMS);
  assert.equal(items[0].title, `t${MAX_ITEMS + 4}`);
  assert.equal(items.at(-1).title, "t5");
});

test("保存できない環境でも落ちない（読むと空、足すと null）", () => {
  useStorage(broken);
  assert.deepEqual(loadRecords(), { items: [] });
  assert.equal(addRecord({ kind: "consult", title: "x" }), null);
  assert.equal(removeRecord("x"), false);
  assert.equal(clearRecords(), false);
  assert.equal(clearAll(), false);
  assert.equal(getMarks("k"), null);
  assert.equal(setMarks("k", { a: 1 }), false);
});

test("壊れた保存（JSON でない・形が違う）は空として読む", () => {
  const s = memory(); useStorage(s);
  s.setItem(STORAGE_KEY, "{not json");
  assert.deepEqual(loadRecords(), { items: [] });
  s.setItem(STORAGE_KEY, JSON.stringify({ items: [{ id: 1 }, { id: "ok", kind: "consult", at: "2026-10-18T00:00:00Z", title: "残る" }, { id: "bad", kind: "consult", at: "いつか" }] }));
  assert.deepEqual(loadRecords().items.map(x => x.id), ["ok"]);
  assert.ok(addRecord({ kind: "consult", title: "足せる" }));
});

test("globalThis.localStorage が無い Node でも、既定のままで落ちない", () => {
  useStorage(null);
  assert.deepEqual(loadRecords(), { items: [] });
  assert.equal(addRecord({ kind: "consult", title: "x" }), null);
});

// ---------------------------------------------------------------- summary.js（サンプルの結果で）
const results = [
  ...SAMPLES3.map(s => ({ name: s.key, r: fromLikertAnswers(s.answers, s.wording, { version: "v3" }).result() })),
  ...PROFILE_SAMPLES3.map(p => ({ name: p.key, r: fromScores(p.scores, p.duel, { version: "v3" }).result() })),
];

test("主軸のパターン：見出しと1〜2行があり、role は主軸", () => {
  assert.ok(results.length >= 2);
  for (const { name, r } of results) {
    const m = mainPattern(r);
    if (!r.select.chosen.length) { assert.equal(m, null, name); continue; }
    assert.equal(m.role, "主軸", name);
    assert.ok(m.headline.trim(), `${name}：見出し`);
    assert.ok(m.one.trim(), `${name}：1〜2行`);
  }
  assert.equal(mainPattern(null), null);
  assert.equal(mainPattern({ select: { chosen: [] } }), null);
});

test("主な傾向：3つまで・拮抗した領域は入れない・弱めでないものが先・強さの順", () => {
  for (const { name, r } of results) {
    const top = topTendencies(r, 3);
    assert.ok(top.length <= 3, name);
    for (const t of top) {
      assert.match(t.key, /^[1-8][AB]$/, name);
      assert.equal(t.side, t.key.slice(-1));
      assert.ok(t.name && t.domainName, name);
    }
    for (let i = 1; i < top.length; i++) {
      const x = top[i - 1], y = top[i];
      assert.ok(x.weak <= y.weak, `${name}：弱めは後ろ`);
      if (x.weak === y.weak) assert.ok(x.level >= y.level, `${name}：強さの順`);
    }
    assert.equal(new Set(top.map(t => t.domain)).size, top.length, `${name}：領域は重ならない`);
  }
  assert.deepEqual(topTendencies(null), []);
});

test("結果の key：同じ結果なら同じ、違う回答なら違う", () => {
  const s = SAMPLES3[0];
  const r1 = fromLikertAnswers(s.answers, s.wording, { version: "v3" }).result();
  const r2 = fromLikertAnswers(s.answers, s.wording, { version: "v3" }).result();
  assert.equal(resultKey(r1), resultKey(r2));
  const keys = new Set(results.map(x => resultKey(x.r)));
  assert.equal(keys.size, results.length);
  assert.match(resultKey(r1), /^d1-v3-[0-9a-z]+$/);
});

test("履歴に足す形と、同じ結果を2回足さないこと", () => {
  useStorage(memory());
  const { r } = results[0];
  const rec = diagnosisRecord(r);
  assert.equal(rec.kind, "diagnosis");
  assert.equal(rec.title, mainPattern(r).headline);
  assert.equal(rec.data.key, resultKey(r));
  assert.ok(Array.isArray(rec.data.tendencies) && rec.data.tendencies.length <= 3);
  assert.equal(rec.data.answered, r.records.length);
  const a = recordDiagnosis(r), b = recordDiagnosis(r);
  assert.ok(a);
  assert.equal(a, b);
  assert.equal(loadRecords().items.length, 1);
  assert.equal(recordDiagnosis(null), null);
});

test("主軸に合う絵のキーは、絵がある傾向か null", () => {
  for (const { name, r } of results) {
    const k = heroKey(r);
    if (k !== null) assert.ok(isReady(TYPE_IMAGES[k]), `${name}：${k}`);
  }
  assert.equal(heroKey(null), null);
});

test("8つの軸の1本：●の位置・「〜寄り」・まんなか・答えが無いとき・強さ・読み上げ", () => {
  const at = (states) => ({ states });
  const b = axisView(at({ 2: { a: 1, b: 3, LA: 40.4, LB: 71.6 } }), 2);
  assert.equal(b.pos, 0.75);
  assert.equal(b.side, "B");
  assert.equal(b.pct, 75);
  assert.equal(b.text, "熟考寄り 75%");
  assert.equal(b.level, "即応 40 ・ 熟考 72");
  assert.equal(b.label, "反応速度：熟考寄り 75%（即応の強さ 40、熟考の強さ 72）");
  const a = axisView(at({ 1: { a: 5, b: 1, LA: 50, LB: 40 } }), 1);
  assert.equal(a.side, "A");
  assert.equal(a.text, "向き合う寄り 83%");
  assert.ok(Math.abs(a.pos - 1 / 6) < 1e-9);
  const allA = axisView(at({ 3: { a: 4, b: 0, LA: 100, LB: 0 } }), 3);
  assert.equal(allA.pos, 0);
  assert.equal(allA.text, "追う寄り 100%");
  const mid = axisView(at({ 1: { a: 3, b: 3, LA: 50, LB: 50 } }), 1);
  assert.equal(mid.side, "mid");
  assert.equal(mid.pos, 0.5);
  assert.equal(mid.text, "まんなか 50%");
  const none = axisView(at({ 4: { a: 0, b: 0, LA: 50, LB: 50 } }), 4);
  assert.equal(none.pos, null);
  assert.equal(none.side, null);
  assert.equal(none.text, "まだ答えがありません");
  assert.equal(none.label, "感情表出：まだ答えがありません（表に出すの強さ 50、内に置くの強さ 50）");
  const noLv = axisView(at({ 5: { a: 1, b: 0 } }), 5);
  assert.equal(noLv.level, "理由・具体 — ・ 気持ち・共感 —");
  assert.equal(axisView(at({}), 9), null);
  // サンプルの結果でも、8本とも値が出る（●は 0〜1、割合は 50〜100）
  for (const { name, r } of results) {
    for (let d = 1; d <= 8; d++) {
      const v = axisView(r, d);
      assert.ok(v, `${name}：領域${d}`);
      if (v.pos !== null) {
        assert.ok(v.pos >= 0 && v.pos <= 1, `${name}：領域${d} の●`);
        assert.ok(v.pct >= 50 && v.pct <= 100, `${name}：領域${d} の割合`);
      }
      assert.ok(Number.isInteger(v.la) && Number.isInteger(v.lb), `${name}：領域${d} の強さ`);
    }
  }
});

useStorage(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
