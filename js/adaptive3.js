// 三択版（左／右／問題を変える）の可変質問票。DOM を触らない純粋ロジック（node でテストできる）。仕様：docs/three-choice-logic.md §4〜5
//
//   段階1 W基本 : 32問。領域を順繰りに（W1-1, W2-1, …, W8-1, W1-2, …）。A行動とB行動の左右は枠ごとに入れ替える
//   段階2 X基本 : xRounds のラウンド1〜4の32問（ラウンド順）
//   段階3 W追加 : 左右が拮抗した領域（差<2 または 取り分<0.6）に alt → 対決設問の順で追加。1問ごとに再集計し、
//                 優勢が決まった領域は打ち切る。領域あたり2・全体16まで
//   段階4 X追加 : level が 40〜60、または回答数 m<3 の傾向を含むラウンド5〜6の組。優勢が決まった領域の傾向を優先。
//                 傾向あたり2・全体16まで（これも1問ごとに計画し直す）
//   最大 32＋32＋16＋16＝96問。adaptive=false は段階1・2の64問だけ。
//
// 「問題を変える」：同じ枠の設問を別の設問に差し替える（1枠2回まで）。
//   W：未使用の alt → 対決 Q7x の言い換え（a/b）→ D?x、X：ラウンド7 → 未使用のラウンド5〜6（同じ傾向を含む組）。
//   差し替えを使い切ったら（候補が尽きた場合も）「答えずに進む」。差し替え前の設問と答えなかった枠は集計に入れない。
//
// 採点は回答した枠の「選んだ傾向」だけを見る（左右の位置ではない）。engine3.js の select3 などで判定する。

import { QUESTIONS } from "./data/questions.js";
import { QUESTIONS3 } from "./data/questions3.js";
import { DOMAINS, TRAITS, DOM_OF, duelFromAnswers } from "./engine.js";
import { BASIC_BY_TRAIT } from "./adaptive.js";
import { TH3, wMargin, domainStates3, select3, responseQuality3, confidence3 } from "./engine3.js";

// ---------------------------------------------------------------- 定数
export const STAGES3 = ["W基本", "X基本", "W追加", "X追加"];
export const MAX_SWAPS = 2;
export const W_EXTRA_PER_DOMAIN = 2, W_EXTRA_CAP = 16;
export const X_EXTRA_PER_TRAIT = 2, X_EXTRA_CAP = 16;
export const X_AMBIG_LOW = 40, X_AMBIG_HIGH = 60, X_MIN_M = 3;
export const W_PROMPT = "取りやすいのはどちら？";
export const X_PROMPT = "より自分らしいのはどちら？";
export const SRC_LABEL = { base: "基本", alt: "予備", duel: "対決（5択版）", duel2: "追加対決（5択版）" };

const TI = QUESTIONS3.traitIndex;
if (TI.join() !== TRAITS.join()) throw new Error("questions3.traitIndex と questions.traits の並びが違います");

// ---------------------------------------------------------------- 設問の索引
/** W 設問：{id, kind:"W", domain, src:"base"|"alt"|"duel"|"duel2", k(基本の番号), stem, a(A行動), b(B行動), source?, variant?} */
export const W_ITEMS = {};
export const W_BASE = {};   // 領域 → 基本4問の id
export const W_POOL = {};   // 領域 → 差し替え・追加の候補（alt → Q7x a/b → D?x）
for (const [d, list] of Object.entries(QUESTIONS3.pairs)) {
  W_BASE[d] = []; W_POOL[d] = [];
  for (const p of list) {
    const k = p.kind === "base" ? W_BASE[d].length + 1 : null;
    W_ITEMS[p.id] = { id: p.id, kind: "W", domain: +d, src: p.kind, k, stem: p.stem, a: p.a, b: p.b };
    (p.kind === "base" ? W_BASE[d] : W_POOL[d]).push(p.id);
  }
}
const DUEL_BY_ID = Object.fromEntries(QUESTIONS.duels.map(q => [q.id, q]));
for (const [d, ids] of Object.entries(QUESTIONS3.extraPairSources)) {
  const D = DOMAINS[d];
  for (const sid of ids) {
    const q = DUEL_BY_ID[sid];
    if (!q) throw new Error("対決設問が見つかりません: " + sid);
    const flipped = q.sideA !== D.a;    // sideA が領域の B側なら a/b を入れ替えて A行動／B行動に揃える
    q.variants.forEach((v, vi) => {
      const id = q.variants.length > 1 ? `${sid}${"ab"[vi]}` : sid;
      W_ITEMS[id] = { id, kind: "W", domain: +d, src: q.role, k: null, source: sid, variant: vi, no: q.no, stem: v.stem, a: flipped ? v.b : v.a, b: flipped ? v.a : v.b };
      W_POOL[d].push(id);
    });
  }
}

