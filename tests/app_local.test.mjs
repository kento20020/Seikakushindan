// node tests/app_local.test.mjs
// 新しい画面（app/）の DOM の無い部分のテスト。仕様：docs/app-screens.md §6.3
//  - app/js/local.js：記録の出し入れ（新しい順・同じ診断結果は2回足さない・消す・すべて消す）、結果の印、保存できないときも落ちない
//  - app/js/summary.js：主軸の見出し・主な傾向・結果の key・履歴に足す形（サンプルの結果で）、8つの軸の1本（axisView。§12 の2）、
//    見出しの半角の引用符を「」にする（jpQuotes）
//  - app/js/axis_art.js：軸の絵（8軸×3パターン。§13）。axisArt の a・b・mid・答えなし、heroArt が軸の絵を返すこと、ホームの絵（home.js の homePics）
//  - 診断結果の絵の一覧（#images。§14）：axis_art.js の axisArtSlots・slotMarks、images.js の typeImageSlots（今の画面の傾向の絵）
// Node には localStorage が無いので、useStorage で入れ物を差し替える。時刻は ISO（UTC）で渡すので時差に依存しない
import assert from "node:assert/strict";
import { STORAGE_KEY, useStorage, loadRecords, getRecord, addRecord, removeRecord, clearRecords, clearAll, getMarks, setMarks, MAX_ITEMS } from "../app/js/local.js";
import { mainPattern, topTendencies, resultKey, diagnosisRecord, recordDiagnosis, heroKey, axisView, jpQuotes } from "../app/js/summary.js";
import { fromLikertAnswers, fromScores } from "../js/adaptive3.js";
import { SAMPLES3, PROFILE_SAMPLES3 } from "../js/data/samples3.js";
import { TYPE_IMAGES, isReady, heroTendency } from "../js/data/type_images.js";
import { AXIS_ART, NAVY, artOf, artSide, axisArt, heroArt, axisArtSlots, slotMarks } from "../app/js/axis_art.js";
import { homePics } from "../app/js/home.js";
import { typeImageSlots } from "../app/js/images.js";
import { DOMAINS } from "../js/engine3.js";
import { existsSync } from "node:fs";

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

test("見出しの半角の引用符を「」にする（jpQuotes）：置き換え・null・引用符の無い文", () => {
  assert.equal(jpQuotes('"ちょっと待って"は早い。本題は遅い。'), "「ちょっと待って」は早い。本題は遅い。");
  assert.equal(jpQuotes('"ごめん"より、"なぜ"が聞きたい。'), "「ごめん」より、「なぜ」が聞きたい。");
  assert.equal(jpQuotes(null), null);
  assert.equal(jpQuotes(undefined), undefined);
  assert.equal(jpQuotes("引用符の無い見出し。"), "引用符の無い見出し。");
});

// ---------------------------------------------------------------- axis_art.js（軸の絵。§13）
const appFile = (f) => new URL(`../app/${f}`, import.meta.url);

test("軸の絵の一覧：8軸それぞれに色と a・b の絵（ファイルがある）。まんなかはまだ無い。B 側は紺", () => {
  const colors = { 1: ["#2E9A8F", "#2E9188"], 2: ["#D9A23A", "#A47D38"], 3: ["#4F86CC", "#4E84C9"], 4: ["#C06A92", "#BD6990"],
    5: ["#9468B6", "#9468B6"], 6: ["#DB7A45", "#BF6D42"], 7: ["#7F9545", "#768A43"], 8: ["#DE675F", "#D0625B"] };
  assert.deepEqual(Object.keys(AXIS_ART).map(Number), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const [d, [color, deep]] of Object.entries(colors)) {
    const t = AXIS_ART[d];
    assert.equal(t.color, color, `軸${d} の色`);
    assert.equal(t.deep, deep, `軸${d} の点の色`);
    assert.equal(t.name, DOMAINS[d].name);
    for (const side of ["a", "b"]) {
      assert.equal(t[side].file, `img/axes/${d}-${side}.jpg`);
      assert.ok(existsSync(appFile(t[side].file)), `${t[side].file} がある`);
      assert.match(t[side].alt, /人の絵/, `軸${d}-${side} の alt`);
    }
    assert.equal(t.mid, null, `軸${d} のまんなかはまだ無い`);
  }
  assert.equal(NAVY, "#22315A");
});

