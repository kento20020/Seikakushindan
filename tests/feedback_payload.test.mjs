// node tests/feedback_payload.test.mjs
// テスト協力モードの記録と送信用テキスト（js/feedback_collect.js。仕様：docs/feedback-spec.md §1〜2）
//  - Session3 を最後まで流しながら、UI と同じ手順で時計・入力方法・一言・戻るを記録し、payload → encodeText → decodeAll
//  - JSON v1 のキーと順番、rec のタプル [key, itemId, ans, lt, rt, pk, sw, ds, inp, flags, shown?]、コード、CRC
//  - rec だけから scoreRecords3 で再採点すると res.lv・res.w が再現できる
//  - 時計：裏に回っていた時間は入らない／差し替えたら最後に表示した設問の時間／戻っても全体の時間は続く
//  - 振り返りの自動選択（一言 → 差し替え → 回答時間）、ブラインド比較の相手、文の区切り、要約行、ファイル名、文字数
import assert from "node:assert/strict";
import { createSession3, ITEM3, X_ITEMS, scoreRecords3 } from "../js/adaptive3.js";
import { DOMAINS, TRAITS } from "../js/engine.js";
import { QUESTIONS3 } from "../js/data/questions3.js";
import { PATTERN_BY_ID } from "../js/data/patterns.js";
import { PROFILE_SAMPLES3 } from "../js/data/samples3.js";
import { encodeText, decodeAll, crc32hex } from "../js/feedback_format.js";
import {
  newFeedback, makeClock, recordAction, toggleFlag, flagsOf, buildPayload, buildText, summaryLines, pickHard, pickDecoy, profileChoices,
  topIds, chosenByRole, splitSentences, filenameFor, isoLocal, genCode, normalizeCode, FLAG_CODES, HARD_CODES, SELF_CODES, ACT_CODES, SELF_DESC, ACT_QUESTIONS,
} from "../js/feedback_collect.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}
const TI = QUESTIONS3.traitIndex;
const sideOf = (c, t) => c.question.left.trait === t ? "left" : "right";

/** ラウンド1〜4で各傾向がちょうど2勝2敗になる勝者（tests/adaptive3.test.mjs と同じ。全領域拮抗で96問になる） */
function evenWinners() {
  const adj = {}, winner = {};
  for (let r = 1; r <= 4; r++) QUESTIONS3.xRounds[r - 1].forEach((_, i) => {
    const q = X_ITEMS[`X${r}-${i + 1}`];
    (adj[q.left] ||= []).push({ id: q.id, to: q.right }); (adj[q.right] ||= []).push({ id: q.id, to: q.left });
  });
  for (const start of Object.keys(adj)) {
    const stack = [start];
    while (stack.length) {
      const v = stack[stack.length - 1];
      const e = adj[v].find(x => !winner[x.id]);
      if (e) { winner[e.id] = v; stack.push(e.to); } else stack.pop();
    }
  }
  return winner;
}

/**
 * UI と同じ順で記録しながら最後まで流す（three_store の answer3/swap3/skip3/back3 → onAction3 → feedback.js と同じ処理）。
 * policy(c, i) → { act: "left"|"right"|"swap"|"skip"|"back", ms, hiddenMs?, via?, flags? }
 */
function run(session, fb, policy) {
  let t = 0, i = 0, guard = 0;
  const clock = makeClock(() => t);
  while (!session.isDone()) {
    if (++guard > 2000) throw new Error("終わりません");
    const c = session.current();
    clock.show(fb, c.key, c.question.id);                 // カードが表示された（再描画でも同じカードなら測り続ける）
    const p = policy(c, i);
    for (const f of p.flags || []) toggleFlag(fb, c.key, c.question.id, f);
    t += p.ms || 0;
    if (p.hiddenMs) { clock.pause(); t += p.hiddenMs; clock.show(fb, c.key, c.question.id); t += 1000; }   // 裏に回って、戻ってからさらに1秒
    const before = c;
    let ok;
    if (p.act === "swap") ok = session.swap() || session.skip({ force: true });
    else if (p.act === "skip") ok = session.skip({ force: true });
    else if (p.act === "back") ok = session.back();
    else ok = session.answer(p.act);
    if (!ok) throw new Error("操作できません: " + p.act);
    const type = p.act === "left" || p.act === "right" ? "answer" : p.act;
    const ms = type === "answer" || type === "skip" ? clock.take(fb, before.key, before.question.id) : 0;
    recordAction(fb, { type, before, via: p.via || "t", ms });
    if (type === "answer" || type === "skip") i++;   // i は「何枠目を答えたか」（差し替え・戻るでは進めない）
  }
  clock.pause();
  return { t };
}

