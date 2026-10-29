// node tests/type_images.test.mjs
// 傾向の絵（js/data/type_images.js）のテスト。仕様：docs/type-images.md
//  - 16傾向のスロットがそろっている／絵がある（ready）ものはファイルと文言があり、準備中（pending）は file が null
//  - tendencyKeyFor・domainTendencies3 の形
//  - heroTendency：架空の例1・2、P1〜P5 の結果で、絵のある傾向のキーか null（準備中の傾向のキーは返さない）。選び方の規則は差し替えた絵の表で確かめる
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TYPE_IMAGES, isReady, tendencyKeyFor, domainTendencies3, heroTendency, referencedDomains, patternTendencyKeys } from "../js/data/type_images.js";
import { DOMAINS, TRAITS, domainFlags3, META3_BY_ID } from "../js/engine3.js";
import { fromLikertAnswers, fromScores } from "../js/adaptive3.js";
import { SAMPLES3, PROFILE_SAMPLES3 } from "../js/data/samples3.js";
import { VERSION_IDS } from "../js/three_version.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

const ALL_KEYS = Object.keys(DOMAINS).flatMap(d => [`${d}A`, `${d}B`]);
const nonEmpty = (s) => typeof s === "string" && s.trim() !== "";

// ---------------------------------------------------------------- 1. データ
test("16傾向のキー（1A〜8B）がそろい、領域・側・傾向名が questions.js の DOMAINS と一致する", () => {
  assert.deepEqual(Object.keys(TYPE_IMAGES), ALL_KEYS);
  assert.equal(ALL_KEYS.length, 16);
  for (const [k, e] of Object.entries(TYPE_IMAGES)) {
    assert.equal(e.key, k);
    assert.equal(`${e.domain}${e.side}`, k);
    assert.equal(e.tendency, DOMAINS[e.domain][e.side === "A" ? "a" : "b"], `${k} の傾向名`);
    assert.ok(TRAITS.includes(e.tendency));
    assert.ok(e.status === "ready" || e.status === "pending", `${k} の status`);
    assert.ok(Object.hasOwn(e, "note") && typeof e.note === "string", `${k} の note`);
  }
});

test("絵がある（ready）ものは、ファイルが実在し、モチーフ・一言・代替テキストが空でない", () => {
  const ready = Object.values(TYPE_IMAGES).filter(e => e.status === "ready");
  assert.ok(ready.length > 0, "ready が1つもない");
  for (const e of ready) {
    assert.ok(nonEmpty(e.file), `${e.key} の file`);
    assert.ok(!e.file.startsWith("/") && !e.file.includes(".."), `${e.key} の file はルートからの相対パス（${e.file}）`);
    const p = join(ROOT, e.file);
    assert.ok(existsSync(p), `${e.key} の絵がない：${e.file}`);
    assert.ok(statSync(p).size > 0, `${e.key} の絵が空`);
    if (/\.jpe?g$/i.test(e.file)) assert.deepEqual([...readFileSync(p).subarray(0, 2)], [0xff, 0xd8], `${e.key} は JPEG ではない`);
    assert.ok(nonEmpty(e.caption), `${e.key} の caption`);
    assert.ok(nonEmpty(e.alt), `${e.key} の alt`);
    assert.ok(nonEmpty(e.motif), `${e.key} の motif`);
    assert.ok(isReady(e));
  }
});

test("準備中（pending）は file が null。ready でなければ画面に出さない", () => {
  for (const e of Object.values(TYPE_IMAGES).filter(e => e.status === "pending")) {
    assert.equal(e.file, null, `${e.key} は pending なのに file がある`);
    assert.ok(!isReady(e));
  }
  assert.ok(!isReady(undefined));
  assert.ok(!isReady({ status: "ready", file: null }), "ready でも file が無ければ出さない");
  assert.ok(!isReady({ status: "pending", file: "img/types/1A.jpg" }), "pending なら file があっても出さない");
});

test("絵のファイルは img/types/<キー>.jpg の置き方（docs/type-images.md の手順）", () => {
  for (const e of Object.values(TYPE_IMAGES).filter(isReady)) assert.equal(e.file, `img/types/${e.key}.jpg`);
});

