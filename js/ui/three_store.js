// 三択診断タブの状態と操作。5択版の store.js とは別に持ち、localStorage も別のキーに保存する（失敗しても動く）。
import { Session3, createSession3, fromLikertAnswers, fromScores } from "../adaptive3.js";
import { SAMPLES3, PROFILE_SAMPLES3 } from "../data/samples3.js";
import { resolveVersion, versionOf, isVersion, versionFromSearch } from "../three_version.js";

const STORAGE_KEY = "seikaku16:three:v1";
export const SUBS = [["diagnose", "診断"], ["result", "結果"], ["logic", "ロジック"], ["questions", "設問"]];

export const store3 = {
  session: null,     // Session3（診断中・診断済み・サンプルを変換したもの）
  source: null,      // 結果の出どころ { type: "session"|"sample"|"profile"|"answers"|"scores", name, estimated?, key?, expected5? }
  result: null,      // session.result() ＋ source ＋ history
  screen: "start",   // 診断サブ画面 "start" | "question"
  sub: "diagnose",   // サブ画面 "diagnose" | "result" | "logic" | "questions"
  fbMode: false,     // テスト協力モード（?fb=1 か開始画面のチェック）。オンのまま保存する
  fb: null,          // テスト協力の記録（このセッションをテスト協力モードで始めたときだけ。js/feedback_collect.js）。screen "fb" はその画面
  qv: resolveVersion({}),   // 新しく始める診断・サンプルの設問の版（"v1" | "v2"）。restore3 で URL ?qv= ＞ 保存中のセッションの版 ＞ 既定 から決める
  qvFromUrl: false,  // qv を URL の ?qv= で決めたか（開始画面に表示する）
  practice: null,    // v2 の練習カード："pending"＝1問目の前に出す（採点しない・時間を測らない）。答えるか、回答が1つでもあれば出さない
};

const listeners = new Set();
export function onChange3(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) fn(); }

function build(session, source) { return { ...session.result(), source, history: session.history() }; }

function persist() {
  try {
    const data = { sub: store3.sub, ...(store3.fbMode ? { fbMode: true } : {}),
      ...(store3.session ? { session: store3.session.toJSON(), source: store3.source, ...(store3.fb ? { fb: store3.fb } : {}), ...(store3.practice ? { practice: store3.practice } : {}) } : {}) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* 保存できない環境でもそのまま動かす */ }
}

let restored = false;
export function restore3() {
  if (restored) return;
  restored = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (SUBS.some(([k]) => k === data.sub)) store3.sub = data.sub;
      store3.fbMode = data.fbMode === true;
      if (data.session) {
        store3.session = Session3.fromJSON(data.session);
        store3.source = data.source || { type: "session", name: "あなたの回答" };
        store3.fb = data.fb && typeof data.fb === "object" ? data.fb : null;
        store3.practice = data.practice === "pending" ? "pending" : null;
        if (store3.session.isDone()) store3.result = build(store3.session, store3.source);
      }
    }
  } catch { store3.session = null; store3.result = null; store3.source = null; store3.fb = null; store3.practice = null; }
  // 設問の版：URL の ?qv= ＞ 保存中のセッションの版 ＞ 既定（js/three_version.js の DEFAULT_THREE_VERSION）
  const search = (() => { try { return globalThis.location?.search || ""; } catch { return ""; } })();
  store3.qvFromUrl = versionFromSearch(search) != null;
  store3.qv = resolveVersion({ search, saved: store3.session?.config?.version });
  // URL に ?fb=1 があればテスト協力モードをオンにして保存する（再読み込みしても続く）
  try { if (new URLSearchParams(globalThis.location?.search || "").get("fb") === "1" && !store3.fbMode) { store3.fbMode = true; persist(); } } catch { /* 無視 */ }
}

// ---------------------------------------------------------------- テスト協力モード（js/ui/feedback.js から使う）
/** 操作の通知（回答・差し替え・答えずに進む・戻る）。fn({ type, before: 操作前の current(), via: "s"|"t"|"k"|"x" }) */
const actionHooks = new Set();
export function onAction3(fn) { actionHooks.add(fn); }
// via：スワイプ "s"／タップ "t"／キー "k"。ボタンの onclick に直接渡したときはイベントが来るのでタップ扱い
const viaOf = (v) => v === "s" || v === "t" || v === "k" ? v : v && typeof v === "object" ? "t" : "x";
function act(type, before, via) {
  for (const fn of actionHooks) { try { fn({ type, before, via: viaOf(via) }); } catch (err) { console.error(err); } }
}
export function setFbMode3(on) { store3.fbMode = !!on; persist(); }
/** 記録を書き換えたあとに保存（render: true なら再描画も） */
export function save3({ render = false } = {}) { persist(); if (render) emit(); }
/** テスト協力の画面（診断サブ画面の中）へ */
export function showFb3() { store3.screen = "fb"; store3.sub = "diagnose"; persist(); emit(); }

// ---------------------------------------------------------------- 画面の切り替え
export function setSub(sub) { if (store3.sub !== sub) { store3.sub = sub; persist(); } emit(); }

