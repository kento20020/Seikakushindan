// 24問版（v4）の診断結果（#result）。決定 U42。仕様：docs/diagnosis-v4.md §7（持ち主の仕様書（2026-10-20）の §6.2・§7.1・§7.2）
//   三択（v3）の結果は今までどおり result.js（どちらを出すかは main.js が今の診断の版で決める）
//   上：「←」・中央「診断結果」・右に「シェア」
//   主軸の絵：主軸の領域の、場面の問の p で選んだ軸の絵（axis_art.js の heroArt4。p＞0 は A寄り、p＜0 は B寄り）。主軸が無ければ出さない
//   見出し『今回の回答で目立つ傾向』と短い注記『今回の回答から見た傾向です。相手や状況によって変わることがあります。』
//     適合率・正確率・信頼度などは出さない
//   主軸（1）と補足（最大2）：§7.1 の並べ方（選ばれた側の評定 → |p| → |a−b|、同じなら領域の番号順）。文は §6.2 の状態の見出しと本文
//     主軸の候補が無いとき：状態5があれば『複数の傾向を持つ』、完全に答えた領域があれば『今回の回答では、片側に強く寄らない傾向』、
//     完全に答えた領域が0なら総合の見出しを作らず、分かっている個別の回答（下の8つの領域）と相談への入口
//   あわせて見られる傾向（最大2）：§7.2 の評価器（js/engine4.js の combinations4）。既存の文章の代わりに「〜があわせて見られます。」の短い文
//   8つの領域：状態の見出しと本文、普段の当てはまり（A と B を別々の5段階で。片方からもう片方を引き算で描かない）、
//     場面での選び方（A寄り／ややA寄り／同程度／ややB寄り／B寄り）。答えがそろわない領域は『この領域はまだ分かりません』と、答えた分の値
//     絵は p＞0 で A寄り、p＜0 で B寄り、p＝0 でまんなか（axis_art.js の axisArt4）。答えがそろわない領域は番号の丸
//   結果を開いたら、履歴に1件足す（summary4.js の recordDiagnosis4。同じ結果は2回足さない）
//   見た目は app/css/diagnose.css（三択の結果と同じ a-dg- の部品と、a-d4- で始まるクラス）
import { h, icon, topBar, toast, badge, sectionHead, rowLink, artPic } from "./ui.js";
import { store4, restore4, progress4 } from "../../js/ui/four_store.js";
import { DOMAINS } from "../../js/engine.js";
import { DOMAIN_IDS4, domainText4, prefText4, ratingLabel4, isRating4, isPref4 } from "../../js/engine4.js";
import { leadOf4, recordDiagnosis4 } from "./summary4.js";
import { heroArt4, axisArt4, NAVY, ART_SIZE, AXIS_ART } from "./axis_art.js";

export const RESULT_TITLE4 = "今回の回答で目立つ傾向";
export const RESULT_NOTE4 = "今回の回答から見た傾向です。相手や状況によって変わることがあります。";

export function render(root) {
  restore4();
  const r = store4.result;
  if (!r) { root.append(emptyView()); return; }
  try { recordDiagnosis4(r); } catch (err) { console.error(err); }

  const lead = leadOf4(r);
  root.append(h("div", { class: "a-dg-res a-d4-res", "data-dv": "v4", "data-lead": r.lead },
    topBar({ title: "診断結果", heading: true, right: shareButton(lead) }),
    heroFigure(r),
    h("h2", { class: "a-h1 a-dg-res-title", id: "a-dg-res-title" }, RESULT_TITLE4),
    h("p", { class: "a-note a-d4-res-note" }, RESULT_NOTE4),
    leadCards(r, lead),
    combosSection(r),
    domainsSection(r),
    h("div", { class: "a-dg-res-foot" },
      h("div", { class: "a-card a-rows a-dg-res-rows" },
        rowLink({ href: "#consult", ic: "chat", text: "相談する" }),
        rowLink({ href: "#diagnose", ic: "redo", text: "もう一度診断する" }),
        rowLink({ href: "#types", ic: "grid", text: "診断結果の一覧" }),
        rowLink({ href: "#images", ic: "sparkle", text: "診断結果の絵の一覧" }),
        rowLink({ href: "#home", ic: "home", text: "ホームへ戻る" })))));
}

// ---------------------------------------------------------------- 主軸の絵
function heroFigure(r) {
  let art = null;
  try { art = heroArt4(r); } catch (err) { console.error(err); }
  if (!art?.file) return null;
  return h("figure", { class: "a-dg-hero", "data-key": art.key, "data-art": art.id },
    h("div", { class: "a-dg-hero-pic" },
      h("img", { src: art.file, alt: art.alt || "", width: ART_SIZE, height: ART_SIZE, decoding: "async", fetchpriority: "high" })),
    h("figcaption", { class: "a-dg-hero-name" }, h("span", { class: "a-sr" }, "主軸の領域の絵："), art.tendency));
}