// ---------------------------------------------------------------- 2. キー
test("tendencyKeyFor：A/B でも傾向名でも同じキー。分からなければ null", () => {
  assert.equal(tendencyKeyFor(1, "A"), "1A");
  assert.equal(tendencyKeyFor("1", "b"), "1B");
  assert.equal(tendencyKeyFor(1, "向き合う"), "1A");
  assert.equal(tendencyKeyFor(1, "距離を取る"), "1B");
  assert.equal(tendencyKeyFor(8, "関係を戻す"), "8B");
  for (const d of Object.keys(DOMAINS)) {
    assert.equal(tendencyKeyFor(d, DOMAINS[d].a), `${d}A`);
    assert.equal(tendencyKeyFor(d, DOMAINS[d].b), `${d}B`);
  }
  assert.equal(tendencyKeyFor(1, "即応"), null, "別の領域の傾向名");
  assert.equal(tendencyKeyFor(9, "A"), null);
  assert.equal(tendencyKeyFor(0, "A"), null);
  assert.equal(tendencyKeyFor(1, "C"), null);
  assert.equal(tendencyKeyFor(1, null), null);
  assert.equal(tendencyKeyFor(undefined, "A"), null);
});

// ---------------------------------------------------------------- 3. 結果（架空の例1・2、P1〜P5。設問の版はすべて：v1・v2・v3）
const results = [];
for (const v of VERSION_IDS) {
  for (const s of SAMPLES3) results.push({ name: `${s.key}/${v}`, r: fromLikertAnswers(s.answers, s.wording, { version: v }).result() });
  for (const p of PROFILE_SAMPLES3) results.push({ name: `${p.key}/${v}`, r: fromScores(p.scores, p.duel, { version: v }).result() });
}

test("domainTendencies3：8領域それぞれ { domain, key, tendency, tie, weak }。key は左右で優勢な傾向（拮抗は null）", () => {
  for (const { name, r } of results) {
    const t = domainTendencies3(r.profile3);
    assert.deepEqual(Object.keys(t), Object.keys(DOMAINS), name);
    for (const d of Object.keys(DOMAINS)) {
      const x = t[d], f = domainFlags3(r.profile3, d);
      assert.deepEqual(Object.keys(x).sort(), ["domain", "key", "tendency", "tie", "weak"], `${name} 領域${d}`);
      assert.equal(x.domain, +d);
      assert.equal(typeof x.weak, "boolean");
      assert.equal(typeof x.tie, "boolean");
      assert.equal(x.tie, x.key === null);
      assert.equal(x.tendency, f.lead, `${name} 領域${d} の優勢側（engine3 の domainFlags3）`);
      assert.equal(x.weak, f.weak || f.conflict, `${name} 領域${d} の weak`);
      if (x.key === null) assert.equal(x.weak, false, "拮抗は弱めにしない");
      else { assert.match(x.key, /^[1-8][AB]$/); assert.equal(x.key, tendencyKeyFor(d, x.tendency)); assert.ok(x.key in TYPE_IMAGES); }
    }
  }
});

test("heroTendency：架空の例1・2、P1〜P5（すべての版）で、絵のある傾向のキーか null。準備中の傾向は返さない", () => {
  for (const { name, r } of results) {
    const hero = heroTendency(r.profile3, r.select.chosen);
    if (hero === null) continue;
    assert.deepEqual(Object.keys(hero).sort(), ["key", "reason"], name);
    assert.ok(hero.key in TYPE_IMAGES, `${name} のキー ${hero.key}`);
    assert.ok(isReady(TYPE_IMAGES[hero.key]), `${name}：準備中の傾向 ${hero.key} が返った`);
    assert.notEqual(TYPE_IMAGES[hero.key].status, "pending");
    assert.ok(["主軸", "代わり", "主軸なし"].includes(hero.reason), name);
    const t = domainTendencies3(r.profile3)[TYPE_IMAGES[hero.key].domain];
    if (hero.reason !== "主軸") assert.equal(t.key, hero.key, `${name}：代わり・主軸なしの絵はあなたが優勢な傾向から`);
  }
});

test("heroTendency：選んだパターンが無い・主軸が無いときは null（結果は壊れない）", () => {
  const r = results[0].r;
  assert.equal(heroTendency(r.profile3, []), null);
  assert.equal(heroTendency(r.profile3, undefined), null);
  assert.equal(heroTendency(r.profile3, r.select.chosen.filter(h => h.role !== "主軸")), null);
});