/** X 設問：{id:"X{ラウンド}-{組}", kind:"X", round, index, s(行動文の番号0〜3), left, right(傾向), leftText, rightText} */
export const X_ITEMS = {};
export const X_BY_ROUND_TRAIT = {};   // ラウンド → 傾向 → id
QUESTIONS3.xRounds.forEach((round, ri) => {
  const r = ri + 1, s = ri % 4;
  X_BY_ROUND_TRAIT[r] = {};
  round.forEach(([l, rt], pi) => {
    const id = `X${r}-${pi + 1}`;
    X_ITEMS[id] = { id, kind: "X", round: r, index: pi, s, left: TI[l], right: TI[rt], leftText: QUESTIONS3.statements[TI[l]][s], rightText: QUESTIONS3.statements[TI[rt]][s] };
    X_BY_ROUND_TRAIT[r][TI[l]] = id; X_BY_ROUND_TRAIT[r][TI[rt]] = id;
  });
});
export const ROUND_USE = { 1: "基本", 2: "基本", 3: "基本", 4: "基本", 5: "追加", 6: "追加", 7: "差し替え用" };
export const ITEM3 = { ...W_ITEMS, ...X_ITEMS };

/** 枠の中で設問を左右に並べた形。W は flip のとき B行動を左に出す */
export function present(step, q) {
  if (q.kind === "W") {
    const D = DOMAINS[q.domain];
    const A = { text: q.a, trait: D.a, side: "A" }, B = { text: q.b, trait: D.b, side: "B" };
    const flip = !!step?.flip;
    return { id: q.id, kind: "W", stem: q.stem, prompt: W_PROMPT, src: q.src, domain: q.domain, left: flip ? B : A, right: flip ? A : B, flip };
  }
  return { id: q.id, kind: "X", stem: null, prompt: X_PROMPT, round: q.round, left: { text: q.leftText, trait: q.left }, right: { text: q.rightText, trait: q.right }, flip: false };
}

// ---------------------------------------------------------------- 基本の枠
/** W の枠 n（領域内の通し番号 1〜6）の左右：(領域 + n) が奇数なら B行動を左に（各領域で左右が半々、出題順でも交互） */
const wFlip = (d, n) => (d + n) % 2 === 1;
const W_BASE_STEPS = [];
for (let k = 1; k <= 4; k++) for (let d = 1; d <= 8; d++) {
  W_BASE_STEPS.push({ key: `WB-${d}-${k}`, stage: 1, kind: "W", domain: d, n: k, flip: wFlip(d, k), item: W_BASE[d][k - 1] });
}
const X_BASE_STEPS = [];
for (let r = 1; r <= 4; r++) QUESTIONS3.xRounds[r - 1].forEach((_, i) => {
  const q = X_ITEMS[`X${r}-${i + 1}`];
  X_BASE_STEPS.push({ key: `XB-${r}-${i + 1}`, stage: 2, kind: "X", item: q.id, traits: [q.left, q.right] });
});

// ---------------------------------------------------------------- 採点（共通）
/** 拮抗：差<2 または 取り分<0.6（どちらの側も優勢でない） */
export function isTied(w) {
  const n = (w?.a || 0) + (w?.b || 0);
  if (!n) return true;
  const hi = Math.max(w.a, w.b);
  return Math.abs(w.a - w.b) < TH3.domDiff || hi / n < TH3.domShare;
}

