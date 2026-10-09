// node tools/make_fb_fixtures.mjs
// テスト協力モード（docs/feedback-spec.md）の送信用テキストのサンプルを作り、tests/fixtures/fb_sample_all.txt に書く。
// 集計ページ（admin.html）と tests/admin.test.mjs の入力。乱数は固定シードなので、何度実行しても同じ内容になる。
//
// 参加者5人（Session3 + drive() で本物の質問票を最後まで流す）と、そのまわりの「受け取る側の現実」：
//   ab12   左ばかり（位置バイアス。左率 1.0）          スワイプ中心のスマホ
//   kenji  混ぜた回答（領域ごとに A/B の癖）            PC（キー・タップ）。再検査あり（1週間後に同じコードで）
//   mi     拮抗ばかり（W は a,b,a,b、X は半々）         スマホ。メールの折り返し（72桁ごとに CRLF）で届く
//   tora   B寄り（固定64問）                           スマホ
//   sora   A寄り。差し替えが多い                        スマホ
//   hana   途中で切れて届いた1通（最後の |END が無い）。後ろに別の人の分が続く
//   ab12 の二重送信（同じ code＋ts）
// 見直し候補の自動検出が動くように、次を仕込んである（HOT_* を参照）：
//   W5-2 に「場面」を2人、W3-3 に「言葉」を2人、X2-5 に「どちらも違う」を2人／W4-2 を3人が差し替え／W2-1 は全員が B 側／
//   W6-3 と X4-7 は回答時間が長い／領域7 は self と act の両方が診断と食い違う人が2人／共通のパターンに「違う」2人と低評価
//
// res は参加者側と同じ作り方：chosen=[[id, 役割]]（select3）、states={領域: 状態コード}（domainStates3）、
// lv=16傾向の level を四捨五入した整数（traitIndex 順）、w=[[a,b]×8]。

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { Session3, drive } from "../js/adaptive3.js";
import { QUESTIONS3 } from "../js/data/questions3.js";
import { DOMAINS } from "../js/engine3.js";
import { PATTERN_BY_ID } from "../js/data/patterns.js";
import { EXPECTED5 } from "../js/data/samples3.js";
import { encodeText } from "../js/feedback_format.js";

const TI = QUESTIONS3.traitIndex;
export const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "fb_sample_all.txt");

/** 参加者側（js/feedback_collect.js）と同じ：結果画面の並び（役割順、同じ役割は選ばれた順）で [id, 役割] */
const ROLE_ORDER = { "主軸": 0, "補強": 1, "矛盾": 2, "地（形状）": 3 };
const chosenByRole = (chosen) => chosen.map((hit, i) => ({ hit, i }))
  .sort((x, y) => (ROLE_ORDER[x.hit.role] ?? 9) - (ROLE_ORDER[y.hit.role] ?? 9) || x.i - y.i)
  .map(({ hit }) => [hit.meta.id, hit.role]);

// ---------------------------------------------------------------- 乱数
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const chance = (rng, p) => rng() < p;
const weighted = (rng, pairs) => { let r = rng() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; } return pairs[pairs.length - 1][0]; };

