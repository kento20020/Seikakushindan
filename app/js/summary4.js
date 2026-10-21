// 24問版（v4）の結果から、ホーム・履歴・結果の画面で使う要点を取り出す。DOM を使わない（Node のテストでも動く）。決定 U42・U44
// 判定はしない（js/engine4.js の computeResult4 の結果を読むだけ）。三択（v3）は app/js/summary.js のまま。
//   isResult4(r)            … v4 の結果か（r.diagnosisVersion === "v4"）
//   leadOf4(r)              … 冒頭の見出し { kind: "primary"|"flat"|"none", title, body, domain }
//   axisView4(r, d)         … 結果の「8つの領域」の1本の横軸（三択の「8つの軸」の axisView と同じ形。●の位置・「向き合う寄り 67%」・読み上げの文）
//   tendencies4(r)          … 主軸と補足の傾向（最大3）[{ domain, key: "1A", side, name, domainName, role: "主軸"|"補足" }]
//   resultKey4(r)           … 結果の key（同じ24問の答えなら同じ）。履歴の重なりの判定に使う（三択の key とは頭が違う：d4-）
//   diagnosisRecord4(r)     … 履歴に足す形 { kind, title, sub, data }（結果の出し方の版で変わる。下の「持ち主の原稿の形」）
//   recordDiagnosis4(r)     … 履歴に足す（同じ結果は足さない）→ id か null
//
// 持ち主の原稿の形（決定 U46。既定。?rc=u44 で前の形。app/js/result_copy_version.js）
//   copyOf4(r)              … 結果の文の1セット（js/result_copy4.js の resultCopy4）。結果の画面・ホーム・履歴・シェアの題は、どれもこの title
//   copyCard4(r)            … ホームの診断後のカードの中身 { title, sentence（本文の最初の1文。答えがそろった領域が無いときは ""）, kind }
//   履歴の記録：題＝copy の title、sub＝本文の最初の1文、data に copyVersion・copyId（前に記録した物はそのまま読める）
import { DOMAINS } from "../../js/engine.js";
import { LEAD_TITLE4, domainText4, leadSide4, DOMAIN_IDS4 } from "../../js/engine4.js";
import { idsOfDomain4 } from "../../js/data/questions4.js";
import { resultCopy4, firstSentence4 } from "../../js/result_copy4.js";
import { resultCopyVersion } from "./result_copy_version.js";
import { addRecord } from "./local.js";

export const isResult4 = (r) => !!r && typeof r === "object" && r.diagnosisVersion === "v4" && !!r.domains;

/** 冒頭の見出し（docs/diagnosis-v4.md §6）。primary は主軸の領域の状態の見出しと本文 */
export function leadOf4(r) {
  if (!isResult4(r)) return null;
  if (r.lead === "primary" && r.primaryDomainId) {
    const t = domainText4(r.domains[r.primaryDomainId]);
    return { kind: "primary", title: t.title, body: t.body, domain: r.primaryDomainId };
  }
  if (r.lead === "flat") return { kind: "flat", title: LEAD_TITLE4.flat, body: "", domain: null };
  return { kind: "none", title: "", body: "判断できない問が多いため、領域ごとの傾向はまとめていません。分かっている回答だけを出しています。", domain: null };
}

/**
 * 「8つの領域」の1本の横軸。三択の summary.js の axisView と同じ形（結果の画面が同じ部品で描く）
 *   pos … B を選んだ割合（0〜1。●の位置。左はし＝A）。incomplete（答えた数が2より少ない）は null（●を出さない）
 *   side … "A" | "B" | "mid" | null、pct … 多い側の割合（%）、text …「向き合う寄り 67%」「まんなか 50%」「まだ分かりません」
 */
export function axisView4(r, d) {
  const D = DOMAINS[d];
  const dom = isResult4(r) ? r.domains?.[d] : null;
  if (!D || !dom) return null;
  const ok = dom.state !== "incomplete" && dom.n > 0;
  const a = ok ? dom.a : 0, b = ok ? dom.b : 0, n = a + b;
  const side = !n ? null : a > b ? "A" : b > a ? "B" : "mid";
  const pct = n ? Math.round((Math.max(a, b) / n) * 100) : null;
  const text = !n ? "まだ分かりません" : side === "mid" ? "まんなか 50%" : `${side === "A" ? D.a : D.b}寄り ${pct}%`;
  return {
    domain: +d, name: D.name, aName: D.a, bName: D.b,
    a, b, n, pos: n ? b / n : null, side, pct, text,
    label: `${D.name}：${text}${n ? `（${n}問のうち、${D.a} ${a}問・${D.b} ${b}問）` : ""}`,
  };
}