/**
 * 回答した枠の記録 → Profile3。records: [{kind, domain, left, right, answer, picked, swaps}]
 * 返り値 { profile3, levels, w, m, wins, quality }
 */
export function scoreRecords3(records) {
  const w = {}; for (const d of Object.keys(DOMAINS)) w[d] = { a: 0, b: 0, n: 0 };
  const m = {}, wins = {}; for (const t of TRAITS) { m[t] = 0; wins[t] = 0; }
  for (const r of records) {
    if (!r.picked) continue;
    if (r.kind === "W") {
      const D = DOMAINS[r.domain];
      if (r.picked === D.a) w[r.domain].a++; else if (r.picked === D.b) w[r.domain].b++; else continue;
      w[r.domain].n++;
    } else {
      m[r.left]++; m[r.right]++; wins[r.picked]++;
    }
  }
  const levels = {};
  for (const t of TRAITS) levels[t] = m[t] > 0 ? wins[t] / m[t] * 100 : 50;
  const quality = responseQuality3(records);
  const profile3 = { levels, w, quality: { leftRate: quality.leftRate, swapCount: quality.swapCount, skipCount: quality.skipCount, ok: quality.ok } };
  return { profile3, levels, w, m, wins, quality };
}

const fmt = (v) => Number.isInteger(v) ? String(v) : v.toFixed(1);

// ---------------------------------------------------------------- セッション
/**
 *   plan  : { s1: W基本, s2: X基本, s3: W追加|null, s4: X追加|null }（null＝まだ計画していない）
 *   state : 枠の key → { items:[見せた設問id…（最後が今の設問）], answered, answer:"left"|"right"|null(答えずに進む) }
 *   pos   : いま表示している枠（steps() 上の添字。全部終われば steps().length）
 *   log   : 操作履歴（answer / swap / skip / back / plan）。追記のみ
 */
export class Session3 {
  constructor({ adaptive = true, origin = null } = {}) {
    this.config = { adaptive: adaptive !== false, ...(origin ? { origin } : {}) };
    this.plan = { s1: W_BASE_STEPS.map(s => ({ ...s })), s2: X_BASE_STEPS.map(s => ({ ...s, traits: [...s.traits] })), s3: null, s4: null };
    this.state = {};
    this.pos = 0;
    this.log = [];
  }

  steps() { return [...this.plan.s1, ...this.plan.s2, ...(this.plan.s3 || []), ...(this.plan.s4 || [])]; }
  _items(step) { return this.state[step.key]?.items || [step.item]; }
  _itemId(step) { const it = this._items(step); return it[it.length - 1]; }
  _answered(step) { return !!this.state[step.key]?.answered; }
  _ensure(step) { return (this.state[step.key] ||= { items: [step.item], answered: false, answer: null }); }

  /** いま計画にある全枠で、見せた（または出す予定の）設問 */
  _used(steps = this.steps()) {
    const used = new Set();
    for (const st of steps) for (const id of this._items(st)) used.add(id);
    return used;
  }

  /** 差し替え候補（使える順） */
  _swapCandidates(step) {
    const used = this._used();
    if (step.kind === "W") return W_POOL[step.domain].filter(id => !used.has(id));
    const out = [];
    for (const rounds of [[7], [5, 6]]) for (const t of step.traits) for (const r of rounds) {
      const id = X_BY_ROUND_TRAIT[r][t];
      if (id && !used.has(id) && !out.includes(id)) out.push(id);
    }
    return out;
  }