function fillFeedback(fb, result, { long = false } = {}) {
  for (const d of Object.keys(DOMAINS)) { fb.self[d] = SELF_CODES[(+d) % 5]; fb.act[d] = ACT_CODES[(+d) % 3]; }
  const d = pickDecoy(result.select.chosen);
  fb.blind = { decoy: d.key, top: d.top, order: "decoy-first", pick: "own" };
  for (const [k, [id]] of chosenByRole(result.select.chosen).entries()) fb.cards[id] = { r: 1 + (k % 5), ng: [2, 0], sc: ["y", k % 2 ? "n" : ""], main: "yes" };
  fb.missing = long ? "怒るとすぐ言葉に出るが、そのあとで自分から謝ることが多い。言い過ぎたと思ったら、その日のうちに連絡する。" : "なし";
  fb.hardList = pickHard(fb, result.records);
  fb.hardList.forEach((id, k) => { fb.hard[id] = HARD_CODES[k % HARD_CODES.length]; });
  fb.time = "ok"; fb.swipe = 4;
  fb.free = long ? "スワイプは慣れると早い。後半の比べる設問は場面が想像しにくいものがあった。所要時間はちょうどよかった。" : "";
}

/** rec から再採点（admin.html と同じ手順：lt/rt/pk → traitIndex、kind/domain → ITEM3） */
function rescore(payload) {
  const records = payload.rec.map(([key, itemId, ans, lt, rt, pk, sw]) => {
    const q = ITEM3[itemId];
    return { key, kind: q.kind, domain: q.kind === "W" ? q.domain : null, left: TI[lt], right: TI[rt],
      answer: ans === "L" ? "left" : ans === "R" ? "right" : null, picked: pk >= 0 ? TI[pk] : null, swaps: sw };
  });
  const sc = scoreRecords3(records);
  return { lv: TI.map(t => Math.round(sc.levels[t])), w: Object.keys(DOMAINS).map(d => [sc.w[d].a, sc.w[d].b]) };
}

