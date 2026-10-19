// node tests/app_transfer.test.mjs
// 診断の引き継ぎ（iPhone の Safari ↔ ホーム画面のアプリ。保存が別のため）のテスト。仕様：docs/app-screens.md §15.3・§15.10（決定 U37）
//  - app/js/transfer.js：makeTransferCode → readTransferCode → applyTransfer の往復（別の入れ物に入れて、結果の key が同じ）
//  - 入れない物：相談の記録・相談の下書き・テスト協力の記録（fb・fbMode）・5択版の保存
//  - 読めない物（壊れた・別のアプリ・空・大きすぎる・形が違う）は ok: false で、例外を外に出さない
//  - 同じ診断の記録を2回入れても増えない、この端末にある印は上書きしない、途中の回答も移せる、記録だけでも移せる
// Node には localStorage が無いので、globalThis.localStorage に入れ物（Map）を置く（js/ui/three_store.js と app/js/local.js の両方がそれを使う）。
// 入れ物を差し替えると「別の端末の保存」になる。store3（画面の状態）はモジュールに1つなので、差し替えたら discard3 などで空にしてから使う
import assert from "node:assert/strict";
import { store3, start3, answer3, practice3, practicePending3, discard3, setFbMode3, save3 } from "../js/ui/three_store.js";
import { Session3 } from "../js/adaptive3.js";
import { useStorage, loadRecords, addRecord, getMarks, setMarks, STORAGE_KEY as APP_KEY } from "../app/js/local.js";
import { resultKey, recordDiagnosis } from "../app/js/summary.js";
import { makeTransferCode, readTransferCode, applyTransfer, hasTransferable, PREFIX, PREFIX_Z, MAX_CODE } from "../app/js/transfer.js";

let fail = 0, pass = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

const THREE_KEY = "seikaku16:three:v1";
const DRAFT_KEY = "seikaku16:app:consult-draft";
const FIVE_KEY = "seikaku16:v1";

/** localStorage の代わり（Map に入れるだけ） */
function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}
/** 入れ物を差し替える（＝別の端末の保存）。画面の状態（store3）も空にする */
function device() {
  const s = memory();
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true });
  useStorage(null);   // local.js も globalThis.localStorage を使う
  setFbMode3(false);
  discard3();
  return s;
}
/** 三択 v3 を n 問（省略で最後まで）答える。左右は決まった並び */
function answer(n = Infinity, seed = 1) {
  start3({ adaptive: true, version: "v3" });
  let i = 0;
  while (!store3.result && i < n) {
    if (practicePending3()) { practice3("left"); continue; }
    i++;
    answer3((i * seed) % 3 ? "left" : "right");
  }
  return i;
}
const plainCode = (obj) => PREFIX + Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
const decodePlain = (code) => JSON.parse(Buffer.from(code.slice(PREFIX.length), "base64url").toString("utf8"));
const savedThree = (s) => JSON.parse(s.getItem(THREE_KEY) || "null");
/** i 文字目を別の文字にする */
const flip = (text, i) => text.slice(0, i) + (text[i] === "A" ? "B" : "A") + text.slice(i + 1);

// ---------------------------------------------------------------- 1つ目の端末（Safari のつもり）
const A = device();
const answered = answer();
const keyA = resultKey(store3.result);
const recA = recordDiagnosis(store3.result);
const atA = loadRecords().items.find(x => x.id === recA).at;
setMarks(keyA, { off: { B1: [0, 2] }, scenes: { "B1-1": "yes" } });
addRecord({ kind: "consult", title: "相談のひみつの文", sub: "待つ", data: { text: "相談のひみつの本文" } });
A.setItem(DRAFT_KEY, JSON.stringify({ text: "下書きのひみつ" }));
A.setItem(FIVE_KEY, JSON.stringify({ secret: "5択のひみつ" }));
store3.fb = { phase: "done", note: "テスト協力のひみつ" };
setFbMode3(true);
save3();
const code = await makeTransferCode();
const plain = await makeTransferCode({ compress: false });

