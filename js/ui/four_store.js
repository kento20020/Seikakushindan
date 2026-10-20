// 24問版（v4）の診断の状態と操作（保存・再開）。DOM を使わない（Node のテストでも動く）。決定 U42
// 仕様：docs/diagnosis-v4.md（持ち主の仕様書（2026-10-20）の §8.2 の保存の形）。三択の three_store.js とは別に持ち、保存のキーも別。
//   v4 の保存が壊れていても、ほかの版の保存（seikaku16:three:v1 など）には触らない（読めない v4 の保存は無かったことにするだけ）
//
// 保存の形（キー seikaku16:four:v1）：
//   { schemaVersion: 1, diagnosisVersion: "v4", questionBankVersion: "v4-24-2026-10-20", questionOrder: [24個の ID],
//     answers: { R1A: { status: "answered", value: 3 }, R2B: { status: "unknown", value: null }, … }, currentIndex: 0, completed: false }
//   未回答＝answers にキーが無い。数の回答は status "answered"、判断できないは status "unknown"（value は null）
//   currentIndex は画面の位置（答えた数とは別）。completed は24問すべてに答え（判断できないを含む）があること
//   読むとき：数でない・範囲の外・整数でない・文字列の数・形の合わない値は未回答に戻す。completed は答えから決め直す
//   結果は保存しない。読むたび・答えるたびに、今の24問の答えから computeResult4 で作り直す（古い結果を使い回さない）
//
//   store4               … { session, result }（session は上の形。result は js/engine4.js の computeResult4）
//   restore4()           … 保存を読む（1回だけ）
//   start4()             … 新しく始める（前の v4 の答えは消す。ほかの版の保存には触らない）
//   answer4(value)       … 今の問いに答えて次へ。value は数か null（判断できない）。正しくない値は何もしない（false）
//   back4()              … 前の問いへ
//   discard4()           … v4 の診断を消す
//   adopt4(json)         … 別の入れ物（iPhone の Safari ↔ ホーム画面のアプリ）から移した診断に置き換える。読めなければ投げる
//   sanitizeSession4(x)  … 保存の形を確かめた写し（読めなければ null）
//   progress4(session)   … { answered（判断できないを含む）, total: 24, index, ratio }
//   onChange4(fn)        … 変わったら呼ぶ
//   useStorage4(s)       … 入れ物を差し替える（テスト用。null で globalThis.localStorage に戻す）
import { QUESTION_ORDER4, QUESTION_BANK_VERSION4, DIAGNOSIS_VERSION4, TOTAL4, ITEMS4 } from "../data/questions4.js";
import { computeResult4, validValue4 } from "../engine4.js";

export const STORAGE_KEY4 = "seikaku16:four:v1";
export const SCHEMA_VERSION4 = 1;

export const store4 = {
  session: null,   // 上の保存の形
  result: null,    // completed のときだけ computeResult4(session.answers)
};

let injected = null;
/** 入れ物を差し替える（テスト用）。null で既定（globalThis.localStorage）に戻す。差し替えたら、次の restore4 で読み直す */
export function useStorage4(storage) { injected = storage ?? null; restored = false; }
function storage() {
  if (injected) return injected;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

const listeners = new Set();
export function onChange4(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) { try { fn(); } catch (err) { console.error(err); } } }

const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);

/** 答えが全部そろっているか（判断できないも答えに数える） */
const allPresent = (answers) => QUESTION_ORDER4.every((id) => Object.hasOwn(answers, id));
const firstMissing = (answers) => {
  const i = QUESTION_ORDER4.findIndex((id) => !Object.hasOwn(answers, id));
  return i < 0 ? TOTAL4 - 1 : i;
};

/** 新しいセッション（保存の形） */
export function emptySession4() {
  return {
    schemaVersion: SCHEMA_VERSION4,
    diagnosisVersion: DIAGNOSIS_VERSION4,
    questionBankVersion: QUESTION_BANK_VERSION4,
    questionOrder: QUESTION_ORDER4.slice(),
    answers: {},
    currentIndex: 0,
    completed: false,
  };
}

/** 1問の保存値を確かめる。正しければ写し、だめなら null（＝未回答に戻す） */
function cleanAnswer(id, x) {
  if (!isObj(x)) return null;
  if (x.status === "unknown" && x.value === null) return { status: "unknown", value: null };
  if (x.status === "answered" && validValue4(id, x.value)) return { status: "answered", value: x.value };
  return null;
}

/**
 * 保存の形を確かめた写し。読めなければ null
 *   版（schemaVersion・diagnosisVersion・questionBankVersion）が違えば null。answers の中の正しくない値は未回答に戻す（キーを消す）
 *   questionOrder はいつも固定の24個に書き直す。completed は答えから決め直す。currentIndex は 0〜23 の整数に、
 *   途中なら最初の未回答より先へは進めない（壊れた値で問いを飛ばさない）
 */
