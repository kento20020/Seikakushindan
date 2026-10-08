// 可変（アダプティブ）質問票の状態機械。DOM を一切触らない純粋ロジック（node でテストできる）。
//
// 5件法だと「3 どちらともいえない」に座り続けられてしまうため、回答の様子に合わせて質問を足す。
//   段階1 基本     : 72問（基本64＋一貫性8）を番号順に。表現A（または開始時に選んだ表現）で出し、
//                    「別の言い方で聞く」でもう一方の表現に切り替えられる（どちらで答えたかを記録）。
//   段階2 追加     : 段階1のあと計算。傾向ごとに基本4問の「はっきりした回答（3以外）」を数え、3未満なら
//                    3（または未回答）だった設問を、まだ見せていない表現で聞き直す。1傾向2問まで・全体16問まで。
//                    優勢が決まっていない領域（暫定スコアの左右差<15）の傾向を先に聞く。
//   段階3 対決     : Q73〜Q80 の強制選択8問。
//   段階4 追加対決 : 左右差<15 で、対決も「どちらとも」か「やや」だった領域だけ、追加の対決場面 D?x を聞く。
//
// 採点は engine.js の scoreTraits / duelFromAnswers / responseQuality / select をそのまま使う。
// adaptive=false のときは固定80問（段階1＋段階3）だけになる（比較用）。

import { QUESTIONS } from "./data/questions.js";
import { TH, DOMAINS, TRAITS, scoreTraits, duelFromAnswers, responseQuality, select } from "./engine.js";

// ---------------------------------------------------------------- 定数・索引
export const STAGE_LABEL = { 1: "基本", 2: "追加", 3: "対決", 4: "追加対決" };
export const ROLE_LABEL = { basic: "基本", consist: "一貫性", duel: "対決", duel2: "追加対決" };
export const LIKERT_CHOICES = [
  { v: 1, label: "まったく当てはまらない" },
  { v: 2, label: "あまり当てはまらない" },
  { v: 3, label: "どちらともいえない" },
  { v: 4, label: "やや当てはまる" },
  { v: 5, label: "とても当てはまる" },
];
/** 対決の5択。ラベルは「A」「B」ではなく実際の文を使う */
export function duelChoices(variant) {
  return [
    { v: 1, tag: "近い", text: variant.a },
    { v: 2, tag: "やや近い", text: variant.a },
    { v: 3, tag: "", text: "どちらともいえない" },
    { v: 4, tag: "やや近い", text: variant.b },
    { v: 5, tag: "近い", text: variant.b },
  ];
}

export const FOLLOWUP_MAX_PER_TRAIT = 2;   // 1傾向あたりの追加質問の上限
export const FOLLOWUP_CAP = 16;            // 追加質問の全体上限
export const INFORMATIVE_NEED = 3;         // 基本4問のうち、はっきりした回答がこの数に満たなければ追加
export const CONSIST_GAP = 1.5;            // 一貫性設問と基本平均の差がこれ以上なら「不一致」

const ITEMS = [...QUESTIONS.items].sort((a, b) => a.no - b.no);                 // 72問（基本64＋一貫性8）
const DUELS = QUESTIONS.duels.filter(d => d.role === "duel").sort((a, b) => a.no - b.no);   // Q73〜Q80
const EXTRA = QUESTIONS.duels.filter(d => d.role === "duel2").sort((a, b) => a.no - b.no);  // D1x〜D8x
export const ITEM_BY_ID = Object.fromEntries([...ITEMS, ...QUESTIONS.duels].map(q => [q.id, q]));
export const ITEM_BY_NO = Object.fromEntries([...ITEMS, ...QUESTIONS.duels].map(q => [q.no, q]));
export const BASIC_BY_TRAIT = Object.fromEntries(TRAITS.map(t => [t, ITEMS.filter(i => i.role === "basic" && i.trait === t)]));
const DUEL_BY_DOMAIN = Object.fromEntries(DUELS.map(d => [d.domain, d]));
const EXTRA_BY_DOMAIN = Object.fromEntries(EXTRA.map(d => [d.domain, d]));