  /** 表示中の設問。終わっていれば null */
  current() {
    const steps = this.steps();
    const step = steps[this.pos];
    if (!step) return null;
    const st = this.state[step.key];
    const swapsUsed = this._items(step).length - 1;
    const cands = swapsUsed < MAX_SWAPS ? this._swapCandidates(step) : [];
    const swapsLeft = Math.min(MAX_SWAPS - swapsUsed, cands.length);
    const stageSteps = steps.filter(x => x.stage === step.stage);
    return {
      key: step.key, slot: step.key, stage: STAGES3[step.stage - 1], stageNo: step.stage, kind: step.kind,
      question: present(step, ITEM3[this._itemId(step)]),
      index: this.pos, total: steps.length,
      stageIndex: stageSteps.indexOf(step), stageTotal: stageSteps.length,
      canSwap: swapsLeft > 0, swapsLeft, swapsUsed, canSkip: swapsLeft === 0,
      answer: st?.answered ? st.answer : undefined,
      reason: step.reason || null, domain: step.domain ?? null, n: step.n ?? null, traits: step.traits ?? null, target: step.target ?? null,
      shown: this._items(step).slice(),
    };
  }

  /** 左／右を選んで次へ */
  answer(side) {
    if (side !== "left" && side !== "right") throw new Error(`answer must be "left" or "right": ${side}`);
    const step = this.steps()[this.pos];
    if (!step) return false;
    const s = this._ensure(step);
    const q = present(step, ITEM3[this._itemId(step)]);
    const prev = s.answered ? s.answer : undefined;
    s.answered = true; s.answer = side;
    this.log.push({ type: "answer", key: step.key, stage: step.stage, itemId: q.id, side, trait: q[side].trait, ...(prev !== undefined ? { prev } : {}) });
    this._advance();
    return true;
  }

  /** 問題を変える（同じ枠の別の設問へ）。差し替えられないときは false。回答済みの枠を差し替えたら未回答に戻す */
  swap() {
    const step = this.steps()[this.pos];
    if (!step) return false;
    if (this._items(step).length - 1 >= MAX_SWAPS) return false;
    const cands = this._swapCandidates(step);
    if (!cands.length) return false;
    const s = this._ensure(step);
    const from = s.items[s.items.length - 1];
    const prev = s.answered ? s.answer : undefined;
    s.items.push(cands[0]);
    s.answered = false; s.answer = null;
    this.log.push({ type: "swap", key: step.key, stage: step.stage, from, to: cands[0], ...(prev !== undefined ? { prev } : {}) });
    return true;
  }

  /** 答えずに進む。差し替えを使い切った（候補が尽きた）ときだけ。force は 5択回答からの変換用 */
  skip({ force = false } = {}) {
    const step = this.steps()[this.pos];
    if (!step) return false;
    const c = this.current();
    if (c.canSwap && !force) return false;
    const s = this._ensure(step);
    const prev = s.answered ? s.answer : undefined;
    s.answered = true; s.answer = null;
    this.log.push({ type: "skip", key: step.key, stage: step.stage, itemId: this._itemId(step), ...(force && c.canSwap ? { forced: true } : {}), ...(prev !== undefined ? { prev } : {}) });
    this._advance();
    return true;
  }

  /** 1つ前の枠へ戻る */
  back() {
    const n = this.steps().length;
    if (this.pos <= 0) return false;
    this.pos = Math.min(this.pos, n) - 1;
    this.log.push({ type: "back", key: this.steps()[this.pos].key });
    return true;
  }

  isDone() {
    const steps = this.steps();
    if (this.config.adaptive && (this.plan.s3 === null || this.plan.s4 === null)) return false;
    return this.pos >= steps.length && steps.every(s => this._answered(s));
  }

