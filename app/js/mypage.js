// マイページ（#mypage）。仕様：docs/app-screens.md §4.9
//   アカウント：「ログインしていません」＋「アカウントを作成」（→ #account）
//   診断：「結果を見る」「もう一度診断する」（まだなら「診断をはじめる」、途中なら「続きから答える」）
//     どの状態でも「診断結果の絵を見る」（→ #images。§14）
//   アプリとして使う（§15）：ホーム画面に追加する案内。状態（pwa.js の installState）ごとに文とボタンを替える。
//     状態が変わったら（追加のボタンが使えるようになった・追加し終わった）この節だけ描き直す
//   この端末の記録：「すべて消す」（確かめてから。app/ の履歴と結果の印、診断の回答と結果。今の画面と共通の保存も消える）
//   小さく「試作の画面です」と、今の画面（../#three）へのリンク
import { h, icon, eyebrow, sectionHead, rowLink, toast, go } from "./ui.js";
import { loadRecords, clearAll } from "./local.js";
import { store3, restore3, discard3 } from "../../js/ui/three_store.js";
import { diagnosisState } from "./home.js";
import { PWA_EVENT, currentInstallState, promptInstall } from "./pwa.js";

export function render(root) {
  restore3();
  root.append(view());
  // 「アプリとして使う」の節だけ描き直す。画面を離れたら外す
  const onChange = (e) => {
    const old = root.querySelector("[data-pwa-section]");
    if (!old) return;
    const hadFocus = old.contains(document.activeElement);
    const next = appSection();
    old.replaceWith(next);
    if (hadFocus) next.querySelector("[data-pwa-text]")?.focus({ preventScroll: true });
    if (e?.detail?.reason === "installed") toast("ホーム画面に追加しました");
  };
  window.addEventListener(PWA_EVENT, onChange);
  return () => window.removeEventListener(PWA_EVENT, onChange);
}

// ---------------------------------------------------------------- アプリとして使う（§15）
const APP_TEXT = {
  installed: "ホーム画面のアプリとして開いています。",
  added: "ホーム画面に追加しました。次からは、ホーム画面のアイコンから開けます。",
  prompt: "ホーム画面に追加すると、アプリのように開けます。",
  line: "LINE などのアプリの中の画面からは追加できません。右上のメニューから Chrome（iPhone は Safari）で開き直してください。",
  ios: "共有ボタン → 『ホーム画面に追加』で追加できます。ホーム画面のアプリと Safari では、診断の結果などの保存が別になります。",
  menu: "Chrome のメニュー（︙）から『アプリをインストール』か『ホーム画面に追加』を選んでください。",
};

function appSection() {
  const state = currentInstallState();
  const done = state === "installed" || state === "added";
  return h("section", { "aria-labelledby": "a-me-app", "data-pwa-section": state },
    sectionHead("アプリとして使う", { id: "a-me-app", aside: done ? "追加済み" : null }),
    h("div", { class: "a-card a-pwa-card" },
      h("p", { class: "a-pwa-text", "data-pwa-text": "", tabindex: "-1" },
        done ? icon("check-circle", { size: 20, solid: true }) : null,
        h("span", null, APP_TEXT[state] || APP_TEXT.menu)),
      state === "prompt"
        ? h("button", { type: "button", class: "a-btn a-btn-block a-pwa-btn", onclick: addToHome }, "ホーム画面に追加する")
        : null,
      h("p", { class: "a-note a-pwa-note" }, "Android では、ホーム画面のアプリと Chrome で、診断の結果などはこの端末の中で共有されます。")));
}

async function addToHome(e) {
  e.currentTarget.disabled = true;
  await promptInstall();   // 追加し終わったら pwa.js が知らせ、上の onChange が描き直してトーストを出す
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

    appSection(),

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
