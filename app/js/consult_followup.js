// 相談の「続き（往復）」のうち、DOM を使わない部分。仕様：docs/app-screens.md §11（決定 U30）。node でテストできる（tests/app_followup.test.mjs）
//   最初のカードのあと、［相手の返事を貼る］［送った］［もう少し話したい］のたびに「状況の項目」を書き換え、今の判定で一手を決め直す。
//   AI は使わない。文はすべて決まった文。一手が変わったときだけ新しいカード（画面は app/js/consult.js）。
//   判定はカードと同じ道（poc/card/model.js の buildPoc → js/consult/ の judge と文型）。js/ と poc/ は直さない。
//
//   状況の項目（known）：判定の入力の一部。js/consult/needed.js の ASKABLE の項目と afterMakeup（分からない項目は入れない）。
//     深夜かどうか（lateNight）は時刻で変わるので known には入れず、判定のたびに今の時刻で決める（rejudge）
//
//   SELF_LAST_BY_ACTION            今の一手 → 送ったあとの「自分の最後の送り方」（§11.4 の表。null は「変えない」）
//   afterSent(known, action, now)  ［送った］→ { known, sentAt }
//   afterNoReply(known, elapsed)   ［まだ来ない］→ known（elapsed はミリ秒か区切りの値）
//   afterReply(known, kind, { sent })  ［相手の返事を貼る］→ known
//   mergeTalk(known, fields)       ［もう少し話したい］で読めた項目を重ねる → known
//   elapsedBucket(ms) / sinceText(ms)  時間の区切り／「送ってから◯時間ほどですね。」
//   checkReply(action, kind)       答え合わせの1行 { result: "near" | "different", text }
//   actionChanged(prev, next)      一手か安全の扱いが変わったか
//   statusLines(known)             「いまの状況」の3行
//   rejudge(a)                     判定し直す（buildPoc と同じ。一手は今のカードと同じ手順で決まる）
//   readReply(raw) / replyText(raw)  貼った相手の返事を読む（`相手から「…」と返事が来た` の形にして readText へ）
//   talkAccept(read)               ［もう少し話したい］の受け止め（気持ちの部分だけ）
//   keepText(model)                一手が変わらないときの吹き出し
//   splitExtra(known, extra)       カードで足した差分のうち、状況の項目を known へ移す
import { ASKABLE, nextQuestion } from "../../js/consult/needed.js";
import { readText } from "../../js/consult/extract.js";
import { isLateNight } from "../../js/consult/timefmt.js";
import { GROUPS } from "../../js/ui/consult_state.js";
import * as M from "../../poc/card/model.js";

/** 1回の相談の往復の上限（定義書のサブスクの上限。往復＝下の3つのボタンのどれかで1回） */
export const MAX_TURNS = 10;

/** 状況の項目（往復で書き換える・「いまの状況」で直せる） */
export const FOLLOW_KEYS = [...Object.keys(ASKABLE), "afterMakeup"];
const validValue = (key, v) => key === "afterMakeup" ? typeof v === "boolean" : (ASKABLE[key] || []).includes(v);

// ---------------------------------------------------------------- 決まった文
export const TEXTS = Object.freeze({
  sentAsk: "送ったんですね。どうなった？",
  keep: "一手はこのままで大丈夫です。",
  talkThanks: "話してくれて、ありがとうございます。",
  near: "予想に近い返事です。",
  different: "予想とはちがう返事でした。ここから一緒に考え直します。",
  edited: "状況を直しました。",
  limit: "この相談はここまでです",
});

// ---------------------------------------------------------------- ［送った］
/**
 * 今の一手 → 送ったあとの「自分の最後の送り方」（selfLast）。docs/app-screens.md §11.4 の表。
 * null は「変えない」：待つ一手（今は何も送らない一手）。それでも［送った］を押したときは、送ったものとして「保留」（hold）にする（afterSent）
 */