  progress() {
    const steps = this.steps();
    const answered = steps.filter(s => this._answered(s)).length;
    const cur = steps[this.pos];
    const stages = [1, 2, 3, 4]
      .filter(k => this.config.adaptive || k <= 2)
      .map(k => {
        const list = steps.filter(s => s.stage === k);
        const planned = k === 3 ? this.plan.s3 !== null : k === 4 ? this.plan.s4 !== null : true;
        return { stage: STAGES3[k - 1], stageNo: k, label: STAGES3[k - 1], total: list.length, answered: list.filter(s => this._answered(s)).length, planned };
      });
    const stageNo = cur ? cur.stage : null;
    const stageList = stageNo ? steps.filter(s => s.stage === stageNo) : [];
    // 全体の見込み：計画前の追加段階は上限で数える（固定モードは64）
    const max = this.config.adaptive ? 32 + 32 + (this.plan.s3 ? this.plan.s3.length : W_EXTRA_CAP) + (this.plan.s4 ? this.plan.s4.length : X_EXTRA_CAP) : 64;
    return {
      answered, total: steps.length, max, ratio: steps.length ? answered / steps.length : 0,
      stage: stageNo ? STAGES3[stageNo - 1] : "完了", stageNo, stageLabel: stageNo ? STAGES3[stageNo - 1] : "完了",
      stageIndex: cur ? stageList.indexOf(cur) : 0, stageTotal: stageList.length,
      skipped: steps.filter(s => this.state[s.key]?.answered && this.state[s.key].answer === null).length,
      swaps: steps.reduce((n, s) => n + this._items(s).length - 1, 0),
      done: this.isDone(), stages,
    };
  }

  // 次の未回答の枠へ。段階1・2が終わったら段階3を、段階3が終わったら段階4を（再）計画する
  _advance() {
    this._replan();
    const steps = this.steps();
    let next = steps.findIndex((st, i) => i > this.pos && !this._answered(st));
    if (next < 0) next = steps.findIndex(st => !this._answered(st));
    this.pos = next < 0 ? steps.length : next;
  }

  _replan() {
    if (!this.config.adaptive) return;
    const done = (list) => list.every(s => this._answered(s));
    if (!done(this.plan.s1) || !done(this.plan.s2)) return;
    this._setPlan("s3", this._planWExtra());
    if (done(this.plan.s3)) this._setPlan("s4", this._planXExtra());
    else if (this.plan.s4) this._setPlan("s4", this.plan.s4.filter(st => this.state[st.key]));   // 未着手の X追加 は段階3のあとで計画し直す
  }

  _setPlan(name, steps) {
    const before = this.plan[name] ? this.plan[name].map(s => `${s.key}=${s.item}`).join(",") : null;
    const after = steps.map(s => `${s.key}=${s.item}`).join(",");
    if (before === after) return;
    this.plan[name] = steps;
    this.log.push({ type: "plan", stage: name === "s3" ? 3 : 4, keys: steps.map(s => s.key) });
  }

  /** 回答済みの枠（時系列＝段階順）。採点に使う */
  records() {
    const out = [];
    for (const step of this.steps()) {
      const s = this.state[step.key];
      if (!s || !s.answered) continue;
      const q = present(step, ITEM3[s.items[s.items.length - 1]]);
      out.push({
        key: step.key, stage: step.stage, stageLabel: STAGES3[step.stage - 1], kind: step.kind, itemId: q.id, domain: step.domain ?? null,
        left: q.left.trait, right: q.right.trait, flip: q.flip, answer: s.answer, picked: s.answer ? q[s.answer].trait : null,
        swaps: s.items.length - 1, shown: s.items.slice(),
      });
    }
    return out;
  }

  _score(steps) {
    const set = steps ? new Set(steps.map(s => s.key)) : null;
    return scoreRecords3(this.records().filter(r => !set || set.has(r.key)));
  }

  /** 段階3：W追加（拮抗した領域だけ。回答済み・差し替え済みの枠は残し、未着手の枠を計画し直す） */
  _planWExtra() {
    const kept = (this.plan.s3 || []).filter(st => this.state[st.key]);
    const { w } = this._score();
    const per = {}; for (const st of kept) per[st.domain] = (per[st.domain] || 0) + 1;
    const used = this._used([...this.plan.s1, ...this.plan.s2, ...kept, ...(this.plan.s4 || []).filter(st => this.state[st.key])]);
    const keys = new Set(kept.map(s => s.key));
    const out = [...kept];
    for (let round = 1; round <= W_EXTRA_PER_DOMAIN; round++) {
      for (const d of Object.keys(DOMAINS).map(Number)) {
        if (out.length >= W_EXTRA_CAP) break;
        if ((per[d] || 0) >= round || !isTied(w[d])) continue;
        const id = W_POOL[d].find(x => !used.has(x));
        if (!id) continue;
        used.add(id);
        per[d] = (per[d] || 0) + 1;
        let k = per[d]; while (keys.has(`WE-${d}-${k}`)) k++;
        const key = `WE-${d}-${k}`; keys.add(key);
        const n = 4 + per[d];
        const D = DOMAINS[d], wd = w[d], hi = Math.max(wd.a, wd.b);
        out.push({
          key, stage: 3, kind: "W", domain: d, n, flip: wFlip(d, n), item: id,
          reason: `${D.name}：左右が ${D.a} ${wd.a}：${wd.b} ${D.b}（差${Math.abs(wd.a - wd.b)}・取り分${wd.n ? Math.round(hi / wd.n * 100) + "%" : "—"}）で、優勢が決まっていないため。`,
        });
      }
    }
    return out;
  }