function checkStructure(p, session, result) {
  assert.deepEqual(Object.keys(p), ["v", "app", "code", "ts", "mode", "dur", "back", "ua", "rec", "res", "fb"]);
  assert.deepEqual(Object.keys(p.res), ["chosen", "states", "lv", "w"]);
  assert.deepEqual(Object.keys(p.fb), ["self", "act", "blind", "cards", "missing", "hard", "time", "swipe", "free"]);
  assert.deepEqual(Object.keys(p.fb.blind), ["pick", "decoy", "order"]);
  assert.equal(p.v, 1); assert.equal(p.app, QUESTIONS3.version);
  assert.match(p.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.ok(["a", "f"].includes(p.mode)); assert.ok(["m", "d"].includes(p.ua));
  assert.ok(Number.isInteger(p.dur) && Number.isInteger(p.back));
  const recs = session.records();
  assert.equal(p.rec.length, recs.length);
  p.rec.forEach((r, i) => {
    const s = recs[i];
    assert.equal(r.length, s.swaps > 0 ? 11 : 10, `${s.key}: 長さ`);
    const [key, itemId, ans, lt, rt, pk, sw, ds, inp, flags] = r;
    assert.equal(key, s.key); assert.equal(itemId, s.itemId);
    assert.equal(ans, s.answer === "left" ? "L" : s.answer === "right" ? "R" : "K");
    assert.equal(TI[lt], s.left); assert.equal(TI[rt], s.right);
    assert.equal(pk, s.picked ? TI.indexOf(s.picked) : -1);
    if (ans === "L") assert.equal(pk, lt); else if (ans === "R") assert.equal(pk, rt);
    assert.equal(sw, s.swaps);
    assert.ok(Number.isInteger(ds) && ds >= 0);
    assert.ok(["s", "t", "k", "x"].includes(inp));
    assert.equal(typeof flags, "string");
    if (flags) for (const f of flags.split("+")) assert.ok(FLAG_CODES.includes(f), f);
    if (sw > 0) {
      assert.deepEqual(r[10].map(x => x[0]), s.shown.slice(0, -1), `${s.key}: shown は差し替え前の設問（古い順）`);
      for (const [, f] of r[10]) assert.equal(typeof f, "string");
    }
  });
  assert.deepEqual(p.res.chosen, chosenByRole(result.select.chosen));
  assert.deepEqual(Object.keys(p.res.states), Object.keys(DOMAINS));
  for (const d of Object.keys(DOMAINS)) assert.equal(p.res.states[d], result.states[d].state);
  assert.equal(p.res.lv.length, 16); assert.equal(p.res.w.length, 8);
  assert.deepEqual(p.res.lv, TRAITS.map(t => Math.round(result.levels[t])));
  assert.equal(p.fb.cards.length, p.res.chosen.length);
  p.fb.cards.forEach((c, i) => {
    assert.equal(c.length, 5); assert.equal(c[0], p.res.chosen[i][0]);
    assert.ok(Number.isInteger(c[1]) && c[1] >= 0 && c[1] <= 5);
    assert.ok(Array.isArray(c[2]) && c[2].every(Number.isInteger));
    assert.deepEqual(c[2], [...c[2]].sort((a, b) => a - b));
    assert.ok(c[3].length === 2 && c[3].every(x => ["y", "n", ""].includes(x)));
    assert.equal(c[4], p.res.chosen[i][1] === "主軸" ? c[4] : "");
    assert.ok(["yes", "partly", "no", ""].includes(c[4]));
  });
  for (const v of Object.values(p.fb.self)) assert.ok(SELF_CODES.includes(v));
  for (const v of Object.values(p.fb.act)) assert.ok(ACT_CODES.includes(v));
  assert.ok(p.fb.hard.length <= 6 && p.fb.hard.every(([id, c]) => ITEM3[id] && HARD_CODES.includes(c)));
}

// ---------------------------------------------------------------- 1. 96問の通し
const win = evenWinners();
const tieAll = (c) => {
  if (c.kind === "W") { const D = DOMAINS[c.domain]; return sideOf(c, c.n % 2 === 1 ? D.a : D.b); }
  return win[c.question.id] ? sideOf(c, win[c.question.id]) : "left";
};
const full = (() => {
  const session = createSession3();
  const fb = newFeedback({ code: "ab12", now: new Date(2026, 9, 9, 12, 34, 56) });
  let backDone = false;
  const marks = {};
  run(session, fb, (c, i) => {
    const via = "stk"[i % 3];
    const ms = 2000 + (i * 997) % 9000;
    if (i === 2 && !marks.keep) { marks.keep = { key: c.key, itemId: c.question.id }; return { act: tieAll(c), ms, via, flags: ["words", "scene"] }; }
    if (i === 5 && c.swapsUsed === 0 && !marks.swapped) { marks.swapped = { key: c.key, itemId: c.question.id }; return { act: "swap", ms: 4000, via: "s", flags: ["both"] }; }
    if (i === 5) { marks.after = { key: c.key, itemId: c.question.id }; return { act: tieAll(c), ms: 1500, via: "k" }; }
    if (i === 8 && !backDone) { backDone = true; return { act: "back", ms: 500, via: "s" }; }
    if (i === 10) { marks.hidden = c.key; return { act: tieAll(c), ms: 2000, hiddenMs: 60000, via: "t" }; }
    if (i === 20) { marks.slow = c.key; return { act: tieAll(c), ms: 45000, via: "t" }; }
    return { act: tieAll(c), ms, via };
  });
  const result = session.result();
  fillFeedback(fb, result, { long: true });
  return { session, fb, result, marks };
})();

test("96問の通し：全領域拮抗の回答者で W追加16・X追加16（合計96）", () => {
  assert.equal(full.session.records().length, 96);
  assert.equal(full.result.stages.wExtra.length, 16); assert.equal(full.result.stages.xExtra.length, 16);
});

const fullOut = buildText({ session: full.session, result: full.result, fb: full.fb, ua: "m" });
test("JSON v1：キーの順番・rec のタプル・コード（仕様 §2）", () => {
  checkStructure(fullOut.payload, full.session, full.result);
  assert.equal(fullOut.payload.code, "ab12");
  assert.equal(fullOut.payload.ts, "2026-10-09T12:34:56" + fullOut.payload.ts.slice(19));
  assert.equal(fullOut.payload.mode, "a"); assert.equal(fullOut.payload.ua, "m");
  assert.equal(fullOut.payload.back, 1);
});
test("encodeText → decodeAll：CRC が通り、同じ payload に戻る", () => {
  const { items, errors } = decodeAll("前置き\n" + fullOut.text + "\nうしろ");
  assert.equal(errors.length, 0); assert.equal(items.length, 1);
  assert.deepEqual(items[0].payload, fullOut.payload);
  const line = fullOut.text.split("\n").pop();
  const m = line.match(/^16DFB1\|([0-9a-f]{8})\|(.*)\|END$/);
  assert.ok(m); assert.equal(m[1], crc32hex(m[2])); assert.equal(m[2], JSON.stringify(fullOut.payload));
  // メールの自動折り返し（途中に改行）でも読める
  const wrapped = fullOut.text.replace(/(.{70})/g, "$1\r\n");
  assert.deepEqual(decodeAll(wrapped).items[0]?.payload, fullOut.payload);
});
test("rec から scoreRecords3 で再採点すると res.lv と res.w が再現できる", () => {
  const r = rescore(fullOut.payload);
  assert.deepEqual(r.lv, fullOut.payload.res.lv);
  assert.deepEqual(r.w, fullOut.payload.res.w);
});
test("一言：そのとき表示していた設問に付き、差し替え前の設問の一言は shown 側へ", () => {
  const p = fullOut.payload, { keep, swapped, after } = full.marks;
  const rk = p.rec.find(r => r[0] === keep.key);
  assert.equal(rk[1], keep.itemId); assert.equal(rk[9], "scene+words");   // FLAG_CODES の順に "+" で連結
  const rs = p.rec.find(r => r[0] === swapped.key);
  assert.equal(rs[1], after.itemId); assert.equal(rs[6], 1); assert.equal(rs[9], "");
  assert.deepEqual(rs[10], [[swapped.itemId, "both"]]);
  assert.equal(rs[8], "k");   // 最後の操作（回答）の入力方法
  assert.equal(rs[7], 15);    // 時間は差し替えたあとの設問の分だけ（1.5秒）
});
test("回答時間：裏に回っていた60秒は入らない（2秒＋戻ってから1秒）、長考45秒は450", () => {
  const p = fullOut.payload;
  assert.equal(p.rec.find(r => r[0] === full.marks.hidden)[7], 30);
  assert.equal(p.rec.find(r => r[0] === full.marks.slow)[7], 450);
  // 全体の所要時間：表示していた時間の合計（裏に回っていた60秒を除く）
  const total = p.rec.reduce((s, r) => s + r[7], 0) / 10;
  // 差は「差し替え前の設問を見ていた4秒」「戻る前に答えた分と戻る操作の0.5秒」「裏から戻ったあとの時間」など（どれも20秒未満）
  assert.ok(p.dur >= Math.floor(total) && p.dur <= total + 20, `dur ${p.dur} / 回答時間の合計 ${total}`);
});
test("入力方法・戻る：s/t/k が記録され、戻るは back に数える", () => {
  const cnt = fullOut.payload.rec.reduce((o, r) => (o[r[8]] = (o[r[8]] || 0) + 1, o), {});
  assert.ok(cnt.s > 0 && cnt.t > 0 && cnt.k > 0, JSON.stringify(cnt));
  assert.ok(!cnt.x);
  assert.equal(full.fb.swipes > 0, true);
});
test("振り返り：一言 → 差し替え → 回答時間の長い順に最大6問", () => {
  const ids = full.fb.hardList;
  assert.equal(ids.length, 6);
  assert.equal(ids[0], full.marks.keep.itemId);
  assert.equal(ids[1], full.marks.swapped.itemId);       // 一言も付けたので2番目（一言を付けた設問の順）
  const slow = full.session.records().find(r => r.key === full.marks.slow);
  assert.equal(ids[2], slow.itemId);                     // 45秒
  assert.deepEqual(fullOut.payload.fb.hard.map(x => x[0]), ids);
});

test(`文字数：96問の通しで ${[...fullOut.text].length} 文字（仕様の目標 4,000 は v1 のタプルでは届かない。rec だけで ${JSON.stringify(fullOut.payload.rec).length}）`, () => {
  const n = [...fullOut.text].length;
  console.log(`     96問: 全体 ${n} 文字（JSON ${JSON.stringify(fullOut.payload).length}・rec ${JSON.stringify(fullOut.payload.rec).length}・res ${JSON.stringify(fullOut.payload.res).length}・fb ${JSON.stringify(fullOut.payload.fb).length}）`);
  // rec の1枠は約42文字（["WB-1-1","W1-1","L",0,1,0,0,34,"s",""],）。96枠で約4,000文字になるので、全体の上限は 5,500 で見る
  assert.ok(n <= 5500, `${n} > 5500`);
});

// ---------------------------------------------------------------- 2. 固定64問
const fixed = (() => {
  const session = createSession3({ adaptive: false });
  const fb = newFeedback({ code: "" , rand: () => 0.5 });
  run(session, fb, (c, i) => ({ act: i % 7 === 3 ? "skip" : i % 2 ? "left" : "right", ms: 3000 + (i % 5) * 1000, via: "t" }));
  const result = session.result();
  fillFeedback(fb, result);
  fb.actSkip = true;
  return { session, fb, result, out: buildText({ session, result, fb, ua: "d" }) };
})();
test(`固定64問：mode "f"、答えずに進むは K と pk -1、${[...fixed.out.text].length} 文字（4,000 以内）`, () => {
  const p = fixed.out.payload;
  checkStructure(p, fixed.session, fixed.result);
  assert.equal(p.mode, "f"); assert.equal(p.rec.length, 64); assert.equal(p.ua, "d");
  const ks = p.rec.filter(r => r[2] === "K");
  assert.ok(ks.length > 0 && ks.every(r => r[5] === -1));
  assert.deepEqual(rescore(p).lv, p.res.lv); assert.deepEqual(rescore(p).w, p.res.w);
  assert.ok([...fixed.out.text].length <= 4000);
  console.log(`     64問: 全体 ${[...fixed.out.text].length} 文字`);
});
test("自動コード：空なら4文字（紛らわしい文字なし）・auto、act をスキップしたら8領域とも na", () => {
  assert.match(fixed.fb.code, /^[a-z2-9]{4}$/); assert.equal(fixed.fb.auto, true); assert.equal(fixed.fb.phase, "code");
  assert.ok(!/[01ilo]/.test(genCode(() => 0.999)));
  assert.deepEqual(fixed.out.payload.fb.act, Object.fromEntries(Object.keys(DOMAINS).map(d => [d, "na"])));
  const f2 = newFeedback({ code: "  けん  たろう " });
  assert.equal(f2.code, "けん たろう"); assert.equal(f2.auto, false); assert.equal(f2.phase, "q");
  assert.equal(normalizeCode(" a\tb "), "a b");
});

// ---------------------------------------------------------------- 3. 部品
test("時計：同じカードの再描画では測り続け、別のカードで測り直す。戻るでも全体の時間は続く", () => {
  let t = 0; const clock = makeClock(() => t);
  const fb = newFeedback({ code: "x" });
  clock.show(fb, "A", "W1-1"); t += 1000;
  clock.show(fb, "A", "W1-1"); t += 500;                 // 再描画
  clock.pause(); t += 9999; clock.show(fb, "A", "W1-1"); t += 500;   // 裏に回った
  clock.show(fb, "A", "W1-5"); t += 700;                 // 差し替え（最後に表示した設問の時間だけ）
  assert.equal(clock.take(fb, "A", "W1-5"), 700);
  assert.equal(fb.activeMs, 2700);
  assert.equal(fb.cur, null);
  t += 300; clock.show(fb, "B", "W2-1"); t += 200;       // 次のカードまでの300msも全体には入る
  clock.pause();
  assert.equal(fb.activeMs, 3200);
  assert.equal(clock.take(fb, "C", "W3-1"), 0);         // 違うカードは0
});
test("一言のトグル：コードの順に並び、空になれば消える", () => {
  const fb = newFeedback({ code: "x" });
  assert.deepEqual(toggleFlag(fb, "K", "W1-1", "words"), ["words"]);
  assert.deepEqual(toggleFlag(fb, "K", "W1-1", "none"), ["none", "words"]);
  assert.deepEqual(toggleFlag(fb, "K", "W1-1", "bogus"), ["none", "words"]);
  toggleFlag(fb, "K", "W1-1", "none"); toggleFlag(fb, "K", "W1-1", "words");
  assert.deepEqual(flagsOf(fb, "K", "W1-1"), []);
  assert.deepEqual(fb.flags, {});
});
test("ブラインド比較：P1〜P5 のうち自分の選択（地を除く）と重なりが最少のもの。上位3本は地を除いた役割順", () => {
  const own = full.result.select.chosen;
  const d = pickDecoy(own);
  const ownIds = new Set(chosenByRole(own).filter(([, r]) => r !== "地（形状）").map(([id]) => id));
  const overlaps = profileChoices().map(p => p.ids.filter(id => ownIds.has(id)).length);
  assert.equal(d.overlap, Math.min(...overlaps));
  assert.ok(PROFILE_SAMPLES3.some(p => p.key === d.key));
  assert.ok(d.top.length >= 2 && d.top.length <= 3 && d.top.every(id => PATTERN_BY_ID[id]));
  assert.ok(topIds(own).length <= 3);
  // P3 自身なら、重なりが最少の別のプロファイルを選ぶ（自分と同じ P3 は選ばない）
  const p3 = profileChoices()[2];
  const fake = p3.ids.map((id, i) => ({ meta: { id }, role: i === 0 ? "主軸" : "補強" }));
  assert.notEqual(pickDecoy(fake).key, "P3");
});
test("詳細説明の文の区切り：「。」で区切り、番号は0始まり", () => {
  assert.deepEqual(splitSentences("一。二？まだ二。三。"), ["一。", "二？まだ二。", "三。"]);
  const t = PATTERN_BY_ID["X12-1"].text.detail;
  assert.equal(splitSentences(t).join(""), t);
  assert.ok(splitSentences(t).length >= 2);
});
test("要約行と送信用テキストの形（仕様 §2）", () => {
  const lines = fullOut.text.split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^【16次元診断 テスト協力】コード: ab12 ／ 2026-10-09 ／ 回答 96問 ／ \d+分$/);
  const main = fullOut.payload.res.chosen.find(([, r]) => r === "主軸");
  assert.equal(lines[1], `主軸: ${main[0]}「${PATTERN_BY_ID[main[0]].headline}」 ほか ${fullOut.payload.res.chosen.length - 1}本`);
  assert.equal(lines[2], "（ここから下の行も消さずに、全部送ってください）");
  assert.deepEqual(summaryLines(fullOut.payload), lines.slice(0, 2));
  assert.equal(fullOut.text, encodeText(fullOut.payload, lines.slice(0, 2)));
});
test("ファイル名 16d-feedback-<code>-<yyyymmdd>.txt", () => {
  assert.equal(filenameFor("ab12", "2026-10-09T12:34:56+09:00"), "16d-feedback-ab12-20261009.txt");
  assert.equal(filenameFor("けん/た ろう", "2026-10-09T00:00:00+09:00"), "16d-feedback-けん_た_ろう-20261009.txt");
});
test("isoLocal はローカル時刻＋時差", () => {
  const d = new Date(2026, 0, 2, 3, 4, 5);
  assert.match(isoLocal(d), /^2026-01-02T03:04:05[+-]\d{2}:\d{2}$/);
});
test("説明文の表（自己評価8領域・行動8問）が揃っている", () => {
  for (const d of Object.keys(DOMAINS)) {
    assert.equal(SELF_DESC[d].a[0], DOMAINS[d].a); assert.equal(SELF_DESC[d].b[0], DOMAINS[d].b);
    assert.ok(ACT_QUESTIONS[d].q && ACT_QUESTIONS[d].a && ACT_QUESTIONS[d].b);
  }
});
test("未回答の項目は空のまま（rating 0・場面 \"\"・主軸 \"\"）", () => {
  const fb = { ...full.fb, cards: {} };
  const p = buildPayload({ session: full.session, result: full.result, fb });
  for (const c of p.fb.cards) { assert.equal(c[1], 0); assert.deepEqual(c[2], []); assert.deepEqual(c[3], ["", ""]); assert.equal(c[4], ""); }
});

console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} feedback_payload tests passed`);
process.exit(fail ? 1 : 0);