const isLikert = (q) => q.role === "basic" || q.role === "consist";
const isInformative = (v) => v != null && v !== 3;
const findLast = (arr, pred) => { for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i]; return undefined; };
const mean = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

/** 切り替え先の表現の番号。もう一方が無い・同じ文なら null */
export function otherWording(q, w) {
  const list = isLikert(q) ? q.wordings : q.variants;
  const o = w === 0 ? 1 : 0;
  if (!list || o >= list.length) return null;
  if (JSON.stringify(list[o]) === JSON.stringify(list[w])) return null;
  return o;
}
/** 対決の開始表現：開始時の表現指定に従い、その版が無ければ variants[0] */
const duelStartVariant = (q, w) => Math.min(w, q.variants.length - 1);

// ---------------------------------------------------------------- 採点（共通）
/**
 * 回答記録の列から結果を計算する。セッションと「80問シート形式の回答」で同じ処理を通す。
 * records: [{itemId, stage, wordingIndex, answer}]（時系列順。answer は 1〜5 または null=未回答）
 */
export function scoreRecords(records) {
  const byItem = {};
  for (const r of records) (byItem[r.itemId] ||= []).push(r);

  // 基本4問のスロット値：はっきりした回答（3以外）の最新 → なければ最新の回答（3）→ なければ null
  const slotValue = (rs) => {
    const vals = (rs || []).map(r => r.answer);
    const inf = findLast(vals, isInformative);
    if (inf !== undefined) return inf;
    const any = findLast(vals, v => v != null);
    return any === undefined ? null : any;
  };
  const slotAnswers = {};
  for (const t of TRAITS) slotAnswers[t] = BASIC_BY_TRAIT[t].map(it => slotValue(byItem[it.id]));
  const st = scoreTraits(slotAnswers);

  // 回答品質：段階1の基本64問の回答（追加質問は含めない）
  const qualityValues = records.filter(r => r.stage === 1 && ITEM_BY_ID[r.itemId]?.role === "basic").map(r => r.answer);
  const quality = responseQuality(qualityValues);

  // 一貫性：一貫性設問の回答と、同じ傾向の基本4問（最終スロット値）の平均を比べる。スコアには入れない
  const consistency = ITEMS.filter(i => i.role === "consist").map(it => {
    const ans = findLast((byItem[it.id] || []).map(r => r.answer), v => v != null);
    const m = mean(slotAnswers[it.trait].filter(v => v != null));
    if (ans === undefined || m === null) return { itemId: it.id, no: it.no, trait: it.trait, domain: it.domain, answer: ans ?? null, mean: m, delta: null, flag: "未回答" };
    const delta = ans - m;
    return { itemId: it.id, no: it.no, trait: it.trait, domain: it.domain, answer: ans, mean: m, delta, flag: Math.abs(delta) >= CONSIST_GAP ? "不一致" : "OK" };
  });

  // 対決：追加対決（D?x）は A/B の向きが基本の対決と逆のことがあるので、基本の対決の向きに揃えてから平均する
  const duelInputs = [], perDomain = {};
  for (const r of records) {
    const q = ITEM_BY_ID[r.itemId];
    if (!q || (q.role !== "duel" && q.role !== "duel2")) continue;
    const base = DUEL_BY_DOMAIN[q.domain];
    const flipped = q.sideA !== base.sideA;
    const answer = r.answer == null ? null : (flipped ? 6 - r.answer : r.answer);
    duelInputs.push({ domain: q.domain, sideA: base.sideA, sideB: base.sideB, answer });
    (perDomain[q.domain] ||= []).push({ itemId: q.id, no: q.no, role: q.role, answer: r.answer, normalized: answer, flipped,
      value: answer == null ? null : (3 - answer) * 50, wordingIndex: r.wordingIndex });
  }
  const duel = duelFromAnswers(duelInputs);
  const duelDetail = Object.keys(DOMAINS).map(d => {
    const base = DUEL_BY_DOMAIN[d];
    const agg = duel[d] || { side: null, strength: 0, n: 0 };
    return { domain: +d, name: DOMAINS[d].name, sideA: base.sideA, sideB: base.sideB, answers: perDomain[d] || [], side: agg.side, strength: agg.strength, n: agg.n };
  });

  const profileDuel = {};
  for (const [d, v] of Object.entries(duel)) profileDuel[d] = { side: v.side, strength: v.strength };
  const profile = { scores: st.scores, duel: profileDuel, qualityOk: quality.ok, rawScores: st.scores };
  return {
    profile, scores: st.scores, confidence: st.confidence, informative: st.informative, slotAnswers,
    quality, consistency, duelDetail, select: select(profile),
  };
}

