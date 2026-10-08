// node tests/patterns.test.mjs
// patterns.js が 172 本すべてに本文を結合できているか、および docs/design.md との整合を確認する。
//  - 失敗 (exit 1): 本文の欠落・空フィールド・scenes が2件でない・unique 欠落・導入文欠落・
//                   クロス/特殊の本文が design.md と一致しない（生成ミス）
//  - 報告のみ     : meta.headline と design.md の「短い見出し」の不一致（patterns_meta.js は変更しない）
import { readFileSync, existsSync } from "node:fs";
import { PATTERNS, PATTERN_BY_ID, getText, KIND_LABEL, GROUP_LABEL, CROSS_GROUP_INTRO, SPECIAL_GROUP_INTRO } from "../js/data/patterns.js";
import { CROSS_TEXT } from "../js/data/patterns_text_cross.js";
import { SPECIAL_TEXT } from "../js/data/patterns_text_special.js";
import { BASIC_TEXT } from "../js/data/patterns_text_basic.js";

const errors = [];
const fail = (msg) => errors.push(msg);
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

// ---- 1. 件数 ---------------------------------------------------------------
const count = { basic: 0, cross: 0, special: 0 };
for (const p of PATTERNS) count[p.kind] = (count[p.kind] || 0) + 1;
console.log(`patterns: total=${PATTERNS.length} basic=${count.basic} cross=${count.cross} special=${count.special}`);
if (PATTERNS.length !== 172) fail(`PATTERNS.length = ${PATTERNS.length} (expected 172)`);
if (count.basic !== 72) fail(`basic = ${count.basic} (expected 72 = 56 + 16 weak)`);
if (count.cross !== 80) fail(`cross = ${count.cross} (expected 80)`);
if (count.special !== 20) fail(`special = ${count.special} (expected 20)`);
if (Object.keys(PATTERN_BY_ID).length !== PATTERNS.length) fail("PATTERN_BY_ID has duplicate ids");
for (const k of ["basic", "cross", "special"]) if (!nonEmpty(KIND_LABEL[k])) fail(`KIND_LABEL.${k} missing`);

// ---- 2. 各パターンの本文 ----------------------------------------------------
for (const p of PATTERNS) {
  const t = p.text;
  if (!t) { fail(`${p.id}: no text`); continue; }
  for (const f of ["one", "detail", "caveat"]) if (!nonEmpty(t[f])) fail(`${p.id}: empty ${f}`);
  if (!Array.isArray(t.scenes) || t.scenes.length !== 2 || !t.scenes.every(nonEmpty)) {
    fail(`${p.id}: scenes must be 2 non-empty strings (got ${JSON.stringify(t.scenes)})`);
  }
  if (typeof t.weak !== "boolean") fail(`${p.id}: weak must be boolean`);
  const isWeakId = /^B\d-[13]w$/.test(p.id);
  if (t.weak !== isWeakId) fail(`${p.id}: weak=${t.weak} but id ${isWeakId ? "is" : "is not"} a weak basic`);
  if (p.kind === "basic") {
    if (t.unique !== null) fail(`${p.id}: basic unique must be null`);
  } else {
    if (!nonEmpty(t.unique)) fail(`${p.id}: empty unique`);
    if (!nonEmpty(t.cond)) fail(`${p.id}: empty cond`);
  }
  if (isWeakId) {
    const base = getText(p.id.replace(/w$/, ""));
    if (!base || base.one !== t.one || base.detail !== t.detail) fail(`${p.id}: does not reuse base text`);
  }
}

// ---- 3. 本文モジュールと meta の突き合わせ ------------------------------------
const metaIds = new Set(PATTERNS.map((p) => p.id));
for (const id of Object.keys(CROSS_TEXT)) if (!metaIds.has(id)) fail(`CROSS_TEXT has id not in meta: ${id}`);
for (const id of Object.keys(SPECIAL_TEXT)) if (!metaIds.has(id)) fail(`SPECIAL_TEXT has id not in meta: ${id}`);
for (const id of Object.keys(BASIC_TEXT)) if (!metaIds.has(id)) fail(`BASIC_TEXT has id not in meta: ${id}`);
if (Object.keys(CROSS_TEXT).length !== 80) fail(`CROSS_TEXT size ${Object.keys(CROSS_TEXT).length} != 80`);
if (Object.keys(SPECIAL_TEXT).length !== 20) fail(`SPECIAL_TEXT size ${Object.keys(SPECIAL_TEXT).length} != 20`);
for (const [id, t] of [...Object.entries(CROSS_TEXT), ...Object.entries(SPECIAL_TEXT)]) {
  if (!nonEmpty(t.headline)) fail(`${id}: empty headline`);
  if (/^「|」$/.test(t.headline)) fail(`${id}: headline still wrapped in 「」`);
}

