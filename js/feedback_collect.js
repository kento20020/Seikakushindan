// テスト協力モード（三択版）の記録と送信用テキストの組み立て。仕様：docs/feedback-spec.md §1〜2
// DOM を触らない（node でテストできる）。画面は js/ui/feedback.js、状態の保存は js/ui/three_store.js（store3.fb）。
//
//   記録 fb（store3.fb。JSON のまま localStorage に保存される）
//     code, auto, ts, phase, activeMs, cur:{key,itemId,ms}, back, swipes,
//     slots:{key:{ds,inp}}, flags:{key:{itemId:[code…]}},
//     self, act, actSkip, blind:{decoy,top,order,pick}, cards:{id:{r,ng,sc,main}}, missing, hardList, hard, time, swipe, free, finishedAt
//   送信用テキスト：buildText(...) → encodeText(payload, summaryLines)（js/feedback_format.js）
import { QUESTIONS3 } from "./data/questions3.js";
import { ITEM3, fromScores, bankFor } from "./adaptive3.js";
import { versionOf } from "./three_version.js";
import { DOMAINS } from "./engine.js";
import { PATTERN_BY_ID } from "./data/patterns.js";
import { PROFILE_SAMPLES3 } from "./data/samples3.js";
import { encodeText } from "./feedback_format.js";

// ---------------------------------------------------------------- コードと表示名
/** 画面の流れ。code は自動コードを見せる画面（自動生成したときだけ）、q は質問 */
export const PHASES = ["code", "q", "part1", "blind", "cards", "part3", "send"];
export const phaseAtLeast = (fb, p) => !!fb && PHASES.indexOf(fb.phase) >= PHASES.indexOf(p);

export const FLAG_CODES = ["none", "both", "scene", "words"];
export const FLAG_LABEL = { none: "どちらも違う", both: "どちらも当てはまる", scene: "場面が想像しにくい", words: "言葉が分かりにくい" };
export const HARD_CODES = [...FLAG_CODES, "ok"];
export const HARD_LABEL = { ...FLAG_LABEL, ok: "特に迷っていない" };
export const SELF_CODES = ["A", "B", "both", "neither", "depends"];
export const SELF_LABEL = { A: "A寄り", B: "B寄り", both: "両方強い", neither: "両方弱い", depends: "場面による" };
export const ACT_CODES = ["A", "B", "na"];
export const TIME_CODES = ["short", "ok", "long"];
export const TIME_LABEL = { short: "短く感じた", ok: "ちょうどよい", long: "長く感じた" };
export const MAIN_CODES = ["yes", "partly", "no"];
export const MAIN_LABEL = { yes: "はい", partly: "一部そう", no: "いいえ" };
export const SCENE_LABEL = { y: "ありそう", n: "なさそう" };
export const SHAPE_ROLE = "地（形状）";

/** 自己評価に添える説明文（仕様 §1 の表）。a/b は「傾向名：説明」 */
export const SELF_DESC = {
  1: { a: ["向き合う", "問題があれば、その場か早めに話して片付けたい"], b: ["距離を取る", "熱くなったら一度離れて、落ち着いてから考えたい"] },
  2: { a: ["即応", "言われたらすぐ返す。考えながら話す"], b: ["熟考", "一度持ち帰って、考えてから返す"] },
  3: { a: ["追う", "不安になったら連絡して確かめたい"], b: ["待つ", "不安でも相手の反応を待つ"] },
  4: { a: ["表に出す", "嫌だった・傷ついたが顔や言葉に出る"], b: ["内に置く", "その場では出さず、自分の中で整理する"] },
  5: { a: ["理由・具体", "何が起きたか、なぜかが分かると納得できる"], b: ["気持ち・共感", "気持ちを分かってもらえると納得できる"] },
  6: { a: ["主導する", "進め方や結論を自分から出す"], b: ["調整する", "相手に合わせて、落としどころを探す"] },
  7: { a: ["広げる", "過去や関係全体の話につなげる"], b: ["切り分ける", "今回の出来事だけに絞る"] },
  8: { a: ["解決する", "原因と次からの対応が決まって終われる"], b: ["関係を戻す", "普段どおりに戻れば終われる"] },
};
/** 実際の行動の質問（仕様 §1 の表） */
export const ACT_QUESTIONS = {
  1: { q: "その場面で、話し合いを切り出したのは？", a: "自分から切り出した", b: "時間を置いた・自分からは切り出さなかった" },
  2: { q: "相手に何か言われたとき", a: "その場で言い返した・答えた", b: "すぐには答えず、あとで返した" },
  3: { q: "相手の反応が見えなくなったとき", a: "自分から連絡して確かめた", b: "連絡せず待った" },
  4: { q: "嫌だった・傷ついた気持ちは", a: "顔や言葉に出た", b: "その場では出さなかった" },
  5: { q: "納得するために欲しかったのは", a: "何が起きたか・なぜかの説明", b: "気持ちを分かってもらうこと" },
  6: { q: "話し合いの進め方は", a: "自分が仕切った・案を出した", b: "相手に合わせた" },
  7: { q: "話の範囲は", a: "過去の件や関係全体の話も出た", b: "今回の件だけを話した" },
  8: { q: "終わり方は", a: "次からどうするかを決めて終わった", b: "普段どおりに戻って終わった" },
};
export const ACT_NA_LABEL = "覚えていない・当てはまらない";
export const DOMAIN_KEYS = Object.keys(DOMAINS);   // "1"〜"8"