/**
 * 80問シート形式 {設問番号: 回答} を同じ採点に通す（サンプル・JSON読み込み用）。
 * 81〜88（D1x〜D8x）があれば追加対決として扱う。
 */
export function scoreFromAnswerMap(answers, wordingIndex = 0) {
  const records = Object.entries(answers)
    .map(([no, a]) => ({ q: ITEM_BY_NO[+no], a }))
    .filter(x => x.q)
    .sort((x, y) => x.q.no - y.q.no)
    .map(({ q, a }) => ({
      itemId: q.id, stage: q.role === "duel" ? 3 : q.role === "duel2" ? 4 : 1,
      wordingIndex: isLikert(q) ? wordingIndex : duelStartVariant(q, wordingIndex), answer: a == null ? null : +a,
    }));
  return scoreRecords(records);
}

// ---------------------------------------------------------------- セッション
/**
 * 質問票セッション。
 *   plan  : 段階ごとのステップ列 { s1, s2, s3, s4 }。s2/s4 は前段が終わってから計算（null=未計算）
 *   state : ステップの key → { wordingIndex, shown:[見せた表現], answered, answer, answeredWording }
 *   pos   : いま表示しているステップの位置（steps() 上の添字。全部終われば steps().length）
 *   log   : 操作履歴（answer / swap / back / plan）。追記のみ
 */
export class Session {
  constructor({ startWording = 0, adaptive = true } = {}) {
    this.config = { startWording: startWording === 1 ? 1 : 0, adaptive: !!adaptive };
    this.plan = {
      s1: ITEMS.map(q => ({ key: `s1:${q.id}`, stage: 1, itemId: q.id, wordingIndex: this.config.startWording })),
      s2: null,
      s3: DUELS.map(q => ({ key: `s3:${q.id}`, stage: 3, itemId: q.id, wordingIndex: duelStartVariant(q, this.config.startWording) })),
      s4: null,
    };
    this.state = {};
    this.pos = 0;
    this.log = [];
  }

  /** いまの全ステップ（段階順） */
  steps() { return [...this.plan.s1, ...(this.plan.s2 || []), ...this.plan.s3, ...(this.plan.s4 || [])]; }

  _peek(step) { return this.state[step.key] || { wordingIndex: step.wordingIndex, shown: [step.wordingIndex], answered: false, answer: null }; }
  _ensure(step) { return (this.state[step.key] ||= { wordingIndex: step.wordingIndex, shown: [step.wordingIndex], answered: false, answer: null }); }
  _answered(step) { return !!this.state[step.key]?.answered; }
  _answer(step) { const s = this.state[step.key]; return s && s.answered ? s.answer : undefined; }

  /** 表示中の設問。終わっていれば null */
  current() {
    const steps = this.steps();
    const step = steps[this.pos];
    if (!step) return null;
    const q = ITEM_BY_ID[step.itemId];
    const s = this._peek(step);
    const kind = isLikert(q) ? "likert" : "duel";
    const stageSteps = steps.filter(x => x.stage === step.stage);
    return {
      key: step.key, stage: step.stage, stageLabel: STAGE_LABEL[step.stage], kind, item: q,
      wordingIndex: s.wordingIndex,
      text: kind === "likert" ? q.wordings[s.wordingIndex] : null,
      variant: kind === "duel" ? q.variants[s.wordingIndex] : null,
      index: this.pos, total: steps.length,
      stageIndex: stageSteps.indexOf(step), stageTotal: stageSteps.length,
      canSwap: step.stage !== 2 && otherWording(q, s.wordingIndex) !== null,
      answer: s.answered ? s.answer : undefined,
      reason: step.reason || null,
      trait: q.trait || null, domain: q.domain,
    };
  }

