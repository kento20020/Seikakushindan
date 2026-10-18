// マイページ（#mypage）。仕様：docs/app-screens.md §4.9
//   アカウント：「ログインしていません」＋「アカウントを作成」（→ #account）
//   診断：「結果を見る」「もう一度診断する」（まだなら「診断をはじめる」、途中なら「続きから答える」）
//     どの状態でも「診断結果の絵を見る」（→ #images。§14）
//   この端末の記録：「すべて消す」（確かめてから。app/ の履歴と結果の印、診断の回答と結果。今の画面と共通の保存も消える）
//   小さく「試作の画面です」と、今の画面（../#three）へのリンク
import { h, icon, eyebrow, sectionHead, rowLink, toast, go } from "./ui.js";
import { loadRecords, clearAll } from "./local.js";
import { store3, restore3, discard3 } from "../../js/ui/three_store.js";
import { diagnosisState } from "./home.js";

export function render(root) {
  restore3();
  root.append(view());
}

function view() {
  const state = diagnosisState();
  const count = loadRecords().items.length;
  const hasData = count > 0 || !!store3.session;
  return h("div", { class: "a-mypage" },
    h("header", { class: "a-page-head" },
      eyebrow("MY PAGE"),
      h("h1", { class: "a-h1" }, "マイページ")),

    h("section", { "aria-labelledby": "a-me-account" },
      sectionHead("アカウント", { id: "a-me-account" }),
      h("div", { class: "a-card a-me-card" },
        h("div", { class: "a-me" },
          h("span", { class: "a-me-icon", "aria-hidden": "true" }, icon("person")),
          h("div", null,
            h("p", { class: "a-me-name" }, "ログインしていません"),
            h("p", { class: "a-note" }, "診断の結果と相談の履歴は、この端末の中だけに保存しています。"))),
        h("a", { class: "a-btn a-btn-block", href: "#account" }, "アカウントを作成", icon("arrow-right")))),

    h("section", { "aria-labelledby": "a-me-diag" },
      sectionHead("診断", { id: "a-me-diag", aside: state === "done" ? "診断済み" : state === "mid" ? "途中まで答えています" : "まだ診断していません" }),
      h("div", { class: "a-card a-rows-card" },
        h("div", { class: "a-rows" },
          state === "done" ? [
            rowLink({ href: "#result", ic: "paper", text: "結果を見る" }),
            rowLink({ href: "#diagnose", ic: "redo", text: "もう一度診断する" }),
          ] : state === "mid" ? [
            rowLink({ href: "#diagnose/q", text: "続きから答える" }),
          ] : [
            rowLink({ href: "#diagnose", text: "診断をはじめる" }),
          ],
          // 絵の一覧（§14）。ほかの行にアイコンがあるとき（診断済み）だけアイコンを付ける
          rowLink({ href: "#images", ic: state === "done" ? "sparkle" : null, text: "診断結果の絵を見る" })))),

    h("section", { "aria-labelledby": "a-me-data" },
      sectionHead("この端末の記録", { id: "a-me-data" }),
      h("div", { class: "a-card" },
        h("div", { class: "a-data-row" },
          h("p", null, `履歴 ${count}件`),
          h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm", disabled: !hasData, onclick: clearEverything }, "すべて消す")),
        h("p", { class: "a-note", style: { marginTop: "12px" } }, "どこにも送っていません。消すと元に戻せません。"))),

    h("footer", { class: "a-foot" },
      h("p", { class: "a-note" }, "試作の画面です"),
      h("p", { class: "a-note" }, h("a", { class: "a-link a-link-tap", href: "../#three" }, "今の画面（診断・相談）を開く"))));
}

function clearEverything() {
  if (!window.confirm("この端末に残っている、診断の回答と結果・相談の履歴をすべて消しますか？（元に戻せません）")) return;
  clearAll();
  discard3();
  toast("この端末の記録を消しました");
  go("#mypage");
}
