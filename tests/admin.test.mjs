// node tests/admin.test.mjs
// テスト協力モードの集計（admin.html の中身：js/admin/*.js）のテスト。仕様：docs/feedback-spec.md §3
//  - 入力は tests/fixtures/fb_sample_all.txt（node tools/make_fb_fixtures.mjs で作る）。5人＋再検査1＋途中で切れた1通＋二重送信＋メール折り返し
//  - 集計は、固定したサンプルファイルの回答ログ（rec・fb）から独立に数え直した値と突き合わせる
//  - 再採点は「いまのロジックで作ったサンプル」（buildFixtures()）と、参加者側（js/feedback_collect.js）が作る本物の送信テキストでも確認する
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { buildFixtures } from "../tools/make_fb_fixtures.mjs";
import { encodeText, decodeAll, crc32hex } from "../js/feedback_format.js";
import { QUESTIONS3 } from "../js/data/questions3.js";
import { ITEM3, Session3, drive } from "../js/adaptive3.js";
import { PATTERN_BY_ID } from "../js/data/patterns.js";
import { DOMAINS, STATE_LABEL } from "../js/engine3.js";
import {
  REVIEW, parseInput, analyze, analyzeParsed, splitSentences, splitSegments, diagClass, compareSelf, compareAct, domainMatrix, blindSummary, cardSummary,
  itemTable, detectSentenceBase, retestComparisons, normCode, tsLabel, fmtDur, median, usedSessions,
} from "../js/admin/aggregate.js";
import { rescoreAll, rescoreSession, recordsFromRec, computeRes, diffRes } from "../js/admin/rescore.js";
import { csvCell, toCsv, participantCsvRows, itemCsvRows, buildMarkdown, CSV_BOM } from "../js/admin/export.js";

let fail = 0, pass = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);     // 非同期のテストもあるので、最後に順番に実行する

