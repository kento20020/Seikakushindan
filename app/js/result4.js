// 24問版（v4）の診断結果（#result）。決定 U42・U44。仕様：docs/diagnosis-v4.md §6
//   三択（v3）の結果は今までどおり result.js（どちらを出すかは main.js が今の診断の版で決める）
//   上：「←」・中央「診断結果」・右に「シェア」
//   主軸の絵：主軸の領域の、A の割合で選んだ軸の絵（axis_art.js の heroArt4）。主軸が無ければ出さない
//   見出し『今回の回答で目立つ傾向』と短い注記『今回の回答から見た傾向です。相手や状況によって変わることがあります。』
//     適合率・正確率・信頼度などは出さない
//   主軸（1）と補足（最大2）：強（3問とも・答えた2問とも同じ側）→ 寄り（3問のうち2問）、同じなら答えた数が多い方、さらに同じなら領域の番号順。
//     文は状態の見出しと本文（js/engine4.js の domainText4）
//     主軸の候補が無いとき：状態の出た領域があれば『今回の回答では、片側に強く寄らない傾向』、どの領域も incomplete なら
//     総合の見出しを作らず、分かっている個別の回答（下の8つの領域）と相談への入口
//   組み合わせ（172パターン）は出さない（U44）
//   8つの領域：三択の結果の「8つの軸」と同じ形の横の線（左右の傾向の名前・●の位置＝B を選んだ割合・「向き合う寄り 67%」の1行）＋
//     状態の見出しと本文。U41 の5 で三択から外した説明の文は出さない。絵は A の割合で選ぶ（axis_art.js の axisArt4）。incomplete は番号の丸
//   結果を開いたら、履歴に1件足す（summary4.js の recordDiagnosis4。同じ結果は2回足さない）
//   見た目は app/css/diagnose.css（三択の結果と同じ a-dg- の部品と、a-d4- で始まるクラス）
import { h, icon, topBar, toast, badge, sectionHead, rowLink, artPic } from "./ui.js";
import { store4, restore4, progress4 } from "../../js/ui/four_store.js";
import { DOMAINS } from "../../js/engine.js";
import { DOMAIN_IDS4, domainText4 } from "../../js/engine4.js";
import { leadOf4, recordDiagnosis4, axisView4 } from "./summary4.js";
import { heroArt4, axisArt4, NAVY, ART_SIZE } from "./axis_art.js";

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

// ---------------------------------------------------------------- 主軸・補足
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

// ---------------------------------------------------------------- 8つの領域（三択の「8つの軸」と同じ形の横の線。U44）
const AXIS_PIC = { pos: "52% 40%", zoom: 1.35 };
const SIDE_CLASS = { A: "is-a", B: "is-b", mid: "is-mid" };

function domainsSection(r) {
  return h("section", { class: "a-dg-axes a-d4-doms", "aria-labelledby": "a-d4-doms-h" },
    sectionHead("8つの領域", { id: "a-d4-doms-h" }),
    h("ul", { class: "a-card a-dg-axis-list" }, DOMAIN_IDS4.map((d) => domainRow(r, d))));
}

/**
 * 1本の横軸と、その領域の文
 *   左に軸の絵（A の割合で選ぶ。incomplete は番号の丸）／題「1 衝突への向き合い方」／その下に状態の見出し
 *   両はしの傾向名 → 横軸と● → 「向き合う寄り 67%」（三択と同じ部品 a-dg-axis-ends・a-dg-track・a-dg-axis-share）→ 状態の本文
 *   横軸の部分は読み上げを1文にまとめる（role="img"）。見出しと本文はふつうの文として読む
 */
function domainRow(r, d) {
  const D = DOMAINS[d];
  const dom = r.domains[d];
  const v = axisView4(r, d);
  const t = domainText4(dom);
  const art = axisArt4(d, dom);
  const pic = artPic(art, { cls: "a-dg-axis-pic", ...AXIS_PIC }) ?? h("span", { class: "a-dg-axis-num", "aria-hidden": "true" }, String(d));
  const x = v.pos == null ? 50 : v.pos * 100;
  const hid = `a-d4-dom${d}-h`;
  const track = h("div", { class: "a-dg-track" },
    h("span", { class: "a-dg-track-mid" }),
    v.pos == null ? null : h("span", { class: "a-dg-track-fill" }),
    v.pos == null ? null : h("span", { class: "a-dg-track-dot" }));
  const row = h("li", {
    class: ["a-dg-axis", "a-d4-dom", SIDE_CLASS[v.side] || "is-none", dom.state === "incomplete" && "is-incomplete"],
    "data-domain": d, "data-state": dom.state, "data-side": v.side ?? "none", "data-share": dom.share ?? "none",
    "data-art": art?.file ? art.id : null,
  },
  h("div", { class: "a-dg-axis-head" },
    pic,
    h("div", { class: "a-d4-dom-titles" },
      h("p", { class: "a-dg-axis-name" }, h("span", { class: "a-nowrap" }, `${d} ${D.name}`)),
      h("h3", { class: "a-d4-dom-title", id: hid }, t.title))),
  h("div", { class: "a-dg-axis-view a-d4-dom-view", role: "img", "aria-label": v.label },
    h("div", { class: "a-dg-axis-ends" },
      h("span", { class: ["a-dg-end", "a-dg-end-a", v.side === "A" && "is-lead"] }, D.a),
      h("span", { class: ["a-dg-end", "a-dg-end-b", v.side === "B" && "is-lead"] }, D.b)),
    track,
    h("p", { class: "a-dg-axis-share" }, h("span", null,
      v.pos == null ? null : h("i", { class: "a-dg-share-dot", "aria-hidden": "true" }),
      v.text))),
  h("p", { class: "a-d4-dom-body" }, t.body));
  row.style.setProperty("--axis", art?.color ?? NAVY);
  row.style.setProperty("--axis-deep", art?.deep ?? NAVY);
  row.style.setProperty("--x", `${x}%`);
  row.style.setProperty("--from", `${Math.min(x, 50)}%`);
  row.style.setProperty("--len", `${Math.abs(x - 50)}%`);
  return row;
}

// ---------------------------------------------------------------- シェア
function shareButton(lead) {
  return h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm a-dg-share", id: "a-dg-share", onclick: () => share(lead) },
    icon("share", { size: 20 }), h("span", null, "シェア"));
}

async function share(lead) {
  const url = new URL("./", location.href).href;
  const data = { title: "喧嘩の答え", text: lead?.title || "喧嘩の答えの診断結果", url };
  if (typeof navigator.share === "function") {
    try { await navigator.share(data); return; }
    catch (err) { if (err?.name === "AbortError") return; }
  }
  let ok = false;
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); ok = true; } } catch { ok = false; }
  toast(ok ? "リンクをコピーしました" : "リンクをコピーできませんでした");
}
