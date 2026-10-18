// 仮の画面：診断の開始（#diagnose）と質問（#diagnose/q）。あとで診断の担当が作り直す（docs/app-screens.md §4.2・§4.3）。
// 今は上の題と「準備中」だけ（ホームなどからの行き来を確かめるため）。
import { h, topBar } from "./ui.js";

export function render(root, route) {
  const q = route.key === "diagnose/q";
  root.append(
    topBar({ title: "診断", back: "#home" }),
    h("div", { class: "a-pending" },
      h("h1", { class: "a-h1" }, q ? "診断の質問" : "診断"),
      h("p", { class: "a-note" }, "この画面は準備中です。"),
      h("a", { class: "a-btn a-btn-outline a-btn-sm", href: "#home" }, "ホームへ戻る")));
}
