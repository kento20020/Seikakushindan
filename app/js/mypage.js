// マイページ（#mypage）。仕様：docs/app-screens.md §4.9
//   アカウント：「ログインしていません」＋「アカウントを作成」（→ #account）
//   診断：「結果を見る」「もう一度診断する」（まだなら「診断をはじめる」、途中なら「続きから答える」）
//     どの状態でも「診断結果の一覧（24タイプ）」（→ #types。§16）と「診断結果の絵を見る」（→ #images。§14）
//   アプリとして使う（§15）：ホーム画面に追加する案内。状態（pwa.js の installState）ごとに文とボタンを替える。
//     状態が変わったら（追加のボタンが使えるようになった・追加し終わった）この節だけ描き直す
//     iPhone（§15.10。決定 U37）：Safari・ほかのブラウザで追加の手順（<ol>）。下の注は端末で分ける（iPhone は保存が別）。
//     iPhone のときだけ、手順の下に「Safari とアプリのあいだで診断を移す」（app/js/transfer.js の引き継ぎのコード）
//     カードのいちばん下に、どの状態でも「ホーム画面で使うのをやめるには」（<details>。§15.11。決定 U39）。
//       今の端末（pwa.js の currentDevice：iPhone・Android・パソコン）の手順を先に、ほかの端末は「ほかの端末」の下に
//     節の最初の方に1行「端末を見られたくないときは、追加しないでください。…」（決定 U47。人目の守り）
//   この端末の記録：「すべて消す」（確かめてから。app/ の履歴と結果の印、診断の回答と結果、履歴の冒頭の設定。今の画面と共通の保存も消える）
//     切り替え「履歴の一覧に、相談で書いた文の冒頭を出す」（決定 U47。local.js の historySnippetOn・setHistorySnippet。はじめはオフ）と小さな注
//   いちばん下（タブの上）に「危ないときは：相談できる窓口 ›」（ui.js の helpFoot → #help。決定 U47）
//   お問い合わせ（§17。決定 U39・U40）：「お問い合わせ・不具合の報告」（→ #contact。今はメールのアプリで送る画面。Google フォームを入れればフォームへ）
//   小さく「試作の画面です」と、今の画面（../#three）へのリンク
import { h, icon, eyebrow, sectionHead, rowLink, toast, go, helpFoot } from "./ui.js";
import { loadRecords, clearAll, historySnippetOn, setHistorySnippet } from "./local.js";
import { APP_PRIVACY_LINE, HISTORY_SNIPPET_LABEL, HISTORY_SNIPPET_NOTE } from "./safety.js";
import { store3, restore3, discard3 } from "../../js/ui/three_store.js";
import { store4, restore4, discard4 } from "../../js/ui/four_store.js";
import { diagnosisState } from "./home.js";
import { currentResult, setActiveVersion } from "./diagnosis_version.js";
import { PWA_EVENT, currentInstallState, currentPlatform, currentDevice, promptInstall } from "./pwa.js";
import { hasTransferable, makeTransferCode, readTransferCode, applyTransfer } from "./transfer.js";

