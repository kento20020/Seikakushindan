// 24問版（v4）の結果から、ホーム・履歴・結果の画面で使う要点を取り出す。DOM を使わない（Node のテストでも動く）。決定 U42
// 判定はしない（js/engine4.js の computeResult4 の結果を読むだけ）。三択（v3）は app/js/summary.js のまま。
//   isResult4(r)            … v4 の結果か（r.diagnosisVersion === "v4"）
//   leadOf4(r)              … 冒頭の見出し { kind: "primary"|"multiple"|"flat"|"none", title, body, domain }
//   tendencies4(r)          … 主軸と補足の傾向（最大3）[{ domain, key: "1A", side, name, domainName, role: "主軸"|"補足" }]
//   resultKey4(r)           … 結果の key（同じ24問の答えなら同じ）。履歴の重なりの判定に使う（三択の key とは頭が違う：d4-）
//   diagnosisRecord4(r)     … 履歴に足す形 { kind, title, sub, data }
//   recordDiagnosis4(r)     … 履歴に足す（同じ結果は足さない）→ id か null
import { DOMAINS } from "../../js/engine.js";
import { LEAD_TITLE4, domainText4, leadSide4, DOMAIN_IDS4 } from "../../js/engine4.js";
import { addRecord } from "./local.js";

export const isResult4 = (r) => !!r && typeof r === "object" && r.diagnosisVersion === "v4" && !!r.domains;

/** 冒頭の見出し（§7.1）。primary は主軸の領域の状態の見出しと本文 */
export function leadOf4(r) {
  if (!isResult4(r)) return null;
  if (r.lead === "primary" && r.primaryDomainId) {
    const t = domainText4(r.domains[r.primaryDomainId]);
    return { kind: "primary", title: t.title, body: t.body, domain: r.primaryDomainId };
  }
  if (r.lead === "multiple") {
    const names = (r.multipleDomainIds || []).map((d) => DOMAINS[d]?.name).filter(Boolean);
    return { kind: "multiple", title: LEAD_TITLE4.multiple, body: names.length ? `両方の当てはまりが多かった領域：${names.join("、")}` : "", domain: null };
  }
  if (r.lead === "flat") return { kind: "flat", title: LEAD_TITLE4.flat, body: "", domain: null };
  return { kind: "none", title: "", body: "判断できない項目があるため、領域ごとの傾向はまとめていません。分かっている回答だけを出しています。", domain: null };
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

const val = (v) => (v === null ? "u" : String(v));
/** 結果の key。設問の版と、8領域の a・b・p（判断できないは u）から作る */
export function resultKey4(r) {
  const doms = isResult4(r) ? r.domains : {};
  const body = DOMAIN_IDS4.map((d) => { const x = doms[d] || {}; return `${d}:${val(x.a ?? null)}:${val(x.b ?? null)}:${val(x.p ?? null)}`; }).join(",");
  return `d4-${r?.questionBankVersion ?? ""}-${fnv1a(body)}`;
}

/** 履歴に足す形。title＝冒頭の見出し、sub＝その本文 */
export function diagnosisRecord4(r) {
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