test("heroTendency：select の結果（{ chosen }）をそのまま渡しても同じ", () => {
  for (const { r } of results) assert.deepEqual(heroTendency(r.profile3, r.select), heroTendency(r.profile3, r.select.chosen));
});

// ---------------------------------------------------------------- 4. 選び方の規則（手で作ったプロファイルと、差し替えた絵の表）
/** 全領域 2:2（拮抗）・全傾向50 から、領域ごとに { 領域: [a, b] } と levels を上書きする */
function P({ w = {}, levels = {} } = {}) {
  const p = { levels: {}, w: {}, quality: { ok: true } };
  for (const t of TRAITS) p.levels[t] = levels[t] ?? 50;
  for (const d of Object.keys(DOMAINS)) { const [a, b] = w[d] ?? [2, 2]; p.w[d] = { a, b, n: a + b }; }
  return p;
}
const hit = (id, role) => ({ meta: META3_BY_ID[id], role });
/** 絵がある傾向だけを指定した表（それ以外は準備中） */
const only = (...keys) => Object.fromEntries(Object.entries(TYPE_IMAGES).map(([k, e]) => [k, keys.includes(k) ? { ...e, status: "ready", file: `img/types/${k}.jpg` } : { ...e, status: "pending", file: null }]));
// 領域1・2・3 の A が強く優勢（4:0・level 100・対の傾向 0）→ 弱めでない。領域4 の B は弱め（level 50 は 67 未満）
const strongA = (...ds) => Object.fromEntries(ds.map(d => [d, [4, 0]]));
const lvA = (...ds) => Object.fromEntries(ds.flatMap(d => [[DOMAINS[d].a, 100], [DOMAINS[d].b, 0]]));

test("パターンが語る傾向：基本は状態で A/B、5・6・7 は優勢側。クロス・特殊は条件の傾向。形状は無し", () => {
  const leads = domainTendencies3(P({ w: strongA(1), levels: lvA(1) }));
  assert.deepEqual(patternTendencyKeys(META3_BY_ID["B1-1"], leads), ["1A"]);
  for (const id of ["B1-2", "B1-1w"]) assert.deepEqual(patternTendencyKeys(META3_BY_ID[id], leads), ["1A"], id);
  for (const id of ["B1-3", "B1-4", "B1-3w"]) assert.deepEqual(patternTendencyKeys(META3_BY_ID[id], leads), ["1B"], id);
  assert.deepEqual(patternTendencyKeys(META3_BY_ID["B1-5"], leads), ["1A"], "5 は優勢側（領域1は A が優勢）");
  assert.deepEqual(patternTendencyKeys(META3_BY_ID["B2-7"], leads), [], "領域2 は拮抗なので無し");
  assert.deepEqual(patternTendencyKeys(META3_BY_ID["X12-1"], leads), ["1A", "2A"]);
  assert.deepEqual(patternTendencyKeys(META3_BY_ID["S01"], leads), ["1A", "6A", "8A"]);
  assert.deepEqual(patternTendencyKeys(META3_BY_ID["S10"], leads), ["7B", "7A", "8B"], "特殊B：高・中・高の傾向を順に");
  assert.deepEqual(patternTendencyKeys(META3_BY_ID["S18"], leads), []);
  assert.deepEqual(patternTendencyKeys(null), []);
});

test("heroTendency：主軸の傾向に絵があれば、それ（reason 主軸）", () => {
  const p = P({ w: strongA(1), levels: lvA(1) });
  assert.deepEqual(heroTendency(p, [hit("B1-1", "主軸")], only("1A", "2B")), { key: "1A", reason: "主軸" });
  assert.deepEqual(heroTendency(p, [hit("B1-1", "補強"), hit("B2-7", "主軸")], only("1A")), { key: "1A", reason: "主軸なし" }, "主軸は B2-7（領域2 は拮抗で傾向なし）→ 主軸なし");
});