  /** 回答（1〜5、null=答えない）して次へ */
  answer(v) {
    if (!(v === null || (Number.isInteger(v) && v >= 1 && v <= 5))) throw new Error("answer must be 1..5 or null: " + v);
    const step = this.steps()[this.pos];
    if (!step) return false;
    const s = this._ensure(step);
    const prev = s.answered ? s.answer : undefined;
    s.answered = true; s.answer = v; s.answeredWording = s.wordingIndex;
    this.log.push({ type: "answer", key: step.key, itemId: step.itemId, stage: step.stage, wordingIndex: s.wordingIndex, answer: v, ...(prev !== undefined ? { prev } : {}) });
    this._advance();
    return true;
  }

  /** 「別の言い方で聞く」。切り替えられないときは false */
  swapWording() {
    const step = this.steps()[this.pos];
    if (!step || step.stage === 2) return false;
    const q = ITEM_BY_ID[step.itemId];
    const s = this._ensure(step);
    const o = otherWording(q, s.wordingIndex);
    if (o === null) return false;
    this.log.push({ type: "swap", key: step.key, itemId: step.itemId, stage: step.stage, from: s.wordingIndex, to: o });
    s.wordingIndex = o;
    if (!s.shown.includes(o)) s.shown.push(o);
    return true;
  }

  /** 1つ前の設問へ戻る */
  back() {
    const n = this.steps().length;
    if (this.pos <= 0) return false;
    this.pos = Math.min(this.pos, n) - 1;
    this.log.push({ type: "back", key: this.steps()[this.pos].key });
    return true;
  }

  isDone() { const steps = this.steps(); return this.pos >= steps.length && steps.every(s => this._answered(s)); }

  progress() {
    const steps = this.steps();
    const answered = steps.filter(s => this._answered(s)).length;
    const cur = steps[this.pos];
    const stages = [1, 2, 3, 4]
      .filter(k => this.config.adaptive || k === 1 || k === 3)
      .map(k => {
        const list = steps.filter(s => s.stage === k);
        const planned = k === 2 ? this.plan.s2 !== null : k === 4 ? this.plan.s4 !== null : true;
        return { stage: k, label: STAGE_LABEL[k], total: list.length, answered: list.filter(s => this._answered(s)).length, planned };
      });
    const stage = cur ? cur.stage : null;
    const stageList = stage ? steps.filter(s => s.stage === stage) : [];
    return {
      answered, total: steps.length, ratio: steps.length ? answered / steps.length : 0,
      stage, stageLabel: stage ? STAGE_LABEL[stage] : "完了",
      stageIndex: cur ? stageList.indexOf(cur) : 0, stageTotal: stageList.length,
      done: this.isDone(), stages,
    };
  }

  // 次の未回答ステップへ。段階1・3が終わったところで段階2・4を（再）計算する
  _advance() {
    this._replan();
    const steps = this.steps();
    let next = steps.findIndex((st, i) => i > this.pos && !this._answered(st));
    if (next < 0) next = steps.findIndex(st => !this._answered(st));
    this.pos = next < 0 ? steps.length : next;
  }

  _replan() {
    if (!this.config.adaptive) return;
    const { s1, s3 } = this.plan;
    const s1Done = s1.every(s => this._answered(s));
    if (s1Done) this._setPlan("s2", this._planFollowups());
    const s2Done = (this.plan.s2 || []).every(s => this._answered(s));
    if (s1Done && s2Done && s3.every(s => this._answered(s))) this._setPlan("s4", this._planExtraDuels());
  }

