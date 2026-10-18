// 診断の結果から、ホーム・履歴・結果の画面で使う要点を取り出す。DOM を使わない（Node のテストでも動く）。
// 判定はしない（js/ の結果を読むだけ。js/ の中身は直さない）。
//   mainPattern(result)      … 主軸のパターン { id, role, headline, one, meta }（byRole の先頭。headline は jpQuotes を通す）
//   jpQuotes(text)           … 見出しの半角の引用符 "X" を「X」にする（新しい画面の表示だけ。元の文 js/data/ は変えない）
//   topTendencies(result, n) … 強く出ている傾向を n 個（既定 3）
//   heroKey(result)          … 主軸に合う傾向の絵のキー（heroTendency。出せなければ null）
//   axisView(result, d)      … 結果の「8つの軸」の1本（●の位置・「熟考寄り 75%」・強さ・読み上げの文）。docs/app-screens.md §12 の2
//   resultKey(result)        … 結果の key（同じ回答・同じ選ばれたパターンなら同じ）。履歴の重なりの判定と、結果の印の key に使う
//   diagnosisRecord(result)  … 履歴に足す形 { kind, title, sub, data }
//   recordDiagnosis(result)  … 履歴に足す（同じ結果は足さない）→ id か null
import { PATTERN_BY_ID } from "../../js/data/patterns.js";
import { byRole } from "../../js/ui/result.js";
import { DOMAINS } from "../../js/engine3.js";
import { domainTendencies3, heroTendency, TYPE_IMAGES, isReady } from "../../js/data/type_images.js";
import { addRecord } from "./local.js";

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

/** 履歴に足す形。title＝主軸の見出し、sub＝その1〜2行 */
export function diagnosisRecord(r) {
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