// ---------------------------------------------------------------- 参加者
const PERSONAS = [
  { code: "ab12", ts: "2026-10-09T12:34:56+09:00", ua: "m", mode: "a", style: "left", seed: 101, inp: { s: 0.92, t: 0.08 }, speed: 1.0, swapRate: 0, skipRate: 0, back: 1, swipe: 4, time: "ok",
    missing: "", free: "スワイプで答えるのは楽でした。迷ったときに「問題を変える」が使えるのがよかったです。" },
  { code: "kenji", ts: "2026-10-09T19:05:12+09:00", ua: "d", mode: "a", style: "pA", pA: { 1: 0.9, 2: 0.75, 3: 0.2, 4: 0.5, 5: 0.85, 6: 0.7, 7: 0.3, 8: 0.8 }, seed: 202, inp: { k: 0.6, t: 0.4 }, speed: 1.15, swapRate: 0.05, skipRate: 0.1, back: 3, swipe: 0, time: "long",
    missing: "言い返さずに黙る時間が長いことが書かれていない。落ち着いたら自分から戻る、というところが足りない気がする。", free: "PCだとキーで答えられて速かった。設問は後半になると似た場面が多く感じました。" },
  { code: "mi", ts: "2026-10-10T08:21:40+09:00", ua: "m", mode: "a", style: "tie", seed: 303, inp: { s: 0.55, t: 0.45 }, speed: 0.95, swapRate: 0.03, skipRate: 0.05, back: 0, swipe: 3, time: "ok",
    missing: "", free: "どちらも当てはまる設問が多くて、決めるのに少し時間がかかった。", wrap: 72 },
  { code: "tora", ts: "2026-10-10T21:47:03+09:00", ua: "m", mode: "f", style: "pA", pA: { 1: 0.15, 2: 0.2, 3: 0.1, 4: 0.15, 5: 0.25, 6: 0.15, 7: 0.2, 8: 0.1 }, seed: 404, inp: { s: 0.7, t: 0.3 }, speed: 0.85, swapRate: 0.04, skipRate: 0.1, back: 2, swipe: 5, time: "short",
    missing: "", free: "" },
  { code: "sora", ts: "2026-10-11T07:58:30+09:00", ua: "m", mode: "a", style: "pA", pA: { 1: 0.85, 2: 0.9, 3: 0.8, 4: 0.85, 5: 0.7, 6: 0.9, 7: 0.85, 8: 0.8 }, seed: 505, inp: { s: 0.35, t: 0.6, x: 0.05 }, speed: 1.05, swapRate: 0.1, skipRate: 0.3, back: 4, swipe: 2, time: "long",
    missing: "気持ちを分かってほしい場面もあるのに、理由を説明する側だけが強く出ている印象。", free: "スワイプは途中で誤爆することがあった。" },
];
const RETEST = { code: "kenji", ts: "2026-10-16T20:10:45+09:00", seedOffset: 7000, back: 1, swipe: 0, time: "ok", missing: "", free: "2回目はキーで素早く答えられた。" };
const TRUNCATED = { code: "hana", ts: "2026-10-11T13:15:09+09:00", ua: "m", mode: "a", style: "pA", pA: { 1: 0.6, 2: 0.3, 3: 0.7, 4: 0.4, 5: 0.2, 6: 0.55, 7: 0.7, 8: 0.35 }, seed: 606, inp: { s: 0.8, t: 0.2 }, speed: 1.0, swapRate: 0.03, skipRate: 0, back: 0, swipe: 4, time: "ok", missing: "", free: "" };

// ---------------------------------------------------------------- 仕込み（見直し候補が動くように）
/** 一言を付ける設問：{設問id: {code: "コード+コード"}} */
const HOT_FLAGS = {
  "W5-2": { kenji: "scene", tora: "scene" },
  "W3-3": { sora: "words", mi: "words+both" },
  "X2-5": { ab12: "none", kenji: "none+both" },
  "W8-4": { tora: "both" },
  "X3-2": { mi: "words" },
  "W4-2": { kenji: "scene", tora: "words" },     // 差し替える設問に付けた一言（shown 側に入る）
};
/** 必ず差し替える設問（最初に見せたとき） */
const HOT_SWAP = { "W4-2": ["kenji", "tora", "sora"], "W1-3": ["sora"] };
/** 回答時間の倍率 */
const HOT_TIME = { "W6-3": 4, "X4-7": 3.2 };
/** 全員が B 側を選ぶ W */
const HOT_B_SIDE = new Set(["W2-1"]);
/** 診断の優勢と self・act の両方が食い違うようにする領域（ここでは領域7） */
const HOT_MISMATCH = { kenji: [7], sora: [7] };

