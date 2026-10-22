// アカウント（#account。画像4）。仕様：docs/app-screens.md §4.7
//   LINE と Google だけ（メール・パスワード・Apple は置かない）。押しても実際にはログインしない（試作）。どこにも送らない
//   新規登録のときだけ「利用規約・プライバシーポリシーに同意する」。同意しないとボタンは押せない
import { h, topBar, logo, icon, toast, goBack } from "./ui.js";

const PROTO = "試作のため、ログインはしません";
const MODES = [["signup", "新規登録"], ["login", "ログイン"]];

export function render(root) {
  let mode = "signup";
  let agreed = false;

  const tabs = MODES.map(([key, label]) => h("button", {
    type: "button", role: "tab", id: `a-acc-tab-${key}`, "aria-controls": "a-acc-panel",
    onclick: () => setMode(key, false),
    onkeydown: (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      setMode(mode === "signup" ? "login" : "signup", true);
    },
  }, label));
  const panel = h("div", { class: "a-account-panel", role: "tabpanel", id: "a-acc-panel" });

  function setMode(next, focusTab) {
    mode = next;
    for (const t of tabs) {
      const on = t.id === `a-acc-tab-${mode}`;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      if (on && focusTab) t.focus();
    }
    panel.setAttribute("aria-labelledby", `a-acc-tab-${mode}`);
    panel.replaceChildren(...panelBody());
  }

  function panelBody() {
    const signup = mode === "signup";
    const verb = signup ? "登録する" : "ログインする";
    const buttons = [
      h("button", { type: "button", class: "a-btn a-btn-outline a-btn-block a-btn-brand", "data-provider": "line", onclick: press }, logo("line"), `LINEで${verb}`),
      h("button", { type: "button", class: "a-btn a-btn-outline a-btn-block a-btn-brand", "data-provider": "google", onclick: press }, logo("google"), `Googleで${verb}`),
    ];
    const sync = () => { for (const b of buttons) b.disabled = signup && !agreed; };
    sync();
    const check = signup ? h("label", { class: "a-check" },
      h("input", { type: "checkbox", id: "a-acc-agree", checked: agreed, onchange: (e) => { agreed = e.target.checked; sync(); } }),
      h("span", { class: "a-check-box", "aria-hidden": "true" }, icon("check")),
      h("span", null,
        h("button", { type: "button", class: "a-link a-link-tap", onclick: soon }, "利用規約"),
        "・",
        h("button", { type: "button", class: "a-link a-link-tap", onclick: soon }, "プライバシーポリシー"),
        "に同意する")) : null;
    const foot = signup
      ? h("p", { class: "a-account-foot" }, "すでにアカウントをお持ちの方は ",
        h("button", { type: "button", class: "a-link a-link-tap", onclick: () => setMode("login", true) }, "ログイン"))
      : h("p", { class: "a-account-foot" }, "はじめての方は ",
        h("button", { type: "button", class: "a-link a-link-tap", onclick: () => setMode("signup", true) }, "新規登録"));
    return [check, h("div", { class: "a-stack" }, buttons), foot];
  }

  setMode("signup", false);
  root.append(
    topBar({ title: "アカウント", back: () => goBack("#mypage"), help: true }),
    h("div", { class: "a-account-head" },
      deco(),
      h("h1", { class: "a-h1" }, "アカウントを作成して", h("br"), "もっと便利に"),
      h("p", { class: "a-lead" }, "診断結果の保存や、相談の履歴管理が", h("br"), "できるようになります。")),
    h("div", { class: "a-card a-account-card" },
      h("div", { class: "a-seg", role: "tablist", "aria-label": "新規登録とログインの切り替え" }, tabs),
      panel),
    h("p", { class: "a-note a-account-note" }, "試作の画面です。押しても、ログインやどこかへの送信はしません。"));
}

function press() { toast(PROTO); }
function soon() { toast("準備中です"); }

/** 右上の飾り（薄い円2つと細い曲線。画像4のとおり） */
function deco() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "a-deco");
  svg.setAttribute("viewBox", "0 0 168 196");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML =
    '<circle cx="104" cy="66" r="50" fill="#E9D2CB" opacity="0.6"/>' +
    '<circle cx="118" cy="128" r="40" fill="#E9D2CB" opacity="0.42"/>' +
    '<path d="M168 22C120 30 104 70 98 104S80 168 6 186" fill="none" stroke="#8C7F7A" stroke-width="0.9" opacity="0.6"/>';
  return svg;
}