  _setPlan(name, steps) {
    const before = this.plan[name] ? this.plan[name].map(s => s.key).join(",") : null;
    const after = steps.map(s => s.key).join(",");
    if (before === after) return;
    this.plan[name] = steps;
    this.log.push({ type: "plan", stage: name === "s2" ? 2 : 4, keys: steps.map(s => s.key) });
  }

  /** 段階1の基本スロット値（傾向ごとに4つ） */
  _slots(stages) {
    const records = [];
    for (const step of this.steps()) {
      if (!stages.includes(step.stage)) continue;
      const a = this._answer(step);
      if (a !== undefined) records.push({ itemId: step.itemId, answer: a });
    }
    const byItem = {};
    for (const r of records) (byItem[r.itemId] ||= []).push(r.answer);
    const slots = {};
    for (const t of TRAITS) slots[t] = BASIC_BY_TRAIT[t].map(it => {
      const vals = byItem[it.id] || [];
      const inf = findLast(vals, isInformative);
      if (inf !== undefined) return inf;
      const any = findLast(vals, v => v != null);
      return any === undefined ? null : any;
    });
    return slots;
  }

  /** 段階2：追加（言い換え）質問の計画 */
  _planFollowups() {
    const slots = this._slots([1]);
    const prov = scoreTraits(slots).scores;
    const needs = [];
    TRAITS.forEach((t, ti) => {
      const d = ITEMS.find(i => i.trait === t).domain;
      const D = DOMAINS[d];
      const diff = Math.abs(prov[D.a] - prov[D.b]);
      const informative = slots[t].filter(isInformative).length;
      if (informative >= INFORMATIVE_NEED) return;
      const cands = [];
      for (const it of BASIC_BY_TRAIT[t]) {
        const s = this._peek(this.plan.s1.find(x => x.itemId === it.id));
        if (s.answered && isInformative(s.answer)) continue;     // 3 か未回答だけ聞き直す
        // まだ見せていない表現。両方の表現を見せ済み（または同文）なら聞き直さない
        const w = s.shown.length >= 2 ? null : otherWording(it, s.shown[0]);
        if (w === null) continue;
        cands.push({ it, w });
      }
      if (!cands.length) return;
      needs.push({ t, ti, d, diff, informative, undecided: diff < TH.diff, cands });
    });
    // 優勢が決まっていない領域の傾向 → はっきりした回答が少ない順 → 傾向の並び順
    needs.sort((x, y) => (y.undecided - x.undecided) || (x.informative - y.informative) || (x.ti - y.ti));
    const out = [];
    for (const tier of [needs.filter(n => n.undecided), needs.filter(n => !n.undecided)]) {
      // 同じ段の中では1周目に1問ずつ、2周目に2問目（上限内で多くの傾向に行き渡らせる）
      for (let round = 0; round < FOLLOWUP_MAX_PER_TRAIT; round++) {
        for (const n of tier) {
          if (out.length >= FOLLOWUP_CAP) break;
          const c = n.cands[round];
          if (!c) continue;
          const D = DOMAINS[n.d];
          out.push({
            key: `s2:${c.it.id}:w${c.w}`, stage: 2, itemId: c.it.id, wordingIndex: c.w, trait: n.t, domain: n.d,
            reason: `「${n.t}」の4問のうち、はっきりした回答（3以外）が${n.informative}問。` +
              (n.undecided ? `${D.name}の左右差が${n.diff.toFixed(1)}点（<${TH.diff}）で優勢が決まっていないため優先。`
                           : `${D.name}の優勢は決まっているが、水準が曖昧。`),
          });
        }
      }
    }
    return out;
  }

