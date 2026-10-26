// 相談の「ふつうのチャット」の形（app/js/consult_talk.js。決定 U56）のうち、DOM を使わない部分。node でテストできる（tests/app_consult_talk.test.mjs）
//   選ぶボタンは出さない（安全の確かめだけ残す）。足りないことは文で聞き、文で答えてもらう。一手はカードでなく吹き出しの文章。
//   返事は今の規則と決まった文（読み取り readText・足りない問 nextQuestion・判定 buildPoc・往復 consult_followup.js）。ここは、その間をつなぐ小さな決まりだけ
//
//   TALK_TEXTS                    この形で新しく足した決まった文（仕様 U56 に書いた文だけ）
//   normalizeAnswer(text)         答えを比べる形に（全角・半角をそろえ、空白・句読点・括弧を外す）
//   exampleLine(q) / retryText(q) 問いの下の答え方の例（「（例：A／B／C）」）／読み取れなかったときの聞き直し
//   matchAnswer(q, text)          書いた答え → 選択肢の差分 { patch, label } | null（言い方の一覧 ANSWER_WORDS も）
//   quotesOf(text)                「」『』の中身と、その外の文
//   classifyFollow(text, { sent }) 一手のあとに書いた文の種類（相手の返事・送った・来ない・それ以外）。言葉の一覧 SENT_PATTERNS・NOREPLY_PATTERNS
//   moveText(m)                   一手の吹き出しの中身（buildPoc の結果か、履歴の写し snapshotOf）
//   keepText(m)                   判定し直して一手が変わらないときの文
//   talkPersist(items) / talkFrom(raw)  やりとりの列を記録に残す形に／記録から戻す形に（安全の確かめ・安全のカードは残さない）
//   pendPersist(p) / pendFrom(raw)      文で答えるのを待っている問（相手の返事の種類・もう少し話したいあとの1問）を記録に残す形に／戻す形に
import { readText } from "../../js/consult/extract.js";
import { ASKABLE } from "../../js/consult/needed.js";
import { doNowLabel } from "../../js/consult/texts.js";
import { timeLabel, avoidPhrase } from "../../poc/card/model.js";
import { REPLY_KIND_QUESTION } from "./consult_followup.js";

export const MAX_CHARS = 2000;

/** この形で新しく足した文（仕様 U56 に書いた文だけ。ほかは今の consult_chat.js・consult_followup.js・model.js の文を使う） */
export const TALK_TEXTS = Object.freeze({
  greet: "いま、何があったか、そのまま書いてください。全部そろっていなくても大丈夫です。足りないところは、あとで少しだけ聞きます。",
  quoteGuide: "相手から来た文や、相手に言われた言葉は「」で囲んで書いてください。",
  offer: "前の相談の続きがあります：",
  offerHow: "続けるときは、そのまま書いてください。新しく始めるときは、上の「新しく相談」を押してください。",
  example: "（例：{例}）",
  retry: "うまく読み取れませんでした。たとえば「{例}」のように、短く書いてもらえれば大丈夫です。",
  moveHead: "いまの一手：",
  avoidLead: "足さない方がいい一言：",
  guessLead: "相手はたぶん、",
  guessTag: "仮の文",                                         // 今のカードの札と同じ字（consult_card.js の guessP）
  guessTagTitle: "AI がつながるまでの、決まった仮の文です",   // 同じ札の title（consult_card.js の guessP）
  replyKindQ: "相手の返事は、どれに近いですか？",
  sentAck: "送ったんですね。返事が来たら、相手の文を「」で囲んで書いてください。まだ来ないときは、そう書いてください。",
  redo: "いまの状況に合わせて、一手を考え直しました。",
  keep: "一手はこのままで大丈夫です。",
  keepDraft: "前の「{label}」を、そのまま使えます。",
  keepWait: "前に書いた「{時刻}」まで、このまま待つ形です。",
  limit: "この相談はここまでです。続きは、上の「新しく相談」から書いてください。",
  newConsult: "新しく相談",
  privacy: "書いた文は、この端末の中だけで読み取ります。どこにも送りません。",
  status: "いまの状況",
  collapse: "たたむ",
  expand: "状況",
  check: "答え合わせ",
  send: "送る",
});
const fillText = (t, vars) => String(t).replace(/\{([^}]+)\}/g, (_, k) => (vars[k] ?? ""));

