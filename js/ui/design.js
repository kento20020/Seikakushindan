// 設計タブ：docs/design.md を marked（cdnjs、版固定）で描画し、## 見出しから目次をつくる。
// CDN が使えないときは、見出しごとに区切った <pre> で表示する（目次はそのまま使える）。
import { h, mount } from "./dom.js";

const MARKED_URL = "https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js";
const DOC_URL = "./docs/design.md";
let rendered = null;   // 描画済みの要素（タブを切り替えても作り直さない）
let loading = null;

export function renderDesign(el) {
  if (rendered) { mount(el, rendered); return; }
  mount(el, h("p", { class: "note loading" }, "設計書を読み込んでいます…"));
  loading ||= build().then(node => { rendered = node; }).catch(err => {
    rendered = h("div", { class: "empty-state" }, h("h1", null, "設計書を読み込めませんでした"),
      h("p", null, `${DOC_URL} を取得できませんでした（${err.message}）。ローカルで開く場合は python3 -m http.server などでサーバー経由にしてください。`));
  });
  loading.then(() => { if (!el.hidden) mount(el, rendered); });
}

function loadMarked() {
  return new Promise((resolve) => {
    if (window.marked) return resolve(window.marked);
    const s = document.createElement("script");
    s.src = MARKED_URL;
    s.async = true;
    s.onload = () => resolve(window.marked || null);
    s.onerror = () => resolve(null);
    document.head.append(s);
    setTimeout(() => resolve(window.marked || null), 8000);
  });
}

async function build() {
  const [res, marked] = await Promise.all([fetch(DOC_URL), loadMarked()]);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const md = await res.text();
  const body = h("article", { class: "doc" });
  let usedMarked = false;
  if (marked?.parse) {
    try { body.innerHTML = marked.parse(md, { gfm: true }); usedMarked = true; } catch { usedMarked = false; }
  }
  if (!usedMarked) fallback(body, md);

  // 横に長い表は表の中だけでスクロール
  for (const t of body.querySelectorAll("table")) {
    const wrap = h("div", { class: "table-wrap" });
    t.replaceWith(wrap); wrap.append(t);
  }
  // 目次（## 見出し）
  const heads = [...body.querySelectorAll("h2")];
  heads.forEach((hd, i) => { hd.id = `doc-sec-${i + 1}`; hd.tabIndex = -1; });
  const jump = (hd) => { hd.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); hd.focus({ preventScroll: true }); };
  const tocList = h("ol", { class: "toc-list" }, heads.map(hd => h("li", null, h("button", { class: "toc-link", type: "button", onclick: () => jump(hd) }, hd.textContent))));
  const title = body.querySelector("h1")?.textContent || "設計書";

  return h("div", { class: "design-layout" },
    h("nav", { class: "toc", "aria-label": "設計書の目次" },
      h("details", { class: "toc-box", open: matchMedia("(min-width: 960px)").matches },
        h("summary", null, `目次（${heads.length}）`), tocList)),
    h("div", { class: "doc-main" },
      h("p", { class: "doc-meta" }, `docs/design.md を表示しています（${usedMarked ? "Markdown を描画" : "Markdown 描画ライブラリを読み込めなかったため原文のまま"}）。`, h("a", { href: DOC_URL }, "原文を開く")),
      body));
}

/** marked が使えないとき：## ごとに区切って見出し＋原文 */
function fallback(body, md) {
  const parts = md.split(/^## /m);
  body.append(h("pre", { class: "doc-pre" }, parts[0]));
  for (const p of parts.slice(1)) {
    const nl = p.indexOf("\n");
    body.append(h("h2", null, p.slice(0, nl < 0 ? undefined : nl).trim()), h("pre", { class: "doc-pre" }, nl < 0 ? "" : p.slice(nl + 1)));
  }
}