test("axisArt：A の割合が 50% より多ければ a、少なければ b、ちょうど 50% は mid（絵はまだ無い）、答えなしは null", () => {
  const at = (states) => ({ states });
  const a = axisArt(2, axisView(at({ 2: { a: 3, b: 1 } }), 2));
  assert.deepEqual(a, { id: "2-a", domain: 2, side: "a", file: "img/axes/2-a.jpg", alt: AXIS_ART[2].a.alt, color: "#D9A23A", deep: "#A47D38" });
  const b = axisArt(2, axisView(at({ 2: { a: 1, b: 3 } }), 2));
  assert.equal(b.side, "b");
  assert.equal(b.file, "img/axes/2-b.jpg");
  assert.equal(b.id, "2-b");
  const allA = axisArt(3, axisView(at({ 3: { a: 4, b: 0 } }), 3));
  assert.equal(allA.side, "a");
  const mid = axisArt(1, axisView(at({ 1: { a: 3, b: 3 } }), 1));
  assert.equal(mid.side, "mid");
  assert.equal(mid.file, null, "まんなかの絵はまだ無い（番号の丸を出す）");
  assert.equal(mid.color, "#2E9A8F");
  const none = axisArt(4, axisView(at({ 4: { a: 0, b: 0 } }), 4));
  assert.equal(none.side, null);
  assert.equal(none.file, null);
  assert.equal(none.deep, "#BD6990", "答えなしでも色は返す");
  assert.equal(axisArt(9, { pos: 0.2 }), null, "知らない軸");
  assert.equal(artSide(null), null);
  assert.equal(artSide({ pos: 0.4 }), "a");
  assert.equal(artSide({ pos: 0.6 }), "b");
  assert.equal(artSide({ pos: 0.5 }), "mid");
  assert.equal(artSide({ pos: null }), null);
  assert.equal(artOf(5, "mid").file, null);
  assert.equal(artOf(5, "x"), null);
  assert.equal(artOf(0, "a"), null);
});

// 16の傾向すべてに絵がある前提の images（テストの側でも作って、heroArt の選び方と比べる）
const allReady = Object.fromEntries(Object.entries(TYPE_IMAGES).map(([k, e]) => [k, { ...e, status: "ready", file: `x/${k}.jpg` }]));

test("heroArt：主軸に合う傾向（16すべてに絵がある前提の heroTendency）の軸の、●で選んだ絵を返す", () => {
  let other = 0;
  for (const { name, r } of results) {
    const art = heroArt(r);
    const pick = heroTendency(r.profile3, r.select.chosen, allReady);
    if (!pick) { assert.equal(art, null, name); continue; }
    assert.ok(art, name);
    assert.equal(art.key, pick.key, `${name}：傾向`);
    const d = parseInt(pick.key, 10);
    assert.equal(art.domain, d);
    assert.equal(art.tendency, pick.key.endsWith("A") ? DOMAINS[d].a : DOMAINS[d].b, `${name}：傾向の名前`);
    assert.match(art.file, /^img\/axes\/[1-8]-[ab]\.jpg$/, `${name}：軸の絵`);
    assert.ok(existsSync(appFile(art.file)), `${name}：${art.file}`);
    assert.ok(art.alt, `${name}：alt`);
    const v = axisView(r, d);
    const side = artSide(v);
    if (side === "a" || side === "b") {
      assert.equal(art.side, side, `${name}：●で選ぶ`);
      assert.equal(art.bySide, false);
    } else {
      assert.equal(art.side, pick.key.endsWith("A") ? "a" : "b", `${name}：まんなか・答えなしは傾向の側`);
      assert.equal(art.bySide, true);
    }
    if (!isReady(TYPE_IMAGES[pick.key])) other++;
  }
  assert.ok(other > 0, "今の傾向の絵が無い傾向（例 1B・2A）も選ばれる");
  assert.equal(heroArt(null), null);
  assert.equal(heroArt({}), null);
});

