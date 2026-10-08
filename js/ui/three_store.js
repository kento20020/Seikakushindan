// 三択診断タブの状態と操作。5択版の store.js とは別に持ち、localStorage も別のキーに保存する（失敗しても動く）。
import { Session3, createSession3, fromLikertAnswers, fromScores } from "../adaptive3.js";
import { SAMPLES3, PROFILE_SAMPLES3 } from "../data/samples3.js";

const STORAGE_KEY = "seikaku16:three:v1";
export const SUBS = [["diagnose", "診断"], ["result", "結果"], ["logic", "ロジック"], ["questions", "設問"]];

export const store3 = {
  session: null,     // Session3（診断中・診断済み・サンプルを変換したもの）
  source: null,      // 結果の出どころ { type: "session"|"sample"|"profile"|"answers"|"scores", name, estimated?, key?, expected5? }
  result: null,      // session.result() ＋ source ＋ history
  screen: "start",   // 診断サブ画面 "start" | "question"
  sub: "diagnose",   // サブ画面 "diagnose" | "result" | "logic" | "questions"
};

const listeners = new Set();
export function onChange3(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) fn(); }

function build(session, source) { return { ...session.result(), source, history: session.history() }; }

function persist() {
  try {
    const data = { sub: store3.sub, ...(store3.session ? { session: store3.session.toJSON(), source: store3.source } : {}) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* 保存できない環境でもそのまま動かす */ }
}

let restored = false;
export function restore3() {
  if (restored) return;
  restored = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (SUBS.some(([k]) => k === data.sub)) store3.sub = data.sub;
    if (data.session) {
      store3.session = Session3.fromJSON(data.session);
      store3.source = data.source || { type: "session", name: "あなたの回答" };
      if (store3.session.isDone()) store3.result = build(store3.session, store3.source);
    }
  } catch { store3.session = null; store3.result = null; store3.source = null; }
}

// ---------------------------------------------------------------- 画面の切り替え
export function setSub(sub) { if (store3.sub !== sub) { store3.sub = sub; persist(); } emit(); }

// ---------------------------------------------------------------- 診断
export function start3({ adaptive }) {
  store3.session = createSession3({ adaptive });
  store3.source = { type: "session", name: "あなたの回答" };
  store3.result = null;
  store3.screen = "question"; store3.sub = "diagnose";
  persist(); emit();
}
export function resume3() { store3.screen = "question"; store3.sub = "diagnose"; emit(); }
export function toStart3() { store3.screen = "start"; emit(); }
export function discard3() {
  store3.session = null; store3.result = null; store3.source = null; store3.screen = "start";
  persist(); emit();
}

function afterStep() {
  if (store3.session.isDone()) {
    store3.result = build(store3.session, store3.source);
    store3.screen = "start"; store3.sub = "result";
  }
  persist(); emit();
}
export function answer3(side) { if (store3.session?.answer(side)) afterStep(); }
export function skip3() { if (store3.session?.skip()) afterStep(); }
export function swap3() { if (store3.session?.swap()) { persist(); emit(); } }
export function back3() { if (store3.session?.back()) { persist(); emit(); } }

// ---------------------------------------------------------------- サンプル（5択回答からの推定）
function showFinished(session, source, sub = "result") {
  store3.session = session; store3.source = source;
  store3.result = build(session, source);
  store3.screen = "start"; store3.sub = sub;
  persist(); emit();
}
export function runSample3(i, sub) {
  const s = SAMPLES3[i];
  showFinished(fromLikertAnswers(s.answers, s.wording),
    { type: "sample", name: s.label, key: s.key, estimated: true, from: "likert", wording: s.wording, expected5: s.expected5 }, sub);
}
export function runProfile3(i, sub) {
  const p = PROFILE_SAMPLES3[i];
  showFinished(fromScores(p.scores, p.duel),
    { type: "profile", name: p.label, key: p.key, estimated: true, from: "scores", expected5: p.expected5 }, sub);
}

// ---------------------------------------------------------------- JSON
export function sessionJSON() { return store3.session ? store3.session.toJSON() : null; }

/**
 * 受け付ける形：
 *   1. 三択版のセッション（type: "seikaku16-three-session"）
 *   2. 三択版の結果JSON（type: "seikaku16-three-result"。session ごと復元）
 *   3. 5択版の80問シート形式の回答 {"1":4, …}（三択の回答に変換＝推定）
 *   4. スコア {scores:{16傾向}, duel?}（三択の回答に変換＝推定）
 */
export function loadJSON3(obj, filename = "JSON") {
  if (obj?.type === "seikaku16-three-session") {
    store3.session = Session3.fromJSON(obj);
    store3.source = { type: "session", name: `読み込んだ回答（${filename}）` };
    if (store3.session.isDone()) return showFinished(store3.session, store3.source);
    store3.result = null; store3.screen = "question"; store3.sub = "diagnose";
    persist(); emit();
    return;
  }
  if (obj?.type === "seikaku16-three-result") {
    if (!obj.session) throw new Error("結果JSONに回答（session）が入っていません");
    const session = Session3.fromJSON(obj.session);
    const source = { ...(obj.source || { type: "session" }), name: `${obj.source?.name ?? "結果"}（${filename}）` };
    if (!session.isDone()) { store3.session = session; store3.source = source; store3.result = null; store3.screen = "question"; store3.sub = "diagnose"; persist(); emit(); return; }
    return showFinished(session, source);
  }
  if (obj?.type === "seikaku16-session" || obj?.type === "seikaku16-result") {
    throw new Error("5択版のセッション／結果JSONです。上の「診断」タブで読み込んでください（三択版には回答表 {\"1\":4, …} なら読み込めます）。");
  }
  const answers = obj?.answers && typeof obj.answers === "object" ? obj.answers : obj;
  const keys = answers && typeof answers === "object" ? Object.keys(answers) : [];
  if (keys.length && keys.every(k => /^\d+$/.test(k))) {
    const wording = obj.wording === 1 ? 1 : 0;
    return showFinished(fromLikertAnswers(answers, wording),
      { type: "answers", name: `${obj.name || `読み込んだ5択回答（${filename}）`}（5択回答からの推定）`, estimated: true, from: "likert", wording });
  }
  if (obj?.scores) {
    return showFinished(fromScores(obj.scores, obj.duel || {}),
      { type: "scores", name: `${obj.name || filename}（スコアからの推定）`, estimated: true, from: "scores" });
  }
  throw new Error("読み込めない形式です。三択版のセッション・結果JSON、5択版の回答表 {設問番号: 回答}、{scores: {…}} のどれかを選んでください。");
}

export { SAMPLES3, PROFILE_SAMPLES3 };