// ---------------------------------------------------------------- 回答の流し込み
function simulate(P, { retest = false } = {}) {
  const seedBase = P.seed ?? 0;
  const rng = mulberry32(seedBase + (retest ? RETEST.seedOffset : 0));
  const adaptive = P.mode !== "f";
  const session = new Session3({ adaptive });
  const extra = {};
  let slotNo = 0;
  const sideOf = (c, trait) => c.question.left.trait === trait ? "left" : "right";
  const flagsFor = (id) => {
    const f = HOT_FLAGS[id]?.[P.code];
    if (f != null && (!retest || chance(rng, 0.5))) return f.split("+");
    if (chance(rng, 0.012)) return [pick(rng, ["none", "both", "scene", "words"])];
    return [];
  };
  const answerFor = (c) => {
    const q = c.question, id = q.id;
    if (P.style === "left") return "left";
    if (q.kind === "W") {
      const D = DOMAINS[c.domain];
      if (HOT_B_SIDE.has(id)) return sideOf(c, D.b);
      if (P.style === "tie") return sideOf(c, c.n % 2 === 1 ? D.a : D.b);
      return sideOf(c, chance(rng, P.pA[c.domain]) ? D.a : D.b);
    }
    if (P.style === "tie") return chance(rng, 0.5) ? "left" : "right";
    const dom = (t) => Object.values(DOMAINS).findIndex(D => D.a === t || D.b === t) + 1;
    const strength = (t) => { const d = dom(t), D = DOMAINS[d]; return t === D.a ? P.pA[d] : 1 - P.pA[d]; };
    const pLeft = Math.min(0.95, Math.max(0.05, 0.5 + (strength(q.left.trait) - strength(q.right.trait)) * 0.9));
    return chance(rng, pLeft) ? "left" : "right";
  };
  const timeFor = (c, flagged) => {
    const base = c.kind === "W" ? 105 : 72;
    let ds = base * P.speed * Math.exp(0.38 * gauss(rng)) * (HOT_TIME[c.question.id] ?? 1) * (slotNo < 3 ? 1.8 : 1) * (flagged ? 1.3 : 1);
    if (chance(rng, 0.02)) ds *= 3;   // たまに席を外す
    return Math.max(8, Math.round(ds));
  };
  const inputFor = () => weighted(rng, Object.entries(P.inp).map(([k, w]) => [k, w]).concat(chance(rng, 0.01) ? [["x", 5]] : []));

  drive(session, (c) => {
    slotNo++;
    const id = c.question.id;
    const ex = (extra[c.key] ||= { shown: [] });
    const flags = flagsFor(id);
    const hotSwap = c.swapsUsed === 0 && (HOT_SWAP[id] || []).includes(P.code);
    if (c.canSwap && (hotSwap || chance(rng, P.swapRate))) { ex.shown.push([id, flags.join("+")]); return "swap"; }
    ex.flags = flags.join("+");
    ex.ds = timeFor(c, flags.length > 0);
    ex.inp = inputFor();
    if (!c.canSwap && chance(rng, P.skipRate * (c.swapsUsed > 0 ? 1 : 0.3))) return "skip";
    return answerFor(c);
  });

  const records = session.records();
  const rec = records.map(r => {
    const ex = extra[r.key];
    const row = [r.key, r.itemId, r.answer === "left" ? "L" : r.answer === "right" ? "R" : "K", TI.indexOf(r.left), TI.indexOf(r.right), r.picked ? TI.indexOf(r.picked) : -1, r.swaps, ex.ds, ex.inp, ex.flags];
    if (r.swaps > 0) row.push(ex.shown);
    return row;
  });
  const result = session.result();
  const res = {
    chosen: chosenByRole(result.select.chosen),
    states: Object.fromEntries(Object.keys(DOMAINS).map(d => [d, result.states[d].state])),
    lv: TI.map(t => Math.round(result.levels[t])),
    w: Object.keys(DOMAINS).map(d => [result.w[d].a, result.w[d].b]),
  };
  const dur = Math.round(rec.reduce((s, r) => s + r[7], 0) / 10 + rec.reduce((s, r) => s + r[6], 0) * 6 + (P.back || 0) * 4 + 25);
  return { rng, rec, res, dur, nSwaps: rec.reduce((s, r) => s + r[6], 0) };
}

// ---------------------------------------------------------------- フィードバック（パート1〜3）
const sideClass = (state) => ({ "1": "A", "2": "A", "1w": "A", "3": "B", "4": "B", "3w": "B", "5": "both", "6": "neither", "7": "depends" })[state] ?? null;
const opposite = (x) => x === "A" ? "B" : "A";
const SENTENCES = (id) => String(PATTERN_BY_ID[id]?.text?.detail || "").split("。").map(x => x.trim()).filter(Boolean).map(x => x + "。");