const TEXT = readFileSync(new URL("./fixtures/fb_sample_all.txt", import.meta.url), "utf-8");
const TI = QUESTIONS3.traitIndex;
const parsed = parseInput(TEXT);
const model = analyzeParsed(parsed);
const bySession = (code, i = 0) => parsed.sessions.filter(s => s.codeKey === code)[i];
const eq = (a, b, msg) => assert.deepEqual(a, b, msg);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ""} ${a} vs ${b}`);

// 最小の送信テキストを作る道具
const REC1 = ["WB-1-1", "W1-1", "L", 0, 1, 0, 0, 30, "s", ""];
function mkText(over = {}) {
  const payload = { v: 1, app: QUESTIONS3.version, code: "t1", ts: "2026-10-09T10:00:00+09:00", mode: "a", dur: 100, back: 0, ua: "m", rec: [REC1], res: null, fb: {}, ...over };
  return encodeText(payload, [`【16次元診断 テスト協力】コード: ${payload.code}`]);
}

// ---------------------------------------------------------------- サンプルの前提
test("サンプル：決まった作り方で毎回同じ内容になる（乱数は固定シード）", () => {
  const a = buildFixtures(), b = buildFixtures();
  assert.equal(a.all, b.all);
  eq([...a.people.keys()], ["ab12", "kenji", "mi", "tora", "sora"]);
});
test("サンプルファイルが今の生成結果と同じか（違えば警告だけ。エンジンを調整したあとは再生成すればよい）", () => {
  const same = buildFixtures().all === TEXT;
  if (!same) console.log("  WARN tests/fixtures/fb_sample_all.txt が古い：node tools/make_fb_fixtures.mjs で作り直してください");
});
test("サンプルの形：折り返し（CRLF）・途中で切れた1通・二重送信が入っている", () => {
  assert.ok(TEXT.includes("\r\n"), "メール折り返しの CRLF");
  assert.equal((TEXT.match(/16DFB1\|/g) || []).length, 8);
  assert.equal((TEXT.match(/\|END/g) || []).length, 7);    // 切れた1通だけ END が無い
});
test("サンプルの res：参加者側と同じ形（chosen=[[id,役割]]、states、lv=16個の整数、w=[[a,b]×8]）", () => {
  const { items } = decodeAll(TEXT);
  assert.ok(items.length >= 1);
  for (const { payload: p } of items) {
    assert.equal(p.v, 1); assert.equal(p.app, QUESTIONS3.version);
    assert.ok(p.res.chosen.every(c => Array.isArray(c) && c.length === 2 && PATTERN_BY_ID[c[0]]));
    eq(Object.keys(p.res.states), ["1", "2", "3", "4", "5", "6", "7", "8"]);
    assert.equal(p.res.lv.length, 16); assert.ok(p.res.lv.every(Number.isInteger));
    assert.equal(p.res.w.length, 8); assert.ok(p.res.w.every(w => w.length === 2 && w.every(Number.isInteger)));
    assert.ok(p.rec.every(r => r.length === 10 || (r.length === 11 && Array.isArray(r[10]) && r[6] > 0)));
    assert.ok(p.rec.every(r => r[5] === (r[2] === "L" ? r[3] : r[2] === "R" ? r[4] : -1)), "pk は選んだ側の傾向");
  }
});

// ---------------------------------------------------------------- 1. 読み込み
test("読み込み：有効6件（5人＋再検査）、途中で切れた1件、二重送信1件、再検査の組1つ", () => {
  assert.equal(parsed.markers, 8);
  assert.equal(parsed.sessions.length, 6);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.duplicates.length, 1);
  eq(parsed.duplicates[0], { code: "ab12", ts: "2026-10-09T12:34:56+09:00", same: true });
  eq(parsed.groups.map(g => [g.code, g.sessions.length]), [["kenji", 2]]);
  assert.equal(new Set(parsed.sessions.map(s => s.codeKey)).size, 5);
  assert.deepEqual(parsed.warnings, []);
});
test("読み込み：途中で切れた分は、種類・行番号・抜粋・誰の分かの手掛かり付きで報告し、次の人の分を飲み込まない", () => {
  const e = parsed.errors[0];
  assert.equal(e.kind, "truncated"); assert.equal(e.n, 4); assert.equal(e.hintCode, "hana");
  assert.ok(e.line > 50 && e.excerpt.startsWith('{"v":1'));
  assert.ok(parsed.sessions.some(s => s.codeKey === "tora"), "切れた1通のすぐ後ろの tora は読める");
  // 共通の decodeAll も、切れた1通が次の人の分を飲み込まない（開始タグをまたがない）。集計側の読み込みと件数が一致する
  assert.equal(decodeAll(TEXT).items.length, parsed.sessions.length + parsed.duplicates.length);
});
test("読み込み：メールの折り返し（機械用の行の途中に CRLF）でも読める。|END の途中で折り返されても読める", () => {
  assert.ok(bySession("mi"));
  const line = mkText().split("\n").pop();
  const wrapped = line.match(/.{1,40}/g).join("\r\n");
  eq(parseInput(wrapped).sessions.length, 1);
  const cut = line.replace("|END", "|EN\r\nD");
  eq(parseInput("本文\n" + cut + "\n署名").sessions.length, 1);
  const cut2 = line.replace("|END", "|\r\nEND");
  eq(parseInput(cut2).sessions.length, 1);
});
test("読み込み：書き換わった（CRC不一致）1件だけ報告し、ほかは読める", () => {
  const broken = TEXT.replace('"code":"tora"', '"code":"toro"');
  const p = parseInput(broken);
  assert.equal(p.errors.length, 2);
  assert.equal(p.errors.find(e => e.kind === "crc").n, 5);
  assert.equal(p.sessions.length, 5);
});
test("読み込み：JSON として読めない・版が違う・必須項目がない、はそれぞれエラー", () => {
  const body = '{"v":1,"code":"x"';
  const bad = `16DFB1|${crc32hex(body)}|${body}|END`;
  const p = parseInput([bad, encodeText({ v: 2, code: "a" }), encodeText({ v: 1, ts: "2026-10-09T10:00:00+09:00", rec: [] }), encodeText({ v: 1, code: "a", ts: "ばらばら", rec: [] })].join("\n"));
  eq(p.errors.map(e => e.kind), ["json", "version", "format", "format"]);
  assert.match(p.errors[2].reason, /code/); assert.match(p.errors[3].reason, /ts/);
  eq(p.sessions, []);
});

test("読み込み：機械用の行がないテキストは markers=0（エラーではなく案内を出せる）", () => {
  const p = parseInput("こんにちは。ごはん食べました。");
  eq([p.markers, p.sessions.length, p.errors.length], [0, 0, 0]);
  eq(parseInput("").sessions, []);
});
test("読み込み：同じ code＋ts は1件に（同じ内容）。内容が違うときは後に貼られた方を採用して印を付ける", () => {
  const a = mkText({ fb: { free: "前" } }), b = mkText({ fb: { free: "後" } });
  const p = parseInput(a + "\n\n" + b);
  eq(p.sessions.length, 1); eq(p.duplicates, [{ code: "t1", ts: "2026-10-09T10:00:00+09:00", same: false }]);
  assert.equal(p.sessions[0].fb.free, "後");
  eq(parseInput(a + "\n" + a).duplicates.map(d => d.same), [true]);
});
test("読み込み：再検査＝同じ code で ts が違う。code は全角半角・大小文字・前後の空白を無視してそろえる", () => {
  const p = parseInput([mkText({ code: "ＡＢ12" }), mkText({ code: "ab12 ", ts: "2026-10-12T10:00:00+09:00" }), mkText({ code: "zz", ts: "2026-10-10T10:00:00+09:00" })].join("\n"));
  eq(p.sessions.map(s => [s.codeKey, s.retestIndex, s.isRetest]), [["ab12", 0, false], ["zz", 0, false], ["ab12", 1, true]]);
  assert.equal(normCode(" Ｋｅｎ "), "ken");
  eq(p.groups.length, 1);
});
test("読み込み：設問版の違い・知らない設問 id・結果なしは警告", () => {
  const p = parseInput(mkText({ app: "old-version", rec: [["WB-1-1", "ZZ9", "L", 0, 1, 0, 0, 30, "s", ""], REC1, "でたらめ"] }));
  assert.equal(p.sessions[0].badRec, 1);
  assert.ok(p.warnings.some(w => /設問版/.test(w)) && p.warnings.some(w => /id/.test(w)) && p.warnings.some(w => /res/.test(w)) && p.warnings.some(w => /読めず/.test(w)));
});
test("splitSegments：開始位置ごとに切る", () => {
  eq(splitSegments("a16DFB1|x b 16DFB1|y").map(s => s.start), [1, 12]);
});
test("tsLabel・fmtDur・median", () => {
  assert.equal(tsLabel("2026-10-09T12:34:56+09:00"), "2026-10-09 12:34");
  assert.equal(fmtDur(1080), "18分00秒"); assert.equal(fmtDur(45), "45秒"); assert.equal(fmtDur(null), "—");
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 2, 3]), 2.5); assert.equal(median([]), null);
});

// ---------------------------------------------------------------- 2. 参加者一覧
test("参加者一覧：回答数・差し替え・スキップ・左率・入力方法が rec から数えた値と一致", () => {
  for (const s of parsed.sessions) {
    const rec = s.payload.rec;
    const L = rec.filter(r => r[2] === "L").length, R = rec.filter(r => r[2] === "R").length;
    assert.equal(s.n, rec.length);
    assert.equal(s.swaps, rec.reduce((n, r) => n + r[6], 0));
    assert.equal(s.skips, rec.filter(r => r[2] === "K").length);
    near(s.leftRate, L / (L + R));
    eq(s.inp, { s: rec.filter(r => r[8] === "s").length, t: rec.filter(r => r[8] === "t").length, k: rec.filter(r => r[8] === "k").length, x: rec.filter(r => r[8] === "x").length });
    assert.equal(s.inp.s + s.inp.t + s.inp.k + s.inp.x, s.n);
    assert.equal(s.mode, s.payload.mode); assert.equal(s.dur, s.payload.dur); assert.equal(s.back, s.payload.back);
  }
});
test("参加者一覧：左率の警告は 0.85 以上か 0.15 以下（ab12＝左ばかり。ほかは警告なし）", () => {
  assert.equal(bySession("ab12").leftRate, 1);
  eq(parsed.sessions.filter(s => s.leftWarn).map(s => s.code), ["ab12"]);
  const lr = (L, R) => { const rec = [...Array(L).fill(0).map(() => ["a", "W1-1", "L", 0, 1, 0, 0, 30, "s", ""]), ...Array(R).fill(0).map(() => ["a", "W1-1", "R", 0, 1, 1, 0, 30, "s", ""])]; return parseInput(mkText({ rec })).sessions[0]; };
  eq([lr(17, 3).leftWarn, lr(16, 4).leftWarn, lr(3, 17).leftWarn, lr(4, 16).leftWarn], [true, false, true, false]);   // 0.85 / 0.80 / 0.15 / 0.20
});
test("参加者一覧：主軸は res.chosen の「主軸」と、その見出し。モード・端末・再検査の目印", () => {
  for (const s of parsed.sessions) {
    const main = s.payload.res.chosen.find(c => c[1] === "主軸");
    assert.equal(s.main.id, main[0]); assert.equal(s.main.headline, PATTERN_BY_ID[main[0]].headline);
    assert.equal(s.main.extra, s.payload.res.chosen.length - 1);
  }
  assert.equal(bySession("tora").mode, "f"); assert.equal(bySession("tora").n, 64);
  eq(parsed.sessions.map(s => [s.code, s.retestIndex]).filter(x => x[0] === "kenji"), [["kenji", 0], ["kenji", 1]]);
  assert.ok(parsed.sessions.every((s, i, a) => !i || a[i - 1].tsMs <= s.tsMs), "開始日時の順");
});
test("集計対象：既定では再検査を除く（人数で数える）。含める指定で全部", () => {
  eq(model.used.map(s => s.code), ["ab12", "kenji", "mi", "tora", "sora"]);
  assert.equal(model.people, 5);
  const all = analyzeParsed(parsed, { includeRetests: true });
  assert.equal(all.used.length, 6); assert.equal(all.people, 5);
  assert.equal(usedSessions(parsed, { includeRetests: false }).length, 5);
});

// ---------------------------------------------------------------- 3. 領域ごとの照合
test("診断の側：状態 1・2・1w → A、3・4・3w → B、5 → both、6 → neither、7 → depends、判定なし → null", () => {
  eq(["1", "2", "1w", "3", "4", "3w", "5", "6", "7", null, undefined, "x"].map(diagClass), ["A", "A", "A", "B", "B", "B", "both", "neither", "depends", null, null, null]);
});
test("self の照合：A/B は優勢の側と、both/neither/depends は状態 5/6/7 と。違えば不一致、未回答・判定なしは比較しない", () => {
  eq([["A", "A"], ["A", "B"], ["B", "B"], ["both", "both"], ["neither", "neither"], ["depends", "depends"], ["both", "A"], ["A", "both"], ["depends", "neither"]].map(([c, s]) => compareSelf(c, s)),
    ["match", "mismatch", "match", "match", "match", "match", "mismatch", "mismatch", "mismatch"]);
  eq([compareSelf(null, "A"), compareSelf("A", ""), compareSelf("A", null), compareSelf("A", "どれか")], ["none", "none", "none", "none"]);
});
test("act の照合：A/B を優勢の側と比べる。na は除外、診断が拮抗（5・6・7）のときは比べない", () => {
  eq([["A", "A"], ["A", "B"], ["B", "B"], ["B", "A"]].map(([c, a]) => compareAct(c, a)), ["match", "mismatch", "match", "mismatch"]);
  eq([compareAct("A", "na"), compareAct("both", "A"), compareAct("neither", "B"), compareAct("depends", "A"), compareAct(null, "A"), compareAct("A", ""), compareAct("A", null)], ["na", "tie", "tie", "tie", "none", "none", "none"]);
});
test("領域の表：行＝集計対象の参加者、列＝8領域。状態・状態名・W a:b・self・act が rec/res/fb と一致", () => {
  const dm = model.domain;
  eq(dm.rows.map(r => r.session.code), ["ab12", "kenji", "mi", "tora", "sora"]);
  for (const r of dm.rows) {
    assert.equal(r.cells.length, 8);
    r.cells.forEach((c, i) => {
      const d = i + 1, p = r.session.payload;
      assert.equal(c.d, d); assert.equal(c.state, p.res.states[d]);
      assert.equal(c.label, c.state ? STATE_LABEL[c.state] : "判定なし");
      eq([c.a, c.b], p.res.w[i]); assert.equal(c.self, p.fb.self[d]); assert.equal(c.act, p.fb.act[d]);
    });
  }
});
test("領域の表：一致率（領域別・全体）を、独立に数えた値と比べる。na と拮抗は act から除く", () => {
  const side = { "1": "A", "2": "A", "1w": "A", "3": "B", "4": "B", "3w": "B", "5": "both", "6": "neither", "7": "depends" };
  const per = Array.from({ length: 8 }, () => ({ sm: 0, sn: 0, am: 0, an: 0, both: 0 }));
  for (const s of model.used) for (let d = 1; d <= 8; d++) {
    const cls = side[s.payload.res.states[d]], self = s.payload.fb.self[d], act = s.payload.fb.act[d], x = per[d - 1];
    let selfMis = false, actMis = false;
    if (cls && self) { x.sn++; if (cls === self) x.sm++; else selfMis = true; }
    if (cls && (cls === "A" || cls === "B") && (act === "A" || act === "B")) { x.an++; if (cls === act) x.am++; else actMis = true; }
    if (selfMis && actMis) x.both++;
  }
  model.domain.perDomain.forEach((p, i) => {
    eq([p.self.m, p.self.n, p.act.m, p.act.n, p.bothMismatchPeople], [per[i].sm, per[i].sn, per[i].am, per[i].an, per[i].both], `領域${i + 1}`);
  });
  const tot = per.reduce((a, x) => ({ sm: a.sm + x.sm, sn: a.sn + x.sn, am: a.am + x.am, an: a.an + x.an }), { sm: 0, sn: 0, am: 0, an: 0 });
  eq([model.domain.overall.self.m, model.domain.overall.self.n, model.domain.overall.act.m, model.domain.overall.act.n], [tot.sm, tot.sn, tot.am, tot.an]);
  assert.equal(model.domain.overall.self.pct, Math.round(tot.sm / tot.sn * 100));
  assert.ok(tot.sn > 20 && tot.an > 10);
});
test("領域の表：参加者ごとの一致数（この人の一致）も出る。拮抗の領域の act は比べない", () => {
  const p = parseInput(mkText({ res: { chosen: [], states: { 1: "1", 2: "5", 3: "3", 4: null }, lv: [], w: [] }, fb: { self: { 1: "A", 2: "both", 3: "A", 4: "B" }, act: { 1: "B", 2: "A", 3: "na", 4: "A" } } }));
  const r = domainMatrix(p.sessions).rows[0];
  eq(r.cells.slice(0, 4).map(c => [c.selfRes, c.actRes]), [["match", "mismatch"], ["match", "tie"], ["mismatch", "na"], ["none", "none"]]);
  eq([r.self.m, r.self.n, r.act.m, r.act.n], [2, 3, 0, 1]);
});
test("領域の表：res や fb がない参加者でも落ちない", () => {
  const p = parseInput(mkText({ res: undefined, fb: undefined }));
  const r = domainMatrix(p.sessions).rows[0];
  assert.ok(r.cells.every(c => c.state === null && c.selfRes === "none" && c.actRes === "none"));
});

// ---------------------------------------------------------------- 4. ブラインド比較
test("ブラインド：own を選んだ人数／回答した人数", () => {
  const raw = model.used.map(s => s.payload.fb.blind.pick);
  const b = blindSummary(model.used);
  eq([b.own, b.total], [raw.filter(x => x === "own").length, raw.filter(Boolean).length]);
  eq([b.own, b.total, b.pct], [2, 5, 40]);
  eq(b.rows.map(r => [r.session.code, r.pick, r.decoy, r.order]), model.used.map(s => [s.code, s.payload.fb.blind.pick, s.payload.fb.blind.decoy, s.payload.fb.blind.order]));
  assert.equal(b.byOrder["own-first"].n + b.byOrder["decoy-first"].n, 5);
  const none = blindSummary(parseInput(mkText({ fb: { blind: { pick: "", decoy: "", order: "" } } })).sessions);
  eq([none.total, none.noAnswer], [0, 1]);
});

// ---------------------------------------------------------------- 5. カード評価
test("文の分け方：「。」で区切って「。」を残す（参加者側と同じ。番号は0始まり）", () => {
  eq(splitSentences("あ。い。う。"), ["あ。", "い。", "う。"]);
  eq(splitSentences(" あ。 \nい"), ["あ。", "い。"]);
  eq(splitSentences(""), []);
});
test("参加者側（js/feedback_collect.js）の文の分け方と同じ", async () => {
  const mod = await import("../js/feedback_collect.js").catch(() => null);
  if (!mod) return;
  for (const id of Object.keys(PATTERN_BY_ID)) {
    const d = PATTERN_BY_ID[id].text?.detail;
    eq(splitSentences(d), mod.splitSentences(d), id);
  }
});
test("カード評価：パターンごとの n・平均・「違う」の印・場面 y/n・主軸の答えを、fb.cards から数えた値と比べる", () => {
  const cs = cardSummary(model.used);
  const raw = {};
  for (const s of model.used) for (const [id, r, bad, sc, axis] of s.payload.fb.cards) {
    const x = (raw[id] ||= { n: 0, ratings: [], marks: {}, y: [0, 0], n_: [0, 0], axis: { yes: 0, partly: 0, no: 0 } });
    x.n++; if (r > 0) x.ratings.push(r);
    for (const i of bad) x.marks[i] = (x.marks[i] || 0) + 1;
    sc.forEach((v, k) => { if (v === "y") x.y[k]++; if (v === "n") x.n_[k]++; });
    if (axis) x.axis[axis]++;
  }
  eq(cs.cards.map(c => c.id).sort(), Object.keys(raw).sort());
  for (const c of cs.cards) {
    const x = raw[c.id];
    assert.equal(c.n, x.n); assert.equal(c.nRated, x.ratings.length);
    near(c.mean, x.ratings.reduce((a, b) => a + b, 0) / x.ratings.length);
    c.sentences.forEach((s, i) => assert.equal(s.marks, x.marks[i] || 0, `${c.id} 文${i}`));
    eq(c.scenes.map(s => s.y), x.y); eq(c.scenes.map(s => s.n), x.n_);
    eq([c.axis.yes, c.axis.partly, c.axis.no], [x.axis.yes, x.axis.partly, x.axis.no]);
    assert.equal(c.headline, PATTERN_BY_ID[c.id].headline);
    eq(c.sentences.map(s => s.text), splitSentences(PATTERN_BY_ID[c.id].text.detail));
    eq(c.scenes.map(s => s.text), PATTERN_BY_ID[c.id].text.scenes);
  }
  const s18 = cs.cards.find(c => c.id === "S18");
  eq([s18.n, s18.mean, s18.sentences[1].marks, s18.sentences[1].by], [2, 2, 2, ["ab12", "mi"]]);
  assert.ok(cs.cards.every((c, i, a) => !i || (a[i - 1].mean ?? 99) <= (c.mean ?? 99)), "当てはまり度の低い順");
});
test("カード評価：自由記述（足りない特徴・ひとこと）は空を除いてすべて", () => {
  const cs = cardSummary(model.used);
  const raw = model.used.flatMap(s => ["missing", "free"].filter(k => (s.payload.fb[k] || "").trim()).map(k => [s.code, k, s.payload.fb[k].trim()]));
  eq(cs.texts.map(t => [t.code, t.kind, t.text]), raw);
  assert.ok(raw.length >= 5);
});
test("違う印の番号の基準：0 があれば0始まり、文の数ちょうどの番号があれば1始まり。なければ0始まり", () => {
  const detail = splitSentences(PATTERN_BY_ID["S18"].text.detail), n = detail.length;
  const mk = (bad) => parseInput(mkText({ fb: { cards: [["S18", 3, bad, ["", ""], ""]] } })).sessions;
  assert.equal(detectSentenceBase(mk([0, 2])), 0);
  assert.equal(detectSentenceBase(mk([n])), 1);
  assert.equal(detectSentenceBase(mk([2])), 0);
  const c1 = cardSummary(mk([n]));
  assert.equal(c1.cards[0].sentences[n - 1].marks, 1); assert.equal(c1.base, 1);
});
test("カード評価：知らない id・未回答（評価0）・欠けた項目でも落ちない", () => {
  const cs = cardSummary(parseInput(mkText({ fb: { cards: [["ZZ99", 0, [], ["", ""], ""], ["S18", 0, [9], [], ""], "でたらめ", []] } })).sessions);
  eq(cs.cards.map(c => [c.id, c.known, c.mean]).sort(), [["S18", true, null], ["ZZ99", false, null]]);
});

// ---------------------------------------------------------------- 6. 設問ごとの表
test("設問の表：表示回数（最後に見せた設問＋差し替え前の設問）を rec から数えた値と比べる", () => {
  const t = itemTable(model.used);
  const shown = {}, swapped = {}, skips = {}, answered = {}, firstPick = {}, secondPick = {}, flags = {};
  const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  for (const s of model.used) for (const r of s.payload.rec) {
    inc(shown, r[1]); if (r[2] === "K") inc(skips, r[1]); else inc(answered, r[1]);
    for (const f of String(r[9]).split("+").filter(Boolean)) inc(flags, `${r[1]}:${f}`);
    for (const [id, f] of r[10] || []) { inc(shown, id); inc(swapped, id); for (const g of String(f).split("+").filter(Boolean)) inc(flags, `${id}:${g}`); }
    const q = ITEM3[r[1]];
    if (r[2] !== "K") {
      const first = q.kind === "W" ? DOMAINS[q.domain].a : q.left;
      if (TI[r[5]] === first) inc(firstPick, r[1]); else inc(secondPick, r[1]);
    }
  }
  eq(t.items.filter(x => x.shown).map(x => x.id).sort(), Object.keys(shown).sort());
  for (const x of t.items.filter(x => x.shown)) {
    assert.equal(x.shown, shown[x.id], x.id); assert.equal(x.swappedAway, swapped[x.id] || 0, x.id); assert.equal(x.skips, skips[x.id] || 0, x.id);
    assert.equal(x.answered, answered[x.id] || 0, x.id); assert.equal(x.pickFirst, firstPick[x.id] || 0, x.id); assert.equal(x.pickSecond, secondPick[x.id] || 0, x.id);
    for (const c of ["none", "both", "scene", "words"]) assert.equal(x.flags[c], flags[`${x.id}:${c}`] || 0, `${x.id} ${c}`);
  }
});
test("設問の表：W 48＋対決由来24、X 56組すべてを持てる（未出題も含める指定）。文は設問バンクどおり", () => {
  const t = itemTable(model.used, { includeUnseen: true });
  assert.equal(t.items.length, 72 + 56);
  eq([t.items.filter(x => x.kind === "W").length, t.items.filter(x => x.kind === "X").length], [72, 56]);
  const w = t.items.find(x => x.id === "W4-2"), x = t.items.find(x => x.id === "X2-5");
  eq([w.stem, w.textFirst, w.textSecond, w.first.trait, w.second.trait], [ITEM3["W4-2"].stem, ITEM3["W4-2"].a, ITEM3["W4-2"].b, DOMAINS[4].a, DOMAINS[4].b]);
  eq([x.textFirst, x.textSecond, x.first.trait, x.second.trait], [ITEM3["X2-5"].leftText, ITEM3["X2-5"].rightText, ITEM3["X2-5"].left, ITEM3["X2-5"].right]);
  assert.ok(t.items.some(i => /^Q7\d[ab]$/.test(i.id)) && t.items.some(i => /^D\dx$/.test(i.id)), "5択の対決由来");
  assert.ok(itemTable(model.used).items.every(i => i.shown > 0), "既定では出題された設問だけ");
  eq(t.items.slice(0, 3).map(i => i.id), ["W1-1", "W1-2", "W1-3"]);
});
test("設問の表：回答時間（ds→秒）の平均・最大・中央値。最後に見せた設問の分の枠の時間", () => {
  const t = itemTable(model.used);
  const times = {};
  for (const s of model.used) for (const r of s.payload.rec) if (r[7] > 0) (times[r[1]] ||= []).push(r[7] / 10);
  for (const x of t.items.filter(x => x.shown)) {
    const v = times[x.id] || [];
    assert.equal(x.timeN, v.length);
    if (v.length) { near(x.timeMean, v.reduce((a, b) => a + b, 0) / v.length); assert.equal(x.timeMax, Math.max(...v)); near(x.timeMedian, median(v)); } else assert.equal(x.timeMean, null);
  }
  near(t.overallMedian, median(Object.values(times).flat()));
});
test("設問の表：振り返りの理由（hard）の件数。ok は迷いに数えない", () => {
  const t = itemTable(model.used);
  const raw = {};
  for (const s of model.used) for (const [id, r] of s.payload.fb.hard) { (raw[id] ||= {})[r] = (raw[id]?.[r] || 0) + 1; }
  for (const [id, m] of Object.entries(raw)) {
    const x = t.items.find(i => i.id === id);
    for (const c of ["none", "both", "scene", "words", "ok"]) assert.equal(x.hard[c], m[c] || 0, `${id} ${c}`);
    assert.equal(x.hardNonOkPeople, Object.entries(m).filter(([c]) => c !== "ok").reduce((n, [, k]) => n + k, 0));
  }
});
test("設問の表：知らない設問 id でも行を作る。reason が空の hard は数えない", () => {
  const t = itemTable(parseInput(mkText({ rec: [["k", "ZZ1", "L", 0, 1, 0, 0, 30, "s", "scene"]], fb: { hard: [["ZZ1", ""], ["ZZ1", "words"], "x"] } })).sessions);
  const x = t.items.find(i => i.id === "ZZ1");
  eq([x.known, x.shown, x.flags.scene, x.hard.words, x.hardTotal], [false, 1, 1, 1, 1]);
});

// ---------------------------------------------------------------- 7. 見直し候補
const hasReview = (type, ref, re) => model.review.some(r => r.type === type && r.ref === ref && (!re || r.reasons.some(x => re.test(x))));
test("見直し候補：仕込んだ問題（一言・差し替え・迷い・全員同じ側・回答時間・領域・低評価・違う印）が見つかる", () => {
  assert.ok(hasReview("item", "W4-2", /一言 3人/) && hasReview("item", "W4-2", /差し替え 3人/) && hasReview("item", "W4-2", /振り返りで迷った/));
  assert.ok(hasReview("item", "W5-2", /一言 2人（場面2）/));
  assert.ok(hasReview("item", "W3-3", /一言 2人/));
  assert.ok(hasReview("item", "X2-5", /一言 3人/));
  assert.ok(hasReview("item", "W2-1", /全員が同じ側（B側 5\/5）/));
  assert.ok(hasReview("item", "W6-3", /回答時間の中央値/) && hasReview("item", "X4-7", /回答時間/));
  assert.ok(hasReview("domain", "7", /両方が診断と食い違った人 2人/));
  assert.ok(hasReview("pattern", "S18", /平均 2\.0（n=2）/));
  assert.ok(hasReview("sentence", "S18#2", /違う」の印 2人（ab12、mi）/));
  assert.ok(!hasReview("item", "W1-1"), "反応のない設問は候補にならない");
});
test("見直し候補：しきい値は aggregate.js の REVIEW にまとまっている", () => {
  eq(Object.keys(REVIEW).sort(), ["cardMeanBelow", "cardMinRated", "domainBothMismatchPeople", "flagPeople", "hardNonOkPeople", "oneSidedMinN", "sentenceMarkPeople", "swapPeople", "timeMinN", "timeRatio"]);
});
test("見直し候補の規則（手作りの小さな標本）：一言2人・差し替え2人・迷い2人から。1人では出ない", () => {
  const person = (code, o = {}) => mkText({ code, rec: [["WB-1-1", "W1-1", "L", 0, 1, 0, o.sw ? 1 : 0, 50, "s", o.flags || "", ...(o.sw ? [[["W1-5", ""]]] : [])]], fb: { hard: o.hard || [] } });
  const run = (...ps) => analyze(ps.join("\n")).items.items.find(x => x.id === "W1-1").reasons.map(r => r.code);
  eq(run(person("a", { flags: "scene" }), person("b")), []);
  eq(run(person("a", { flags: "scene" }), person("b", { flags: "words+both" })), ["flag"]);
  const swapReasons = (...ps) => analyze(ps.join("\n")).items.items.find(x => x.id === "W1-5").reasons.map(r => r.code);   // 差し替えられた設問は W1-5
  eq(swapReasons(person("a", { sw: 1 }), person("b")), []);
  eq(swapReasons(person("a", { sw: 1 }), person("b", { sw: 1 })), ["swap"]);
  eq(run(person("a", { hard: [["W1-1", "words"]] }), person("b", { hard: [["W1-1", "ok"]] })), []);
  eq(run(person("a", { hard: [["W1-1", "words"]] }), person("b", { hard: [["W1-1", "scene"]] })), ["hard"]);
  // 同じ人の一言は何度付けても1人
  eq(run(person("a", { flags: "scene+words+none" })), []);
});
test("見直し候補の規則：全員が同じ側は W で n≥4 から（3人では出ない）。X には適用しない", () => {
  const rec = (pk, lt, rt, id = "W1-1") => [["k", id, pk === lt ? "L" : "R", lt, rt, pk, 0, 50, "s", ""]];
  const group = (n, picks, mk = rec) => analyze(Array.from({ length: n }, (_, i) => mkText({ code: `p${i}`, rec: mk(picks[i % picks.length], 0, 1) })).join("\n")).items.items.find(x => x.id === "W1-1").reasons.map(r => r.code);
  eq(group(3, [0]), []);
  eq(group(4, [0]), ["oneside"]);
  eq(group(4, [1]), ["oneside"]);
  eq(group(4, [0, 1]), []);
  eq(group(5, [0, 0, 0, 0, 1]), []);
  const x = analyze(Array.from({ length: 5 }, (_, i) => mkText({ code: `p${i}`, rec: [["k", "X1-1", "L", 0, 8, 0, 0, 50, "s", ""]] })).join("\n")).items.items.find(i => i.id === "X1-1");
  eq(x.reasons.map(r => r.code), []);
});
test("見直し候補の規則：回答時間の中央値が全体の2倍超、標本3以上から", () => {
  const person = (code, ds) => mkText({ code, rec: [["a", "W1-1", "L", 0, 1, 0, 0, ds, "s", ""], ["b", "W2-1", "L", 3, 2, 3, 0, 50, "s", ""], ["c", "W3-1", "L", 4, 5, 4, 0, 50, "s", ""]] });
  const slow = (ds, n) => analyze(Array.from({ length: n }, (_, i) => person(`p${i}`, ds)).join("\n")).items.items.find(x => x.id === "W1-1").reasons.map(r => r.code);
  eq(slow(200, 3), ["time"]);   // 20秒 > 5秒×2
  eq(slow(200, 2), []);         // 標本が足りない
  eq(slow(100, 3), []);         // ちょうど2倍は超えていない
});
test("見直し候補の規則：当てはまり度の平均3未満（1人から）、違う印は2人から", () => {
  const person = (code, r, bad) => mkText({ code, fb: { cards: [["S18", r, bad, ["", ""], ""]] } });
  const rv = (...ps) => analyze(ps.join("\n")).review.map(r => `${r.type}:${r.ref}`);
  eq(rv(person("a", 3, [1])), []);
  eq(rv(person("a", 2, [1])), ["pattern:S18"]);
  eq(rv(person("a", 4, [1]), person("b", 4, [1])), ["sentence:S18#2"]);
  eq(rv(person("a", 0, []), person("b", 0, [])), [], "未回答は評価に入れない");
});
test("再検査を含める指定にしても、同じ人は1人と数える（一言の人数など）", () => {
  const a = mkText({ code: "a", rec: [["WB-1-1", "W1-1", "L", 0, 1, 0, 0, 50, "s", "scene"]] });
  const a2 = mkText({ code: "a", ts: "2026-10-12T10:00:00+09:00", rec: [["WB-1-1", "W1-1", "L", 0, 1, 0, 0, 50, "s", "scene"]] });
  const m = analyze([a, a2].join("\n"), { includeRetests: true });
  const x = m.items.items.find(i => i.id === "W1-1");
  eq([x.shown, x.flags.scene, x.flagPeople, x.reasons.length], [2, 2, 1, 0]);
});

// ---------------------------------------------------------------- 再検査
test("再検査の比較：状態・優勢の側・採用パターン・level・同じ設問での同じ選択", () => {
  const rc = model.retests;
  assert.equal(rc.length, 1);
  const r = rc[0], a = bySession("kenji", 0), b = bySession("kenji", 1);
  assert.equal(r.code, "kenji"); assert.equal(r.gapDays, 7);
  let same = 0, total = 0;
  for (let d = 1; d <= 8; d++) { const x = a.payload.res.states[d], y = b.payload.res.states[d]; if (x != null && y != null) { total++; if (x === y) same++; } }
  eq([r.states.same, r.states.total], [same, total]);
  assert.ok(r.states.sameSide >= r.states.same);
  const A = new Set(a.payload.res.chosen.map(c => c[0])), B = new Set(b.payload.res.chosen.map(c => c[0]));
  eq([r.chosen.inter, r.chosen.union], [[...A].filter(x => B.has(x)).length, new Set([...A, ...B]).size]);
  const pa = new Map(a.payload.rec.filter(x => x[2] !== "K").map(x => [x[1], x[5]])), pb = new Map(b.payload.rec.filter(x => x[2] !== "K").map(x => [x[1], x[5]]));
  let common = 0, agree = 0; for (const [id, pk] of pa) if (pb.has(id)) { common++; if (pb.get(id) === pk) agree++; }
  eq([r.items.common, r.items.agree], [common, agree]);
  near(r.lvDiff, a.payload.res.lv.reduce((s, v, i) => s + Math.abs(v - b.payload.res.lv[i]), 0) / 16);
  eq(retestComparisons([]), []);
});

// ---------------------------------------------------------------- 8. 再採点
const FX = buildFixtures();
const fxParsed = parseInput(FX.all);
test("再採点：いまのロジックで作ったサンプルは、rec から再採点しても当時の結果（res）と全員一致（採用・状態・level・W）", () => {
  assert.equal(fxParsed.sessions.length, 6);
  const rs = rescoreAll(fxParsed.sessions);
  eq([rs.same, rs.diff, rs.other], [6, 0, 0]);
  for (const r of rs.rows) { eq(r.now.chosen, r.session.res.chosen); eq(r.now.states, r.session.res.states); eq(r.now.lv, r.session.res.lv); eq(r.now.w, r.session.res.w); }
});
test("再採点：保存してあるサンプルファイルでも動く（エンジンを調整したあとは差分が出うる）", () => {
  const rs = rescoreAll(parsed.sessions);
  assert.equal(rs.rows.length, 6);
  assert.ok(rs.rows.every(r => r.status === "same" || r.status === "diff"));
  if (rs.diff) console.log(`  NOTE サンプルファイルとの差分 ${rs.diff} 人（エンジンの変更の反映。再生成すれば消えます）`);
});
test("再採点：recordsFromRec — lt/rt/pk は traitIndex の添字、kind・domain は設問から、答えずに進む（pk −1）は picked なし", () => {
  const s = parseInput(mkText({ rec: [["WB-2-1", "W2-1", "L", 3, 2, 3, 0, 30, "s", ""], ["XB-1-1", "X1-1", "R", 0, 8, 8, 1, 30, "t", ""], ["x", "W1-1", "K", 0, 1, -1, 2, 30, "s", ""]] })).sessions[0];
  const { records, problems } = recordsFromRec(s.rec);
  eq(problems, []);
  eq(records.map(r => [r.kind, r.domain, r.left, r.right, r.answer, r.picked, r.swaps]), [
    ["W", 2, TI[3], TI[2], "left", TI[3], 0], ["X", null, TI[0], TI[8], "right", TI[8], 1], ["W", 1, TI[0], TI[1], null, null, 2]]);
});
test("再採点：当時の結果と違えば差分を出す（状態・W・level・採用パターン）。並び順と level の丸め（±1）は差にしない", () => {
  const s = fxParsed.sessions[1];
  const now = rescoreSession(s).now;
  const clone = () => JSON.parse(JSON.stringify(s.res));
  const t1 = clone(); t1.chosen.reverse(); t1.lv[0] += 1; t1.lv[1] -= 1;
  assert.equal(diffRes(t1, now).same, true);
  const t2 = clone(); t2.states["3"] = t2.states["3"] === "1" ? "2" : "1";
  const d2 = diffRes(t2, now); eq([d2.same, d2.states.map(x => x.d)], [false, [3]]);
  const t3 = clone(); t3.w[4] = [t3.w[4][0] + 1, t3.w[4][1]];
  eq(diffRes(t3, now).w.map(x => x.d), [5]);
  const t4 = clone(); t4.lv[2] += 5;
  eq(diffRes(t4, now).lv.map(x => x.trait), [TI[2]]);
  const t5 = clone(); t5.chosen[0] = ["S01", "主軸"];
  const d5 = diffRes(t5, now); eq([d5.same, d5.chosen.same], [false, false]);
  // セッションごと差し替えて再採点
  const mutated = { ...s, res: t2 };
  const r = rescoreSession(mutated);
  eq([r.status, r.diff.states.length], ["diff", 1]);
  eq(rescoreSession({ ...s, res: null }).status, "nores");
});
test("再採点：今の設問バンクにない設問は問題として報告して除く。回答が1つもなければ再採点できない", () => {
  const s = parseInput(mkText({ rec: [["a", "ZZ1", "L", 0, 1, 0, 0, 30, "s", ""], ["b", "W1-1", "L", 0, 1, 0, 0, 30, "s", ""]] })).sessions[0];
  const r = rescoreSession(s);
  eq([r.status, r.problems.length, r.now.w[0]], ["nores", 1, [1, 0]]);
  eq(rescoreSession(parseInput(mkText({ rec: [["a", "ZZ1", "L", 0, 1, 0, 0, 30, "s", ""]] })).sessions[0]).status, "error");
  assert.deepEqual(computeRes([]).w, Array(8).fill([0, 0]));
});
test("再採点：参加者側（js/feedback_collect.js）が実際に作る送信テキストを読み、そのまま再採点しても一致する", async () => {
  const mod = await import("../js/feedback_collect.js").catch(() => null);
  if (!mod || !mod.buildPayload || !mod.newFeedback) return;
  const session = new Session3({ adaptive: true });
  let k = 0;
  drive(session, (c) => { k++; return c.kind === "W" ? (k % 5 === 0 ? "swap" : (c.question.left.trait === DOMAINS[c.domain].a ? "left" : "right")) : (k % 3 === 0 ? "right" : "left"); });
  const result = session.result();
  const fb = mod.newFeedback({ code: "real", now: new Date("2026-10-09T12:00:00+09:00") });
  fb.activeMs = 600000; fb.back = 2;
  result.records.forEach((r, i) => { fb.slots[r.key] = { ds: 40 + i, inp: ["s", "t", "k"][i % 3] }; });
  result.records.filter(r => r.swaps).forEach(r => { fb.flags[r.key] = { [r.shown[0]]: ["scene"] }; });
  for (let d = 1; d <= 8; d++) { fb.self[d] = d % 2 ? "A" : "depends"; fb.act[d] = d % 3 ? "B" : "na"; }
  fb.blind = { decoy: "P2", top: [], order: "own-first", pick: "own" };
  const ids = mod.chosenByRole(result.select.chosen).map(([id]) => id);
  fb.cards = Object.fromEntries(ids.map((id, i) => [id, { r: 3 + (i % 3), ng: [1, 0], sc: ["y", "n"], main: "partly" }]));
  fb.hardList = result.records.slice(0, 3).map(r => r.itemId); fb.hard = { [fb.hardList[0]]: "words" };
  fb.time = "ok"; fb.swipe = 4; fb.missing = "足りない"; fb.free = "ひとこと";
  const { text, payload } = mod.buildText({ session, result, fb, ua: "m" });
  const p = parseInput(text);
  eq([p.errors.length, p.sessions.length], [0, 1]);
  const s = p.sessions[0];
  eq([s.code, s.n, s.mode, s.swaps], ["real", payload.rec.length, "a", result.records.reduce((n, r) => n + r.swaps, 0)]);
  const r = rescoreSession(s);
  eq(r.status, "same", JSON.stringify(r.diff));
  eq(r.now, payload.res);
  const m = analyzeParsed(p);
  eq(m.cards.cards.map(c => c.id).sort(), [...ids].sort());
  assert.ok(m.cards.cards.every(c => c.sentences[0].marks === 1 && c.sentences[1].marks === 1), "違う印（0始まりの番号）が文に付く");
  eq(m.blind.rows.map(x => x.pick), ["own"]); eq(m.items.items.find(i => i.id === fb.hardList[0]).hard.words, 1);
});

// ---------------------------------------------------------------- 9. 出力
test("CSV：セルの引用符・改行・カンマ・数値・空。式として実行される先頭文字（= + - @）には ' を付ける", () => {
  eq(["a", 'b"c', "d,e", "f\ng", null, undefined, 3, 0.5, NaN, true].map(csvCell), ["a", '"b""c"', '"d,e"', '"f\ng"', "", "", "3", "0.5", "", "TRUE"]);
  eq(["=1+1", "+1", "-1", "@SUM", "ふつう", "a=b"].map(csvCell), ["'=1+1", "'+1", "'-1", "'@SUM", "ふつう", "a=b"]);
  assert.equal(csvCell(-1), "-1", "数値の負号はそのまま");
  assert.equal(toCsv([["a", "b"], [1, "x,y"]]), 'a,b\r\n1,"x,y"\r\n');
  assert.equal(CSV_BOM, "﻿");
});
// 簡易 CSV 読み取り（引用符つき）
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += c;
  }
  return rows;
}
test("参加者CSV：ヘッダーと全行の列数が同じ。1行＝1セッション（再検査も含み、集計対象は列で示す）。値が集計と一致", () => {
  const rows = participantCsvRows(model);
  assert.equal(rows.length, 1 + 6);
  assert.ok(rows.every(r => r.length === rows[0].length), "列数");
  const csv = parseCsv(toCsv(rows));
  eq(csv.length, 7); assert.ok(csv.every(r => r.length === rows[0].length));
  const col = (name) => csv[0].indexOf(name);
  const get = (code, i, name) => csv.filter(r => r[0] === code)[i][col(name)];
  eq(csv.slice(1).map(r => r[0]), ["ab12", "kenji", "mi", "tora", "sora", "kenji"]);
  assert.equal(get("ab12", 0, "左を選んだ割合"), "1"); assert.equal(get("ab12", 0, "左率の警告"), "警告");
  assert.equal(get("kenji", 0, "集計対象"), "○"); assert.equal(get("kenji", 1, "集計対象"), "×"); assert.equal(get("kenji", 1, "検査回"), "2");
  assert.equal(get("tora", 0, "回答数"), "64"); assert.equal(get("tora", 0, "モード"), "固定64");
  assert.equal(get("mi", 0, "領域1_状態"), String(bySession("mi").payload.res.states[1] ?? ""));
  assert.equal(get("sora", 0, "領域7_self照合"), model.domain.rows.find(r => r.session.code === "sora").cells[6].selfRes === "match" ? "一致" : "不一致");
  assert.equal(get("kenji", 0, "足りない特徴"), bySession("kenji").payload.fb.missing);
  assert.equal(get("ab12", 0, "ブラインド選択"), bySession("ab12").payload.fb.blind.pick);
});
test("設問CSV：出題された設問ごとに1行。列数がそろい、見直し理由と文が入る", () => {
  const rows = itemCsvRows(model);
  assert.ok(rows.every(r => r.length === rows[0].length));
  const csv = parseCsv(toCsv(rows));
  assert.equal(csv.length, rows.length);
  const w42 = csv.find(r => r[0] === "W4-2");
  assert.equal(w42[csv[0].indexOf("場面文")], ITEM3["W4-2"].stem);
  assert.equal(w42[csv[0].indexOf("差し替えられた回数")], "3");
  assert.match(w42[csv[0].indexOf("見直し理由")], /差し替え 3人/);
  assert.equal(rows.length - 1, itemTable(model.used).items.length);
});
test("参加者CSV：自由記述が式のように見えても、そのまま式にならない（= で始まる）", () => {
  const m = analyze(mkText({ fb: { free: "=HYPERLINK(\"http://x\")", missing: "-2+3" } }));
  const row = toCsv(participantCsvRows(m)).split("\r\n")[1];
  assert.ok(row.includes("'=HYPERLINK") && row.includes("'-2+3"));
});
test("Claude に貼る用 Markdown：2〜7の見出し、参加者・設問文・パターンの文・見直し候補の引用が入る。undefined や NaN が出ない", () => {
  const md = buildMarkdown(model, { rescore: rescoreAll(parsed.sessions) });
  for (const h of ["## 読み方", "## 2. 参加者", "## 3. 領域ごとの照合", "## 4. ブラインド比較", "## 5. カード評価", "## 6. 設問ごと", "## 7. 見直し候補", "## 9. 自由記述"]) assert.ok(md.includes(h), h);
  for (const s of model.used) assert.ok(md.includes(`| ${s.code}`) || md.includes(s.code), s.code);
  assert.ok(md.includes(`「${ITEM3["W4-2"].stem}」`) && md.includes(ITEM3["W4-2"].a) && md.includes(ITEM3["W4-2"].b), "W の設問文");
  assert.ok(md.includes(ITEM3["X2-5"].leftText) && md.includes(ITEM3["X2-5"].rightText), "X の2つの行動文");
  const s18 = splitSentences(PATTERN_BY_ID.S18.text.detail)[1];
  assert.ok(md.includes(`「${s18}」`), "違う印の文の引用");
  assert.ok(md.includes("W4-2") && /差し替え 3人/.test(md) && /全員が同じ側/.test(md));
  assert.ok(md.includes(PATTERN_BY_ID.S18.headline));
  assert.ok(md.includes("自己評価") && md.includes("再検査の比較"));
  assert.ok(!/undefined|NaN|\[object/.test(md), md.match(/.{20}(undefined|NaN|\[object).{20}/)?.[0]);
  assert.ok(md.includes("読めなかった") && md.includes("hana"), "読めなかった分と誰の分か");
  // 表の区切り文字を含む文でも表が壊れない
  assert.equal(buildMarkdown(analyze(mkText({ fb: { missing: "a|b" } }))).includes("a|b"), true);
});
test("Markdown：差分があれば再採点の節が出る。なければ出ない", () => {
  const s = { ...fxParsed.sessions[0], res: { ...fxParsed.sessions[0].res, states: { ...fxParsed.sessions[0].res.states, 1: "5" } } };
  const rs = rescoreAll([s]);
  assert.equal(rs.diff, 1);
  const m = analyzeParsed({ ...fxParsed, sessions: [s] });
  assert.ok(buildMarkdown(m, { rescore: rs }).includes("## 8. 再採点"));
  assert.ok(!buildMarkdown(model, { rescore: rescoreAll(fxParsed.sessions) }).includes("## 8. 再採点"));
});
test("空の入力・欠けたデータでも、集計もCSVもMarkdownも落ちない", () => {
  for (const text of ["", "ただの雑談", mkText({ rec: [], res: undefined, fb: undefined }), mkText({ fb: "でたらめ", res: 5 })]) {
    const m = analyze(text);
    participantCsvRows(m); itemCsvRows(m); buildMarkdown(m, { rescore: rescoreAll(m.sessions) });
  }
});

for (const [name, fn] of queue) {
  try { await fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 5).join("\n  ")); }
}
console.log(fail ? `${fail} failed, ${pass} passed` : `all admin tests passed (${pass})`);
process.exit(fail ? 1 : 0);