export const SELF_LAST_BY_ACTION = Object.freeze({
  apology_partial: "apology", apology_full: "apology",
  acknowledge: "reconcile", short_feeling: "reconcile", accept_apology: "reconcile", restore_routine: "reconcile",
  ask_feeling: "reconcile", propose_call: "reconcile", propose_talk_plan: "reconcile",
  pause_with_time: "hold", accept_space: "hold", request_space: "hold",
  wait_until: null, self_calm: null, prepare_points: null,
});

/**
 * ［送った］：最後に送ったのは自分・3時間未満・相手からはまだ無し・自分の最後の送り方は今の一手から。
 * 仕様に足したこと：したいこと（intent）は「特になし」に、言い合いの最中（ongoing）は「止まっている」に戻す。
 *   謝る・伝える・距離のお願いは送ったことで済んだとみなす（戻さないと、送ったあとも同じ「謝る」などが出続ける）。
 *   「いったん止める」などを送ったあとは、言い合いは止まっている
 * @param {object} known  状況の項目
 * @param {string} action 今のカードの一手
 * @param {Date} [now]    送った時刻（既定は今）
 * @returns {{ known: object, sentAt: string }}  sentAt：送った時刻（ISO）。［まだ来ない］で経った時間を出すのに使う
 */
export function afterSent(known = {}, action, now = new Date()) {
  const k = { ...known, lastSender: "self", elapsed: "lt3h", partnerLast: "none", ongoing: false };
  if (k.intent !== undefined) k.intent = "none";
  k.selfLast = SELF_LAST_BY_ACTION[action] ?? "hold";
  return { known: k, sentAt: now.toISOString() };
}

const MIN = 60 * 1000, HOUR = 60 * MIN;
/**
 * 経った時間（ミリ秒）→ 時間の区切り。3時間未満／3〜12時間／半日〜2日（3日未満までをここに入れる）／3日以上。
 * 数でない・負のときは 3時間未満
 */
export function elapsedBucket(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 3 * HOUR) return "lt3h";
  if (v < 12 * HOUR) return "3h_12h";
  if (v < 72 * HOUR) return "12h_2d";
  return "ge3d";
}

/** 「送ってから◯時間ほどですね。」（1時間未満・時間・日の3通り。数字は時間の長さだけ） */
export function sinceText(ms) {
  const v = Number.isFinite(Number(ms)) && Number(ms) > 0 ? Number(ms) : 0;
  const h = v / HOUR;
  if (h < 1) return "送ってから、まだ1時間たっていませんね。";
  if (h < 23.5) return `送ってから${Math.max(1, Math.round(h))}時間ほどですね。`;
  return `送ってから${Math.max(1, Math.round(h / 24))}日ほどですね。`;
}

/** ［まだ来ない］：経った時間（ミリ秒か区切りの値）を入れる。ほかは変えない */
export function afterNoReply(known = {}, elapsed) {
  const bucket = typeof elapsed === "string" && ASKABLE.elapsed.includes(elapsed) ? elapsed : elapsedBucket(elapsed);
  return { ...known, lastSender: "self", elapsed: bucket };
}

// ---------------------------------------------------------------- ［相手の返事を貼る］
/** 貼った文 → 読み取りに渡す形（中の「」は『』に、改行は空白に） */
export function replyText(raw) {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim().replace(/「/g, "『").replace(/」/g, "』");
  return `相手から「${t}」と返事が来た`;
}

/**
 * 貼った相手の返事を読む。kind：相手の言葉の種類（読めなければ null）。safety：安全の言葉（規則で毎回見る）
 * @returns {{ kind: string|null, read: object, safety: { selfHarm: boolean, partnerThreat: boolean } }}
 */
export function readReply(raw) {
  const read = readText(replyText(raw));
  const k = read.fields.partnerLast;
  return { kind: k && k !== "none" ? k : null, read, safety: read.safety };
}

