// 仮の画面：相談（#consult）。あとで相談の担当が作り直す（docs/app-screens.md §4.5・§4.6）。
// 今は上の題と「準備中」だけ（ホームなどからの行き来を確かめるため）。
//
// 履歴の詳細（#history/<id>）との約束：このモジュールが
//   export function renderSaved(record) { return 要素 }   // record は local.js の記録（kind "consult"）
// を持てば、履歴の詳細はそれで「そのときのカード」を出す。無ければ、書いた文の冒頭と一手だけを出す。
import { h, topBar } from "./ui.js";

export function render(root) {
  root.append(
    topBar({ title: "相談" }),
    h("div", { class: "a-pending" },
      h("h1", { class: "a-h1" }, "なんでも相談する"),
      h("p", { class: "a-note" }, "この画面は準備中です。"),
      h("a", { class: "a-btn a-btn-outline a-btn-sm", href: "#home" }, "ホームへ戻る")));
}