await test("1つ目の端末：診断を最後まで答え、コードが1行でできる（縮めた S16Z- か、縮められない環境では S16-）", () => {
  assert.ok(answered > 20 && store3.result);
  assert.equal(typeof code, "string");
  assert.ok(code.startsWith(PREFIX_Z) || code.startsWith(PREFIX), code.slice(0, 8));
  assert.match(code, /^S16Z?-[A-Za-z0-9_-]+$/);
  assert.match(plain, /^S16-[A-Za-z0-9_-]+$/);
  assert.ok(code.length <= plain.length);
  assert.ok(code.length < MAX_CODE && plain.length < MAX_CODE);
  console.log(`     （ふつうの診断1回 ${answered}問：コード ${code.length}字〔${code.slice(0, 4)}〕、縮めないと ${plain.length}字）`);
});

await test("入れる物：診断（session と source）・診断の記録・その印。入れない物：相談・下書き・テスト協力・5択版", () => {
  const raw = Buffer.from(plain.slice(PREFIX.length), "base64url").toString("utf8");
  for (const secret of ["相談のひみつ", "下書きのひみつ", "テスト協力のひみつ", "5択のひみつ"]) assert.ok(!raw.includes(secret), secret);
  const o = decodePlain(plain);
  assert.equal(o.t, "seikaku16-move");
  assert.equal(o.v, 1);
  assert.deepEqual(Object.keys(o).sort(), ["marks", "records", "session", "source", "t", "v"]);
  assert.equal(o.session.type, "seikaku16-three-session");
  assert.ok(!("fb" in o.session) && !("fbMode" in o));
  assert.equal(o.records.length, 1);
  assert.ok(o.records.every(x => x.kind === "diagnosis"));
  assert.equal(o.records[0].data.key, keyA);
  assert.deepEqual(o.marks, { [keyA]: { off: { B1: [0, 2] }, scenes: { "B1-1": "yes" } } });
});

let data = null;
await test("読む：縮めた物も縮めない物も ok。前後・途中の空白と改行（全角の空白も）を取り除いて読む", async () => {
  const r1 = await readTransferCode(code);
  const r2 = await readTransferCode(plain);
  assert.equal(r1.ok, true); assert.equal(r2.ok, true);
  assert.deepEqual(r1.data, r2.data);
  const spaced = `\n  ${code.slice(0, 10)} \n${code.slice(10, 50)}　${code.slice(50)}\t \n`;
  const r3 = await readTransferCode(spaced);
  assert.equal(r3.ok, true);
  data = r1.data;
  assert.ok(data.session && data.source && data.records.length === 1);
});

// ---------------------------------------------------------------- 2つ目の端末（ホーム画面のアプリのつもり）
const B = device();
answer(5, 2);   // アプリの側にも途中の診断がある（置き換えられる）
const before = store3.session.progress().answered;
addRecord({ kind: "consult", title: "アプリの側の相談" });

await test("入れる：別の入れ物に入れて、結果の key が同じ（保存した物から読み直しても同じ）", () => {
  assert.equal(before, 5);
  const out = applyTransfer(data);
  assert.deepEqual(out, { ok: true, session: true, done: true, records: 1, marks: 1 });
  assert.ok(store3.result);
  assert.equal(resultKey(store3.result), keyA);
  const saved = savedThree(B);
  const s = Session3.fromJSON(saved.session);
  assert.ok(s.isDone());
  assert.equal(resultKey({ ...s.result(), source: saved.source }), keyA);
  assert.deepEqual(saved.source, { type: "session", name: "あなたの回答" });
});

