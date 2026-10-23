// 診断の結果から、ホーム・履歴・結果の画面で使う要点を取り出す。DOM を使わない（Node のテストでも動く）。
// 判定はしない（js/ の結果を読むだけ。js/ の中身は直さない）。
//   mainPattern(result)      … 主軸のパターン { id, role, headline, one, meta }（byRole の先頭。headline は jpQuotes を通す）
//   jpQuotes(text)           … 見出しの半角の引用符 "X" を「X」にする（新しい画面の表示だけ。元の文 js/data/ は変えない）
//   topTendencies(result, n) … 強く出ている傾向を n 個（既定 3）
//   heroKey(result)          … 主軸に合う傾向の、今の傾向の絵（img/types/。絵のある8つから）のキー（heroTendency。出せなければ null）
//                              app/ の画面は使わない（軸の絵 app/js/axis_art.js の heroArt を使う。§13）
//   axisView(result, d)      … 結果の「8つの軸」の1本（●の位置・「熟考寄り 75%」・強さ・読み上げの文）。docs/app-screens.md §12 の2
//   resultKey(result)        … 結果の key（同じ回答・同じ選ばれたパターンなら同じ）。履歴の重なりの判定と、結果の印の key に使う
//   diagnosisRecord(result)  … 履歴に足す形 { kind, title, sub, data }（結果の出し方の版で変わる。下の「持ち主の原稿の形」）
//   recordDiagnosis(result)  … 履歴に足す（同じ結果は足さない）→ id か null
//
// 持ち主の原稿の形（決定 U49。既定。?rc3=old で前の形。app/js/result_copy_version.js）
//   isResult3(r)             … 三択の結果か（r.states があり、24問の結果ではない）
//   copyOf3(r)               … 結果の文の1セット（js/result_copy3.js の resultCopy3）。結果の画面・ホーム・履歴・シェアの題は、どれもこの title
//   copyCard3(r)             … ホームの診断後のカードの中身 { title, sentence（本文の最初の1文）, kind }（24問の copyCard4 と同じ形）
//   履歴の記録：題＝copy の title、sub＝本文の最初の1文、data に copyVersion・copyId。key は前と同じ resultKey（前に記録した物はそのまま読め、同じ答えなら足さない）
import { PATTERN_BY_ID } from "../../js/data/patterns.js";
import { byRole } from "../../js/ui/result.js";
import { DOMAINS } from "../../js/engine3.js";
import { domainTendencies3, heroTendency, TYPE_IMAGES, isReady } from "../../js/data/type_images.js";
import { addRecord } from "./local.js";
import { resultCopy3 } from "../../js/result_copy3.js";
import { firstSentence4 } from "../../js/result_copy4.js";
import { resultCopy3Version } from "./result_copy_version.js";

/**
 * 半角の引用符 "X" を「X」にする（明朝では浮いて見え、変な所で折り返すため。新しい画面の表示だけ）
 *   元の文（js/data/・docs/design.md）と今の画面は変えない。文字列でなければ（null など）そのまま返す
 *   今の見出しの " はどれも対になっている（「」とまざっている所は無い）
 */
export function jpQuotes(text) {
  return typeof text === "string" ? text.replace(/"([^"]*)"/g, "「$1」") : text;
}

const chosenOf = (r) => (Array.isArray(r?.select?.chosen) ? r.select.chosen.filter(x => x && x.meta) : []);

/** 主軸のパターン。役割の順（js/ui/result.js の byRole）で並べた先頭。無ければ null */
export function mainPattern(r) {
  const list = byRole(chosenOf(r));
  const hit = list.find(x => x.role === "主軸") ?? list[0];
  if (!hit) return null;
  const m = hit.meta;
  const p = PATTERN_BY_ID[m.id];
  return { id: m.id, role: hit.role, headline: jpQuotes(p?.headline ?? m.headline ?? ""), one: p?.text?.one ?? "", meta: m };
}

/**
 * 強く出ている傾向（左右で優勢な領域だけ。拮抗した領域は入れない）を n 個
 *   並べ方：「弱め」（優勢だが強さが弱い・W と X の向きが逆）でないものが先 → 強さ（X の level）が高い順 → 左右（W）の取り分が高い順 → 領域番号
 *   { domain, key: "1A", side: "A" | "B", name: 傾向の名前, domainName: 領域の名前, weak, level, share }
 */
export function topTendencies(r, n = 3) {
  const p3 = r?.profile3;
  if (!p3) return [];
  const leads = domainTendencies3(p3);
  const list = Object.values(leads).filter(t => t.key).map(t => {
    const side = t.key.slice(-1);
    const w = p3.w?.[t.domain] || {};
    const a = +w.a || 0, b = +w.b || 0;
    const share = a + b ? (side === "A" ? a : b) / (a + b) : 0;
    const lv = Number(p3.levels?.[t.tendency]);
    return { domain: t.domain, key: t.key, side, name: t.tendency, domainName: DOMAINS[t.domain]?.name ?? "", weak: !!t.weak, level: Number.isFinite(lv) ? lv : 50, share };
  });
  list.sort((x, y) => (x.weak - y.weak) || (y.level - x.level) || (y.share - x.share) || (x.domain - y.domain));
  return list.slice(0, Math.max(0, n));
}

/** 主軸に合う傾向の絵のキー（js/data/type_images.js の heroTendency）。絵が無ければ null */
export function heroKey(r) {
  try {
    const pick = r?.profile3 ? heroTendency(r.profile3, chosenOf(r)) : null;
    return pick && isReady(TYPE_IMAGES[pick.key]) ? pick.key : null;
  } catch {
    return null;
  }
}