// ---------------------------------------------------------------- 結果が無いとき
function emptyView() {
  const s = store4.session;
  const mid = !!s && !s.completed && progress4(s).answered > 0;
  return h("div", { class: "a-dg-res" },
    topBar({ title: "診断結果" }),
    h("div", { class: "a-card a-empty a-dg-empty" },
      h("h1", { class: "a-empty-title" }, "まだ結果がありません"),
      h("p", { class: "a-note" }, mid ? "途中まで答えた診断があります。最後まで答えると、ここに結果が出ます。" : "診断に答えると、ここに結果が出ます。"),
      h("div", { class: "a-empty-actions" },
        mid
          ? h("a", { class: "a-btn a-btn-block", href: "#diagnose/q" }, "続きから答える", icon("arrow-right"))
          : h("a", { class: "a-btn a-btn-block", href: "#diagnose" }, "診断をはじめる", icon("arrow-right")))));
}

// ---------------------------------------------------------------- 主軸・補足（§7.1）
const domainLabel = (d) => `${d} ${DOMAINS[d]?.name ?? ""}`;

function leadCards(r, lead) {
  if (lead.kind === "primary") {
    const ids = [r.primaryDomainId, ...(r.supportingDomainIds || [])];
    return h("div", { class: "a-dg-cards a-d4-cards" }, ids.map((d, i) => domainCard(r, d, i === 0)));
  }
  if (lead.kind === "none") {
    return h("div", { class: "a-dg-cards a-d4-cards" },
      h("article", { class: "a-dg-pc a-dg-pc-shape a-d4-none", "data-lead": "none" },
        h("p", { class: "a-d4-none-text" }, lead.body),
        h("p", { class: "a-note a-d4-none-sub" }, "今の気持ちや出来事を書いて、相談することもできます。"),
        h("a", { class: "a-btn a-btn-block a-d4-none-btn", href: "#consult" }, "相談する", icon("arrow-right"))));
  }
  return h("div", { class: "a-dg-cards a-d4-cards" },
    h("article", { class: "a-dg-pc a-dg-pc-main a-d4-overall", "data-lead": lead.kind, "aria-labelledby": "a-d4-lead-h" },
      h("h3", { class: "a-dg-pc-title", id: "a-d4-lead-h" }, lead.title),
      lead.body ? h("p", { class: "a-dg-pc-domain" }, lead.body) : null));
}

function domainCard(r, d, main) {
  const dom = r.domains[d];
  const t = domainText4(dom);
  const uid = `a-d4-pc${d}`;
  return h("article", { class: ["a-dg-pc", main ? "a-dg-pc-main" : "a-dg-pc-support"], "data-domain": d, "data-state": dom.state, "data-role": main ? "主軸" : "補足", "aria-labelledby": `${uid}-h` },
    h("div", { class: "a-dg-pc-tags" },
      badge(main ? "主軸" : "補足", { tone: main ? "ink" : "rose" }),
      badge(domainLabel(d), { tone: "quiet" })),
    h("h3", { class: "a-dg-pc-title", id: `${uid}-h` }, t.title),
    h("hr", { class: "a-divider" }),
    h("p", { class: "a-dg-pc-detail a-d4-pc-body" }, t.body));
}

// ---------------------------------------------------------------- あわせて見られる傾向（§7.2。最大2）
function combosSection(r) {
  const list = Array.isArray(r.combos) ? r.combos : [];
  if (!list.length) return null;
  return h("section", { class: "a-d4-combos", "aria-labelledby": "a-d4-combos-h" },
    sectionHead("あわせて見られる傾向", { id: "a-d4-combos-h" }),
    h("ul", { class: "a-card a-d4-combo-list" }, list.map((c) => h("li", { class: "a-d4-combo", "data-id": c.id },
      h("p", { class: "a-d4-combo-text" }, c.text),
      h("p", { class: "a-note a-d4-combo-dom" }, c.domains.length >= DOMAIN_IDS4.length ? "8つの領域すべて" : c.domains.map(domainLabel).join("・"))))));
}

// ---------------------------------------------------------------- 8つの領域
const DOMAINS_NOTE = "「普段の当てはまり」は、2つの文それぞれにどのくらい当てはまるかの答えです（別々に聞いています）。「場面での選び方」は、同じ場面で A と B のどちらに近いかの答えです。";
const AXIS_PIC = { pos: "52% 40%", zoom: 1.35 };

