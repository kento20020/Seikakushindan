// 設問タブ：レビューの総評／傾向→設問番号の対応／72問＋対決16問の一覧（回答履歴・レビュー列つき）
import { h, mount, table } from "./dom.js";
import { store, loadReview } from "./store.js";
import { QUESTIONS } from "../data/questions.js";
import { DOMAINS, TRAITS } from "../engine.js";
import { ROLE_LABEL, STAGE_LABEL, BASIC_BY_TRAIT } from "../adaptive.js";

const FLAG_CLASS = { "要修正": "flag-ng", "要注意": "flag-warn", "OK": "flag-ok" };
let filterValue = "all";

export function renderQuestions(el) {
  if (!store.review) {
    mount(el, h("p", { class: "note" }, "設問を読み込んでいます…"));
    loadReview().then(() => { if (!el.hidden) renderQuestions(el); });
    return;
  }
  const review = store.review;
  const hist = store.session ? store.session.history() : {};
  const rows = [...QUESTIONS.items, ...QUESTIONS.duels].sort((a, b) => a.no - b.no).map(q => itemRow(q, hist[q.id], review.items[q.id]));

  const filter = h("select", { id: "q-filter", "aria-label": "表示する設問", onchange: (e) => { filterValue = e.target.value; applyFilter(el); } },
    [["all", "すべての設問"], ["basic", "基本"], ["consist", "一貫性"], ["duel", "対決・追加対決"], ["answered", "回答した設問"],
     ["要修正", "レビュー：要修正"], ["要注意", "レビュー：要注意"]].map(([v, t]) => h("option", { value: v, selected: v === filterValue }, t)));

  mount(el,
    h("div", { class: "page-head" },
      h("h1", null, "設問"),
      h("p", { class: "lead" }, `基本64問（16傾向×4）・一貫性8問・対決8問（Q73〜Q80）・追加対決8問（D1x〜D8x）。基本と一貫性は「表現A（気持ち）」「表現B（行動）」の2通りの言い方があります。`)),
    review.summary ? summaryBlock(review.summary) : null,
    h("section", { class: "block" }, h("h2", null, "傾向と設問番号の対応"), mappingTable()),
    h("section", { class: "block" },
      h("h2", null, "設問一覧"),
      h("div", { class: "picker" }, h("label", { for: "q-filter" }, "絞り込み"), filter,
        store.session ? null : h("p", { class: "note" }, "診断に答えると、回答履歴の列に表現と回答が入ります。")),
      table(["No", "区分", "領域", "傾向", "表現A", "表現B", "回答履歴", "レビュー"], rows, { class: "qtable" })),
  );
  applyFilter(el);
}

function applyFilter(el) {
  for (const tr of el.querySelectorAll("table.qtable tbody tr")) {
    const d = tr.dataset;
    const show = filterValue === "all" ? true
      : filterValue === "answered" ? d.answered === "1"
      : filterValue === "duel" ? (d.role === "duel" || d.role === "duel2")
      : (filterValue === "要修正" || filterValue === "要注意") ? d.flag === filterValue
      : d.role === filterValue;
    tr.hidden = !show;
  }
}

function summaryBlock(s) {
  const asList = (v) => Array.isArray(v) ? h("ul", null, v.map(x => h("li", null, x))) : String(v ?? "");
  return h("section", { class: "block review-summary" },
    h("h2", null, "設問レビューの総評"),
    s.verdict ? h("p", { class: "verdict" }, s.verdict) : null,
    s.points?.length ? h("ul", { class: "points" }, s.points.map(p => h("li", null, p))) : null,
    s.options?.length ? [h("h3", null, "改善の選択肢"),
      table(["案", "よい点", "気になる点"], s.options.map(o => h("tr", null, h("td", null, h("b", null, o.name)), h("td", null, asList(o.pros)), h("td", null, asList(o.cons)))), { class: "wide" })] : null);
}

function mappingTable() {
  const consist = Object.fromEntries(QUESTIONS.items.filter(i => i.role === "consist").map(i => [i.trait, i.id]));
  const duelOf = (d, role) => QUESTIONS.duels.find(x => x.domain === d && x.role === role)?.id ?? "—";
  return table(["領域", "傾向", "基本4問", "一貫性", "対決／追加対決"],
    TRAITS.map((t, i) => {
      const d = Math.floor(i / 2) + 1;
      const first = i % 2 === 0;
      return h("tr", { class: first ? "grp-first" : "" },
        first ? h("td", { rowspan: 2 }, `${d} ${DOMAINS[d].name}`) : null,
        h("td", null, t),
        h("td", null, BASIC_BY_TRAIT[t].map(q => q.id).join("・")),
        h("td", null, consist[t] ?? "—"),
        first ? h("td", { rowspan: 2 }, `${duelOf(d, "duel")}／${duelOf(d, "duel2")}`) : null);
    }), { class: "wide" });
}

function itemRow(q, hist, rev) {
  const isDuel = q.role === "duel" || q.role === "duel2";
  const D = DOMAINS[q.domain];
  const wording = (i) => {
    if (!isDuel) {
      const w = q.wordings[i];
      if (w == null) return "—";
      return i === 1 && w === q.wordings[0] ? h("span", { class: "same" }, "（表現Aと同じ文）") : w;
    }
    const v = q.variants[i];
    if (!v) return "—";
    return h("div", { class: "dv" }, h("p", null, v.stem), h("p", { class: "dv-a" }, `1側：${v.a}`), h("p", { class: "dv-b" }, `5側：${v.b}`));
  };
  const histCell = (hist || []).map(e => h("span", { class: ["hist", e.stage === 2 || e.stage === 4 ? "hist-extra" : ""] },
    `${e.stage === 2 || e.stage === 4 ? STAGE_LABEL[e.stage] + "・" : ""}${e.wordingIndex === 0 ? "A" : "B"}：${e.answer ?? "なし"}`,
    e.swapped ? h("small", null, "言い換え") : null,
    e.edits > 0 ? h("small", null, `修正${e.edits}`) : null));
  return h("tr", { dataset: { role: q.role, answered: hist?.length ? "1" : "0", flag: rev?.flag ?? "" }, id: `q-${q.id}` },
    h("td", null, h("code", null, q.id)),
    h("td", null, ROLE_LABEL[q.role]),
    h("td", null, `${q.domain} ${D.name}`),
    h("td", null, isDuel ? `1側：${q.sideA}／5側：${q.sideB}` : q.trait),
    h("td", { class: "wtext" }, wording(0)),
    h("td", { class: "wtext" }, wording(1)),
    h("td", null, histCell.length ? histCell : "—"),
    h("td", null, rev ? [h("span", { class: ["flag", FLAG_CLASS[rev.flag] || ""] }, rev.flag), rev.note ? h("p", { class: "rnote" }, rev.note) : null] : "—"));
}