test("heroArt：その軸の●がまんなか・答えなしなら、主軸に合う傾向の側の絵", () => {
  const { r } = results[0];
  const base = heroArt(r);
  const d = base.domain;
  const lead = base.key.endsWith("A") ? "a" : "b";
  const tie = heroArt({ ...r, states: { ...r.states, [d]: { ...r.states[d], a: 2, b: 2 } } });
  assert.equal(tie.key, base.key);
  assert.equal(tie.side, lead);
  assert.equal(tie.file, `img/axes/${d}-${lead}.jpg`);
  assert.equal(tie.bySide, true);
  const none = heroArt({ ...r, states: { ...r.states, [d]: { ...r.states[d], a: 0, b: 0 } } });
  assert.equal(none.side, lead);
  assert.equal(none.bySide, true);
  // ●が傾向と逆の側なら、●の側の絵（§13.3：●で選んだパターン）
  const flip = lead === "a" ? { a: 1, b: 3 } : { a: 3, b: 1 };
  const opp = heroArt({ ...r, states: { ...r.states, [d]: { ...r.states[d], ...flip } } });
  assert.equal(opp.side, lead === "a" ? "b" : "a");
  assert.equal(opp.tendency, base.tendency, "傾向の名前は主軸に合う傾向のまま");
});

test("ホームの絵：診断前・途中は 4-b と 5-a（同じ絵にしない）、診断後は heroArt の絵でカードは絵なし", () => {
  for (const st of ["before", "mid"]) {
    const p = homePics(st);
    assert.equal(p.hero.id, "4-b");
    assert.equal(p.diagnose.id, "5-a");
    assert.notEqual(p.hero.file, p.diagnose.file);
  }
  const art = heroArt(results[0].r);
  const done = homePics("done", art);
  assert.equal(done.hero, art);
  assert.equal(done.diagnose, null);
  assert.equal(homePics("done", null).hero.id, "4-b", "heroArt が無ければ診断前と同じ絵");
});

// ---------------------------------------------------------------- 診断結果の絵の一覧（#images。§14）
// 数（24・16 など）は書かない。AXIS_ART の mid が null かどうかから導く（まんなかの絵が届いて埋まっても壊れないように）
test("絵の一覧の24枠：軸の順・各軸は a → mid → b、ready の枠の絵はある、ready でない枠は file が null", () => {
  const slots = axisArtSlots();
  const domains = Object.keys(AXIS_ART).map(Number);
  assert.equal(slots.length, domains.length * 3);
  assert.deepEqual(slots.map(s => s.id), domains.flatMap(d => [`${d}-a`, `${d}-mid`, `${d}-b`]));
  const ratio = { a: "75:25", mid: "50:50", b: "25:75" };
  for (const s of slots) {
    const D = DOMAINS[s.domain];
    assert.equal(s.ratio, ratio[s.side], `${s.id} の比率`);
    assert.equal(s.label, s.side === "a" ? `${D.a}寄り` : s.side === "b" ? `${D.b}寄り` : "まんなか", `${s.id} の名前`);
    assert.equal(s.color, AXIS_ART[s.domain].color);
    const def = AXIS_ART[s.domain][s.side];
    assert.equal(s.ready, !!def, `${s.id}：AXIS_ART にあれば ready`);
    if (s.ready) {
      assert.equal(s.file, def.file);
      assert.equal(s.path, s.file);
      assert.ok(s.alt, `${s.id} の alt`);
      assert.ok(existsSync(appFile(s.file)), `${s.file} がある`);
    } else {
      assert.equal(s.file, null, `${s.id}：絵が無ければ file は null`);
      assert.equal(s.alt, null);
      assert.equal(s.path, `img/axes/${s.id}.jpg`, `${s.id}：置く場所`);
    }
  }
  // 準備中の数は、mid が null の軸の数と同じ（a・b はどの軸にもある）
  const midMissing = domains.filter(d => AXIS_ART[d].mid == null).length;
  assert.equal(slots.filter(s => !s.ready).length, midMissing);
  assert.ok(slots.filter(s => !s.ready).every(s => s.side === "mid"));
});

