// node tests/app_safety.test.mjs
// 新しい画面（app/）の、相談の外の安全と人目の守り（決定 U47。docs/app-screens.md §23）の DOM の無い部分
//  - app/js/safety.js の safetyDomains4：24問の結果（js/engine4.js の computeResult4）で、領域3・6が A強のときだけ [3]・[6]・[3, 6]
//    A寄り（2問 A）・B 側・何も答えていないときは []。safetyNote4 の文（両方のときは2つの文を続けて、最後に共通の1文）
//  - 窓口：helpResources の並び（DV相談＋ → DV相談ナビ → よりそいホットライン。よりそいは1回だけ）と、番号が js/consult/texts.js の SAFETY_RESOURCES と同じ
//    tel: の作り方（"#8008" → "tel:%238008"、"0120-279-889" → "tel:0120279889"）。いますぐの電話の文（110・119）
//  - app/sw.js の「つながっていません」の画面に、110・119 と3つの窓口の番号（と tel: のリンク）が文字で入っている。殻に help.js・safety.js。保存の名前は seikaku16-app-v1 のまま
//  - 履歴の冒頭の設定（app/js/local.js）：既定は出さない（localStorage が無い Node でも落ちない）。"1" のときだけ出す。clearAll で消える
//  - main.js の ROUTES に help（題「危ないときは」）
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  safetyDomains4, safetyNote4, SAFETY_NOTE4, SAFETY_NOTE_TAIL4, SAFETY_DOMAINS4,
  helpResources, telHref, offlineNumbers, emergencyParts, EMERGENCY_TEXT, HELP_ORDER, HELP_WHEN, HELP_NOTES, HELP_TITLE,
  TYPES_SAFETY_NOTE, APP_PRIVACY_LINE, CONTACT_SAFETY_LINE, CONSULT_ROW_SUB, HISTORY_SNIPPET_LABEL, HISTORY_SNIPPET_NOTE,
} from "../app/js/safety.js";
import { useStorage, historySnippetOn, setHistorySnippet, clearAll, addRecord, loadRecords, HISTORY_SNIPPET_KEY, STORAGE_KEY } from "../app/js/local.js";
import { computeResult4, DOMAIN_IDS4 } from "../js/engine4.js";
import { SAFETY_RESOURCES } from "../js/consult/texts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "app");

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

// ---------------------------------------------------------------- 24問の答え（tests/engine4.test.mjs と同じ形）
const ans = (v) => (v === null ? { status: "unknown", value: null } : { status: "answered", value: v });
const V = { A: 1, B: -1, "?": null };
/** 領域ごとの "UPN"（例 "AAB"・"A?-"。"-" は未回答）から answers */
function answersOf(spec) {
  const out = {};
  for (const [d, s] of Object.entries(spec)) {
    ["U", "P", "N"].forEach((k, i) => { if (s[i] !== "-") out[`${k}${d}`] = ans(V[s[i]]); });
  }
  return out;
}
/** ほかの領域は s、over の領域だけ別の答え */
const resultOf = (s, over = {}) => computeResult4(answersOf(Object.fromEntries(DOMAIN_IDS4.map((d) => [d, over[d] ?? s]))));

// ---------------------------------------------------------------- 結果の安全の1行
test("safetyDomains4：領域3だけ A強 → [3]、6だけ → [6]、両方 → [3, 6]", () => {
  assert.deepEqual(SAFETY_DOMAINS4, [3, 6]);
  assert.deepEqual(safetyDomains4(resultOf("BBB", { 3: "AAA" })), [3]);
  assert.deepEqual(safetyDomains4(resultOf("BBB", { 6: "AAA" })), [6]);
  assert.deepEqual(safetyDomains4(resultOf("BBB", { 3: "AAA", 6: "AAA" })), [3, 6]);
  assert.deepEqual(safetyDomains4(resultOf("AAA")), [3, 6], "全部 A なら3と6の両方");
});

test("safetyDomains4：A寄り（2問 A）・B 側・ほかの領域の A強では出ない", () => {
  for (const s of ["AAB", "ABA", "BAA"]) {
    const r = resultOf("BBB", { 3: s, 6: s });
    assert.equal(r.domains[3].state, "leanA", s);
    assert.deepEqual(safetyDomains4(r), [], s);
  }
  for (const s of ["BBB", "ABB", "BB?"]) assert.deepEqual(safetyDomains4(resultOf("AAA", { 3: s, 6: s })), [], s);
  assert.deepEqual(safetyDomains4(resultOf("BBB", { 1: "AAA", 2: "AAA", 4: "AAA", 5: "AAA", 7: "AAA", 8: "AAA" })), []);
  assert.deepEqual(safetyDomains4(resultOf("BBB", { 3: "AB?", 6: "?AB" })), [], "まんなかでは出ない");
});