/** 相手の言葉が読めなかったときの1問（js/consult/needed.js の partnerLast の問の選択肢と同じ。並びと言葉は GROUPS） */
export const REPLY_KIND_QUESTION = Object.freeze({
  id: "replyKind",
  text: "相手の返事はどれに近い？",
  options: GROUPS.partnerLast.options.filter(([v]) => v !== "none").map(([v, label]) => ({ label, kind: v, patch: { partnerLast: v } })),
});

/**
 * ［相手の返事を貼る］：最後は相手から・相手の言葉の種類・3時間未満・言い合いの最中ではない。
 * 自分の最後の送り方（selfLast）は変えない（［送った］を押していたら、そこで入れた値のまま）
 * @param {{ sent?: boolean }} [opts]  sent：この返事の前に［送った］を押したか（今は selfLast を変えないだけ。記録に使う）
 */
export function afterReply(known = {}, kind, { sent = false } = {}) {
  const k = { ...known, lastSender: "partner", elapsed: "lt3h", ongoing: false };
  if (kind && ASKABLE.partnerLast.includes(kind)) k.partnerLast = kind;
  else delete k.partnerLast;
  void sent;   // selfLast は、押していても押していなくても今のまま（押していれば afterSent で入れた値）
  return k;
}

/** 落ち着いた返事／強い返事 */
const CALM_KINDS = new Set(["casual", "explain", "talk_proposal", "apology"]);
const STRONG_KINDS = new Set(["attack", "space", "breakup"]);
/**
 * 答え合わせの1行（数字なし・「当たる」と言わない）。最初のカードの「相手はたぶん」（GUESS）と比べる。§11.4 の表
 *   落ち着いた返事（普通の話題・説明・話し合いの提案・謝り）→ 近い（一手が「距離の受け止め」のときも同じ）
 *   強い返事（責める・距離・別れ話）→ ちがう。ただし一手が「距離の受け止め」（accept_space）で距離・別れ話が来たときは近い
 * @returns {{ result: "near" | "different", text: string } | null}  種類が分からなければ null
 */
export function checkReply(action, kind) {
  if (CALM_KINDS.has(kind)) return { result: "near", text: TEXTS.near };
  if (STRONG_KINDS.has(kind)) {
    if (action === "accept_space" && (kind === "space" || kind === "breakup")) return { result: "near", text: TEXTS.near };
    return { result: "different", text: TEXTS.different };
  }
  return null;
}

// ---------------------------------------------------------------- ［もう少し話したい］
/** 書いた文から読めた項目だけを重ねる（値が正しいものだけ。分からない項目は今のまま） */
export function mergeTalk(known = {}, fields = {}) {
  const k = { ...known };
  for (const key of FOLLOW_KEYS) {
    const v = fields?.[key];
    if (v !== undefined && validValue(key, v)) k[key] = v;
  }
  return k;
}

const FEELING_FIELDS = ["selfTemp", "intent", "goal", "cause"];
/**
 * ［もう少し話したい］の受け止め：今の受け止めの決まった文（model.js の acceptText）のうち、気持ちの部分だけ。
 * 気持ち（selfTemp）かどうしたいか（intent・goal）が読めなければ「話してくれて、ありがとうございます。」
 * @param {object} read  readText の結果
 * @param {string} [text] 書いた文
 */
export function talkAccept(read, text = "") {
  const f = read?.fields || {};
  const k = {};
  for (const key of FEELING_FIELDS) if (f[key] !== undefined) k[key] = f[key];
  if (!("selfTemp" in k) && !M.knownWantKey(k)) return TEXTS.talkThanks;
  return M.acceptText({ known: k, text, evidence: read?.evidence || {} });
}

/**
 * ［もう少し話したい］のあとの1問：今の足りない問の仕組み（nextQuestion）で、一手が変わる項目があれば1つだけ。無ければ null。
 * asked：この相談でもう聞いた問（最初の足りない問も含む）。同じ項目は二度聞かない
 */