export function render(root) {
  restore3();
  restore4();
  root.append(view());
  // 「アプリとして使う」の節だけ描き直す。画面を離れたら外す
  const onChange = (e) => {
    const old = root.querySelector("[data-pwa-section]");
    if (!old) return;
    const hadFocus = old.contains(document.activeElement);
    const wasOpen = !!old.querySelector("[data-pwa-stop]")?.open;   // 「やめるには」を開いていたら、開いたままにする
    const next = appSection();
    if (wasOpen) next.querySelector("[data-pwa-stop]")?.setAttribute("open", "");
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
  ios: "Safari の共有ボタンから、ホーム画面に追加できます。",
  "ios-other": "このブラウザの共有ボタンから、ホーム画面に追加できます。",
  menu: "Chrome のメニュー（︙）から『アプリをインストール』か『ホーム画面に追加』を選んでください。",
};

// 節の下の小さな注（端末で分ける。§15.3）
const NOTE = {
  android: "Android では、ホーム画面のアプリと Chrome で、診断の結果などはこの端末の中で共有されます。",
  ios: "iPhone では、ホーム画面のアプリと Safari で、診断の結果などの保存が別です。",
  "ios-other": "iPhone では、ホーム画面のアプリとブラウザ（Safari・Chrome など）で、診断の結果などの保存が別です。",
};

/** 共有ボタンの絵（iOS の共有の形：四角に上向きの矢印）。文の中に小さく置く */
const shareMark = () => h("span", { class: "a-pwa-share", role: "img", "aria-label": "（四角に上向きの矢印の絵）" }, icon("share-ios", { size: 18 }));

// 追加の手順（§15.2）。iOS 26 は「…」→「共有」のことがあり、追加の画面に「Webアプリとして開く」のスイッチ（既定でオン）がある
const STEP_ADD = "「ホーム画面に追加」を押す（見当たらないときは、下にずらすか「さらに表示」を押す）";
const STEP_DONE = "「Webアプリとして開く」はオンのまま、「追加」を押す（スイッチが出ないときは、そのまま「追加」）";
function iosSteps(state) {
  const first = state === "ios"
    ? ["画面の「…」か、共有ボタン", shareMark(), "を押す。「…」のときは、続けて「共有」を押す"]
    : ["共有ボタン", shareMark(), "を押す（Chrome はアドレスバーの右。見当たらないときは、メニューの「共有」）"];
  return [
    h("ol", { class: "a-pwa-steps", role: "list" },
      h("li", null, first),
      h("li", null, STEP_ADD),
      h("li", null, STEP_DONE)),
    h("p", { class: "a-pwa-sub" }, "ホーム画面のアイコン『恋コンパス』から開くと、アプリの形で開きます。"),
    state === "ios-other" ? h("p", { class: "a-note a-pwa-note" }, "iOS 16.4 より前の iPhone では、Safari で開いて追加してください。") : null,
  ];
}

function appSection() {
  const state = currentInstallState();
  const ios = currentPlatform() === "ios";
  const done = state === "installed" || state === "added";
  const steps = state === "ios" || state === "ios-other";
  // 引き継ぎ（§15.3）：iPhone で、ブラウザの側（ios・ios-other）とホーム画面のアプリの側（installed）
  const move = ios && (steps || state === "installed");
  return h("section", { "aria-labelledby": "a-me-app", "data-pwa-section": state },
    sectionHead("アプリとして使う", { id: "a-me-app", aside: done ? "追加済み" : null }),
    h("div", { class: "a-card a-pwa-card" },
      h("p", { class: "a-pwa-text", "data-pwa-text": "", tabindex: "-1" },
        done ? icon("check-circle", { size: 20, solid: true }) : null,
        h("span", null, APP_TEXT[state] || APP_TEXT.menu)),
      h("p", { class: "a-note a-pwa-privacy" }, APP_PRIVACY_LINE),   // 人目の守り（決定 U47）
      state === "prompt"
        ? h("button", { type: "button", class: "a-btn a-btn-block a-pwa-btn", onclick: addToHome }, "ホーム画面に追加する")
        : null,
      steps ? iosSteps(state) : null,
      h("p", { class: "a-note a-pwa-note" }, ios ? (state === "ios-other" ? NOTE["ios-other"] : NOTE.ios) : NOTE.android),
      stopBox(state)),
    move ? moveBox(state) : null);
}

// ---------------------------------------------------------------- ホーム画面で使うのをやめるには（§15.11。決定 U39）
//   持ち主の依頼「ホームで使うのを辞める方法も教えて」→ マイページにも載せる。どの状態でも出す（閉じておく）
//   ボタンの名前（「Appを削除」「ブックマークを削除」「アンインストール」「アプリ情報」など）は、実機では確かめていない。
//   出典と英語の表示からの推定で、OS の版・端末で変わる。持ち主に実機で見てもらう（§15.8 と同じ。docs/app-screens.md §15.11）
const STOP_TITLE = { ios: "iPhone（iOS）", android: "Android", other: "パソコン（Chrome・Edge）" };
function stopLines(dev, state) {
  if (dev === "ios") {
    // ios-other（Safari 以外のブラウザで見ている）のときは「Safari」を「ブラウザ」に
    const kept = state === "ios-other"
      ? "ブラウザで開いたときの記録は別に残るので、消したいときはブラウザで開いて「すべて消す」を押してください。"
      : "Safari で開いたときの記録は別に残るので、消したいときは Safari で開いて「すべて消す」を押してください。";
    return [
      "ホーム画面のアイコンを長押しして「Appを削除」（iOS の版によっては「ブックマークを削除」）→「削除」。",
      `アイコンを消すと、ホーム画面のアプリの中の記録も消えます。${kept}`,
      // 引き継ぎ（§15.3）は Safari → アプリの向きだけ。アプリの中の診断は Safari に移せないことを、アプリの側でだけ添える
      state === "installed" ? "アプリの中の診断は、Safari には移せません（移せるのは Safari からアプリへだけです）。" : null,
    ];
  }
  if (dev === "android") {
    return [
      "ホーム画面のアイコンを長押しして「アンインストール」（端末によっては「アプリ情報」→「アンインストール」）。",
      "アイコンを消しても、記録は Chrome の中に残ります。消したいときは、先に「すべて消す」を押してください。",
    ];
  }
  return ["アプリの窓の右上のメニュー（︙）→「アンインストール」。"];
}

function stopBox(state) {
  const here = currentDevice();
  const others = ["ios", "android", "other"].filter((d) => d !== here);
  const block = (dev, tag) => h("div", { class: "a-pwa-stop-dev", "data-device": dev },
    h(tag, { class: "a-pwa-stop-h" }, STOP_TITLE[dev]),
    h("ul", { class: "a-pwa-stop-list" }, stopLines(dev, dev === here ? state : null).filter(Boolean).map((t) => h("li", null, t))));
  return h("details", { class: "a-pwa-stop", "data-pwa-stop": "" },
    h("summary", null, h("span", null, "ホーム画面で使うのをやめるには"), icon("chevron-down", { size: 18 })),
    h("div", { class: "a-pwa-stop-body" },
      h("p", { class: "a-pwa-sub a-pwa-stop-first" }, "記録も消したいときは、先にこのページの「この端末の記録」→「すべて消す」を押してください。"),
      block(here, "h3"),
      h("h3", { class: "a-pwa-stop-other" }, "ほかの端末"),
      others.map((d) => block(d, "h4")),
      h("p", { class: "a-note a-pwa-stop-last" }, "やめても、ブラウザでいつでも開けます。")));
}

// ---------------------------------------------------------------- Safari とアプリのあいだで診断を移す（§15.3。app/js/transfer.js）
const MOVE_NOTE = "コードには診断の回答が入っています。人に送らないでください。相談の履歴は移りません。";
const READ_ERROR = "コードを読めませんでした。Safari でコピーし直して、もう一度貼り付けてください。";

function moveBox(state) {
  const app = state === "installed";
  const title = state === "ios-other" ? "ブラウザとアプリのあいだで診断を移す" : "Safari とアプリのあいだで診断を移す";
  const box = h("div", { class: "a-card a-pwa-move", "data-pwa-move": app ? "app" : "browser" },
    h("h3", { class: "a-pwa-move-h" }, title));
  if (app) appSide(box);
  else browserSide(box, state);
  return box;
}

/** ブラウザの側：［引き継ぎのコードをコピーする］。コードは先に作っておく（押してからすぐクリップボードに書けるように） */
function browserSide(box, state) {
  if (!hasTransferable()) {
    box.append(h("p", { class: "a-note a-pwa-note" }, "診断をすると、ここからアプリに移せます。"));
    return;
  }
  let code = null;
  const ready = makeTransferCode().then((c) => (code = c), () => null);
  const where = state === "ios-other" ? "このブラウザ" : "Safari ";
  const slot = h("div", { class: "a-pwa-manual-slot" });
  const copy = async (e) => {
    const btn = e.currentTarget;
    let c = code;
    if (!c) { btn.disabled = true; c = await ready; btn.disabled = false; }
    if (!c) { slot.replaceChildren(h("p", { class: "a-pwa-error", role: "alert" }, "コードを作れませんでした。マイページを開き直して、もう一度押してください。")); return; }
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(c); copied = true; }
    } catch { copied = false; }
    if (copied) { slot.replaceChildren(); toast("コピーしました。ホーム画面のアプリのマイページで貼り付けてください"); return; }
    showManual(slot, c);
  };
  box.append(
    h("p", { class: "a-pwa-sub" }, `${where}の診断は、ホーム画面のアプリには出ません。コードをコピーして、アプリのマイページで貼り付けると移せます。`),
    // 文が長いので絵は付けない（390px 幅で1行に収める）
    h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm a-btn-block a-pwa-btn", "data-pwa-copy": "", onclick: copy }, "引き継ぎのコードをコピーする"),
    slot,
    h("p", { class: "a-note a-pwa-note" }, MOVE_NOTE));
}