test("heroTendency：主軸が語る傾向のうち絵のあるものを、パターンの順に探す（先頭が準備中でも、あなたが優勢な次の傾向があれば主軸のまま）", () => {
  // X23-1 は「即応（2A）×追う（3A）」。2A・3A ともあなたが優勢
  const p = P({ w: strongA(2, 3), levels: lvA(2, 3) });
  assert.deepEqual(patternTendencyKeys(META3_BY_ID["X23-1"]), ["2A", "3A"]);
  assert.deepEqual(heroTendency(p, [hit("X23-1", "主軸")], only("3A")), { key: "3A", reason: "主軸" }, "2A は準備中 → 3A");
  assert.deepEqual(heroTendency(p, [hit("X23-1", "主軸")], only("2A", "3A")), { key: "2A", reason: "主軸" }, "両方あれば、パターンの順で先頭の 2A");
  assert.deepEqual(heroTendency(p, [hit("X23-1", "主軸")], only("3A", "1A")), { key: "3A", reason: "主軸" }, "ほかの傾向（1A）の絵があっても、主軸の傾向が先");
  // どちらも準備中なら、これまでどおり代わり（あなたの優勢な傾向のうち絵があるもの）
  assert.deepEqual(heroTendency(p, [hit("X23-1", "主軸")], only()), null);
  const p2 = P({ w: { ...strongA(2, 3), 1: [4, 0] }, levels: lvA(1, 2, 3) });
  assert.deepEqual(heroTendency(p2, [hit("X23-1", "主軸")], only("1A")), { key: "1A", reason: "代わり" });
});

test("heroTendency：あなたが優勢でない傾向は、優勢な傾向に絵が無いからといって主軸にしない（代わりへ）。どれも優勢でなければ語られる傾向すべてから探す", () => {
  // 2A は優勢（絵なし）、3A は優勢でない（領域3 は拮抗）が絵はある → 3A は使わず、代わり（優勢で絵があるのは 1A）
  const p = P({ w: { ...strongA(1, 2) }, levels: lvA(1, 2) });
  assert.deepEqual(heroTendency(p, [hit("X23-1", "主軸")], only("1A", "3A")), { key: "1A", reason: "代わり" });
  // 2A・3A とも優勢でない（全領域が拮抗）なら、語られる傾向すべてを順に見る（2A が準備中なら 3A）
  assert.deepEqual(heroTendency(P(), [hit("X23-1", "主軸")], only("3A")), { key: "3A", reason: "主軸" });
});

test("heroTendency：主軸が傾向を語らない（拮抗する基本パターン・形状）ときは、代わりの絵を reason 主軸なし で返す", () => {
  const p = P({ w: strongA(1), levels: lvA(1) });
  for (const id of ["B2-5", "B2-6", "B2-7"]) assert.deepEqual(patternTendencyKeys(META3_BY_ID[id], domainTendencies3(p)), [], id);
  assert.deepEqual(heroTendency(p, [hit("B2-7", "主軸")], only("1A")), { key: "1A", reason: "主軸なし" });
  assert.deepEqual(heroTendency(p, [hit("B2-7", "主軸")], only()), null, "代わりの絵もなければ null");
  // 主軸の傾向が準備中の場合は「代わり」（主軸なし ではない）
  assert.deepEqual(heroTendency(p, [hit("B1-1", "主軸")], only()), null);
  assert.deepEqual(heroTendency(P({ w: { 1: [4, 0], 2: [4, 0] }, levels: lvA(1, 2) }), [hit("B2-1", "主軸")], only("1A")), { key: "1A", reason: "代わり" });
});

test("heroTendency：クロスの主軸は、あなたが優勢な傾向を先頭から。優勢でなければ先頭の傾向", () => {
  // 領域1 は B が優勢（0:4）、領域2 は A が優勢。X12-1 は「向き合う（1A）×即応（2A）」：1A は優勢でないので 2A が先に
  const p = P({ w: { 1: [0, 4], 2: [4, 0] }, levels: { ...lvA(2), [DOMAINS[1].b]: 100, [DOMAINS[1].a]: 0 } });
  assert.deepEqual(heroTendency(p, [hit("X12-1", "主軸")], only("1A", "2A")), { key: "2A", reason: "主軸" });
  // どちらも優勢でない（全領域が拮抗）なら先頭（1A）
  assert.deepEqual(heroTendency(P(), [hit("X12-1", "主軸")], only("1A", "2A")), { key: "1A", reason: "主軸" });
  // 先頭の傾向（優勢な 2A）の絵が準備中なら、代わり（優勢な傾向のうち絵があるもの。ここでは領域1 の B は絵なし → 無し）
  assert.equal(heroTendency(p, [hit("X12-1", "主軸")], only("1A")), null);
});