export function talkQuestion(known = {}, asked = [], context = {}) {
  return nextQuestion({ ...context, ...known }, asked, { maxTotal: (asked?.length || 0) + 1 });
}

// ---------------------------------------------------------------- 判定し直す
/** カードで足した差分（［ちがう］［もっと合わせる］）のうち、状況の項目を known へ移す（往復で書き換える項目が、差分に上書きされないように） */
export function splitExtra(known = {}, extra = {}) {
  const k = { ...known }, e = {};
  for (const [key, v] of Object.entries(extra || {})) {
    if (FOLLOW_KEYS.includes(key)) k[key] = v; else e[key] = v;
  }
  return { known: k, extra: e };
}

/**
 * 判定し直す。最初のカードと同じ道（buildPoc：needed.js の finalInput → judge → 文型）で、一手は今のカードと同じ手順で決まる。
 * 深夜かどうかは now から（lateNight を渡せばそれを使う）
 * @param {{ known: object, extra?: object, text?: string, now: Date, tzOffset?: number, safetyContinue?: boolean, safety?: object, lateNight?: boolean }} a
 */
export function rejudge({ known = {}, extra = {}, text = "", now, tzOffset, safetyContinue = false, safety, lateNight } = {}) {
  const late = typeof lateNight === "boolean" ? lateNight : isLateNight(now, Number.isFinite(tzOffset) ? tzOffset : -now.getTimezoneOffset());
  return M.buildPoc({ known: { ...known, lateNight: late }, extra, text, now, tzOffset, safetyContinue, safety });
}

const actionOf = (m) => m?.result?.action ?? m?.action ?? null;
const modeOf = (m) => m?.mode ?? null;
const safetyOf = (m) => !!(m?.safetyLine && m.safetyLine.length);
/** 一手か安全の扱いが変わったか（buildPoc の結果でも、履歴の写し snapshotOf でもよい） */
export function actionChanged(prev, next) {
  if (!prev || !next) return true;
  return actionOf(prev) !== actionOf(next) || modeOf(prev) !== modeOf(next) || safetyOf(prev) !== safetyOf(next);
}

/** 一手が変わらないときの吹き出し（短い案内つき） */
export function keepText(model) {
  if (model?.mode === "wait") {
    // 「明日 8:00」のような言い方は履歴で読むとずれるので、時刻そのものは書かずカードの欄の名前で案内する
    return model.ret ? `${TEXTS.keep}上のカードの「${M.timeLabel(model.result?.action ?? model.action)}」まで、このまま待つ形です。` : `${TEXTS.keep}上のカードのとおりに進められます。`;
  }
  const d = model?.card?.drafts?.[0] ?? model?.drafts?.[0];
  return d?.label ? `${TEXTS.keep}上のカードの「${d.label}」を、そのまま使えます。` : TEXTS.keep;
}

// ---------------------------------------------------------------- 「いまの状況」の3行
const optLabel = (key, v) => {
  if (key === "ongoing") return v ? "今も言い合っている" : "いまは止まっている";
  if (key === "afterMakeup") return v ? "もう仲直りした" : "まだ仲直りしていない";
  if (key === "repeat") return v ? "前にもあった（くり返し）" : "初めて";
  return GROUPS[key]?.options.find(o => o[0] === v)?.[1] ?? null;
};
const has = (k, f) => k != null && Object.hasOwn(k, f) && k[f] !== undefined && k[f] !== null;
/** 状況の項目の値の言葉（分からなければ「分からない」） */
export function valueLabel(key, v) {
  if (v === undefined || v === null) return "分からない";
  return optLabel(key, v) ?? "分からない";
}

/**
 * 「いまの状況」の3行（受け止めと状況の整理の項目の言葉を使う）：
 *   1行目 やりとり（最後に送ったのはどちらか・相手や自分の最後の言葉）
 *   2行目 どれくらい前か
 *   3行目 いまの気持ち・したいこと（またはゴール）
 */
