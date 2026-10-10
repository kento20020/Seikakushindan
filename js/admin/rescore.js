// 再採点：送られてきた回答ログ（rec）から、いまの採点・判定ロジックで結果を作り直し、当時の結果（res）と比べる。
// 閾値や設問を変えたあとに「同じ回答だと結果がどう変わるか」を見るためのもの。仕様：docs/feedback-spec.md §3 の8
//   mode "then"：当時の版のロジック（v1 の送信は v1、v2 の送信は v2）
//   mode "v2"  ：全員を v2 のロジック（確度低 ×0.8・矛盾枠の向きの条件）で。追加質問の出し方（計画）は再現できないので、
//                当時答えた設問だけで採点し直す
import { QUESTIONS3 } from "../data/questions3.js";
import { scoreRecords3, bankFor } from "../adaptive3.js";
import { DOMAINS, select3, domainStates3, lowConfDomains3, STATE_LABEL } from "../engine3.js";
import { THREE_VERSIONS, versionOf } from "../three_version.js";
import { LV_TOLERANCE, payloadQv } from "./aggregate.js";

export const RESCORE_MODES = { then: "当時の版のロジック", v2: "v2 のロジック" };

const TI = QUESTIONS3.traitIndex;
/** 結果画面の並び（参加者側 js/feedback_collect.js の chosenByRole と同じ：役割順、同じ役割は選ばれた順） */
const ROLE_ORDER = { "主軸": 0, "補強": 1, "矛盾": 2, "地（形状）": 3 };
export const chosenByRole = (chosen) => chosen.map((hit, i) => ({ hit, i }))
  .sort((x, y) => (ROLE_ORDER[x.hit.role] ?? 9) - (ROLE_ORDER[y.hit.role] ?? 9) || x.i - y.i)
  .map(({ hit }) => [hit.meta.id, hit.role]);
const DOMAIN_NOS = Object.keys(DOMAINS).map(Number);

/**
 * rec（正規化済み）→ scoreRecords3 に渡す records。lt/rt/pk は traitIndex の添字、kind と domain は ITEM3[itemId] から。
 * qv は送信の版（設問バンクを選ぶ。省略時 v1）。返り値 { records, problems }。設問バンクにない id などは problems に入れて、その枠は除く
 */
export function recordsFromRec(rec, qv = "v1") {
  const records = [], problems = [];
  const ITEM3 = bankFor(qv).ITEM3;
  for (const r of rec) {
    const q = ITEM3[r.itemId];
    if (!q) { problems.push(`設問 ${r.itemId} が今の設問バンクにありません`); continue; }
    const left = TI[r.lt], right = TI[r.rt];
    if (left == null || right == null) { problems.push(`${r.key}：傾向の番号が範囲外（lt=${r.lt}, rt=${r.rt}）`); continue; }
    const picked = r.ans === "K" ? null : (r.pk >= 0 ? TI[r.pk] : null);
    if (r.ans !== "K" && picked == null) { problems.push(`${r.key}：選んだ傾向の番号が読めません（pk=${r.pk}）`); continue; }
    records.push({ key: r.key, kind: q.kind, domain: q.kind === "W" ? q.domain : null, itemId: r.itemId, left, right, answer: r.ans === "L" ? "left" : r.ans === "R" ? "right" : null, picked, swaps: r.sw });
  }
  return { records, problems };
}

/**
 * records → 送信用 res と同じ形（chosen:[[id,役割]], states:{領域:状態コード}, lv:[16傾向の整数 level], w:[[a,b]×8]）
 * logic（省略時 v1）は版ごとの判定ロジック（js/three_version.js の THREE_VERSIONS[版].logic）
 */
export function computeRes(records, { logic = null } = {}) {
  const sc = scoreRecords3(records);
  const sel = logic?.lowConf || logic?.contraAlign ? select3(sc.profile3, { logic }) : select3(sc.profile3);
  const st = domainStates3(sc.profile3);
  return {
    chosen: chosenByRole(sel.chosen),
    states: Object.fromEntries(DOMAIN_NOS.map(d => [String(d), st[d].state])),
    lv: TI.map(t => Math.round(sc.levels[t])),
    w: DOMAIN_NOS.map(d => [sc.w[d].a, sc.w[d].b]),
  };
}

