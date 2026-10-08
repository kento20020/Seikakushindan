// 画面全体の状態と操作。状態はメモリ上に持ち、セッションは localStorage に自動保存する（失敗しても動く）。
import { Session, createSession, sessionFromAnswerMap, scoreFromAnswerMap } from "../adaptive.js";
import { select, DOMAINS, TRAITS } from "../engine.js";
import { SAMPLES, PROFILE_SAMPLES } from "../data/samples.js";

const STORAGE_KEY = "seikaku16:v1";

export const store = {
  session: null,      // Session（診断中・診断済み）。プロファイルだけ読み込んだときは null
  source: null,       // 結果の出どころ { type: "session"|"sample"|"answers"|"profile", name, expected? }
  result: null,       // 結果モデル（下の buildFrom〜 で作る）
  screen: "start",    // 診断タブの画面 "start" | "question"
  review: null,       // 設問レビュー { items, summary }（設問タブを開いたときに読み込む）
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) fn(); }
export function go(tab) { if (location.hash !== "#" + tab) location.hash = tab; else emit(); }

// ---------------------------------------------------------------- 結果モデル
function buildFromSession(session, source) {
  return { ...session.result(), source, history: session.history() };
}

/** 対決 {d:{side,strength}} / {d:[side,strength]} のどちらも受ける */
function normalizeDuel(duel) {
  const out = {};
  for (const [d, v] of Object.entries(duel || {})) {
    if (Array.isArray(v)) out[d] = { side: v[0] ?? null, strength: +v[1] || 0 };
    else if (v && typeof v === "object") out[d] = { side: v.side ?? null, strength: +v.strength || 0 };
  }
  return out;
}

export function buildFromProfile(p, source) {
  const scores = {};
  for (const t of TRAITS) {
    const v = Number(p.scores?.[t]);
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error(`スコア「${t}」がありません（0〜100の数値が必要です）`);
    scores[t] = v;
  }
  const duel = normalizeDuel(p.duel);
  const profile = { scores, duel, qualityOk: p.qualityOk ?? p.quality_ok ?? true, rawScores: { ...scores } };
  const duelDetail = Object.keys(DOMAINS).map(d => ({
    domain: +d, name: DOMAINS[d].name, sideA: DOMAINS[d].a, sideB: DOMAINS[d].b, answers: [],
    side: duel[d]?.side ?? null, strength: duel[d]?.strength ?? 0, n: duel[d] ? 1 : 0,
  }));
  return { profile, scores, confidence: null, informative: null, quality: null, consistency: null, duelDetail,
    select: select(profile), stages: null, source, history: null };
}

// ---------------------------------------------------------------- 保存・復元
function persist() {
  try {
    let data = null;
    if (store.session) data = { kind: "session", source: store.source, session: store.session.toJSON() };
    else if (store.result) data = { kind: "profile", source: store.source, profile: store.result.profile };
    if (data) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* 保存できない環境（プライベートモードなど）でもそのまま動かす */ }
}

export function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.kind === "session") {
      store.session = Session.fromJSON(data.session);
      store.source = data.source || { type: "session", name: "あなたの回答" };
      if (store.session.isDone()) store.result = buildFromSession(store.session, store.source);
    } else if (data.kind === "profile") {
      store.source = data.source;
      store.result = buildFromProfile(data.profile, data.source);
    }
  } catch { store.session = null; store.result = null; store.source = null; }
}

// ---------------------------------------------------------------- 診断の操作
export function startSession({ adaptive, startWording }) {
  store.session = createSession({ adaptive, startWording });
  store.source = { type: "session", name: "あなたの回答" };
  store.result = null;
  store.screen = "question";
  persist(); emit();
}
export function resumeSession() { store.screen = "question"; emit(); }
export function toStart() { store.screen = "start"; emit(); }
export function discardSession() {
  store.session = null; store.result = null; store.source = null; store.screen = "start";
  persist(); emit();
}