export function statusLines(known = {}) {
  const k = known;
  let l1;
  if (k.ongoing === true) l1 = "いま言い合いの最中";
  else if (k.lastSender === "self") l1 = `最後に送ったのは自分${has(k, "selfLast") && k.selfLast !== "none" ? `（${valueLabel("selfLast", k.selfLast)}）` : ""}`;
  else if (k.lastSender === "partner") l1 = `最後は相手から${has(k, "partnerLast") && k.partnerLast !== "none" ? `（${valueLabel("partnerLast", k.partnerLast)}）` : ""}`;
  else if (k.lastSender === "none") l1 = "どちらも送っていない";
  else l1 = "最後に送ったのは：分からない";
  if (k.lastSender !== "partner" && (k.partnerLast === "space" || k.partnerLast === "breakup")) l1 += `。相手の言葉：${valueLabel("partnerLast", k.partnerLast)}`;
  if (k.afterMakeup === true) l1 = `もう仲直りした。${l1}`;
  const l2 = `最後のやりとりから：${valueLabel("elapsed", k.elapsed)}`;
  const feel = [];
  if (has(k, "selfTemp")) feel.push(`いまの気持ち：${valueLabel("selfTemp", k.selfTemp)}`);
  if (has(k, "intent") && k.intent !== "none") feel.push(`したいこと：${valueLabel("intent", k.intent)}`);
  else if (has(k, "goal")) feel.push(`ゴール：${valueLabel("goal", k.goal)}`);
  const l3 = feel.length ? feel.join("。") : "いまの気持ち：分からない";
  return [l1, l2, l3];
}

/** 「いまの状況」で直せる項目と、その問い（model.js の FIELD_NAMES）・選択肢 */
export const EDIT_KEYS = ["lastSender", "partnerLast", "selfLast", "elapsed", "ongoing", "selfTemp", "intent", "goal", "cause", "repeat"];
export function editOptions(key) { return M.fieldOptions(key); }
export const editName = (key) => M.FIELD_NAMES[key] ?? key;

// ---------------------------------------------------------------- 終える
/** 「相談を終える」の「どうなった？」の答え（答えなくてもよい） */
export const OUTCOMES = Object.freeze([
  { key: "made_up", label: "仲直りできた", reply: "よかったです。この相談は履歴に残しました。" },
  { key: "not_yet", label: "まだ", reply: "この相談は履歴に残しました。また書きたくなったら、いつでも新しく相談できます。" },
  { key: "worse", label: "こじれた", reply: "話してくれて、ありがとうございます。この相談は履歴に残しました。新しく相談すると、いまの状況から一緒に考え直せます。" },
]);
export const OUTCOME_SKIP_REPLY = "この相談は履歴に残しました。";
export const outcomeOf = (key) => OUTCOMES.find(o => o.key === key) ?? null;

// ---------------------------------------------------------------- 続きの記録
/** 往復の状態の初めの形 */
export function newFollow({ known = {}, asked = [], safety, safetyContinue = false } = {}) {
  const k = { ...known };
  delete k.lateNight;
  delete k.want;
  return {
    v: 1, known: k, turns: 0, sentAt: null, sent: false, asked: [...asked],
    thread: [], log: [], checks: [], pending: null,
    ended: false, outcome: null, closed: false,
    safety: { selfHarm: !!safety?.selfHarm, partnerThreat: !!safety?.partnerThreat },
    safetyContinue: !!safetyContinue,
  };
}

/** 記録（履歴の1件）が「続き」にできるか（往復の状態があり、終えていない） */
export function resumable(record) {
  const d = record?.data;
  const fu = d?.fu;
  return !!(record?.kind === "consult" && d?.v === 2 && fu && typeof fu === "object" && !fu.ended && !fu.closed
    && Array.isArray(fu.thread) && fu.thread.length && d.input && typeof d.input === "object" && typeof d.text === "string");
}