/** 当時の結果と今の結果の差。same=差がない。lv は丸め方の違い（±LV_TOLERANCE）を差とみなさない */
export function diffRes(then, now) {
  // 採用された id と役割の組が同じか（並び順の違いは差とみなさない）
  const key = (list) => (list || []).map(c => `${c[0]}:${c[1]}`).sort();
  const chosenThen = key(then?.chosen), chosenNow = key(now.chosen);
  const chosenSame = chosenThen.length === chosenNow.length && chosenThen.every((x, i) => x === chosenNow[i]);
  const states = [], lv = [], w = [];
  for (const d of DOMAIN_NOS) {
    const a = then?.states?.[d] ?? then?.states?.[String(d)] ?? null, b = now.states[String(d)];
    if (a !== b) states.push({ d, then: a, now: b, thenLabel: a ? STATE_LABEL[a] : "判定なし", nowLabel: b ? STATE_LABEL[b] : "判定なし" });
    const wa = then?.w?.[d - 1], wb = now.w[d - 1];
    if (!Array.isArray(wa) || wa[0] !== wb[0] || wa[1] !== wb[1]) w.push({ d, then: wa ?? null, now: wb });
  }
  TI.forEach((t, i) => {
    const a = then?.lv?.[i], b = now.lv[i];
    if (!Number.isFinite(a) || Math.abs(a - b) > LV_TOLERANCE) lv.push({ trait: t, then: Number.isFinite(a) ? a : null, now: b });
  });
  return { same: chosenSame && !states.length && !lv.length && !w.length, chosen: { same: chosenSame, then: then?.chosen || [], now: now.chosen }, states, lv, w };
}

/** 確度低の領域の差（then・now は {領域: …}。v1 のロジックには確度低が無いので空） */
export function diffLowConf(then, now) {
  const fmt = (o) => Object.keys(o || {}).sort().map(d => `${d}:${(o[d].reasons || []).join("+")}`);
  const a = fmt(then), b = fmt(now);
  return { same: a.length === b.length && a.every((x, i) => x === b[i]), then: then || {}, now: now || {} };
}

/**
 * 1セッションを再採点。mode "then"（当時の版のロジック）か "v2"（v2 のロジック）。
 * 返り値 { session, status: same|diff|nores|error, problems, now, diff, mode, qv, logic, lowConf:{same, then, now} }
 */
export function rescoreSession(s, { mode = "then" } = {}) {
  const qv = s.qv || payloadQv(s.payload);
  const thenLogic = versionOf(qv).logic;
  const logic = mode === "v2" ? THREE_VERSIONS.v2.logic : thenLogic;
  const { records, problems } = recordsFromRec(s.rec, qv);
  const base = { session: s, mode, qv, logic: logic.id };
  if (!records.length) return { ...base, status: "error", problems: problems.length ? problems : ["回答がありません"], now: null, diff: null, lowConf: null };
  const now = computeRes(records, { logic });
  const prof = scoreRecords3(records).profile3;
  // 当時の確度低（v2 の送信だけ。res には入れていないが、同じ回答から決まるので計算し直せる）と、このロジックでの確度低
  const lowConf = diffLowConf(thenLogic.lowConf ? lowConfDomains3(prof) : {}, logic.lowConf ? lowConfDomains3(prof) : {});
  if (!s.res) return { ...base, status: "nores", problems, now, diff: null, lowConf };
  const diff = diffRes(s.res, now);
  return { ...base, status: diff.same && lowConf.same ? "same" : "diff", problems, now, diff, lowConf };
}

export function rescoreAll(sessions, { mode = "then" } = {}) {
  const rows = sessions.map(s => rescoreSession(s, { mode }));
  return { mode, rows, same: rows.filter(r => r.status === "same").length, diff: rows.filter(r => r.status === "diff").length, other: rows.filter(r => r.status !== "same" && r.status !== "diff").length };
}