/** コピーできなかったとき：読むだけの欄にコードを出して選んだ状態にする */
function showManual(slot, code) {
  const id = "a-pwa-manual";
  const area = h("textarea", { id, class: "a-textarea a-pwa-code", readonly: "", rows: "4", spellcheck: "false", autocapitalize: "off", autocomplete: "off", "aria-describedby": `${id}-help` });
  area.value = code;
  slot.replaceChildren(
    h("label", { class: "a-pwa-label", for: id }, "引き継ぎのコード"),
    area,
    h("p", { class: "a-pwa-sub", id: `${id}-help` }, "コピーできませんでした。上の欄を長押しして『すべてを選択』→『コピー』を押してください。"));
  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, code.length);
  } catch { /* 選べなくても欄は出ている */ }
}

/** ホーム画面のアプリの側：［Safari の診断を引き継ぐ］→ 欄と［読み込む］ */
function appSide(box) {
  const form = h("div", { class: "a-pwa-form" });
  const open = () => {
    const id = "a-pwa-paste";
    const area = h("textarea", { id, class: "a-textarea a-pwa-code", rows: "4", spellcheck: "false", autocapitalize: "off", autocomplete: "off", autocorrect: "off" });
    const msg = h("div", { class: "a-pwa-msg" });
    area.addEventListener("input", () => msg.replaceChildren());   // 貼り直したら前の「読めませんでした」を消す
    const load = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const res = await readTransferCode(area.value);
      btn.disabled = false;
      if (!res.ok) { msg.replaceChildren(h("p", { class: "a-pwa-error", role: "alert" }, READ_ERROR)); return; }
      msg.replaceChildren();
      const state = diagnosisState();
      if ((res.data.session || res.data.four) && (state === "done" || state === "mid")
        && !window.confirm("この端末のアプリの診断を、貼り付けた診断に置き換えますか？")) return;
      const out = applyTransfer(res.data);
      if (!out.ok) { msg.replaceChildren(h("p", { class: "a-pwa-error", role: "alert" }, "この端末に入れられませんでした。もう一度押してください。")); return; }
      toast("診断を引き継ぎました");
      go(currentResult() ? "#result" : "#mypage");
    };
    form.replaceChildren(
      h("label", { class: "a-pwa-label", for: id }, "引き継ぎのコード"),
      area,
      msg,
      h("button", { type: "button", class: "a-btn a-btn-sm a-btn-block a-pwa-btn", "data-pwa-load": "", onclick: load }, "読み込む"));
    area.focus({ preventScroll: false });
  };
  box.append(
    h("p", { class: "a-pwa-sub" }, "Safari（または Chrome など）で診断したときは、そちらのマイページで「引き継ぎのコード」をコピーして、ここに貼り付けると移せます。"),
    form,
    h("p", { class: "a-note a-pwa-note" }, MOVE_NOTE));
  form.append(h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm a-btn-block a-pwa-btn", "data-pwa-open": "", onclick: open }, "Safari の診断を引き継ぐ"));
}