  /** 段階4：追加対決の計画（段階1・2の暫定スコアと段階3の対決回答から） */
  _planExtraDuels() {
    const prov = scoreTraits(this._slots([1, 2])).scores;
    const out = [];
    for (const d of Object.keys(DOMAINS)) {
      const D = DOMAINS[d];
      const diff = Math.abs(prov[D.a] - prov[D.b]);
      const duelStep = this.plan.s3.find(s => ITEM_BY_ID[s.itemId].domain === +d);
      const a = this._answer(duelStep);
      const weak = a == null || Math.abs(3 - a) * 50 <= 50;
      const extra = EXTRA_BY_DOMAIN[d];
      if (!extra || diff >= TH.diff || !weak) continue;
      out.push({
        key: `s4:${extra.id}`, stage: 4, itemId: extra.id, wordingIndex: duelStartVariant(extra, this.config.startWording), domain: +d,
        reason: `${D.name}：5件法の左右差が${diff.toFixed(1)}点（<${TH.diff}）で、対決も${a == null ? "未回答" : a === 3 ? "「どちらとも」" : "「やや」"}だったため、別の場面でもう一度比べる。`,
      });
    }
    return out;
  }

  /** 回答済みの記録（時系列＝段階順）。採点に使う */
  records() {
    const out = [];
    for (const step of this.steps()) {
      const s = this.state[step.key];
      if (s && s.answered) out.push({ itemId: step.itemId, stage: step.stage, wordingIndex: s.answeredWording ?? s.wordingIndex, answer: s.answer, key: step.key });
    }
    return out;
  }

  /** 設問ごとの回答履歴（設問タブ用）：{itemId: [{stage, wordingIndex, answer, edits}]} */
  history() {
    const out = {};
    for (const step of this.steps()) {
      const s = this.state[step.key];
      if (!s || !s.answered) continue;
      const edits = this.log.filter(e => e.type === "answer" && e.key === step.key).length - 1;
      (out[step.itemId] ||= []).push({ stage: step.stage, wordingIndex: s.answeredWording ?? s.wordingIndex, answer: s.answer, edits, swapped: s.shown.length > 1 });
    }
    return out;
  }

  result() {
    const r = scoreRecords(this.records());
    const ans = (step) => this._answer(step);
    const followups = (this.plan.s2 || []).map(st => {
      const first = this._answer(this.plan.s1.find(x => x.itemId === st.itemId));
      const a = ans(st);
      return { itemId: st.itemId, no: ITEM_BY_ID[st.itemId].no, trait: st.trait, domain: st.domain, wordingIndex: st.wordingIndex, reason: st.reason,
        first: first ?? null, answer: a ?? null, changed: isInformative(a) };
    });
    const extraDuels = (this.plan.s4 || []).map(st => ({ itemId: st.itemId, no: ITEM_BY_ID[st.itemId].no, domain: st.domain, reason: st.reason, answer: ans(st) ?? null }));
    return { ...r, stages: { followups, extraDuels }, config: { ...this.config }, log: this.log.slice() };
  }

  toJSON() {
    return { type: "seikaku16-session", version: 1, config: this.config, plan: { s2: this.plan.s2, s4: this.plan.s4 }, state: this.state, pos: this.pos, log: this.log };
  }

  static fromJSON(obj) {
    if (!obj || obj.type !== "seikaku16-session" || obj.version !== 1) throw new Error("セッションの形式が違います");
    const s = new Session(obj.config || {});
    const known = (list) => list ? list.filter(st => ITEM_BY_ID[st.itemId]) : null;
    s.plan.s2 = known(obj.plan?.s2);
    s.plan.s4 = known(obj.plan?.s4);
    s.state = obj.state || {};
    s.log = Array.isArray(obj.log) ? obj.log : [];
    s.pos = Math.max(0, Math.min(+obj.pos || 0, s.steps().length));
    return s;
  }
}

export function createSession(opts) { return new Session(opts); }

/** 80問シート形式の回答を、固定80問のセッションとして流し込む（回答履歴つきで結果を見せるため） */
export function sessionFromAnswerMap(answers, wordingIndex = 0) {
  const s = new Session({ startWording: wordingIndex, adaptive: false });
  while (!s.isDone()) {
    const c = s.current();
    const a = answers[c.item.no] ?? answers[String(c.item.no)];
    s.answer(a == null ? null : +a);
  }
  return s;
}