  /** 段階4：X追加（level 40〜60 または m<3 の傾向を含むラウンド5〜6の組） */
  _planXExtra() {
    const kept = (this.plan.s4 || []).filter(st => this.state[st.key]);
    const sc = this._score();
    const used = this._used([...this.plan.s1, ...this.plan.s2, ...(this.plan.s3 || []), ...kept]);
    const cnt = {};
    for (const st of kept) { const q = ITEM3[this._itemId(st)]; cnt[q.left] = (cnt[q.left] || 0) + 1; cnt[q.right] = (cnt[q.right] || 0) + 1; }
    const decided = (t) => !isTied(sc.w[DOM_OF[t]]);
    const amb = TRAITS.map((t, ti) => ({ t, ti, L: sc.levels[t], m: sc.m[t] }))
      .filter(x => x.m < X_MIN_M || (x.L >= X_AMBIG_LOW && x.L <= X_AMBIG_HIGH))
      .map(x => ({ ...x, dec: decided(x.t), dist: Math.abs(x.L - 50) }))
      .sort((x, y) => (y.dec - x.dec) || (x.dist - y.dist) || (x.ti - y.ti));
    const avail = [5, 6].flatMap(r => QUESTIONS3.xRounds[r - 1].map((_, i) => `X${r}-${i + 1}`)).filter(id => !used.has(id));
    const out = [...kept];
    const keys = new Set(kept.map(s => s.key));
    for (let pass = 1; pass <= X_EXTRA_PER_TRAIT; pass++) {
      for (const a of amb) {
        if (out.length >= X_EXTRA_CAP) break;
        if ((cnt[a.t] || 0) >= pass) continue;
        const id = avail.find(x => {
          if (used.has(x)) return false;
          const q = X_ITEMS[x];
          if (q.left !== a.t && q.right !== a.t) return false;
          const other = q.left === a.t ? q.right : q.left;
          return (cnt[other] || 0) < X_EXTRA_PER_TRAIT;
        });
        if (!id) continue;
        used.add(id);
        const q = X_ITEMS[id];
        cnt[q.left] = (cnt[q.left] || 0) + 1; cnt[q.right] = (cnt[q.right] || 0) + 1;
        let key = `XE-${id}`; while (keys.has(key)) key += "+"; keys.add(key);
        const D = DOMAINS[DOM_OF[a.t]];
        const why = a.m < X_MIN_M ? `比較の回答数が${a.m}（${X_MIN_M}未満）` : `level が ${fmt(a.L)}（${sc.wins[a.t]}/${a.m}、${X_AMBIG_LOW}〜${X_AMBIG_HIGH}）で強さが曖昧`;
        out.push({
          key, stage: 4, kind: "X", item: id, target: a.t, traits: [a.t],
          reason: `「${a.t}」の${why}。` + (a.dec ? `${D.name}は左右の優勢が決まっているので、状態1／2／弱の判定に効くため優先。` : `${D.name}は左右も拮抗。`),
        });
      }
    }
    return out;
  }

