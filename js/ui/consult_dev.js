// 相談（試作）の開発者向けの表示：判定の中身と、AI に渡すプロンプト。ふだんは閉じておく（<details>）。
// どちらもクラス dev-only で、?dev=1 のときだけ見える（css/style.css の末尾）。
import { h, table } from "./dom.js";
import { PHASE_LABELS, ACTION_DEFS, STYLE_DEFS } from "../consult/texts.js";
import { estimateTokens } from "../consult/prompt.js";

/** 文面の指定・メモの ID に意味を添える（texts.js の STYLE_DEFS） */
const describe = (id) => { const d = STYLE_DEFS[id] ?? STYLE_DEFS[`note:${id}`]; return d ? `${id}：${d}` : id; };
const nf = (n) => new Intl.NumberFormat("ja-JP").format(n);
const list = (a) => Array.isArray(a) && a.length ? a.join("、") : "なし";

/** 判定の中身（ctx.result）。局面・一手・付け足し・タイミング・点検時刻・確かさ・差・文面の指定・メモ・点数・補正 */
export function judgeDetails(ctx) {
  const r = ctx.result;
  const rows = [
    ["局面 (phase)", r.phase ? `${r.phase}　${PHASE_LABELS[r.phase] ?? ""}` : `なし（安全ゲート：${r.gate}）`],
    ["一手 (action)", r.action ? `${r.action}${ACTION_DEFS[r.action] ? `　${ACTION_DEFS[r.action].split("。")[0]}` : ""}` : "なし"],
    ["付け足し (addons)", list(r.addons)],
    ["タイミング (timing)", r.timing ?? "なし"],
    ["点検時刻 (recheck)", r.recheck ?? "なし"],
    ["確かさ (confidence)", r.confidence ?? "なし"],
    ["1位と2位の差 (margin)", r.margin ?? "なし"],
    ["文面の指定 (styles)", r.styles?.length ? r.styles.map(describe).join("\n") : "なし"],
    ["メモ (notes)", r.notes?.length ? r.notes.map(describe).join("\n") : "なし"],
    ["2通り (variants)", r.variants ? `A：${r.variants.A} ／ B：${r.variants.B}` : "なし"],
    ["文面の2通り (styleVariants)", r.styleVariants ? `領域${r.styleVariants.domain} A：${list(r.styleVariants.A)} ／ B：${list(r.styleVariants.B)}` : "なし"],
    ["避ける言葉 (avoid)", list(r.avoid)],
    ["現在時刻", `${ctx.now.toISOString()}（時差 ${ctx.tzOffset} 分）`],
    ["文体・呼び方", `${ctx.register}${ctx.partnerCall ? `・${ctx.partnerCall}` : ""}`],
    ["安全ゲートの種類", `selfHarm=${ctx.safety.selfHarm}・partnerThreat=${ctx.safety.partnerThreat}`],
  ];
  const scores = r.scores.map(([a, s]) => h("tr", { class: a === r.action ? "cs-picked" : null }, h("td", null, h("code", null, a)), h("td", { class: "num" }, String(s))));
  const contrib = Object.entries(r.contributions || {});
  return h("details", { class: "cs-dev dev-only", "data-dev": "judge" },
    h("summary", null, "判定の中身（開発用）"),
    h("div", { class: "cs-dev-body" },
      h("dl", { class: "cs-dl" }, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, String(v))])),
      h("h4", null, "点数（行動 / 点）"),
      scores.length ? table(["行動", "点"], scores, { class: "cs-dev-table" }) : h("p", { class: "note" }, "点数はありません（安全ゲート）。"),
      h("h4", null, "適用した補正の ID"),
      r.applied.length ? h("ul", { class: "cs-chips cs-ids" }, r.applied.map(id => h("li", { class: "cs-id-chip" }, h("code", null, id)))) : h("p", { class: "note" }, "なし"),
      h("h4", null, "一手の点を動かした量（contributions）"),
      contrib.length
        ? table(["補正の ID", "動かした点"], contrib.map(([id, v]) => h("tr", null, h("td", null, h("code", null, id)), h("td", { class: "num" }, (v > 0 ? "+" : "") + v))), { class: "cs-dev-table" })
        : h("p", { class: "note" }, "なし")));
}

/** 長い文字列は、開いたときに初めて <pre> にする（L1 は約1.7万字） */
function lazyPre(text, summaryText) {
  const body = h("div", { class: "cs-pre-slot" });
  const d = h("details", { class: "cs-prompt-block", "data-layer": "l1" }, h("summary", null, summaryText), body);
  d.addEventListener("toggle", () => { if (d.open && !body.firstChild) body.append(h("pre", { class: "cs-pre" }, text)); });
  return d;
}

const sizeLabel = (name, text) => `${name}　${nf([...text].length)}字・約${nf(estimateTokens(text))}トークン`;

/**
 * AI に渡すプロンプト（l1・l2・l3）と、AI の接続の状態。
 * @param {{ prompt: {l1: string, l2: string, l3: string, version: string}, source: string, errors: string[] }} res  respond の結果
 * @param {string|null} endpoint  使っている中継の URL（なければ null）
 */
export function promptDetails(res, endpoint) {
  const p = res.prompt;
  let host = null;
  if (endpoint) { try { host = new URL(endpoint).host; } catch { host = "（URL が読めない）"; } }
  return h("details", { class: "cs-dev dev-only", "data-dev": "prompt" },
    h("summary", null, "AI に渡すプロンプト"),
    h("div", { class: "cs-dev-body" },
      h("p", { class: "note cs-prompt-note" }, host
        ? `AI につないでいます。下の内容を ${host} に送って回答を作ります（失敗したときは決まった文型に戻します）。`
        : "このページからは、どこにも送っていません。いまの回答は決まった文型で作っています。AI につないだときに渡す中身を、確認用に見せています。"),
      h("dl", { class: "cs-dl" },
        h("dt", null, "AI の接続"), h("dd", { "data-ai-status": host ? "connected" : "off" }, host ? `接続先：${host}` : "未接続"),
        h("dt", null, "この回答の作り方"), h("dd", null, res.source === "ai" ? "AI (ai)" : "決まった文型 (template)"),
        h("dt", null, "1層目の版"), h("dd", null, p.version),
        h("dt", null, "respond.errors"), h("dd", null, res.errors?.length ? h("ul", { class: "cs-errors" }, res.errors.map(e => h("li", null, e))) : "なし")),
      lazyPre(p.l1, sizeLabel("L1（固定のシステムプロンプト）", p.l1)),
      h("h4", { class: "cs-prompt-h" }, sizeLabel("L2（人ごと）", p.l2)),
      h("pre", { class: "cs-pre", "data-layer": "l2" }, p.l2),
      h("h4", { class: "cs-prompt-h" }, sizeLabel("L3（今回の相談）", p.l3)),
      h("pre", { class: "cs-pre", "data-layer": "l3" }, p.l3)));
}