async function addToHome(e) {
  e.currentTarget.disabled = true;
  await promptInstall();   // 追加し終わったら pwa.js が知らせ、上の onChange が描き直してトーストを出す
}

function view() {
  const state = diagnosisState();
  const count = loadRecords().items.length;
  const hasData = count > 0 || !!store3.session || !!store4.session || historySnippetOn();
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
          // タイプ図鑑（§16）と絵の一覧（§14）。ほかの行にアイコンがあるとき（診断済み）だけアイコンを付ける
          rowLink({ href: "#types", ic: state === "done" ? "grid" : null, text: "診断結果の一覧（24タイプ）" }),
          rowLink({ href: "#images", ic: state === "done" ? "sparkle" : null, text: "診断結果の絵を見る" })))),

    appSection(),

    h("section", { "aria-labelledby": "a-me-data" },
      sectionHead("この端末の記録", { id: "a-me-data" }),
      h("div", { class: "a-card" },
        h("div", { class: "a-data-row" },
          h("p", null, `履歴 ${count}件`),
          h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm", disabled: !hasData, onclick: clearEverything }, "すべて消す")),
        h("p", { class: "a-note", style: { marginTop: "12px" } }, "どこにも送っていません。消すと元に戻せません。"),
        snippetToggle())),

    // お問い合わせ（§17。決定 U39）
    h("section", { "aria-labelledby": "a-me-contact" },
      sectionHead("お問い合わせ", { id: "a-me-contact" }),
      h("div", { class: "a-card a-rows-card" },
        h("div", { class: "a-rows" },
          rowLink({ href: "#contact", ic: "chat", text: "お問い合わせ・不具合の報告" })))),

    h("footer", { class: "a-foot" },
      h("p", { class: "a-note" }, "試作の画面です"),
      h("p", { class: "a-note" }, h("a", { class: "a-link a-link-tap", href: "../#three" }, "今の画面（診断・相談）を開く"))),
    helpFoot());
}