function buildFb(P, sim, plan, { retest = false } = {}) {
  const rng = sim.rng;
  const { res, rec } = sim;
  const plantedDomains = (HOT_MISMATCH[P.code] || []);
  const self = {}, act = {};
  for (const d of Object.keys(DOMAINS)) {
    const cls = sideClass(res.states[d]);
    const planted = plantedDomains.includes(+d) && !retest;
    if (cls === "A" || cls === "B") {
      self[d] = planted ? opposite(cls) : weighted(rng, [[cls, 0.72], [opposite(cls), 0.1], ["depends", 0.12], ["both", 0.06]]);
      act[d] = planted ? opposite(cls) : weighted(rng, [[cls, 0.7], [opposite(cls), 0.17], ["na", 0.13]]);
    } else {
      self[d] = cls && chance(rng, 0.7) ? cls : pick(rng, ["A", "B", "depends"]);
      act[d] = weighted(rng, [["A", 0.4], ["B", 0.4], ["na", 0.2]]);
    }
  }
  // ブラインド：自分の上位3本（地を除く）と重なりが最も少ない P1〜P5
  const own3 = res.chosen.filter(c => c[1] !== "地（形状）").slice(0, 3).map(c => c[0]);
  let decoy = "P1", best = 99;
  for (const [k, list] of Object.entries(EXPECTED5)) {
    if (!/^P\d$/.test(k)) continue;
    const ids = list.filter(x => x[1] !== "地（形状）").slice(0, 3).map(x => x[0]);
    const ov = ids.filter(x => own3.includes(x)).length;
    if (ov < best) { best = ov; decoy = k; }
  }
  const blind = { pick: chance(rng, P.style === "left" ? 0.4 : 0.8) ? "own" : "decoy", decoy, order: chance(rng, 0.5) ? "own-first" : "decoy-first" };
  // カード
  const cards = res.chosen.map(([id, role]) => {
    const sents = SENTENCES(id);
    const planted = plan.cards[id]?.[P.code];
    let rating = weighted(rng, [[5, 0.25], [4, 0.4], [3, 0.2], [2, 0.1], [1, 0.05]]);
    const bad = [];
    if (planted) { rating = planted.rating; bad.push(...planted.bad); }
    else if (sents.length && chance(rng, 0.2)) bad.push(Math.floor(rng() * sents.length));
    const scenes = [0, 1].map(() => weighted(rng, [["y", 0.7], ["n", 0.2], ["", 0.1]]));
    const axis = role === "主軸" ? weighted(rng, [["yes", 0.55], ["partly", 0.35], ["no", 0.1]]) : "";
    return [id, rating, bad, scenes, axis];
  });
  // 迷った設問：一言を付けた → 差し替えた → 回答時間が長い、の順に最大6問
  const flagged = [], swapped = [], slow = [];
  for (const r of rec) {
    const fl = String(r[9] || "").split("+").filter(Boolean);
    if (fl.length) flagged.push([r[1], pick(rng, fl)]);
    for (const [id, f] of r[10] || []) { const ff = String(f || "").split("+").filter(Boolean); if (ff.length) flagged.push([id, pick(rng, ff)]); else swapped.push([id, pick(rng, ["none", "both", "scene", "words"])]); }
    if (!r[6]) slow.push([r[1], r[7]]);
  }
  slow.sort((x, y) => y[1] - x[1]);
  const seen = new Set(), hard = [];
  for (const [id, reason] of [...flagged, ...swapped, ...slow.slice(0, 4).map(([id]) => [id, weighted(rng, [["ok", 0.6], ["words", 0.2], ["both", 0.2]])])]) {
    if (seen.has(id) || hard.length >= 6) continue;
    seen.add(id); hard.push([id, reason]);
  }
  return { self, act, blind, cards, missing: retest ? RETEST.missing : P.missing, hard, time: retest ? RETEST.time : P.time, swipe: retest ? RETEST.swipe : P.swipe, free: retest ? RETEST.free : P.free };
}

// ---------------------------------------------------------------- 送信用テキスト
function buildText(P, sim, fb, { app = QUESTIONS3.version } = {}) {
  const payload = { v: 1, app, code: P.code, ts: P.ts, mode: P.mode, dur: sim.dur, back: P.back, ua: P.ua, rec: sim.rec, res: sim.res, fb };
  const main = sim.res.chosen.find(c => c[1] === "主軸");
  const lines = [
    `【16次元診断 テスト協力】コード: ${P.code} ／ ${P.ts.slice(0, 10)} ／ 回答 ${sim.rec.length}問 ／ ${Math.round(sim.dur / 60)}分`,
    `主軸: ${main ? `${main[0]}「${PATTERN_BY_ID[main[0]]?.headline || ""}」` : "なし"} ほか ${sim.res.chosen.length - 1}本`,
  ];
  return { payload, text: encodeText(payload, lines), lines };
}

/** メールの自動折り返し：機械用の行を n 文字ごとに CRLF で折る */
function hardWrap(text, n) {
  return text.split("\n").map(line => line.length <= n ? line : (line.match(new RegExp(`[\\s\\S]{1,${n}}`, "g")) || [line]).join("\r\n")).join("\n");
}