  /** 設問ごとの履歴（設問タブ用）：{itemId: [{key, stage, extra, status:"answered"|"swapped"|"skipped"|"pending", side, picked}]} */
  history() {
    const out = {};
    for (const step of this.steps()) {
      const s = this.state[step.key];
      if (!s) continue;
      s.items.forEach((id, i) => {
        const last = i === s.items.length - 1;
        const q = present(step, ITEM3[id]);
        const status = !last ? "swapped" : !s.answered ? "pending" : s.answer === null ? "skipped" : "answered";
        (out[id] ||= []).push({ key: step.key, stage: step.stage, extra: step.stage >= 3, status,
          side: status === "answered" ? s.answer : null, picked: status === "answered" ? q[s.answer].trait : null, leftTrait: q.left.trait });
      });
    }
    return out;
  }

  result() {
    const records = this.records();
    const sc = scoreRecords3(records);
    const states = domainStates3(sc.profile3);
    const sel = select3(sc.profile3);
    const rec = Object.fromEntries(records.map(r => [r.key, r]));
    const extra = (list) => (list || []).map(st => {
      const r = rec[st.key];
      return { key: st.key, itemId: this._itemId(st), domain: st.domain ?? null, target: st.target ?? null, reason: st.reason || "",
        answer: r ? r.answer : undefined, picked: r ? r.picked : null, swaps: this._items(st).length - 1 };
    });
    return {
      profile3: sc.profile3, levels: sc.levels, w: sc.w, m: sc.m, wins: sc.wins, states, select: sel, quality: sc.quality,
      confidence: confidence3(sc.profile3, sc.m, sc.wins),
      stages: { wExtra: extra(this.plan.s3), xExtra: extra(this.plan.s4) },
      config: { ...this.config }, log: this.log.slice(), records,
    };
  }

  toJSON() {
    return { type: "seikaku16-three-session", version: 1, config: this.config, plan: { s3: this.plan.s3, s4: this.plan.s4 }, state: this.state, pos: this.pos, log: this.log };
  }

  static fromJSON(obj) {
    if (!obj || obj.type !== "seikaku16-three-session" || obj.version !== 1) throw new Error("三択版のセッションの形式が違います");
    const s = new Session3(obj.config || {});
    const known = (list) => Array.isArray(list) ? list.filter(st => st && ITEM3[st.item]) : null;
    s.plan.s3 = known(obj.plan?.s3);
    s.plan.s4 = known(obj.plan?.s4);
    const state = {};
    for (const [k, v] of Object.entries(obj.state || {})) {
      if (!v || !Array.isArray(v.items) || !v.items.length || !v.items.every(id => ITEM3[id])) continue;
      state[k] = { items: v.items.slice(), answered: !!v.answered, answer: v.answer === "left" || v.answer === "right" ? v.answer : null };
    }
    s.state = state;
    s.log = Array.isArray(obj.log) ? obj.log : [];
    s.pos = Math.max(0, Math.min(+obj.pos || 0, s.steps().length));
    return s;
  }
}

export function createSession3(opts) { return new Session3(opts); }

// ---------------------------------------------------------------- 回答関数で最後まで流す（変換・テスト用）
/**
 * respond(current) が "left" | "right" | "swap" | "skip" を返す。
 * "swap" で差し替えられなければ答えずに進む。"skip" は差し替えが残っていても答えずに進む（変換用）
 */
export function drive(session, respond) {
  let guard = 0;
  while (!session.isDone()) {
    const c = session.current();
    if (!c) throw new Error("current() が null なのに終わっていません");
    const r = respond(c);
    if (r === "swap") { if (!session.swap()) session.skip({ force: true }); }
    else if (r === "skip") session.skip({ force: true });
    else session.answer(r);
    if (++guard > 1000) throw new Error("drive: 終わりません");
  }
  return session;
}

const sideOf = (c, trait) => c.question.left.trait === trait ? "left" : "right";

// ---------------------------------------------------------------- 5択回答からの推定（§5）
/**
 * 80問シート形式 {設問番号: 1〜5} を三択の回答に変換して流す（「5択回答からの推定」）。返り値は終わった Session3。
 *   W 基本 k：A側 k番目と B側 k番目の5択回答の大きい方。同点（か片方が未回答）なら対決 Q7x の向き（3以外）、
 *            それも 3 なら「問題を変える」で alt へ。alt・対決由来の設問は Q7x／D?x の回答の向き（平均）、無ければ答えずに進む
 *   X（t vs u、行動文 s）：t の s番目と u の s番目の大きい方。同点なら4問平均の高い方、それも同点なら左
 */
