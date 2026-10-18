// 履歴（#history）と、1件の詳細（#history/<id>）。仕様：docs/app-screens.md §4.8
//   この端末の中だけ（app/js/local.js）。新しい順に、診断（日時・主軸の見出し → 結果へ）と相談（日時・書いた文の冒頭・一手 → そのときのカード）
//   1件ずつ消せる。何も無いときは「まだ履歴がありません」と、相談・診断への入口
//   診断：今の結果と同じ key なら #result へ。前の結果は、残っている要点を詳細で見せる（くわしい画面は今の結果だけ）
//   相談：詳細で、consult.js が renderSaved(record) を持てばそれでカードを出す。無ければ書いた文の冒頭と一手
import { h, icon, eyebrow, badge, topBar, fmtDate, toast } from "./ui.js";
import { loadRecords, getRecord, removeRecord } from "./local.js";
import { store3, restore3 } from "../../js/ui/three_store.js";
import { resultKey, jpQuotes } from "./summary.js";

const KIND_LABEL = { diagnosis: "診断", consult: "相談" };

export function render(root, route) {
  restore3();
  const id = route.params[0];
  if (id) return detail(root, id);
  root.append(listView());
}

function currentKey() {
  try { return store3.result ? resultKey(store3.result) : null; } catch { return null; }
}

function hrefOf(item, cur) {
  if (item.kind === "diagnosis" && cur && item.data?.key === cur) return "#result";
  return `#history/${encodeURIComponent(item.id)}`;
}

// ---------------------------------------------------------------- 一覧
function listView() {
  const { items } = loadRecords();
  const cur = currentKey();
  const wrap = h("div", { class: "a-history" },
    h("header", { class: "a-page-head" },
      eyebrow("HISTORY"),
      h("h1", { class: "a-h1" }, "履歴"),
      h("p", { class: "a-lead" }, "この端末の中だけに保存しています")));
  if (!items.length) {
    wrap.append(emptyView());
    return wrap;
  }
  const list = h("ul", { class: "a-hist-list", "aria-label": "新しい順" });
  for (const item of items) list.append(itemRow(item, cur, list));
  wrap.append(list);
  return wrap;
}

function itemRow(item, cur, list) {
  const label = KIND_LABEL[item.kind] || "記録";
  const title = titleOf(item) || (item.kind === "consult" ? "相談" : "診断結果");
  const li = h("li", { class: "a-card a-hist-item", "data-id": item.id, "data-kind": item.kind },
    h("a", { class: "a-hist-link", href: hrefOf(item, cur) },
      h("span", { class: "a-hist-meta" },
        badge(label, { tone: item.kind === "consult" ? "rose" : "slate" }),
        h("time", { datetime: item.at }, fmtDate(item.at))),
      h("span", { class: "a-hist-title" }, title),
      item.sub ? h("span", { class: "a-hist-sub" }, item.kind === "consult" ? `次の一手：${item.sub}` : item.sub) : null),
    h("button", {
      type: "button", class: "a-icon-btn", "aria-label": `「${title}」の${label}の履歴を消す`,
      onclick: () => {
        if (!window.confirm("この履歴を消しますか？（元に戻せません）")) return;
        const next = li.nextElementSibling || li.previousElementSibling;
        if (!removeRecord(item.id)) { toast("消せませんでした"); return; }
        li.remove();
        toast("履歴を1件消しました");
        if (!list.children.length) {
          list.replaceWith(emptyView());
          document.querySelector(".a-history h1")?.focus();
        } else {
          next?.querySelector(".a-hist-link")?.focus();
        }
      },
    }, icon("trash")));
  return li;
}

function emptyView() {
  return h("div", { class: "a-card a-empty" },
    h("p", { class: "a-empty-title" }, "まだ履歴がありません"),
    h("p", { class: "a-note" }, "相談のカードや診断の結果が、ここに残ります。"),
    h("div", { class: "a-empty-actions" },
      h("a", { class: "a-btn a-btn-block", href: "#consult" }, "相談する", icon("arrow-right")),
      h("a", { class: "a-btn a-btn-outline a-btn-block", href: "#diagnose" }, "診断をはじめる", icon("arrow-right"))));
}

// ---------------------------------------------------------------- 1件の詳細
async function detail(root, id) {
  const item = getRecord(id);
  root.append(topBar({ title: "履歴", back: "#history" }));
  if (!item) {
    root.append(h("div", { class: "a-pending" },
      h("h1", { class: "a-h1" }, "この履歴は見つかりません"),
      h("p", { class: "a-note" }, "消したか、別の端末で保存した記録です。"),
      h("a", { class: "a-btn a-btn-outline a-btn-sm", href: "#history" }, "履歴へ戻る")));
    return;
  }
  const label = KIND_LABEL[item.kind] || "記録";
  const head = h("div", { class: "a-detail" },
    h("p", { class: "a-hist-meta" }, badge(label, { tone: item.kind === "consult" ? "rose" : "slate" }), h("time", { datetime: item.at }, fmtDate(item.at))),
    h("h1", { class: "a-detail-title" }, titleOf(item) || label));
  root.append(head);
  if (item.kind === "diagnosis") root.append(...diagnosisDetail(item));
  else root.append(...await consultDetail(item));
}

function diagnosisDetail(item) {
  const d = item.data || {};
  const cur = currentKey();
  const out = [];
  if (item.sub) out.push(h("p", { class: "a-detail-sub" }, item.sub));
  if (Array.isArray(d.tendencies) && d.tendencies.length) {
    out.push(h("section", { class: "a-detail-block" },
      h("h2", null, "主な傾向"),
      h("ul", { class: "a-trends-list" }, d.tendencies.map(t => h("li", null,
        h("span", { class: ["a-dot", t.side === "A" ? "a-dot-a" : "a-dot-b"], "aria-hidden": "true" }),
        h("span", { class: "a-trend-name" }, t.name),
        h("span", { class: "a-trend-domain" }, t.domainName))))));
  }
  const isCurrent = cur && d.key === cur;
  out.push(h("div", { class: "a-detail-block a-stack" },
    isCurrent ? null : h("p", { class: "a-note" }, "くわしい結果の画面は、いちばん新しい診断の結果だけ見られます。"),
    store3.result ? h("a", { class: "a-btn a-btn-block", href: "#result" }, isCurrent ? "結果を見る" : "いまの結果を見る", icon("arrow-right")) : null));
  return out;
}

async function consultDetail(item) {
  try {
    const mod = await import("./consult.js");
    if (typeof mod.renderSaved === "function") {
      const el = mod.renderSaved(item);
      if (el) return [el];
    }
  } catch (err) {
    console.error(err);
  }
  const d = item.data || {};
  const text = typeof d.text === "string" ? d.text : item.title;
  return [
    h("section", { class: "a-detail-block" }, h("h2", null, "書いたこと"), h("p", { class: "a-detail-text" }, text)),
    item.sub ? h("section", { class: "a-detail-block" }, h("h2", null, "次の一手"), h("p", { class: "a-detail-sub" }, item.sub)) : null,
  ].filter(Boolean);
}

// 診断の題は見出し（前に保存した記録は半角の "…" のまま）なので「」にそろえる。相談の題は書いた文の冒頭なので変えない
function titleOf(item) { return item.kind === "diagnosis" ? jpQuotes(item.title) : item.title; }