test("safetyDomains4：2問答えて2問とも A（1問は判断できない）も A強なので出る（engine4 の strongA のまま）", () => {
  const r = resultOf("BBB", { 3: "AA?" });
  assert.equal(r.domains[3].state, "strongA");
  assert.deepEqual(safetyDomains4(r), [3]);
});

test("safetyDomains4：何も答えていない・答えがそろった領域が無い・形が違う → []", () => {
  assert.deepEqual(safetyDomains4(computeResult4({})), []);
  assert.deepEqual(safetyDomains4(resultOf("???")), []);
  assert.deepEqual(safetyDomains4(resultOf("A--")), [], "1問しか答えていない（incomplete）");
  for (const x of [null, undefined, {}, { domains: null }, "x", 3]) assert.deepEqual(safetyDomains4(x), []);
});

test("safetyNote4：文は1つの囲みに。両方のときは3 → 6 の順に続け、最後に共通の1文", () => {
  assert.equal(safetyNote4(resultOf("BBB")), null);
  const one = safetyNote4(resultOf("BBB", { 6: "AAA" }));
  assert.deepEqual(one, { domains: [6], texts: [SAFETY_NOTE4[6]], tail: SAFETY_NOTE_TAIL4 });
  const both = safetyNote4(resultOf("BBB", { 3: "AAA", 6: "AAA" }));
  assert.deepEqual(both.texts, [SAFETY_NOTE4[3], SAFETY_NOTE4[6]]);
  assert.equal(SAFETY_NOTE_TAIL4, "逆に、あなたがそうされていて怖いときも、相談できる窓口があります。");
  assert.match(SAFETY_NOTE4[3], /^不安なときに相手の様子を確かめたくなるのは、自然なことです。/);
  assert.match(SAFETY_NOTE4[6], /^話し合いを先に進められるのは、よいところでもあります。/);
  for (const t of [SAFETY_NOTE4[3], SAFETY_NOTE4[6]]) assert.ok(t.endsWith("それは性格の傾向ではなく、相手を縛る行動になっているかもしれません。"), t);
});

test("文：「〜な人」と言わない・決めつけの言葉を入れない", () => {
  const all = [...Object.values(SAFETY_NOTE4), SAFETY_NOTE_TAIL4, TYPES_SAFETY_NOTE, APP_PRIVACY_LINE, CONTACT_SAFETY_LINE, CONSULT_ROW_SUB,
    HISTORY_SNIPPET_LABEL, HISTORY_SNIPPET_NOTE, EMERGENCY_TEXT, ...HELP_WHEN, ...HELP_NOTES];
  for (const t of all) {
    assert.ok(typeof t === "string" && t.length > 0);
    assert.doesNotMatch(t, /な人|DV加害|加害者|モラハラ|束縛型|あなたは.*です。$/, t);
  }
  assert.ok(TYPES_SAFETY_NOTE.includes("それは型ではなく"));
});

// ---------------------------------------------------------------- 窓口
test("窓口の一覧：DV相談＋ → DV相談ナビ → よりそいホットライン（1回だけ）。名前・番号・注は SAFETY_RESOURCES のまま", () => {
  assert.equal(HELP_TITLE, "危ないときは");
  assert.deepEqual(HELP_ORDER, ["dv_plus", "dv_navi", "yorisoi_self"]);
  const list = helpResources();
  assert.deepEqual(list.map((r) => r.key), ["dv_plus", "dv_navi", "yorisoi_self"]);
  assert.equal(list.filter((r) => r.name === "よりそいホットライン").length, 1);
  for (const r of list) {
    const src = SAFETY_RESOURCES[r.key];
    assert.equal(r.name, src.name);
    assert.equal(r.contact, src.contact);
    assert.equal(r.note, src.note);
    assert.equal(r.tel, telHref(src.contact));
  }
});

test("tel: の作り方：# は %23、ハイフン・空白は外す", () => {
  assert.equal(telHref("#8008"), "tel:%238008");
  assert.equal(telHref("0120-279-889"), "tel:0120279889");
  assert.equal(telHref("0120-279-338"), "tel:0120279338");
  assert.equal(telHref("110"), "tel:110");
  assert.equal(telHref(" 0120 279 889 "), "tel:0120279889");
  assert.equal(telHref(null), "tel:");
});

test("いますぐの電話：110番（警察）・119番（救急）。つなぐと EMERGENCY_TEXT、リンクは tel:110・tel:119", () => {
  assert.equal(EMERGENCY_TEXT, "いま危ないと感じたら、110番（警察）か119番（救急）に電話してください。");
  const parts = emergencyParts();
  assert.equal(parts.map((p) => p.text).join(""), EMERGENCY_TEXT);
  assert.deepEqual(parts.filter((p) => p.tel).map((p) => [p.text, p.tel]), [["110番", "tel:110"], ["119番", "tel:119"]]);
  assert.deepEqual(offlineNumbers(), ["110", "119", ...helpResources().map((r) => r.contact)]);
});