// ---------------------------------------------------------------- 参加者コード・時刻
const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";   // 見間違えやすい 0/o・1/l/i は使わない
export const CODE_MAX = 12;
export function genCode(rand = Math.random) {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length) % CODE_CHARS.length];
  return s;
}
/** 入力されたコードを整える（前後の空白を除き、空白の連続は1つに）。長さの検査は呼び出し側 */
export const normalizeCode = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
export const codeLength = (s) => [...s].length;

/** ローカル時刻の ISO 8601（2026-10-09T12:34:56+09:00） */
export function isoLocal(d = new Date()) {
  const p = (n) => String(Math.abs(Math.trunc(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${off >= 0 ? "+" : "-"}${p(Math.abs(off) / 60)}:${p(Math.abs(off) % 60)}`;
}

/** 新しい記録。code が空なら自動で4文字を作る（auto: true） */
export function newFeedback({ code = "", now = new Date(), rand } = {}) {
  const c = normalizeCode(code);
  return {
    v: 1, code: c || genCode(rand), auto: !c, ts: isoLocal(now), phase: c ? "q" : "code",
    activeMs: 0, cur: null, back: 0, swipes: 0, slots: {}, flags: {},
    self: {}, act: {}, actSkip: false, blind: null, cards: {}, missing: "",
    hardList: null, hard: {}, time: "", swipe: null, free: "", finishedAt: null,
  };
}

// ---------------------------------------------------------------- 回答時間（質問画面が見えている間だけ進む時計）
/**
 * 時計。show で「いま表示しているカード」を知らせ、pause で止め（タブが裏に回った・別の画面へ）、take で回答までの時間を取る。
 *   fb.activeMs … 質問画面が見えていた合計（全体の所要時間）
 *   fb.cur      … いまのカード {key, itemId, ms}。差し替え・戻るで別のカードになったら 0 から測り直す（枠の時間は最後に表示した設問の分）
 * now は単調な時計（performance.now）。テストでは差し替える。
 */
export function makeClock(now = () => globalThis.performance?.now?.() ?? Date.now()) {
  let since = null, owner = null;
  function flush() {
    if (since == null || !owner) return;
    const t = now(), d = Math.max(0, t - since);
    since = t;
    owner.activeMs = (owner.activeMs || 0) + d;
    if (owner.cur) owner.cur.ms += d;
  }
  return {
    show(fb, key, itemId) {
      if (owner !== fb) { flush(); since = null; owner = fb; }
      flush();
      if (!fb.cur || fb.cur.key !== key || fb.cur.itemId !== itemId) fb.cur = { key, itemId, ms: 0 };
      if (since == null) since = now();
    },
    pause() { flush(); since = null; },
    /** 回答・答えずに進むの直前に呼ぶ。そのカードの時間（ms）を返し、cur を空にする（時計は止めない） */
    take(fb, key, itemId) {
      if (owner !== fb) return 0;
      flush();
      const ms = fb.cur && fb.cur.key === key && fb.cur.itemId === itemId ? fb.cur.ms : 0;
      fb.cur = null;
      return ms;
    },
    get running() { return since != null; },
  };
}

/** 操作の記録。type: answer | skip | swap | back、before: 操作前の current()、via: s/t/k、ms: そのカードの時間 */
export function recordAction(fb, { type, before, via, ms = 0 }) {
  if (!fb || !before) return;
  const inp = via === "s" || via === "t" || via === "k" ? via : "x";
  if (inp === "s") fb.swipes = (fb.swipes || 0) + 1;
  if (type === "answer" || type === "skip") (fb.slots ||= {})[before.key] = { ds: Math.max(0, Math.round(ms / 100)), inp };
  else if (type === "back") fb.back = (fb.back || 0) + 1;
}

// ---------------------------------------------------------------- 一言
export const flagsOf = (fb, key, itemId) => fb?.flags?.[key]?.[itemId] || [];
export function toggleFlag(fb, key, itemId, code) {
  if (!FLAG_CODES.includes(code)) return flagsOf(fb, key, itemId);
  const cur = new Set(flagsOf(fb, key, itemId));
  if (cur.has(code)) cur.delete(code); else cur.add(code);
  const list = FLAG_CODES.filter(c => cur.has(c));
  const byKey = ((fb.flags ||= {})[key] ||= {});
  if (list.length) byKey[itemId] = list; else delete byKey[itemId];
  if (!Object.keys(byKey).length) delete fb.flags[key];
  return list;
}
const flagStr = (fb, key, itemId) => flagsOf(fb, key, itemId).join("+");

// ---------------------------------------------------------------- 結果のカード
const ROLE_ORDER = { "主軸": 0, "補強": 1, "矛盾": 2, [SHAPE_ROLE]: 3 };
/** 役割順（結果画面の並び）に [id, role] */
export const chosenByRole = (chosen) => chosen.map((hit, i) => ({ hit, i }))
  .sort((x, y) => (ROLE_ORDER[x.hit.role] ?? 9) - (ROLE_ORDER[y.hit.role] ?? 9) || x.i - y.i)
  .map(({ hit }) => [hit.meta.id, hit.role]);
/** ブラインド比較に出す上位（地＝形状を除いて、役割順に最大3本） */
export const topIds = (chosen, n = 3) => chosenByRole(chosen).filter(([, role]) => role !== SHAPE_ROLE).slice(0, n).map(([id]) => id);

/** 詳細説明を「。」で区切った文（「。」は各文に残す）。番号はこの配列の添字（0始まり） */
export function splitSentences(text) {
  return String(text || "").split("。").map(s => s.trim()).filter(Boolean).map(s => s + "。");
}

let decoyCache = null;
/** P1〜P5 を三択に流した選択（地を除く id・役割順）。一度だけ計算する */
export function profileChoices() {
  return decoyCache ||= PROFILE_SAMPLES3.map((p, i) => {
    const chosen = fromScores(p.scores, p.duel).result().select.chosen;
    return { key: p.key, index: i, ids: chosenByRole(chosen).filter(([, r]) => r !== SHAPE_ROLE).map(([id]) => id) };
  });
}
/** 比較用の結果：自分の選択（地を除く）との重なりが最も少ないプロファイル。同数なら上位3本の重なりが少ない方、それも同じなら番号順 */
export function pickDecoy(chosen) {
  const own = new Set(chosenByRole(chosen).filter(([, r]) => r !== SHAPE_ROLE).map(([id]) => id));
  const top = new Set(topIds(chosen));
  let best = null;
  for (const p of profileChoices()) {
    const overlap = p.ids.filter(id => own.has(id)).length;
    const topOverlap = p.ids.slice(0, 3).filter(id => top.has(id)).length;
    if (!best || overlap < best.overlap || (overlap === best.overlap && topOverlap < best.topOverlap)) best = { key: p.key, index: p.index, overlap, topOverlap, top: p.ids.slice(0, 3) };
  }
  return best;
}

// ---------------------------------------------------------------- 振り返り（迷った設問）
/** 最大6問：一言を付けた → 差し替えた（差し替え前の設問）→ 回答時間が長い。records は Session3.records() */
export function pickHard(fb, records, max = 6) {
  const out = [];
  const add = (id) => { if (id && ITEM3[id] && !out.includes(id) && out.length < max) out.push(id); };
  for (const r of records) for (const id of r.shown) if (flagsOf(fb, r.key, id).length) add(id);
  for (const r of records) for (const id of r.shown.slice(0, -1)) add(id);
  const ds = (r) => fb?.slots?.[r.key]?.ds ?? 0;
  records.map((r, i) => ({ r, i })).sort((x, y) => ds(y.r) - ds(x.r) || x.i - y.i).forEach(({ r }) => add(r.itemId));
  return out;
}

// ---------------------------------------------------------------- 振り返りの理由チップの並び
/** 文字列 → 32bit の種（FNV-1a） */
function seedOf(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/**
 * 振り返り（パート3）の理由チップの並び。設問ごとに並びを変える（最初のチップばかり選ばれないように）。
 * 参加者コード＋設問 id を種にするので、同じ人・同じ設問なら再描画しても同じ並び（v1・v2 とも）
 */
export function chipOrder(code, itemId, codes = HARD_CODES) {
  const rand = mulberry32(seedOf(`${code ?? ""}|${itemId ?? ""}`));
  const out = codes.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// ---------------------------------------------------------------- 送信用の JSON（v1）
const TI = QUESTIONS3.traitIndex;
const ti = (t) => TI.indexOf(t);

/**
 * session: 終わった Session3、result: store3.result（session.result()）、fb: 記録、ua: "m" | "d"
 * 返り値は仕様 §2 の JSON（キーの順も仕様どおり）。app はセッションの設問バンクの version、最後に qv（"v1" | "v2"）を足す
 */
export function buildPayload({ session, result, fb, ua = "d" }) {
  const records = result?.records || session.records();
  const rec = records.map(r => {
    const slot = fb.slots?.[r.key] || {};
    const row = [r.key, r.itemId, r.answer === "left" ? "L" : r.answer === "right" ? "R" : "K",
      ti(r.left), ti(r.right), r.picked ? ti(r.picked) : -1, r.swaps, slot.ds ?? 0, slot.inp || "x", flagStr(fb, r.key, r.itemId)];
    if (r.swaps > 0) row.push(r.shown.slice(0, -1).map(id => [id, flagStr(fb, r.key, id)]));
    return row;
  });
  const chosen = chosenByRole(result.select.chosen);
  const roleOf = Object.fromEntries(chosen);
  const cards = chosen.map(([id]) => {
    const c = fb.cards?.[id] || {};
    const sc = Array.isArray(c.sc) ? c.sc : [];
    return [id, c.r || 0, [...(c.ng || [])].sort((a, b) => a - b), [sc[0] || "", sc[1] || ""], roleOf[id] === "主軸" ? c.main || "" : ""];
  });
  const act = {};
  for (const d of DOMAIN_KEYS) act[d] = fb.actSkip ? "na" : fb.act?.[d] || "";
  const self = {};
  for (const d of DOMAIN_KEYS) self[d] = fb.self?.[d] || "";
  const V = versionOf(session.config?.version);
  return {
    v: 1,
    app: V.bankVersion,
    code: fb.code,
    ts: fb.ts,
    mode: session.config.adaptive ? "a" : "f",
    dur: Math.round((fb.activeMs || 0) / 1000),
    back: fb.back || 0,
    ua: ua === "m" ? "m" : "d",
    rec,
    res: {
      chosen,
      states: Object.fromEntries(DOMAIN_KEYS.map(d => [d, result.states[d]?.state ?? null])),
      lv: TI.map(t => Math.round(result.levels[t])),
      w: DOMAIN_KEYS.map(d => [result.w[d].a, result.w[d].b]),
    },
    fb: {
      self, act,
      blind: { pick: fb.blind?.pick || "", decoy: fb.blind?.decoy || "", order: fb.blind?.order || "" },
      cards,
      missing: fb.missing || "",
      hard: (fb.hardList || []).map(id => [id, fb.hard?.[id] || ""]),
      time: fb.time || "",
      swipe: fb.swipe ?? null,
      free: fb.free || "",
    },
    qv: V.id,
  };
}

/** 人が読む要約の2行（仕様 §2 の形） */
export function summaryLines(payload) {
  const date = String(payload.ts || "").slice(0, 10);
  const min = Math.round((payload.dur || 0) / 60);
  const main = payload.res.chosen.find(([, role]) => role === "主軸");
  const head = main ? PATTERN_BY_ID[main[0]]?.headline ?? "" : "";
  const rest = payload.res.chosen.length - (main ? 1 : 0);
  return [
    `【16次元診断 テスト協力】コード: ${payload.code} ／ ${date} ／ 回答 ${payload.rec.length}問 ／ ${min}分`,
    main ? `主軸: ${main[0]}「${head}」 ほか ${rest}本` : `主軸: なし（選ばれた解釈 ${rest}本）`,
  ];
}

export function buildText(args) {
  const payload = buildPayload(args);
  return { payload, text: encodeText(payload, summaryLines(payload)) };
}

/** 保存するファイル名 16d-feedback-<code>-<yyyymmdd>.txt（コードのうちファイル名に使えない文字は _ に） */
export function filenameFor(code, ts) {
  const safe = String(code || "nocode").replace(/[\\/:*?"<>|\s.]+/g, "_").slice(0, 24) || "nocode";
  const ymd = String(ts || "").slice(0, 10).replace(/-/g, "") || "00000000";
  return `16d-feedback-${safe}-${ymd}.txt`;
}

/** 設問の表示用テキスト（振り返り用）。W：場面＋A行動／B行動、X：2つの行動文。version はセッションの設問の版（省略時 v1） */
export function itemTexts(id, version) {
  const q = (version ? bankFor(version).ITEM3 : ITEM3)[id];
  if (!q) return null;
  if (q.kind === "W") return { kind: "W", stem: q.stem, a: q.a, b: q.b };
  return { kind: "X", stem: null, a: q.leftText, b: q.rightText };
}