function domainsSection(r) {
  return h("section", { class: "a-d4-doms", "aria-labelledby": "a-d4-doms-h" },
    sectionHead("8つの領域", { id: "a-d4-doms-h" }),
    h("p", { class: "a-note a-d4-doms-note" }, DOMAINS_NOTE),
    h("ul", { class: "a-card a-d4-dom-list" }, DOMAIN_IDS4.map((d) => domainRow(r, d))));
}

function domainRow(r, d) {
  const D = DOMAINS[d];
  const dom = r.domains[d];
  const t = domainText4(dom);
  const art = axisArt4(d, dom);
  const pic = artPic(art, { cls: "a-dg-axis-pic", ...AXIS_PIC }) ?? h("span", { class: "a-dg-axis-num", "aria-hidden": "true" }, String(d));
  const incomplete = dom.state === "incomplete";
  const hid = `a-d4-dom${d}-h`;
  const row = h("li", { class: ["a-d4-dom", incomplete && "is-incomplete"], "data-domain": d, "data-state": dom.state, "data-art": art?.file ? art.id : null },
    h("div", { class: "a-dg-axis-head a-d4-dom-head" },
      pic,
      h("div", { class: "a-d4-dom-titles" },
        h("p", { class: "a-d4-dom-name" }, domainLabel(d)),
        h("h3", { class: "a-d4-dom-title", id: hid }, t.title))),
    h("p", { class: "a-d4-dom-body" }, t.body),
    h("div", { class: "a-d4-levels", role: "group", "aria-label": `${D.name}の普段の当てはまり` },
      h("p", { class: "a-d4-sub" }, "普段の当てはまり"),
      levelRow(D.a, dom.a, "a"),
      levelRow(D.b, dom.b, "b")),
    prefRow(D, dom.p));
  row.style.setProperty("--axis", AXIS_ART[d]?.color ?? NAVY);
  row.style.setProperty("--axis-deep", AXIS_ART[d]?.deep ?? NAVY);
  return row;
}

/** 普段の当てはまりの1行：傾向の名前・4つの目盛り（0〜4 の5段階。埋まった数＝評定）・ラベル。判断できないは点線の枠と文字 */
function levelRow(name, v, side) {
  const ok = isRating4(v);
  const label = ratingLabel4(v);
  return h("div", { class: ["a-d4-lv", `a-d4-lv-${side}`, !ok && "is-none"], "data-value": ok ? String(v) : v === null ? "unknown" : "none" },
    h("p", { class: "a-d4-lv-name" }, name),
    h("span", { class: "a-d4-meter", role: "img", "aria-label": `${name}：${label}` },
      [1, 2, 3, 4].map((k) => h("i", { class: ok && v >= k ? "is-on" : null, "aria-hidden": "true" }))),
    h("p", { class: "a-d4-lv-text", "aria-hidden": "true" }, label));
}

/** 場面での選び方：A と B を両はしにした5つの位置と●、下に「やや向き合う寄り」など */
function prefRow(D, p) {
  const ok = isPref4(p);
  const text = prefText4(p, D.a, D.b);
  const pos = ok ? 2 - p : null;   // 0＝A寄り … 4＝B寄り
  const side = !ok ? "none" : p > 0 ? "a" : p < 0 ? "b" : "mid";
  return h("div", { class: ["a-d4-pref", `is-${side}`], "data-p": ok ? String(p) : p === null ? "unknown" : "none" },
    h("p", { class: "a-d4-sub" }, "場面での選び方"),
    h("div", { class: "a-d4-pref-view", role: "img", "aria-label": `場面での選び方：${text}` },
      h("div", { class: "a-d4-pref-ends", "aria-hidden": "true" },
        h("span", { class: "a-d4-pref-end" }, D.a), h("span", { class: "a-d4-pref-end" }, D.b)),
      h("div", { class: "a-d4-pref-track", "aria-hidden": "true" },
        [0, 1, 2, 3, 4].map((k) => h("i", { class: pos === k ? "is-on" : null }))),
      h("p", { class: "a-d4-pref-text", "aria-hidden": "true" }, text)));
}

// ---------------------------------------------------------------- シェア
function shareButton(lead) {
  return h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm a-dg-share", id: "a-dg-share", onclick: () => share(lead) },
    icon("share", { size: 20 }), h("span", null, "シェア"));
}

async function share(lead) {
  const url = new URL("./", location.href).href;
  const data = { title: "16次元診断", text: lead?.title || "16次元診断の結果", url };
  if (typeof navigator.share === "function") {
    try { await navigator.share(data); return; }
    catch (err) { if (err?.name === "AbortError") return; }
  }
  let ok = false;
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); ok = true; } } catch { ok = false; }
  toast(ok ? "リンクをコピーしました" : "リンクをコピーできませんでした");
}