/** 途中で切れた：機械用の行の 55% あたりで終わる */
function truncate(text) {
  const i = text.lastIndexOf("\n") + 1, line = text.slice(i);
  return text.slice(0, i) + line.slice(0, Math.floor(line.length * 0.55));
}

// ---------------------------------------------------------------- 全体
export function buildFixtures() {
  // 1回目：全員を流し、共通のパターンを探して「違う」と低評価を仕込む
  const sims = PERSONAS.map(P => ({ P, sim: simulate(P) }));
  const retestSim = simulate({ ...PERSONAS[1], ...RETEST, seed: PERSONAS[1].seed }, { retest: true });
  const truncSim = simulate(TRUNCATED);
  const count = {};
  for (const { P, sim } of sims) for (const [id] of sim.res.chosen) (count[id] ||= []).push(P.code);
  const plan = { cards: {} };
  const shared = Object.entries(count).filter(([, who]) => who.length >= 2).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  shared.forEach(([id, who], i) => {
    if (i === 0) for (const w of who.slice(0, 2)) (plan.cards[id] ||= {})[w] = { rating: 2, bad: [1] };       // 2人が同じ文に「違う」＋低評価
    if (i === 1) (plan.cards[id] ||= {})[who[0]] = { rating: 2, bad: [] };                                      // 低評価だけ
  });
  const solo = Object.entries(count).filter(([, who]) => who.length === 1).sort((a, b) => a[0].localeCompare(b[0]))[0];
  if (solo) (plan.cards[solo[0]] ||= {})[solo[1][0]] = { rating: 1, bad: [0, 2] };

  const people = new Map();
  for (const { P, sim } of sims) {
    const fb = buildFb(P, sim, plan);
    people.set(P.code, { P, sim, fb, ...buildText(P, sim, fb) });
  }
  const retestP = { ...PERSONAS[1], ...RETEST };
  const retestFb = buildFb(retestP, retestSim, plan, { retest: true });
  const retest = { P: retestP, sim: retestSim, fb: retestFb, ...buildText(retestP, retestSim, retestFb) };
  const hanaFb = buildFb(TRUNCATED, truncSim, plan);
  const hana = { P: TRUNCATED, sim: truncSim, fb: hanaFb, ...buildText(TRUNCATED, truncSim, hanaFb) };

  const get = (code) => people.get(code);
  const block = (x, wrap) => (wrap ? hardWrap(x.text, wrap) : x.text);
  const parts = [
    "（LINEの履歴をまとめてコピー）",
    "",
    "[12:41] ab12: おつかれさまです。終わったので送ります",
    block(get("ab12")),
    "",
    "[19:32] kenji: 送ります！ちょっと長かった笑",
    block(get("kenji")),
    "",
    "[08:50] mi: メールで送りますね（スマホのメールから）",
    "件名: テスト協力の結果",
    "",
    block(get("mi"), get("mi").P.wrap),
    "",
    "--",
    "mi",
    "",
    "[13:40] hana: こんにちは。コピーしたつもりだったのですが、うまくできてないかもしれません",
    truncate(hana.text),
    "[13:41] hana: あれ、途中で切れてますか？あとでもう一度送ります",
    "",
    "[22:05] tora: 送ります。固定の64問のほうでやりました",
    block(get("tora")),
    "",
    "[22:20] ab12: 念のため、さっきの分をもう一回送ります",
    block(get("ab12")),
    "",
    "[08:12] sora: 朝に終わりました。送ります",
    block(get("sora")),
    "",
    "[2026-10-16 20:30] kenji: 1週間たったのでもう一回やってみました（同じコードです）",
    block(retest),
    "",
  ];
  return { all: parts.join("\n"), people, retest, hana, plan, sims, personas: PERSONAS };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fx = buildFixtures();
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, fx.all, "utf-8");
  console.log(`wrote ${OUT_PATH} (${fx.all.length} chars)`);
  for (const [code, x] of fx.people) console.log(`  ${code}: ${x.sim.rec.length}問 ${x.sim.dur}秒 swaps=${x.sim.nSwaps} 主軸=${x.sim.res.chosen[0]?.join("/")} 機械行=${x.text.length}字`);
  console.log(`  kenji(再検査): ${fx.retest.sim.rec.length}問`);
  console.log(`  hana(途中で切れた): ${fx.hana.sim.rec.length}問`);
  console.log("  共通パターンの仕込み:", JSON.stringify(fx.plan.cards));
}