// ---------------------------------------------------------------- 答えを比べる形
/** 全角・半角をそろえ（NFKC）、英字は小文字に、空白・句読点・括弧・記号を外す（長音の「ー」は残す。「〜」「－」は1つの形にそろえて残す：「1〜2日」が「12日」にならないように） */
export function normalizeAnswer(text) {
  return String(text ?? "").normalize("NFKC").toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[〜～~]/g, "~").replace(/[‐―－−]/g, "-")
    .replace(/[。、，．,.!?！？・…‥「」『』（）()［］[\]【】〈〉《》{}"'“”‘’`:：;；/／]/g, "");
}

// ---------------------------------------------------------------- 問いの下の1行・聞き直し
/** 答え方の例「（例：A／B／C）」。選択肢の label を「／」でつなぐ（primary があれば primary の分だけ。長い label もそのまま） */
export function exampleLine(q) {
  const opts = Array.isArray(q?.options) ? q.options : [];
  const shown = Number.isInteger(q?.primary) && q.primary > 0 ? opts.slice(0, q.primary) : opts;
  return fillText(TALK_TEXTS.example, { 例: shown.map(o => o.label).join("／") });
}
/** 読み取れなかったとき（1回だけ）。例は1つ目の選択肢の label */
export function retryText(q) {
  return fillText(TALK_TEXTS.retry, { 例: q?.options?.[0]?.label ?? "" });
}

// ---------------------------------------------------------------- 書いた答え → 選択肢
/**
 * よくある短い答え（仕様 U56 §4.1 に書いたものだけ）。[言い方, 値]。値は、その問いの項目の値（選択肢の patch の値）
 *   最後に送った人（lastSender）・いまの気持ち（selfTemp）・どうしたいか（intent）
 */
export const ANSWER_WORDS = Object.freeze({
  lastSender: [["私", "self"], ["わたし", "self"], ["自分から", "self"], ["彼", "partner"], ["彼女", "partner"], ["向こう", "partner"], ["どっちも", "none"], ["両方送ってない", "none"]],
  selfTemp: [["熱い", "high"], ["イライラ", "high"], ["少し落ち着いた", "cooling"], ["落ち着いてる", "calm"]],
  intent: [["謝りたい", "apologize"], ["伝えたい", "tell"], ["距離", "request_space"], ["特に", "none"]],
});
/** 問いの id → 読み取りの項目（ふつうは同じ名前。相手の返事の種類の問だけ partnerLast） */
const FIELD_OF = { replyKind: "partnerLast" };
/** 場面の問（scene）を読み取りで埋めるときに見る項目 */
const SCENE_KEYS = ["lastSender", "intent", "ongoing", "afterMakeup", "partnerLast"];
const AMBIG = Symbol("ambiguous");

/** 候補のうち長さがいちばん長いもの。同じ長さで別の選択肢が並んだら決めない（AMBIG） */
function pickLongest(cands) {
  if (!cands.length) return null;
  const max = Math.max(...cands.map(c => c.len));
  const top = cands.filter(c => c.len === max);
  return new Set(top.map(c => c.i)).size === 1 ? top[0] : AMBIG;
}
const hitOf = (o) => ({ patch: { ...o.patch }, label: o.label });

/**
 * 書いた答えを、問いの選択肢に当てはめる。当てはまらなければ null。
 *   1. 答えに選択肢の label がそのまま入っている（長い label を先に）
 *   2. よくある短い答え（ANSWER_WORDS。答えにその言い方が入っている。長い言い方を先に）
 *   3. label の中に答えが入っている（答えが2文字以上。長い label を先に）
 *   4. 答えを読み取り（readText）、問いの項目が読めたらその値（場面の問は、場面が決まる項目が読めたらそれ）
 *   1〜3 で、同じ長さで別の選択肢が当たったときは、その段では決めず次の段へ
 * @param {{ id: string, options: { label: string, patch: object }[] }} q  nextQuestion の問（か REPLY_KIND_QUESTION の形）
 * @returns {{ patch: object, label: string|null } | null}
 */
export function matchAnswer(q, text) {
  if (!q || !Array.isArray(q.options) || !q.options.length) return null;
  const a = normalizeAnswer(text);
  if (!a) return null;
  const opts = q.options.map((o, i) => ({ o, i, n: normalizeAnswer(o.label) })).filter(x => x.n);
  const field = FIELD_OF[q.id] ?? q.id;
  // 1. 答えに label が入っている
  let r = pickLongest(opts.filter(x => a.includes(x.n)).map(x => ({ i: x.i, o: x.o, len: x.n.length })));
  if (r && r !== AMBIG) return hitOf(r.o);
  // 2. よくある短い答え
  const words = ANSWER_WORDS[field] && q.id !== "replyKind" ? ANSWER_WORDS[field] : [];
  const wc = [];
  for (const [w, v] of words) {
    const nw = normalizeAnswer(w);
    if (!a.includes(nw)) continue;
    const i = q.options.findIndex(o => o.patch?.[field] === v);
    if (i >= 0) wc.push({ i, o: q.options[i], len: nw.length });
  }
  r = pickLongest(wc);
  if (r && r !== AMBIG) return hitOf(r.o);
  // 3. label に答えが入っている
  if (Array.from(a).length >= 2) {
    r = pickLongest(opts.filter(x => x.n.includes(a)).map(x => ({ i: x.i, o: x.o, len: x.n.length })));
    if (r && r !== AMBIG) return hitOf(r.o);
  }
  // 4. 読み取り
  const f = readText(text).fields;
  if (q.id === "scene") {
    const patch = {};
    for (const k of SCENE_KEYS) if (f[k] !== undefined && (ASKABLE[k] || [true, false]).includes(f[k])) patch[k] = f[k];
    const decided = patch.lastSender !== undefined || patch.intent !== undefined || patch.ongoing === true || patch.afterMakeup === true
      || patch.partnerLast === "space" || patch.partnerLast === "breakup";
    return decided ? { patch, label: null } : null;
  }
  const v = f[field];
  if (v === undefined || !(ASKABLE[field] || []).includes(v)) return null;
  if (q.id === "replyKind" && v === "none") return null;
  const o = q.options.find(x => x.patch && Object.keys(x.patch).length === 1 && x.patch[field] === v);
  return { patch: { [field]: v }, label: o ? o.label : null };
}

/** 相手の返事の種類を文で聞く問（選択肢は今の F.REPLY_KIND_QUESTION と同じ。文だけ U56 の言い方） */
export const REPLY_KIND_Q = Object.freeze({ id: "replyKind", text: TALK_TEXTS.replyKindQ, options: REPLY_KIND_QUESTION.options });

// ---------------------------------------------------------------- 一手のあとに書いた文の種類
/** 送ったことを書いている言い方（正規化した文で探す。「送ったほうが」「送ったら」「送ったか」のような、まだ送っていない言い方は外す） */
export const SENT_PATTERNS = Object.freeze([
  /送(?:った|りました|ってみた|っておいた|っといた|っちゃった|ってしまった)(?!ほう|方|ら|か)/,
  /(?:送信|line|ライン|返信|連絡)(?:した|しました)(?!ほう|方|ら|か)/,
]);
/** 返事が来ないことを書いている言い方（送ったあとだけ見る）。文がまるごと「まだ」のときも来ない扱い */
export const NOREPLY_PATTERNS = Object.freeze([
  /(?:来|こ)ない/, /(?:来|き)てない/, /返事(?:が|は)?(?:ない|無い)/, /返信(?:が|は)?(?:ない|無い)/,
  /返って(?:こない|来ない|きてない|来てない)/, /(?:既読|未読)(?:無視|スルー|のまま)/, /音沙汰/, /反応(?:が|は)?(?:ない|無い)/,
]);
const OPEN = { "「": "」", "『": "』" };
/**
 * 「」『』の中身（入れ子は外側ごと1つ）と、その外の文。閉じていない「は、文の終わりまでを中身にする
 * @returns {{ quoted: string[], rest: string }}  quoted は空でないものだけ
 */
export function quotesOf(text) {
  const chars = Array.from(String(text ?? ""));
  const quoted = [], rest = [];
  let stack = [], cur = [];
  for (const c of chars) {
    if (stack.length) {
      if (c === stack[stack.length - 1]) {
        stack.pop();
        if (!stack.length) { quoted.push(cur.join("")); cur = []; continue; }
      } else if (OPEN[c]) stack.push(OPEN[c]);
      cur.push(c);
      continue;
    }
    if (OPEN[c]) { stack = [OPEN[c]]; cur = []; continue; }
    rest.push(c);
  }
  if (stack.length) quoted.push(cur.join(""));
  return { quoted: quoted.map(s => s.trim()).filter(Boolean), rest: rest.join("").trim() };
}
/**
 * 一手のあとに書いた文の種類（仕様 U56 §4.2）
 *   「」『』がある → "reply"（相手の返事。中身は quoted）
 *   送ったあと（sent）で、返事が来ないことを書いている → "noreply"（送ったあとに「送ったけど返事が来ない」と書いたときも）
 *   送ったことを書いている → "sent"
 *   それ以外 → "talk"（もう少し話したい）
 * @returns {{ kind: "reply"|"sent"|"noreply"|"talk", quoted: string[], rest: string }}
 */
export function classifyFollow(text, { sent = false } = {}) {
  const { quoted, rest } = quotesOf(text);
  if (quoted.length) return { kind: "reply", quoted, rest };
  const n = normalizeAnswer(text);
  const base = { quoted: [], rest: String(text ?? "").trim() };
  if (sent && (n === "まだ" || NOREPLY_PATTERNS.some(re => re.test(n)))) return { kind: "noreply", ...base };
  if (SENT_PATTERNS.some(re => re.test(n))) return { kind: "sent", ...base };
  return { kind: "talk", ...base };
}

// ---------------------------------------------------------------- 一手の吹き出し
/**
 * 一手の吹き出しの中身（カードの中身を文に並べ直す。文の中身は今の model の文だけ。仕様 U56 §5）。上から、無い物は飛ばす：
 *   いまの一手：{見出し}（太字の1行）→ 送る時の行 →（待つ一手で戻る時刻があれば）{戻る時刻}：{時刻} → 理由の1行目
 *   →（待つ一手）{待つ間に}：{すること} → 送る一文（小さな見出しと引用の箱）→ 足さない方がいい一言：… → 相手はたぶん、…
 * m は buildPoc の結果か、履歴の写し（snapshotOf）。安全のモードは文章にしない（{ safety: true }。画面が安全のカードを置く）
 * @returns {{ safety: boolean, parts: object[], draft: { label: string, text: string } | null, safetyLine: { name: string, contact: string }[] | null, text: string }}
 *   parts：{ k: "head", text } | { k: "p", text, lead?, tone? } | { k: "ret", lead, text, at } | { k: "draft", label, text }
 *   text：読み上げ・記録の文（parts を改行でつないだもの）
 */
export function moveText(m) {
  if (!m || m.mode === "safety") return { safety: true, parts: [], draft: null, safetyLine: null, text: "" };
  const action = m.result?.action ?? m.action ?? null;
  const drafts = m.card?.drafts ?? m.drafts ?? [];
  const avoid = m.card?.avoid ?? m.avoid ?? [];
  const reasons = Array.isArray(m.reasons) ? m.reasons : [];
  const parts = [];
  if (m.headline) parts.push({ k: "head", text: `${TALK_TEXTS.moveHead}${m.headline}` });
  if (m.timingLine) parts.push({ k: "p", text: m.timingLine });
  if (m.mode === "wait" && m.ret) {
    const at = m.ret.at instanceof Date ? m.ret.at.toISOString() : typeof m.ret.at === "string" ? m.ret.at : null;
    parts.push({ k: "ret", lead: `${m.ret.label || timeLabel(action)}：`, text: typeof m.ret.text === "string" ? m.ret.text : "", at });
  }
  if (reasons[0]) parts.push({ k: "p", text: reasons[0] });
  if (m.mode === "wait" && m.doNow) parts.push({ k: "p", lead: `${m.doNowLabel || doNowLabel(action)}：`, text: m.doNow });
  const d = drafts[0] && typeof drafts[0].text === "string" && drafts[0].text ? { label: drafts[0].label || "", text: drafts[0].text } : null;
  if (d) parts.push({ k: "draft", ...d });
  if (avoid.length) parts.push({ k: "p", lead: TALK_TEXTS.avoidLead, text: avoid.map(avoidPhrase).join(""), tone: "stop" });
  // 予想は AI がつながるまでの決まった仮の文（今のカードの「仮の文」の札と同じ。consult_card.js の guessP）
  if (m.guess) parts.push({ k: "p", lead: TALK_TEXTS.guessLead, text: m.guess, tag: TALK_TEXTS.guessTag, tagTitle: TALK_TEXTS.guessTagTitle });
  const sl = Array.isArray(m.safetyLine) && m.safetyLine.length ? m.safetyLine.map(r => ({ name: String(r.name), contact: String(r.contact) })) : null;
  return { safety: false, parts, draft: d, safetyLine: sl, text: partsText(parts) };
}
/** parts → 1つの文（改行でつなぐ。送る一文は見出しの次の行に） */
export function partsText(parts) {
  return (parts || []).map(p => p.k === "draft" ? `${p.label ? `${p.label}\n` : ""}${p.text}` : `${p.lead ?? ""}${p.text ?? ""}`).filter(Boolean).join("\n");
}

/** 判定し直して一手が変わらないとき（仕様 U56 §3.3）：送る一文があれば前の見出しを、待つ一手なら戻る時刻を添える */
export function keepText(m) {
  const T = TALK_TEXTS;
  if (m?.mode === "wait") return m.ret ? `${T.keep}${fillText(T.keepWait, { 時刻: timeLabel(m.result?.action ?? m.action) })}` : T.keep;
  const d = m?.card?.drafts?.[0] ?? m?.drafts?.[0];
  return d?.label ? `${T.keep}${fillText(T.keepDraft, { label: d.label })}` : T.keep;
}

// ---------------------------------------------------------------- 記録（data.talk）
const PART_KINDS = new Set(["head", "p", "ret", "draft"]);
const str = (v) => typeof v === "string";
function partOk(p) {
  if (!p || typeof p !== "object" || !PART_KINDS.has(p.k) || !str(p.text)) return null;
  const o = { k: p.k, text: p.text };
  if (str(p.lead) && p.lead) o.lead = p.lead;
  if (p.k === "draft") o.label = str(p.label) ? p.label : "";
  if (p.k === "ret") o.at = str(p.at) ? p.at : null;
  if (p.tone === "stop") o.tone = "stop";
  return o;
}
/**
 * やりとりの列を記録に残す形に：自分・アプリの吹き出しだけ { who, text, at, label?, quote?, check?, draft?, move?, lead?, safetyLine? }。
 * 安全の確かめの吹き出し・答え・安全のカード（sf の印）と、画面の中だけの印（id・old）は残さない
 */
export function talkPersist(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const x of items) {
    if (!x || x.sf || (x.who !== "me" && x.who !== "app") || !str(x.text)) continue;
    const o = { who: x.who, text: x.text, at: str(x.at) ? x.at : null };
    if (str(x.label) && x.label) o.label = x.label;
    if (x.quote === true) o.quote = true;
    if (x.check === "near" || x.check === "different") o.check = x.check;
    if (x.who === "app" && Array.isArray(x.move)) {
      const parts = x.move.map(partOk).filter(Boolean);
      if (parts.length) o.move = parts;
      if (x.draft && str(x.draft.text)) o.draft = { label: str(x.draft.label) ? x.draft.label : "", text: x.draft.text };
      if (str(x.lead) && x.lead) o.lead = x.lead;
      if (Array.isArray(x.safetyLine) && x.safetyLine.length) o.safetyLine = x.safetyLine.filter(r => r && str(r.name) && str(r.contact)).map(r => ({ name: r.name, contact: r.contact }));
    }
    out.push(o);
  }
  return out;
}
/** 記録から戻す形（形の違う項目は外す） */
export function talkFrom(raw) { return talkPersist(raw); }

const PEND_TYPES = new Set(["replyKind", "talkQ"]);
/** 文で答えるのを待っている問を記録に残す形に（相手の返事の種類・もう少し話したいあとの1問だけ。ほかは null） */
export function pendPersist(p) {
  if (!p || !PEND_TYPES.has(p.type)) return null;
  const o = { type: p.type, tries: p.tries ? 1 : 0, text: str(p.text) ? p.text : "" };
  if (p.type === "talkQ") {
    if (!p.q || !str(p.q.id) || !str(p.q.text) || !Array.isArray(p.q.options)) return null;
    o.q = { id: p.q.id, text: p.q.text, options: p.q.options.filter(x => x && str(x.label)).map(x => ({ label: x.label, patch: { ...(x.patch || {}) } })) };
  }
  return o;
}
/** 記録から戻す（相手の返事の種類の問は、選択肢を今の REPLY_KIND_Q にする） */
export function pendFrom(raw) {
  const p = pendPersist(raw);
  if (!p) return null;
  if (p.type === "replyKind") p.q = REPLY_KIND_Q;
  return p;
}