/**
 * 「8つの軸」の1本（領域 d）。値は結果の r.states[d]（js/engine3.js の domainStates3）を読むだけ
 *   pos   … ●の位置 0〜1（同じ場面の問で B を選んだ割合。0＝すべて A、1＝すべて B）。答えが無ければ null（●を出さない）
 *   side  … "A" | "B"（多く選んだ側）| "mid"（同数）| null（答えが無い）
 *   pct   … 多く選んだ側の割合（0〜100 の整数）。答えが無ければ null
 *   text  … 「熟考寄り 75%」／「まんなか 50%」／「まだ答えがありません」
 *   la・lb … 強さ（別々の場面を比べた答えから出した 0〜100。st.LA・st.LB を四捨五入。無ければ null）
 *   level … 「即応 40 ・ 熟考 72」  label … 読み上げ「反応速度：熟考寄り 75%（即応の強さ 40、熟考の強さ 72）」
 */
export function axisView(r, d) {
  const D = DOMAINS[d];
  if (!D) return null;
  const st = r?.states?.[d] || {};
  const a = Math.max(0, +st.a || 0), b = Math.max(0, +st.b || 0);
  const n = a + b;
  const side = n ? (a > b ? "A" : b > a ? "B" : "mid") : null;
  const pct = n ? Math.round(Math.max(a, b) / n * 100) : null;
  const text = !n ? "まだ答えがありません" : side === "mid" ? "まんなか 50%" : `${side === "A" ? D.a : D.b}寄り ${pct}%`;
  const lv = (x) => (Number.isFinite(+x) && x !== null && x !== "" ? Math.round(+x) : null);
  const la = lv(st.LA), lb = lv(st.LB);
  const show = (x) => (x == null ? "—" : String(x));
  return {
    domain: +d, name: D.name, aName: D.a, bName: D.b,
    a, b, n, pos: n ? b / n : null, side, pct, text, la, lb,
    level: `${D.a} ${show(la)} ・ ${D.b} ${show(lb)}`,
    label: `${D.name}：${text}（${D.a}の強さ ${show(la)}、${D.b}の強さ ${show(lb)}）`,
  };
}

// 32 ビットの FNV-1a（結果の key を短くするため。暗号ではない）
function fnv1a(str) {
  let x = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    x ^= str.charCodeAt(i);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return x.toString(36);
}

/** 結果の key。設問の版・回答（設問の枠・出した設問・左右）・選ばれたパターンと役割から作る */
export function resultKey(r) {
  const recs = (Array.isArray(r?.records) ? r.records : []).map(x => `${x.key}:${x.itemId ?? ""}:${x.answer ?? "-"}`).join(",");
  const ids = chosenOf(r).map(x => `${x.meta.id}:${x.role}`).join(",");
  return `d1-${r?.version ?? ""}-${fnv1a(`${recs}|${ids}`)}`;
}

/** 三択の結果か（r.states があり、24問の結果〔diagnosisVersion "v4"〕ではない） */
export const isResult3 = (r) => !!r && typeof r === "object" && r.diagnosisVersion !== "v4" && !!r.states && typeof r.states === "object";

/** 結果の文の1セット（三択の結果でなければ null）。決定 U49 */
export function copyOf3(r) {
  return isResult3(r) ? resultCopy3(r) : null;
}

/** ホームの診断後のカード：題・本文の最初の1文（文の途中で切らない）。答えがそろった領域が無いとき（三択では起きない）は題だけ */
export function copyCard3(r, c = copyOf3(r)) {
  if (!c) return null;
  return { title: c.title, sentence: c.kind === "none" ? "" : firstSentence4(c.paragraphs[0] ?? ""), kind: c.kind };
}

/**
 * 履歴に足す形
 *   持ち主の原稿の形（既定。決定 U49）：title＝copy の title、sub＝本文の最初の1文、data に copyVersion・copyId・主軸（copy の主軸）。主な傾向の一覧は入れない
 *   前の形（rc3 "old"）：title＝主軸の見出し、sub＝その1〜2行、主な傾向
 *   key はどちらも resultKey（同じ答えの記録が前からあれば、足さない）
 */
export function diagnosisRecord(r, { rc3 = resultCopy3Version() } = {}) {
  if (rc3 !== "old") {
    const copy = copyOf3(r);
    const c = copyCard3(r, copy);
    const main = mainPattern(r);
    const src = r?.source || {};
    return {
      kind: "diagnosis",
      title: c?.title || "診断結果",
      sub: c?.sentence || "",
      data: {
        key: resultKey(r),
        version: r?.version ?? null,
        copyVersion: copy?.copyVersion ?? null,
        copyId: copy?.copyId ?? null,
        primaryDomainId: copy?.primaryDomain ?? null,
        mainId: main?.id ?? null,
        tendencies: [],
        answered: Array.isArray(r?.records) ? r.records.length : 0,
        ...(src.type && src.type !== "session" ? { sample: String(src.name || src.type) } : {}),
      },
    };
  }
  const main = mainPattern(r);
  const top = topTendencies(r, 3);
  const src = r?.source || {};
  return {
    kind: "diagnosis",
    title: main?.headline || "診断結果",
    sub: main?.one || "",
    data: {
      key: resultKey(r),
      version: r?.version ?? null,
      mainId: main?.id ?? null,
      tendencies: top.map(({ domain, key, side, name, domainName }) => ({ domain, key, side, name, domainName })),
      answered: Array.isArray(r?.records) ? r.records.length : 0,
      ...(src.type && src.type !== "session" ? { sample: String(src.name || src.type) } : {}),
    },
  };
}

/** 履歴に足す（同じ結果は2回足さない）→ id か null。結果の画面とホームの両方から呼んでよい */
export function recordDiagnosis(r) {
  if (!r) return null;
  return addRecord(diagnosisRecord(r));
}
