// 仮の画面：診断結果（#result）。あとで結果の担当が作り直す（docs/app-screens.md §4.4）。
// 今は上の題と「準備中」だけ（ホームなどからの行き来を確かめるため）。
import { h, topBar } from "./ui.js";

export function render(root) {
  root.append(
    topBar({ title: "診断結果" }),
    h("div", { class: "a-pending" },
      h("h1", { class: "a-h1" }, "あなたを表す解釈"),
      h("p", { class: "a-note" }, "この画面は準備中です。"),
      h("a", { class: "a-btn a-btn-outline a-btn-sm", href: "#home" }, "ホームへ戻る")));
}