export function sanitizeSession4(raw) {
  if (!isObj(raw)) return null;
  if (raw.schemaVersion !== SCHEMA_VERSION4 || raw.diagnosisVersion !== DIAGNOSIS_VERSION4 || raw.questionBankVersion !== QUESTION_BANK_VERSION4) return null;
  const answers = {};
  const src = isObj(raw.answers) ? raw.answers : {};
  for (const id of QUESTION_ORDER4) {
    if (!Object.hasOwn(src, id)) continue;
    const a = cleanAnswer(id, src[id]);
    if (a) answers[id] = a;
  }
  const completed = allPresent(answers);
  const ci = Number.isInteger(raw.currentIndex) && raw.currentIndex >= 0 && raw.currentIndex < TOTAL4 ? raw.currentIndex : null;
  const currentIndex = completed ? (ci ?? TOTAL4 - 1) : Math.min(ci ?? firstMissing(answers), firstMissing(answers));
  return { ...emptySession4(), answers, currentIndex, completed };
}

/** 進み具合：答えた数（判断できないも答えに数える）・全体（24）・今の位置 */
export function progress4(session) {
  const answers = isObj(session?.answers) ? session.answers : {};
  const answered = QUESTION_ORDER4.filter((id) => Object.hasOwn(answers, id)).length;
  return { answered, total: TOTAL4, index: session?.currentIndex ?? 0, ratio: answered / TOTAL4 };
}

/** 今の問い { item, index, answer: 前の答え（{ status, value } か null） } */
export function current4(session = store4.session) {
  if (!session) return null;
  const index = Math.max(0, Math.min(TOTAL4 - 1, session.currentIndex | 0));
  const id = QUESTION_ORDER4[index];
  return { item: ITEMS4[id], index, answer: session.answers[id] ?? null };
}

function rebuild() {
  store4.result = store4.session?.completed ? computeResult4(store4.session.answers) : null;
}

function persist() {
  try {
    const s = storage();
    if (!s) return;
    if (store4.session) s.setItem(STORAGE_KEY4, JSON.stringify(store4.session));
    else s.removeItem(STORAGE_KEY4);
  } catch { /* 保存できない環境でもそのまま動かす */ }
}

let restored = false;
/** 保存を読む（1回だけ）。読めない・壊れているときは「v4 の診断は無い」として動く（ほかの版の保存は消さない） */
export function restore4() {
  if (restored) return;
  restored = true;
  store4.session = null; store4.result = null;
  try {
    const raw = storage()?.getItem(STORAGE_KEY4);
    if (raw) store4.session = sanitizeSession4(JSON.parse(raw));
  } catch { store4.session = null; }
  rebuild();
}

/** 新しく始める（v4 の前の答えは消える） */
export function start4() {
  restored = true;
  store4.session = emptySession4();
  rebuild();
  persist(); emit();
}

/**
 * 今の問いに答えて次へ → 答えられたか
 *   value：数（R は 0〜4、P は −2〜＋2）か null（判断できない）
 *   24問すべてに答え（判断できないを含む）がそろったら完了。そろっていなければ次の問いへ。
 *   最後の問い（24問目）のあとに欠けがあれば（壊れた保存を読んだときだけ）最初の未回答へ（追加の問いは出さない）
 */
export function answer4(value) {
  const s = store4.session;
  if (!s || s.completed) return false;
  const c = current4(s);
  if (!c) return false;
  const id = c.item.id;
  if (value === null) s.answers[id] = { status: "unknown", value: null };
  else if (validValue4(id, value)) s.answers[id] = { status: "answered", value };
  else return false;
  const next = c.index + 1;
  if (allPresent(s.answers)) { s.completed = true; s.currentIndex = TOTAL4 - 1; }
  else if (next < TOTAL4) s.currentIndex = next;
  else s.currentIndex = firstMissing(s.answers);
  rebuild();
  persist(); emit();
  return true;
}

/** 前の問いへ → 戻れたか */
export function back4() {
  const s = store4.session;
  if (!s || s.completed || s.currentIndex <= 0) return false;
  s.currentIndex -= 1;
  persist(); emit();
  return true;
}

/** v4 の診断を消す（ほかの版の保存には触らない） */
export function discard4() {
  restored = true;
  store4.session = null; store4.result = null;
  persist(); emit();
}

/** 移した診断に置き換える（app/js/transfer.js）。読めなければ投げる（そのときは今の診断を変えない） */
export function adopt4(json) {
  const s = sanitizeSession4(json);
  if (!s) throw new Error("24問の診断として読めません");
  restored = true;
  store4.session = s;
  rebuild();
  persist(); emit();
  return true;
}

/** 保存の形の写し（無ければ null） */
export function session4JSON() {
  return store4.session ? JSON.parse(JSON.stringify(store4.session)) : null;
}