// ---------------------------------------------------------------- つながらないときの画面（app/sw.js）
const sw = readFileSync(join(APP, "sw.js"), "utf8");
const offline = sw.slice(sw.indexOf("function offlinePage()"));

test("sw.js の「つながっていません」の画面に、110・119 と3つの窓口の番号と tel: のリンクがある（SAFETY_RESOURCES と同じ）", () => {
  assert.ok(offline.length > 100, "offlinePage がありません");
  for (const n of offlineNumbers()) {
    assert.ok(offline.includes(`>${n}`), `番号がありません：${n}`);
    assert.ok(offline.includes(`href="${telHref(n)}"`), `tel: のリンクがありません：${telHref(n)}`);
  }
  for (const r of helpResources()) assert.ok(offline.includes(r.name), `窓口の名前がありません：${r.name}`);
  assert.match(offline, /110番<\/a>（警察）か<a [^>]*>119番<\/a>（救急）に電話してください。/);
});

test("sw.js：殻に help.js・safety.js（と窓口の一覧）。保存の名前は seikaku16-app-v1 のまま（U43）", () => {
  const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  for (const p of ["./js/help.js", "./js/safety.js", "../js/consult/texts.js"]) assert.ok(shell.includes(`"${p}"`), p);
  assert.match(sw, /const VERSION = "v1";/);
  assert.match(sw, /const PREFIX = "seikaku16-app-";/);
});

test("main.js の ROUTES に help（題「危ないときは」・help.js）", () => {
  const main = readFileSync(join(APP, "js", "main.js"), "utf8");
  assert.match(main, /help: \{ load: \(\) => import\("\.\/help\.js"\), title: "危ないときは" \}/);
});

// ---------------------------------------------------------------- 履歴の冒頭の設定（app/js/local.js）
function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}
const broken = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };

test("履歴の冒頭：localStorage が無い Node でも落ちず、既定は出さない", () => {
  useStorage(null);
  let has = false;
  try { has = globalThis.localStorage != null; } catch { has = false; }
  if (!has) {
    assert.equal(historySnippetOn(), false);
    assert.equal(setHistorySnippet(true), false, "保存できないときは false");
    assert.equal(historySnippetOn(), false);
  } else {
    // localStorage がある Node（新しい版）でも落ちない
    assert.doesNotThrow(() => historySnippetOn());
  }
  // 空の入れ物（初めて開いた端末）では出さない
  useStorage(memory());
  assert.equal(historySnippetOn(), false);
  useStorage(null);
});

test("履歴の冒頭：キー seikaku16:app:history-snippet が \"1\" のときだけ出す。オフでキーを消す", () => {
  const s = memory(); useStorage(s);
  assert.equal(HISTORY_SNIPPET_KEY, "seikaku16:app:history-snippet");
  assert.ok(HISTORY_SNIPPET_KEY.startsWith("seikaku16:"));
  assert.equal(historySnippetOn(), false);
  assert.equal(setHistorySnippet(true), true);
  assert.equal(s._m.get(HISTORY_SNIPPET_KEY), "1");
  assert.equal(historySnippetOn(), true);
  for (const v of ["0", "true", "yes", "", " 1"]) { s.setItem(HISTORY_SNIPPET_KEY, v); assert.equal(historySnippetOn(), false, v); }
  s.setItem(HISTORY_SNIPPET_KEY, "1");
  assert.equal(setHistorySnippet(false), true);
  assert.equal(s._m.has(HISTORY_SNIPPET_KEY), false);
  assert.equal(historySnippetOn(), false);
});

test("履歴の冒頭：clearAll（マイページの「すべて消す」）で設定も消える。記録の保存とは別のキー", () => {
  const s = memory(); useStorage(s);
  addRecord({ kind: "consult", title: "書いた文" });
  setHistorySnippet(true);
  assert.equal(loadRecords().items.length, 1);
  assert.equal(historySnippetOn(), true);
  assert.equal(clearAll(), true);
  assert.equal(historySnippetOn(), false);
  assert.equal(s._m.has(STORAGE_KEY), false);
  assert.equal(s._m.has(HISTORY_SNIPPET_KEY), false);
});

test("履歴の冒頭：読めない入れ物でも落ちない（出さない）", () => {
  useStorage(broken);
  assert.equal(historySnippetOn(), false);
  assert.equal(setHistorySnippet(true), false);
  assert.equal(setHistorySnippet(false), false);
  useStorage(null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