test("heroTendency：代わりの絵は、あなたが優勢な傾向のうち絵があるものから（弱めでない → 触れている本数 → 領域番号）", () => {
  // 領域1・2・3 は A が強く優勢（弱めでない）。領域4 は B が優勢だが level 50（弱め）。領域5 は 5B が優勢で強い。主軸は領域6（拮抗）の B6-7 = 傾向なし
  const p = P({
    w: { 1: [4, 0], 2: [4, 0], 3: [4, 0], 4: [0, 4], 5: [0, 4] },
    levels: { ...lvA(1, 2, 3), [DOMAINS[4].b]: 50, [DOMAINS[5].b]: 100, [DOMAINS[5].a]: 0 },
  });
  const leads = domainTendencies3(p);
  assert.deepEqual(Object.values(leads).map(t => `${t.domain}:${t.key}${t.weak ? "(弱)" : ""}`), ["1:1A", "2:2A", "3:3A", "4:4B(弱)", "5:5B", "6:null", "7:null", "8:null"]);
  const imgs = only("1A", "2A", "3A", "4B", "5B");
  // 触れている本数：領域3 が2本（X13-1 と X23-1）、領域1・2 が1本ずつ → 3A が先
  const sel = [hit("B6-7", "主軸"), hit("X13-1", "補強"), hit("X23-1", "補強")];
  assert.deepEqual(referencedDomains(sel), { 6: 1, 1: 1, 3: 2, 2: 1 });
  assert.deepEqual(heroTendency(p, sel, imgs), { key: "3A", reason: "主軸なし" });
  // 本数が同じなら領域番号の小さい方（1A）。弱めの 4B は、本数が多くても後回し
  assert.deepEqual(heroTendency(p, [hit("B6-7", "主軸"), hit("B4-3", "補強"), hit("B4-4", "補強")], imgs), { key: "1A", reason: "主軸なし" });
  // 弱めでない傾向に絵がなければ、弱めの傾向でも出す（絵が全く無いよりよい）
  assert.deepEqual(heroTendency(p, [hit("B6-7", "主軸")], only("4B")), { key: "4B", reason: "主軸なし" });
  // 主軸が語る傾向（5B）があっても絵が準備中なら、同じ順で代わり（reason 代わり）
  assert.deepEqual(heroTendency(p, [hit("B5-3", "主軸"), hit("X13-1", "補強"), hit("X23-1", "補強")], only("1A", "2A", "3A")), { key: "3A", reason: "代わり" });
  // 絵のある傾向があなたの傾向に1つも無ければ null
  assert.equal(heroTendency(p, [hit("B6-7", "主軸")], only("8B")), null);
  assert.equal(heroTendency(p, [hit("B6-7", "主軸")], only()), null);
});

test("形状（S16〜S20）は領域に数えず、主軸にもならない（地）。形状だけなら null", () => {
  assert.deepEqual(referencedDomains([hit("S18", "地（形状）"), hit("B1-1", "主軸")]), { 1: 1 });
  assert.equal(heroTendency(P({ w: strongA(1), levels: lvA(1) }), [hit("S18", "地（形状）")], only("1A")), null);
});

test("絵の表を渡さないときは本物の TYPE_IMAGES を使い、準備中の傾向は主軸でも返さない", () => {
  const pending = Object.values(TYPE_IMAGES).filter(e => !isReady(e));
  assert.ok(pending.length > 0, "準備中の傾向が無い（この確認は不要になった）");
  for (const e of pending) {
    const side = e.side === "A" ? [4, 0] : [0, 4];
    const p = P({ w: { [e.domain]: side }, levels: { [e.tendency]: 100 } });
    const basic = `B${e.domain}-${e.side === "A" ? 1 : 3}`;
    const hero = heroTendency(p, [hit(basic, "主軸")]);
    assert.ok(hero === null || (hero.key !== e.key && hero.reason !== "主軸" && isReady(TYPE_IMAGES[hero.key])), `${e.key}：${JSON.stringify(hero)}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
