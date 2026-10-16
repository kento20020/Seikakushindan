// data/testers/ に置いたテスターの回答原文が、壊れずに読めるか（CRC 一致・1ファイル1人）を確かめる
import { readFileSync, readdirSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { decodeAll } from "../js/feedback_format.js";
import { analyze } from "../js/admin/aggregate.js";
import { VERSION_IDS } from "../js/three_version.js";

const base = new URL("../data/testers/", import.meta.url);
const files = [];
// 版ごとのフォルダ（v1/・v2/・v3/ …）。回答がまだ無い版のフォルダは無くてよい
for (const ver of VERSION_IDS) {
  const dir = new URL(`${ver}/`, base);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter(f => f.endsWith(".txt"))) files.push(`${ver}/${f}`);
}
let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, "\n  ", e.message); } };

check("回答ファイルが6件以上ある", () => assert.ok(files.length >= 6, `files=${files.length}`));
const all = [];
for (const f of files) {
  const text = readFileSync(new URL(f, base), "utf-8");
  all.push(text);
  check(`${f}: CRC が合い、1人分だけ入っている`, () => {
    const r = decodeAll(text);
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
    assert.equal(r.items.length, 1);
  });
  check(`${f}: フォルダの版と送信テキストの版が合う`, () => {
    const p = decodeAll(text).items[0].payload;
    const qv = p.qv ?? "v1";
    assert.equal(qv, f.split("/")[0]);
  });
}
check("まとめて集計でき、人数がファイル数と同じ", () => {
  const a = analyze(all.join("\n\n"));
  assert.equal(a.parsed.errors.length, 0);
  assert.equal(a.people, files.length);
});

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
