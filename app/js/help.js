// 窓口のページ（#help。タブなし。題「危ないときは」）。決定 U47（U22「どの画面にも」の、相談の外の入口）。仕様：docs/app-screens.md §23.1
//   上から：上の帯（題「危ないときは」。h1）／いますぐの電話（110・119。tel: のリンク）／相談できる窓口（DV相談＋・DV相談ナビ・よりそいホットライン。
//     名前・番号〔tel: のリンク〕・注。js/consult/texts.js の SAFETY_RESOURCES から。よりそいホットラインは1回だけ）／
//     「こんなときは、窓口に相談できます」の短い箇条／小さな注（どこにも送らない・履歴に残さない／番号は2026年10月時点の資料）
//   履歴（app/js/local.js）には記録しない。どこにも何も送らない。文と番号は app/js/safety.js
//   見た目は app/css/app.css（a-help-）
import { h, topBar } from "./ui.js";
import { HELP_TITLE, HELP_LIST_TITLE, HELP_WHEN_TITLE, HELP_WHEN, HELP_NOTES, emergencyParts, helpResources } from "./safety.js";

export function render(root) {
  root.append(h("div", { class: "a-help" },
    topBar({ title: HELP_TITLE, heading: true }),
    h("p", { class: "a-help-now" }, emergencyParts().map((p) => (p.tel
      ? h("a", { class: "a-help-now-tel", href: p.tel }, p.text)
      : p.text))),
    h("section", { class: "a-help-sec", "aria-labelledby": "a-help-list-h" },
      h("h2", { class: "a-help-h", id: "a-help-list-h" }, HELP_LIST_TITLE),
      h("ul", { class: "a-card a-help-list" }, helpResources().map((r) => h("li", { class: "a-help-item", "data-key": r.key },
        h("p", { class: "a-help-name" }, r.name),
        h("a", { class: "a-help-tel", href: r.tel, "aria-label": `${r.name}に電話する（${r.contact}）` }, r.contact),
        r.note ? h("p", { class: "a-help-note" }, r.note) : null)))),
    h("section", { class: "a-help-sec", "aria-labelledby": "a-help-when-h" },
      h("h2", { class: "a-help-h", id: "a-help-when-h" }, HELP_WHEN_TITLE),
      h("ul", { class: "a-help-when" }, HELP_WHEN.map((t) => h("li", null, t)))),
    h("div", { class: "a-help-notes" }, HELP_NOTES.map((t) => h("p", { class: "a-note" }, t)))));
}