await test("入れたあと：テスト協力（fb・fbMode）は来ない、相談・下書き・5択版も来ない、記録の日時は元のまま、印も来る", () => {
  const saved = savedThree(B);
  assert.ok(!("fb" in saved) && !("fbMode" in saved));
  assert.equal(store3.fb, null); assert.equal(store3.fbMode, false); assert.equal(store3.practice, null);
  assert.equal(B.getItem(DRAFT_KEY), null);
  assert.equal(B.getItem(FIVE_KEY), null);
  const items = loadRecords().items;
  assert.deepEqual(items.filter(x => x.kind === "consult").map(x => x.title), ["アプリの側の相談"]);
  const diag = items.filter(x => x.kind === "diagnosis");
  assert.equal(diag.length, 1);
  assert.equal(diag[0].data.key, keyA);
  assert.equal(diag[0].at, atA);
  assert.deepEqual(getMarks(keyA), { off: { B1: [0, 2] }, scenes: { "B1-1": "yes" } });
  assert.ok(!B.getItem(APP_KEY).includes("ひみつ"));
});

await test("同じ診断の記録を2回入れても増えない（結果を開いたときの recordDiagnosis でも増えない）", () => {
  const n = loadRecords().items.length;
  const out = applyTransfer(data);
  assert.equal(out.ok, true); assert.equal(out.records, 0); assert.equal(out.marks, 0);
  recordDiagnosis(store3.result);
  assert.equal(loadRecords().items.length, n);
});

await test("この端末にある印は上書きしない（まだ無い key だけ入れる）", () => {
  device();
  setMarks(keyA, { off: { B2: [1] } });
  const out = applyTransfer(data);
  assert.equal(out.marks, 0);
  assert.deepEqual(getMarks(keyA), { off: { B2: [1] } });
});

// ---------------------------------------------------------------- 途中の回答・記録だけ・何も無い
await test("途中の回答も移せる（結果は無く、続きから答えられる）", async () => {
  device();
  answer(7, 1);
  const c = await makeTransferCode();
  assert.ok(c);
  device();
  const r = await readTransferCode(c);
  assert.equal(r.ok, true);
  assert.equal(r.data.records.length, 0);
  const out = applyTransfer(r.data);
  assert.deepEqual(out, { ok: true, session: true, done: false, records: 0, marks: 0 });
  assert.equal(store3.result, null);
  assert.equal(store3.session.progress().answered, 7);
  assert.equal(Session3.fromJSON(savedThree(globalThis.localStorage).session).progress().answered, 7);
});

await test("診断の記録だけ（診断は消した）も移せる。そのときは入れる側の診断を置き換えない", async () => {
  device();
  addRecord({ kind: "diagnosis", at: "2026-10-01T09:00:00Z", title: "前の結果", sub: "1行", data: { key: "d1-v3-old", version: "v3" } });
  assert.equal(hasTransferable(), true);
  const c = await makeTransferCode({ compress: false });
  const o = decodePlain(c);
  assert.ok(!("session" in o));
  device();
  answer(3, 1);
  const r = await readTransferCode(c);
  assert.equal(r.ok, true);
  const out = applyTransfer(r.data);
  assert.deepEqual(out, { ok: true, session: false, done: false, records: 1, marks: 0 });
  assert.equal(store3.session.progress().answered, 3);
  assert.equal(loadRecords().items[0].at, "2026-10-01T09:00:00.000Z");
});

await test("移す物が無いときは null（何も無い・始めたが1問も答えていない・相談だけ）", async () => {
  device();
  assert.equal(await makeTransferCode(), null);
  assert.equal(hasTransferable(), false);
  start3({ adaptive: true, version: "v3" });
  assert.equal(await makeTransferCode(), null);
  addRecord({ kind: "consult", title: "相談だけ" });
  assert.equal(await makeTransferCode(), null);
  assert.equal(hasTransferable(), false);
});