test("絵の一覧の印：8つの軸の行に選ばれる枠（artSide）と、いちばん上の絵の枠（heroArt）", () => {
  assert.deepEqual(slotMarks(null), { picked: [], hero: null, art: null });
  const ids = new Set(axisArtSlots().map(s => s.id));
  for (const { name, r } of results) {
    const m = slotMarks(r);
    const want = Object.keys(AXIS_ART).map(Number).map(d => [d, artSide(axisView(r, d))]).filter(([, side]) => side).map(([d, side]) => `${d}-${side}`);
    assert.deepEqual(m.picked, want, `${name}：選ばれる枠`);
    assert.ok(m.picked.every(id => ids.has(id)), `${name}：一覧にある枠`);
    const art = heroArt(r);
    assert.equal(m.hero, art?.id ?? null, `${name}：いちばん上の絵の枠`);
    if (m.hero) {
      const slot = axisArtSlots().find(s => s.id === m.hero);
      assert.ok(slot?.ready, `${name}：いちばん上の絵の枠には絵がある`);
      if (art.bySide) assert.equal(m.hero, `${art.domain}-${art.key.endsWith("A") ? "a" : "b"}`, `${name}：代わりの側の枠`);
    }
  }
  // まんなかの軸は "<軸>-mid" に印が付き、いちばん上は代わりの側
  const { r } = results[0];
  const d = heroArt(r).domain;
  const tie = { ...r, states: { ...r.states, [d]: { ...r.states[d], a: 2, b: 2 } } };
  const m = slotMarks(tie);
  assert.ok(m.picked.includes(`${d}-mid`));
  if (AXIS_ART[d].mid == null) assert.notEqual(m.hero, `${d}-mid`, "まんなかの絵が無いあいだは、いちばん上は代わりの側");
});

test("今の画面の傾向の絵の16枠：軸の順・A → B、ready の枠の絵はある、ready でない枠は file が null", () => {
  const slots = typeImageSlots();
  assert.equal(slots.length, Object.keys(TYPE_IMAGES).length);
  assert.deepEqual(slots.map(s => s.key), Object.keys(DOMAINS).flatMap(d => [`${d}A`, `${d}B`]));
  for (const s of slots) {
    const e = TYPE_IMAGES[s.key];
    assert.equal(s.label, e.tendency);
    assert.equal(s.ready, isReady(e), `${s.key}：isReady と同じ`);
    if (s.ready) {
      assert.equal(s.file, e.file);
      assert.ok(existsSync(new URL(`../${s.file}`, import.meta.url)), `${s.file} がある`);
    } else {
      assert.equal(s.file, null);
      assert.equal(s.path, `img/types/${s.key}.jpg`);
    }
  }
  assert.equal(slots.filter(s => s.ready).length, Object.values(TYPE_IMAGES).filter(isReady).length);
  // TYPE_IMAGES の ready の絵はすべてある（今の画面の結果に出る絵）
  for (const e of Object.values(TYPE_IMAGES).filter(isReady)) assert.ok(existsSync(new URL(`../${e.file}`, import.meta.url)), e.file);
});

useStorage(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