// ---- 4. グループ導入文 / ラベル ---------------------------------------------
const crossGroups = new Set(PATTERNS.filter((p) => p.kind === "cross").map((p) => p.id.split("-")[0]));
if (crossGroups.size !== 20) fail(`cross groups in meta = ${crossGroups.size} (expected 20)`);
for (const g of crossGroups) if (!nonEmpty(CROSS_GROUP_INTRO[g])) fail(`CROSS_GROUP_INTRO.${g} missing`);
for (const g of Object.keys(CROSS_GROUP_INTRO)) if (!crossGroups.has(g)) fail(`CROSS_GROUP_INTRO.${g} has no patterns`);
const specialGroups = new Set(PATTERNS.filter((p) => p.kind === "special").map((p) => p.group));
for (const g of ["A", "B", "C", "D"]) {
  if (!specialGroups.has(g)) fail(`no special pattern in group ${g}`);
  if (!nonEmpty(SPECIAL_GROUP_INTRO[g])) fail(`SPECIAL_GROUP_INTRO.${g} missing`);
  if (!nonEmpty(GROUP_LABEL[g])) fail(`GROUP_LABEL.${g} missing`);
}

// ---- 5. design.md との突き合わせ ----------------------------------------------
const docUrl = new URL("../docs/design.md", import.meta.url);
const headlineMismatches = [];
let docChecked = 0;
if (existsSync(docUrl)) {
  const FIELD = /^- (条件|短い見出し|一言説明|詳細説明|具体的な場面例|掛け合わせで初めて言えること|基本・クロスとの違い|誤解しやすい点)：(.*)$/;
  const doc = {};
  let cur = null, curField = null;
  for (const line of readFileSync(docUrl, "utf-8").split("\n")) {
    const h = /^### (B\d-\d|X\d\d-\d|S\d\d)\b/.exec(line);
    if (h) { cur = doc[h[1]] = { scenes: [] }; curField = null; continue; }
    if (/^#{1,3} /.test(line)) { cur = null; continue; }
    if (!cur) continue;
    const f = FIELD.exec(line);
    if (f) { curField = f[1]; if (curField !== "具体的な場面例") cur[curField] = f[2].trim(); continue; }
    const s = /^  - (.*)$/.exec(line);
    if (s && curField === "具体的な場面例") cur.scenes.push(s[1].trim());
  }
  const strip = (s) => (s ?? "").replace(/^「/, "").replace(/」$/, "");
  for (const p of PATTERNS) {
    const isWeak = /^B\d-[13]w$/.test(p.id);
    const d = doc[isWeak ? p.id.replace(/w$/, "") : p.id];
    if (!d) { fail(`${p.id}: not found in docs/design.md`); continue; }
    docChecked++;
    // 見出し: 報告のみ（弱い版は「基本の見出し＋（弱）」を期待値とする）
    const expected = strip(d["短い見出し"]) + (isWeak ? "（弱）" : "");
    if (p.headline !== expected) headlineMismatches.push({ id: p.id, meta: p.headline, doc: expected });
    if (isWeak) continue;
    // 本文: クロス/特殊は原文と完全一致が必須。基本は既存ファイルなので不一致は警告のみ。
    const t = p.text;
    const uniqueLabel = p.kind === "special" ? "基本・クロスとの違い" : "掛け合わせで初めて言えること";
    const pairs = [
      ["one", t.one, d["一言説明"]],
      ["detail", t.detail, d["詳細説明"]],
      ["caveat", t.caveat, d["誤解しやすい点"]],
    ];
    if (p.kind !== "basic") {
      pairs.push(["unique", t.unique, d[uniqueLabel]], ["cond", t.cond, d["条件"]]);
      pairs.push(["headline(text)", (p.kind === "cross" ? CROSS_TEXT : SPECIAL_TEXT)[p.id].headline, strip(d["短い見出し"])]);
    }
    for (const [name, got, want] of pairs) {
      if (got !== want) {
        const msg = `${p.id}.${name} differs from docs/design.md`;
        if (p.kind === "basic") console.log(`WARN  ${msg}`); else fail(msg);
      }
    }
    if (JSON.stringify(t.scenes) !== JSON.stringify(d.scenes)) {
      const msg = `${p.id}.scenes differ from docs/design.md`;
      if (p.kind === "basic") console.log(`WARN  ${msg}`); else fail(msg);
    }
  }
  console.log(`docs/design.md cross-check: ${docChecked} patterns compared`);
} else {
  console.log("docs/design.md not found: skipped headline / verbatim comparison");
}

console.log(`\nheadline mismatches (meta vs doc, report only): ${headlineMismatches.length}`);
for (const m of headlineMismatches) {
  console.log(`  ${m.id}\n    meta: ${m.meta}\n    doc : ${m.doc}`);
}

if (errors.length) {
  console.log(`\nFAIL: ${errors.length} problem(s)`);
  for (const e of errors) console.log("  - " + e);
  process.exit(1);
}
console.log("\nOK: all 172 patterns have complete text");