// ---------------------------------------------------------------- 読めない物
await test("読めない物は ok: false（空・別のアプリ・壊れた・形が違う）で、例外を外に出さない", async () => {
  const o = decodePlain(plain);
  const bad = [
    undefined, null, 123, {}, "", "   \n ", PREFIX, PREFIX_Z, "S16-!!!", "S16-A", "s16-" + plain.slice(4),
    "こんにちは", "https://kento20020.github.io/Seikakushindan/app/", "16DFB1:abc", "{\"t\":\"seikaku16-move\"}",
    PREFIX_Z + plain.slice(PREFIX.length),                 // 縮めていない物に縮めた頭
    PREFIX + code.slice(PREFIX_Z.length),                   // 縮めた物に縮めていない頭（縮めた環境のとき）
    code.slice(0, Math.floor(code.length / 2)),             // 途中で切れた
    plain.slice(0, plain.length - 9),                       // 最後が欠けた（JSON が閉じない）
    flip(code, Math.floor(code.length / 2)),                // 真ん中が1文字ちがう（縮めた物は確かめの数で分かる）
    flip(code, code.length - 3),                            // 終わり近く（確かめの数）が1文字ちがう
    plainCode({ ...o, t: "other-app" }),
    plainCode({ ...o, v: 2 }),
    plainCode({ ...o, session: { type: "seikaku16-session", version: 1 } }),
    plainCode({ ...o, session: "壊れた" }),
    plainCode({ ...o, records: "x" }),
    plainCode({ ...o, records: [{ ...o.records[0], kind: "consult" }] }),
    plainCode({ ...o, records: [{ ...o.records[0], at: "いつか" }] }),
    plainCode({ ...o, records: [{ ...o.records[0], data: {} }] }),
    plainCode({ ...o, marks: [] }),
    plainCode({ ...o, marks: { k: "文字" } }),
    plainCode({ t: "seikaku16-move", v: 1 }),               // 中身が無い
    plainCode({ t: "seikaku16-move", v: 1, records: [], marks: {} }),
    plainCode([1, 2, 3]),
    PREFIX + Buffer.from([0xff, 0xfe, 0x00]).toString("base64url"),   // UTF-8 でない
  ];
  for (const x of bad) {
    const r = await readTransferCode(x);
    assert.deepEqual(r, { ok: false }, String(x).slice(0, 60));
  }
});

await test("大きすぎる物は ok: false（長いコード・貼り付けた文が長すぎる・戻すと大きすぎる縮めた物）", async () => {
  assert.deepEqual(await readTransferCode(PREFIX + "A".repeat(MAX_CODE + 4)), { ok: false });
  assert.deepEqual(await readTransferCode(plain + " ".repeat(1000001)), { ok: false });
  const o = decodePlain(plain);
  assert.deepEqual(await readTransferCode(plainCode({ ...o, records: Array.from({ length: 201 }, (_, i) => ({ ...o.records[0], id: `r${i}`, data: { key: `k${i}` } })) })), { ok: false });
  assert.deepEqual(await readTransferCode(plainCode({ ...o, marks: Object.fromEntries(Array.from({ length: 401 }, (_, i) => [`k${i}`, {}])) })), { ok: false });
  if (code.startsWith(PREFIX_Z)) {
    // 縮めると小さいが、戻すと上限（約40万バイト）を超える物
    const big = new TextEncoder().encode(JSON.stringify({ ...o, pad: " ".repeat(2000000) }));
    const z = new Uint8Array(await new Response(new Blob([big]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
    const bomb = PREFIX_Z + Buffer.from(z).toString("base64url");
    assert.ok(bomb.length < MAX_CODE, `縮めた物は短い：${bomb.length}`);
    assert.deepEqual(await readTransferCode(bomb), { ok: false });
  } else {
    console.log("     （この Node では縮められないので、縮めた物の上限は確かめない）");
  }
});

await test("applyTransfer：形が違う物を渡しても落ちない（ok: false）", () => {
  device();
  assert.equal(applyTransfer(null).ok, false);
  assert.equal(applyTransfer("x").ok, false);
  assert.equal(applyTransfer({ session: { type: "x" } }).ok, false);
  assert.equal(store3.session, null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
