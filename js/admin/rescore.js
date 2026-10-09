// 再採点：送られてきた回答ログ（rec）から、いまの採点・判定ロジックで結果を作り直し、当時の結果（res）と比べる。
// 閾値や設問を変えたあとに「同じ回答だと結果がどう変わるか」を見るためのもの。仕様：docs/feedback-spec.md §3 の8
import { QUESTIONS3 } from "../data/questions3.js";
import { ITEM3, scoreRecords3 } from "../adaptive3.js";
import { DOMAINS, select3, domainStates3, STATE_LABEL } from "../engine3.js";
import { LV_TOLERANCE } from "./aggregate.js";

const TI = QUESTIONS3.traitIndex;
/** 結果画面の並び（参加者側 js/feedback_collect.js の chosenByRole と同じ：役割順、同じ役割は選ばれた順） */
const ROLE_ORDER = { "主軸": 0, "補強": 1, "矛盾": 2, "地（形状）": 3 };
export const chosenByRole = (chosen) => chosen.map((hit, i) => ({ hit, i }))
  .sort((x, y) => (ROLE_ORDER[x.hit.role] ?? 9) - (ROLE_ORDER[y.hit.role] ?? 9) || x.i - y.i)
  .map(({ hit }) => [hit.meta.id, hit.role]);
const DOMAIN_NOS = Object.keys(DOMAINS).map(Number);

/**
 * rec（正規化済み）→ scoreRecords3 に渡す records。lt/rt/pk は traitIndex の添字、kind と domain は ITEM3[itemId] から。
 * 返り値 { records, problems }。今の設問バンクにない id などは problems に入れて、その枠は除く
 */
export function recordsFromRec(rec) {
  const records = [], problems = [];
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

/** records → 送信用 res と同じ形（chosen:[[id,役割]], states:{領域:状態コード}, lv:[16傾向の整数 level], w:[[a,b]×8]） */
export function computeRes(records) {
  const sc = scoreRecords3(records);
  const sel = select3(sc.profile3);
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

export function rescoreSession(s) {
  const { records, problems } = recordsFromRec(s.rec);
  if (!records.length) return { session: s, status: "error", problems: problems.length ? problems : ["回答がありません"], now: null, diff: null };
  const now = computeRes(records);
  if (!s.res) return { session: s, status: "nores", problems, now, diff: null };
  const diff = diffRes(s.res, now);
  return { session: s, status: diff.same ? "same" : "diff", problems, now, diff };
}

export function rescoreAll(sessions) {
  const rows = sessions.map(rescoreSession);
  return { rows, same: rows.filter(r => r.status === "same").length, diff: rows.filter(r => r.status === "diff").length, other: rows.filter(r => r.status !== "same" && r.status !== "diff").length };
}