// ---------------------------------------------------------------- 履歴の一覧に、相談で書いた文の冒頭を出す（決定 U47。はじめはオフ）
function snippetToggle() {
  const input = h("input", {
    type: "checkbox", id: "a-me-snippet", "aria-describedby": "a-me-snippet-note",
    onchange: (e) => {
      const on = e.target.checked;
      if (!setHistorySnippet(on)) { e.target.checked = !on; toast("この端末では切り替えを保存できませんでした"); }
    },
  });
  input.checked = historySnippetOn();
  return h("div", { class: "a-me-snippet" },
    h("label", { class: "a-check", for: "a-me-snippet" },
      input,
      h("span", { class: "a-check-box", "aria-hidden": "true" }, icon("check")),
      h("span", null, HISTORY_SNIPPET_LABEL)),
    h("p", { class: "a-note", id: "a-me-snippet-note" }, HISTORY_SNIPPET_NOTE));
}

function clearEverything() {
  if (!window.confirm("この端末に残っている、診断の回答と結果・相談の履歴をすべて消しますか？（元に戻せません）")) return;
  clearAll();             // 履歴と結果の印と、履歴の冒頭の設定（U47。出さないに戻る）
  discard3();
  discard4();             // 24問版（v4。決定 U42）の診断も消す
  setActiveVersion(null);
  toast("この端末の記録を消しました");
  go("#mypage");
}