export function fromLikertAnswers(answers, wordingIndex = 0, { adaptive = true } = {}) {
  const val = (no) => { const v = answers?.[no] ?? answers?.[String(no)]; return v == null || v === "" || Number.isNaN(+v) ? null : +v; };
  const mean = (t) => { const vs = BASIC_BY_TRAIT[t].map(i => val(i.no)).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; };
  const duelOf = (d, role) => QUESTIONS.duels.find(q => q.domain === +d && q.role === role);
  const duelSide = (d, roles) => {
    const inputs = roles.map(role => duelOf(d, role)).filter(Boolean).map(q => ({ domain: q.domain, sideA: q.sideA, sideB: q.sideB, answer: val(q.no) }));
    return duelFromAnswers(inputs)[d]?.side ?? null;
  };
  const session = new Session3({ adaptive, origin: { from: "likert", wording: wordingIndex === 1 ? 1 : 0 } });
  return drive(session, (c) => {
    const q = ITEM3[c.question.id];
    if (q.kind === "W") {
      const d = q.domain, D = DOMAINS[d];
      if (q.src === "base") {
        const va = val(BASIC_BY_TRAIT[D.a][q.k - 1].no), vb = val(BASIC_BY_TRAIT[D.b][q.k - 1].no);
        if (va != null && vb != null && va !== vb) return sideOf(c, va > vb ? D.a : D.b);
        const t = duelSide(d, ["duel"]);
        return t ? sideOf(c, t) : "swap";
      }
      const t = duelSide(d, ["duel", "duel2"]);
      return t ? sideOf(c, t) : "skip";
    }
    const t = q.left, u = q.right;
    const vt = val(BASIC_BY_TRAIT[t][q.s].no), vu = val(BASIC_BY_TRAIT[u][q.s].no);
    if (vt != null && vu != null && vt !== vu) return sideOf(c, vt > vu ? t : u);
    const mt = mean(t), mu = mean(u);
    if (mt != null && mu != null && mt !== mu) return sideOf(c, mt > mu ? t : u);
    return "left";
  });
}

/**
 * 16傾向スコアだけのプロファイル（P1〜P5）を三択の回答に変換して流す。返り値は終わった Session3。
 *   W：scoreA − scoreB ≥ 10 なら A、≤ −10 なら B、それ以外は a,b,a,b（領域内の通し番号の奇数＝A）で拮抗にする。
 *      duel（{d:{side,strength}} か {d:[side,strength]}）があれば、拮抗の領域の追加設問（5問目以降）だけその向きで答える
 *   X：スコアの高い方。同点なら左
 */
export function fromScores(scores, duel = {}, { adaptive = true } = {}) {
  for (const t of TRAITS) if (!Number.isFinite(+scores?.[t])) throw new Error(`スコア「${t}」がありません`);
  const dside = (d) => { const v = duel?.[d]; const side = Array.isArray(v) ? v[0] : v?.side; return side === DOMAINS[d].a || side === DOMAINS[d].b ? side : null; };
  const session = new Session3({ adaptive, origin: { from: "scores" } });
  return drive(session, (c) => {
    const q = ITEM3[c.question.id];
    if (q.kind === "W") {
      const d = q.domain, D = DOMAINS[d], diff = +scores[D.a] - +scores[D.b];
      if (diff >= 10) return sideOf(c, D.a);
      if (diff <= -10) return sideOf(c, D.b);
      if (c.n > 4 && dside(d)) return sideOf(c, dside(d));
      return sideOf(c, c.n % 2 === 1 ? D.a : D.b);
    }
    const st = +scores[q.left], su = +scores[q.right];
    return st === su ? "left" : sideOf(c, st > su ? q.left : q.right);
  });
}