function afterStep() {
  persist();
  if (store.session.isDone()) {
    store.result = buildFromSession(store.session, store.source);
    store.screen = "start";
    persist();
    go("result");
    return;
  }
  emit();
}
export function answer(v) { if (store.session?.answer(v)) afterStep(); }
export function swapWording() { if (store.session?.swapWording()) { persist(); emit(); } }
export function back() { if (store.session?.back()) { persist(); emit(); } }

// ---------------------------------------------------------------- サンプル・読み込み
export function runSample(i, tab = "result") {
  const s = SAMPLES[i];
  store.session = sessionFromAnswerMap(s.answers, s.wording);
  store.source = { type: "sample", name: s.name, expected: s.expected, wording: s.wording };
  store.result = buildFromSession(store.session, store.source);
  store.screen = "start";
  persist(); go(tab);
}

export function loadProfileSample(i, tab = "result") {
  const p = PROFILE_SAMPLES[i];
  store.session = null;
  store.source = { type: "profile", name: p.name, expected: p.expected };
  store.result = buildFromProfile(p, store.source);
  store.screen = "start";
  persist(); go(tab);
}

/**
 * JSON を読み込む。受け付ける形：
 *   1. 途中保存・診断済みのセッション（type: "seikaku16-session"）
 *   2. 「結果JSONを保存」で書き出したファイル（type: "seikaku16-result"。session があれば回答ごと復元）
 *   3. 80問シート形式の回答 {"1":4, "2":1, …}（wording があれば表現として使う）
 *   4. プロファイル {scores:{16傾向}, duel?, qualityOk?}
 */
export function loadJSON(obj, filename = "JSON") {
  if (obj?.type === "seikaku16-session") {
    store.session = Session.fromJSON(obj);
    store.source = { type: "session", name: `読み込んだ回答（${filename}）` };
    if (store.session.isDone()) { store.result = buildFromSession(store.session, store.source); store.screen = "start"; persist(); go("result"); }
    else { store.result = null; store.screen = "question"; persist(); go("diagnose"); }
    return;
  }
  if (obj?.type === "seikaku16-result") {
    if (obj.session) return loadJSON(obj.session, filename);
    store.session = null;
    store.source = { type: "profile", name: obj.source?.name ? `${obj.source.name}（${filename}）` : filename };
    store.result = buildFromProfile(obj.profile, store.source);
    persist(); go("result");
    return;
  }
  const answers = obj?.answers && typeof obj.answers === "object" ? obj.answers : obj;
  const keys = answers && typeof answers === "object" ? Object.keys(answers) : [];
  if (keys.length && keys.every(k => /^\d+$/.test(k))) {
    const wording = obj.wording === 1 ? 1 : 0;
    scoreFromAnswerMap(answers, wording);   // 形式チェック（例外なら下で報告）
    store.session = sessionFromAnswerMap(answers, wording);
    store.source = { type: "answers", name: obj.name || `読み込んだ回答（${filename}）`, wording };
    store.result = buildFromSession(store.session, store.source);
    persist(); go("result");
    return;
  }
  if (obj?.scores) {
    store.session = null;
    store.source = { type: "profile", name: obj.name || filename };
    store.result = buildFromProfile(obj, store.source);
    persist(); go("result");
    return;
  }
  throw new Error("読み込めない形式です。セッション・結果JSON・{設問番号: 回答} の回答表・{scores: {…}} のどれかを選んでください。");
}

// ---------------------------------------------------------------- 設問レビュー（任意ファイル）
/** js/data/item_review.js があれば読む。無い・壊れていても空で続ける */
export async function loadReview() {
  if (store.review) return store.review;
  try {
    const m = await import("../data/item_review.js");
    store.review = { items: m.ITEM_REVIEW || {}, summary: m.REVIEW_SUMMARY || null };
  } catch {
    store.review = { items: {}, summary: null };
  }
  return store.review;
}

export { SAMPLES, PROFILE_SAMPLES };
