// node tests/feedback_format.test.mjs
import assert from "node:assert/strict";
import { crc32hex, encodeText, decodeAll } from "../js/feedback_format.js";

let fail = 0;
const test = (name, fn) => { try { fn(); console.log("OK  ", name); } catch (e) { fail++; console.log("FAIL", name, "\n ", e.message); } };

test("CRC-32 の既知値", () => {
  assert.equal(crc32hex(""), "00000000");
  assert.equal(crc32hex("123456789"), "cbf43926");
});

const p1 = { v: 1, code: "ab12", fb: { free: "改行\nあり、絵文字😀も" } };
const p2 = { v: 1, code: "cd34", rec: [["s1-1", "W1-1", "L", 0, 1, 0, 0, 34, "s", ""]] };

test("往復：2人分を混ぜて貼っても両方取れる", () => {
  const text = "前置き\n" + encodeText(p1, ["要約1"]) + "\n\nあいだのメッセージ\n" + encodeText(p2, ["要約2"]);
  const { items, errors } = decodeAll(text);
  assert.equal(errors.length, 0);
  assert.deepEqual(items.map(i => i.payload), [p1, p2]);
});

test("メールの折り返し（途中に改行が入る）でも読める", () => {
  const line = encodeText(p2).split("\n").pop();
  const wrapped = line.match(/.{1,40}/g).join("\r\n");
  const { items, errors } = decodeAll(wrapped);
  assert.equal(errors.length, 0);
  assert.deepEqual(items[0].payload, p2);
});

test("書き換わったら CRC エラー", () => {
  const text = encodeText(p1).replace("ab12", "ab13");
  const { items, errors } = decodeAll(text);
  assert.equal(items.length, 0);
  assert.match(errors[0].reason, /CRC/);
});

test("途中で切れたら検出", () => {
  const text = encodeText(p1);
  const { items, errors } = decodeAll(text.slice(0, text.length - 30));
  assert.equal(items.length, 0);
  assert.match(errors[0].reason, /END/);
});

test("途中で切れた1件が、後ろの人の分を飲み込まない", () => {
  const cut = encodeText(p1); const text = cut.slice(0, cut.length - 30) + "\n次の人\n" + encodeText(p2);
  const { items, errors } = decodeAll(text);
  assert.deepEqual(items.map(i => i.payload), [p2]);
  assert.equal(errors.length, 1);
});

console.log(fail ? `${fail} failed` : "all feedback_format tests passed");
process.exit(fail ? 1 : 0);