/** 主軸と補足（最大3）の傾向。主軸の候補が無ければ [] */
export function tendencies4(r) {
  if (!isResult4(r)) return [];
  const ids = [r.primaryDomainId, ...(r.supportingDomainIds || [])].filter(Boolean);
  return ids.map((d, i) => {
    const side = leadSide4(r.domains[d]?.state);
    const D = DOMAINS[d];
    return side && D ? { domain: d, key: `${d}${side}`, side, name: side === "A" ? D.a : D.b, domainName: D.name, role: i === 0 ? "主軸" : "補足" } : null;
  }).filter(Boolean);
}

// 32 ビットの FNV-1a（結果の key を短くするため。暗号ではない。summary.js と同じ式）
function fnv1a(str) {
  let x = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    x ^= str.charCodeAt(i);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return x.toString(36);
}

const PICK = { A: "A", B: "B", unknown: "u" };
/** 結果の key。設問の版と、24問の答え（A・B・判断できないは u・未回答は -）から作る */
export function resultKey4(r) {
  const doms = isResult4(r) ? r.domains : {};
  const body = DOMAIN_IDS4.map((d) => {
    const p = doms[d]?.picks || {};
    const ids = idsOfDomain4(d);
    return ["U", "P", "N"].map((k) => `${ids[k]}:${PICK[p[k]] ?? "-"}`).join(",");
  }).join(",");
  return `d4-${r?.questionBankVersion ?? ""}-${fnv1a(body)}`;
}

/** 結果の文の1セット（v4 の結果でなければ null） */
export function copyOf4(r) {
  return isResult4(r) ? resultCopy4(r) : null;
}

/** ホームの診断後のカード：題・本文の最初の1文（文の途中で切らない）。答えがそろった領域が無いときは題だけ */
export function copyCard4(r, c = copyOf4(r)) {
  if (!c) return null;
  return { title: c.title, sentence: c.kind === "none" ? "" : firstSentence4(c.paragraphs[0] ?? ""), kind: c.kind };
}

/**
 * 履歴に足す形
 *   持ち主の原稿の形（既定）：title＝copy の title、sub＝本文の最初の1文、data に copyVersion・copyId・主軸（copy の主軸）。主な傾向の一覧は入れない
 *   前の形（rc "u44"）：title＝冒頭の見出し、sub＝その本文、主な傾向（主軸と補足）
 */
export function diagnosisRecord4(r, { rc = resultCopyVersion() } = {}) {
  if (rc !== "u44") {
    const copy = copyOf4(r);
    const c = copyCard4(r, copy);
    return {
      kind: "diagnosis",
      title: c?.title || "診断結果",
      sub: c?.sentence || "",
      data: {
        key: resultKey4(r),
        version: "v4",
        questionBankVersion: r?.questionBankVersion ?? null,
        copyVersion: copy?.copyVersion ?? null,
        copyId: copy?.copyId ?? null,
        primaryDomainId: copy?.primaryDomain ?? null,
        tendencies: [],
        answered: r?.counts?.answered ?? 0,
        unknown: r?.counts?.unknown ?? 0,
      },
    };
  }
  const lead = leadOf4(r);
  return {
    kind: "diagnosis",
    title: lead?.title || "診断結果",
    sub: lead?.body || "",
    data: {
      key: resultKey4(r),
      version: "v4",
      questionBankVersion: r?.questionBankVersion ?? null,
      primaryDomainId: r?.primaryDomainId ?? null,
      tendencies: tendencies4(r).map(({ domain, key, side, name, domainName }) => ({ domain, key, side, name, domainName })),
      answered: r?.counts?.answered ?? 0,
      unknown: r?.counts?.unknown ?? 0,
    },
  };
}

/** 履歴に足す（同じ結果は2回足さない）→ id か null */
export function recordDiagnosis4(r) {
  if (!isResult4(r)) return null;
  return addRecord(diagnosisRecord4(r));
}