// ---------------------------------------------------------------- 診断
/** version 省略時は開始画面で選んでいる版（store3.qv） */
export function start3({ adaptive, fb = null, version = store3.qv }) {
  const v = isVersion(version) ? version : store3.qv;
  store3.qv = v;
  store3.session = createSession3({ adaptive, version: v });
  store3.source = { type: "session", name: "あなたの回答" };
  store3.result = null;
  store3.fb = fb || null;
  store3.practice = versionOf(v).practice ? "pending" : null;
  store3.screen = fb && fb.phase === "code" ? "fb" : "question"; store3.sub = "diagnose";
  persist(); emit();
}
export function resume3() { store3.screen = "question"; store3.sub = "diagnose"; emit(); }
export function toStart3() { store3.screen = "start"; emit(); }
export function discard3() {
  store3.session = null; store3.result = null; store3.source = null; store3.fb = null; store3.practice = null; store3.screen = "start";
  persist(); emit();
}

function afterStep() {
  if (store3.session.isDone()) {
    store3.result = build(store3.session, store3.source);
    // テスト協力モードでは、結果より先に質問（パート1）を出す
    if (store3.fb) { store3.screen = "fb"; store3.sub = "diagnose"; }
    else { store3.screen = "start"; store3.sub = "result"; }
  }
  persist(); emit();
}
// ---------------------------------------------------------------- 練習カード（v2）
/** いま練習カードを出すか：練習が残っていて、まだ1問も答えていない（途中再開で回答があれば出さない） */
export function practicePending3() {
  const s = store3.session;
  return store3.practice === "pending" && !!s && !s.isDone() && s.progress().answered === 0;
}
/** 練習カードに答えた（左右どちらでも同じ）。セッションには何も記録しない（採点しない・時間を測らない・操作の通知も出さない） */
export function practice3(side) {
  if (!practicePending3()) return false;
  store3.practice = null;
  store3.lastPractice = side === "left" || side === "right" ? side : null;
  persist(); emit();
  return true;
}
/** 開始画面の「設問の版」（新しく始める診断・サンプル用） */
export function setQv3(v) { if (isVersion(v)) store3.qv = v; }

// via（省略可）：どの入力で操作したか（テスト協力モードの記録用）
export function answer3(side, via) { const before = store3.session?.current(); if (store3.session?.answer(side)) { act("answer", before, via); afterStep(); } }
export function skip3(via) { const before = store3.session?.current(); if (store3.session?.skip()) { act("skip", before, via); afterStep(); } }
export function swap3(via) { const before = store3.session?.current(); if (store3.session?.swap()) { act("swap", before, via); persist(); emit(); } }
export function back3(via) { const before = store3.session?.current(); if (store3.session?.back()) { act("back", before, via); persist(); emit(); } }

// ---------------------------------------------------------------- サンプル（5択回答からの推定）
function showFinished(session, source, sub = "result") {
  store3.session = session; store3.source = source; store3.fb = null; store3.practice = null;
  store3.result = build(session, source);
  store3.screen = "start"; store3.sub = sub;
  persist(); emit();
}
export function runSample3(i, sub) {
  const s = SAMPLES3[i];
  showFinished(fromLikertAnswers(s.answers, s.wording, { version: store3.qv }),
    { type: "sample", name: s.label, key: s.key, estimated: true, from: "likert", wording: s.wording, expected5: s.expected5 }, sub);
}
export function runProfile3(i, sub) {
  const p = PROFILE_SAMPLES3[i];
  showFinished(fromScores(p.scores, p.duel, { version: store3.qv }),
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
    store3.fb = null; store3.practice = null;
    if (store3.session.isDone()) return showFinished(store3.session, store3.source);
    store3.result = null; store3.screen = "question"; store3.sub = "diagnose";
    persist(); emit();
    return;
  }
  if (obj?.type === "seikaku16-three-result") {
    if (!obj.session) throw new Error("結果JSONに回答（session）が入っていません");
    const session = Session3.fromJSON(obj.session);
    const source = { ...(obj.source || { type: "session" }), name: `${obj.source?.name ?? "結果"}（${filename}）` };
    if (!session.isDone()) { store3.session = session; store3.source = source; store3.result = null; store3.fb = null; store3.practice = null; store3.screen = "question"; store3.sub = "diagnose"; persist(); emit(); return; }
    return showFinished(session, source);
  }
  if (obj?.type === "seikaku16-session" || obj?.type === "seikaku16-result") {
    throw new Error("5択版のセッション／結果JSONです。上の「診断」タブで読み込んでください（三択版には回答表 {\"1\":4, …} なら読み込めます）。");
  }
  const answers = obj?.answers && typeof obj.answers === "object" ? obj.answers : obj;
  const keys = answers && typeof answers === "object" ? Object.keys(answers) : [];
  if (keys.length && keys.every(k => /^\d+$/.test(k))) {
    const wording = obj.wording === 1 ? 1 : 0;
    return showFinished(fromLikertAnswers(answers, wording, { version: store3.qv }),
      { type: "answers", name: `${obj.name || `読み込んだ5択回答（${filename}）`}（5択回答からの推定）`, estimated: true, from: "likert", wording });
  }
  if (obj?.scores) {
    return showFinished(fromScores(obj.scores, obj.duel || {}, { version: store3.qv }),
      { type: "scores", name: `${obj.name || filename}（スコアからの推定）`, estimated: true, from: "scores" });
  }
  throw new Error("読み込めない形式です。三択版のセッション・結果JSON、5択版の回答表 {設問番号: 回答}、{scores: {…}} のどれかを選んでください。");
}

export { SAMPLES3, PROFILE_SAMPLES3 };
