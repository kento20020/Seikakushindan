// お問い合わせ（#contact。タブなし。題「お問い合わせ」）。仕様：docs/app-screens.md §17（決定 U39・U40）
//   持ち主の依頼「マイページにお問い合わせホーム（フォーム）を作る」（U39）・「メールアドレス。bokuhagbpt@gmail.com にして」（U40）
//   送り方は、画面を出すときに contact_form.js の contactMode() で決める
//     "form"：Google フォーム（CONTACT_FORM）が入っている → fetch の POST（no-cors）で送る（U39 のまま）
//     "mail"：フォームが無く、メールのアドレス（CONTACT_MAIL）がある → 利用者のメールのアプリを開いて送ってもらう（mailto。今はこれ）
//     "off" ：どちらも無い → 欄は出すが［送る］は押せず、「いまは送れません（送り先を準備しています）。」。何も送らない・開かない
//   上：「←」（前の画面。無ければ #mypage）・題（h1）
//   前置きの上：1行「いま危ないときは、お問い合わせではなく窓口へ。メールの返事には時間がかかります。」＋「危ないときは ›」（#help。決定 U47）
//   前置き：何を送れるか、と注3つ（送り方ごとに文を替える。NOTES）
//   欄：種類（4つのうち1つ。最初はどれも選ばない）・内容（字数を「123 / 1000」で出す）・
//     返事の連絡先（メールアドレス。任意。フォームのときと送れないときだけ。メールのときは出さない：利用者のアドレスが運営者に届くため）・
//     「端末の種類も一緒に送る」（最初はオン。送る文〔「iPhone・ホーム画面のアプリ」など〕をそのまま横に出す）
//   ［送る］（メールのときは［メールのアプリで送る］）：確かめて（contact_form.js の validate）、だめな欄の下に文を出し、最初の欄へ焦点を移す
//     フォーム：送っているあいだは押せない（「送っています…」）。送れたら「送りました。ありがとうございます。」と［マイページへ戻る］
//       送れなかったら（つながっていないなど）書いた物はそのまま、ボタンの上に「送れませんでした…」（role="alert"）
//     メール：buildMail の mailto: を開き（openMail）、欄の代わりに案内（mailPanel）。送ったかはこちらでは分からないので「送りました」とは言わない。
//       案内：メールの画面で「送信」を押すと届く／［もう一度メールのアプリを開く］／開かないとき：宛先と文（件名と本文）を出して
//       ［アドレスをコピー］［文をコピー］（クリップボードが使えなければ、文字を選んだ状態にして長押しでコピーしてもらう）／
//       ［入力に戻る］（書いた物はそのまま）／［書いた物を消してマイページへ戻る］
//   書きかけ：このモジュールの変数（draft）にだけ持つ。画面を離れて戻っても残るが、ページを閉じる・読み込み直すと消える。
//     localStorage・sessionStorage・IndexedDB には書かない（ほかの人に端末を見られたときのため）
//   見た目は app/css/app.css（a-ct-）
import { h, icon, topBar, goBack, go, toast, helpLink } from "./ui.js";
import { CONTACT_SAFETY_LINE } from "./safety.js";
import { CONTACT_FORM, CONTACT_MAIL, CONTACT_KINDS, BODY_MAX, contactMode, countChars, validate, deviceLabel, buildBody, buildMail } from "./contact_form.js";
import { currentDevice, currentStandalone } from "./pwa.js";

const SEND = "送る";
const SEND_MAIL = "メールのアプリで送る";
const SENDING = "送っています…";
const SEND_ERROR = "送れませんでした。電波のよい所で、もう一度「送る」を押してください。";
const OFF_NOTE = "いまは送れません（送り先を準備しています）。";
const ORDER = ["kind", "body", "reply"];   // だめな欄が複数あるとき、焦点を移す順（メールのときは返事の連絡先の欄が無い）
const TIMEOUT_MS = 30000;                  // これより長く返らなければ「送れませんでした」にする（ボタンが押せないままにならないように）
// 前置きの注（送り方ごと）
const NOTES = {
  form: [
    "送った内容は、運営者の Google フォームに届きます。",
    "相談の中身や、相手の名前・連絡先は書かないでください。",
    "試作のため、返事はお約束できません。",
  ],
  mail: [
    `送った内容は、運営者のメール（${CONTACT_MAIL}）に届きます。`,
    "メールで送るので、あなたのメールアドレスも運営者に届きます。返事は、そのアドレスにお送りすることがあります（試作のため、お約束はできません）。",
    "相談の中身や、相手の名前・連絡先は書かないでください。",
  ],
};
NOTES.off = NOTES.form;   // 送れないときは U39 のまま

const blank = () => ({ kind: "", body: "", reply: "", withDevice: true });
let draft = blank();     // 書きかけ（画面を離れて戻っても残す。ページを閉じると消える）
let inflight = false;    // 送っている途中（画面を離れて戻っても、2回送らないため）
let listener = null;     // 今出ている画面の「送り終わった」の受け取り。画面を離れたら null

/** 送り終わった（"ok" | "error"）。画面が出ていればそちらへ、離れていればトーストで知らせる */
function settle(result) {
  inflight = false;
  if (result === "ok") draft = blank();
  if (listener) { listener(result); return; }
  toast(result === "ok" ? "お問い合わせを送りました" : "お問い合わせを送れませんでした。もう一度「送る」を押してください");
}

export function render(root) {
  const mode = contactMode();
  const device = deviceLabel({ platform: currentDevice(), standalone: currentStandalone() });
  const wrap = h("div", { class: "a-ct", "data-ct-mode": mode },
    topBar({ title: "お問い合わせ", heading: true, back: () => goBack("#mypage"), help: true }),
    h("p", { class: "a-ct-safety" }, CONTACT_SAFETY_LINE, helpLink()),   // 決定 U47
    h("div", { class: "a-ct-intro" },
      h("p", { class: "a-lead" }, "使い方がわからないこと・うまく動かないこと・ご意見を送れます。"),
      h("ul", { class: "a-ct-notes" }, NOTES[mode].map((t) => h("li", { class: "a-note" }, t)))));
  const slot = h("div", { class: "a-ct-slot" });
  wrap.append(slot);
  root.append(wrap);

  let ui = null;
  const showForm = () => { ui = form(slot, { mode, device, onMail: (mail) => mailPanel(slot, mail, { back: backToForm }) }); };
  const backToForm = () => { showForm(); ui.focusStart(); };
  showForm();
  const mine = (result) => (result === "ok" ? done(slot) : ui.failed());
  listener = mine;
  return () => { if (listener === mine) listener = null; };
}

/** mailto: を開く。一時的な <a href> を押す形にする（iPhone のホーム画面のアプリでも開け、テストでも受け取れる） */
function openMail(href) {
  const a = h("a", { href, hidden: true });
  document.body.append(a);
  try { a.click(); } finally { a.remove(); }
}

// ---------------------------------------------------------------- 欄
function form(slot, { mode, device, onMail }) {
  const ready = mode !== "off";
  const byMail = mode === "mail";
  const errs = {};   // 欄ごとの「だめ」の文の要素
  const errEl = (key) => (errs[key] = h("p", { class: "a-ct-error", id: `a-ct-${key}-err`, hidden: true }));

  // 種類（ラジオを丸いチップの形で。最初はどれも選ばない）
  const radios = CONTACT_KINDS.map((k, i) => h("input", {
    type: "radio", name: "a-ct-kind", id: `a-ct-kind-${i}`, value: k,
    onchange: (e) => { draft.kind = e.target.value; setError("kind", null); },
  }));
  for (const r of radios) r.checked = r.value === draft.kind;
  const kindSet = h("fieldset", { class: "a-ct-field a-ct-kinds" },
    h("legend", { class: "a-ct-label" }, "種類"),
    h("div", { class: "a-ct-chips" }, radios.map((r) => h("label", { class: "a-ct-chip", for: r.id },
      r,
      h("span", { class: "a-ct-chip-face" }, icon("check", { size: 16 }), h("span", null, r.value))))),
    errEl("kind"));

  // 内容（字数は前後の空白を除いて数える。上限は属性ではなく送る前に確かめる：貼り付けた文が黙って切れないように）
  const count = h("p", { class: "a-count a-ct-count", id: "a-ct-body-count" });
  const body = h("textarea", { id: "a-ct-body", class: "a-textarea a-ct-body", rows: "7", "aria-describedby": "a-ct-body-count" });
  body.value = draft.body;
  const syncCount = () => {
    const n = countChars(body.value);
    count.textContent = `${n} / ${BODY_MAX}`;
    count.classList.toggle("is-over", n > BODY_MAX);
  };
  body.addEventListener("input", () => { draft.body = body.value; syncCount(); if (errs.body.textContent) setError("body", null); });
  syncCount();
  const bodyField = h("div", { class: "a-ct-field" },
    h("label", { class: "a-ct-label", for: "a-ct-body" }, "内容"),
    body, count, errEl("body"));

  // 返事の連絡先（任意）。メールで送るときは出さない（利用者のアドレスが、そのまま運営者に届くため）
  let reply = null, replyField = null;
  if (!byMail) {
    reply = h("input", {
      type: "email", id: "a-ct-reply", class: "a-input a-ct-reply", autocomplete: "email", inputmode: "email",
      autocapitalize: "off", spellcheck: "false",
    });
    reply.value = draft.reply;
    reply.addEventListener("input", () => { draft.reply = reply.value; if (errs.reply.textContent) setError("reply", null); });
    replyField = h("div", { class: "a-ct-field" },
      h("label", { class: "a-ct-label", for: "a-ct-reply" }, "返事がほしいとき：メールアドレス（任意）"),
      reply, errEl("reply"));
  }

  // 端末の種類（最初はオン。送る文をそのまま見せる）
  const withDevice = h("input", { type: "checkbox", id: "a-ct-device", onchange: (e) => { draft.withDevice = e.target.checked; } });
  withDevice.checked = draft.withDevice;
  const deviceRow = h("label", { class: "a-check a-ct-device", for: "a-ct-device" },
    withDevice,
    h("span", { class: "a-check-box", "aria-hidden": "true" }, icon("check")),
    h("span", null, "端末の種類も一緒に送る（不具合を直すため）", h("span", { class: "a-ct-device-val", "data-device": device }, `（${device}）`)));

  // ［送る］（メールのときは［メールのアプリで送る］）と、その上の知らせ（準備中・送れなかった）
  const msg = h("div", { class: "a-ct-msg" });
  const label = byMail ? SEND_MAIL : SEND;
  const btn = h("button", { type: "submit", class: "a-btn a-btn-block a-ct-send", disabled: !ready || inflight, "aria-describedby": ready ? null : "a-ct-off" },
    inflight ? SENDING : label);
  const off = ready ? null : h("p", { class: "a-note a-ct-off", id: "a-ct-off" }, OFF_NOTE);

  const el = h("form", { class: "a-card a-ct-form", novalidate: true, "aria-label": "お問い合わせ", onsubmit: submit },
    kindSet, bodyField, replyField, deviceRow, off, msg, btn);
  slot.replaceChildren(el);

  const fieldsOf = { kind: radios, body: [body], reply: reply ? [reply] : [] };
  const order = ORDER.filter((k) => fieldsOf[k].length);
  function setError(key, text) {
    const p = errs[key];
    if (!p) return;
    p.textContent = text || "";
    p.hidden = !text;
    for (const f of fieldsOf[key]) {
      const ids = (f.getAttribute("aria-describedby") || "").split(" ").filter((x) => x && x !== p.id);
      if (text) ids.push(p.id);
      if (ids.length) f.setAttribute("aria-describedby", ids.join(" ")); else f.removeAttribute("aria-describedby");
      if (text) f.setAttribute("aria-invalid", "true"); else f.removeAttribute("aria-invalid");
    }
    if (key === "kind") kindSet.classList.toggle("is-invalid", !!text);
  }

  function setBusy(busy) {
    btn.disabled = busy || !ready;
    btn.textContent = busy ? SENDING : label;
  }

  async function submit(e) {
    e.preventDefault();
    if (!ready || inflight) return;   // 送り先が無い・送っている途中なら何もしない（Enter で送ろうとしたときも）
    msg.replaceChildren();
    // 欄の今の中身を読み直す（ブラウザの自動入力で input が来なかったときのため）
    draft.kind = radios.find((r) => r.checked)?.value || "";
    draft.body = body.value;
    if (reply) draft.reply = reply.value;
    draft.withDevice = withDevice.checked;
    syncCount();
    // メールのときは返事の連絡先を渡さない（欄が無い。確かめもしない）
    const bad = validate(byMail ? { kind: draft.kind, body: draft.body } : draft);
    for (const key of order) setError(key, bad[key] || null);
    const first = order.find((k) => bad[k]);
    if (first) { fieldsOf[first][0].focus(); return; }

    if (byMail) {
      // 書きかけは消さない（送ったかはこちらでは分からない。［入力に戻る］で直せるように）
      const mail = buildMail({ kind: draft.kind, body: draft.body, device: draft.withDevice ? device : "" });
      openMail(mail.href);
      onMail(mail);
      return;
    }

    inflight = true;
    setBusy(true);
    const payload = buildBody({ ...draft, device: draft.withDevice ? device : "" });
    const stop = typeof AbortController === "function" ? new AbortController() : null;
    const timer = stop ? setTimeout(() => stop.abort(), TIMEOUT_MS) : 0;
    try {
      // mode "no-cors"：Google フォームは、ほかのサイトから読める返事（CORS）を返さない。読めない返事（opaque）が来るだけで、
      //   Google が保存したかどうかは分からない。「送りました」は、送る要求がこの端末から出ていった（ネットにつながっていた）という意味だけ。
      //   届いたかは持ち主がフォームの「回答」で見る。つながっていない・途中で切れた・30秒たっても返らないときは失敗にする（下の catch）
      await fetch(CONTACT_FORM.action, { method: "POST", mode: "no-cors", body: payload, signal: stop?.signal });
    } catch {
      clearTimeout(timer);
      settle("error");
      return;
    }
    clearTimeout(timer);
    settle("ok");
  }

  return {
    failed() {
      setBusy(false);
      msg.replaceChildren(h("p", { class: "a-ct-error a-ct-send-error", role: "alert" }, SEND_ERROR));
    },
    /** 案内から［入力に戻る］で戻ったとき：選んだ種類（無ければ最初のチップ）へ焦点を移す（キーボードが出ないように、文の欄にはしない） */
    focusStart() {
      (radios.find((r) => r.checked) || radios[0]).focus();
    },
  };
}

// ---------------------------------------------------------------- メールのアプリを開いたあと（mode "mail"）
/**
 * 欄の代わりに出す案内。メールのアプリが開いたか・送ったかは、こちらでは分からないので「送りました」とは言わない
 *   mail … buildMail の { href, subject, text }
 *   back … ［入力に戻る］（書いた物はそのまま）
 */
function mailPanel(slot, mail, { back }) {
  const head = h("h2", { class: "a-ct-mail-h", tabindex: "-1" }, icon("mail", { size: 22 }), h("span", null, "メールのアプリが開きます。"));
  const copyText = `件名：${mail.subject}\n\n${mail.text.replace(/\r\n/g, "\n")}`;

  // 宛先
  const addr = h("p", { class: "a-ct-mail-addr", id: "a-ct-mail-addr" }, CONTACT_MAIL);
  const addrMsg = h("div", { class: "a-ct-mail-msg" });
  // 件名と本文（読むだけの欄）
  const area = h("textarea", {
    id: "a-ct-mail-text", class: "a-textarea a-ct-mail-text", readonly: true, rows: "8",
    spellcheck: "false", autocapitalize: "off", autocomplete: "off",
  });
  area.value = copyText;
  const textMsg = h("div", { class: "a-ct-mail-msg" });

  const clear = () => { draft = blank(); go("#mypage"); };

  slot.replaceChildren(h("div", { class: "a-card a-ct-mail", "data-ct-mail": "" },
    // ここだけを読み上げの場所にする（下のコピーの知らせで、案内の全部が読み直されないように）
    h("div", { class: "a-ct-mail-status", role: "status" },
      head,
      h("p", { class: "a-ct-mail-lead" }, "メールの画面で「送信」を押すと届きます。")),
    h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm a-btn-block a-ct-mail-again", "data-ct-again": "", onclick: () => openMail(mail.href) }, "もう一度メールのアプリを開く"),
    h("div", { class: "a-ct-mail-fallback" },
      h("h3", { class: "a-ct-mail-sub" }, "メールのアプリが開かないとき"),
      h("p", { class: "a-note a-ct-mail-how" }, "お使いのメールで、次のアドレスに下の文を送ってください。"),
      h("p", { class: "a-ct-label a-ct-mail-label" }, "送り先"),
      addr,
      h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm a-btn-block a-ct-mail-copy", "data-ct-copy": "addr",
        onclick: () => copy(CONTACT_MAIL, { done: "アドレスをコピーしました", slot: addrMsg, select: () => selectNode(addr) }) },
        icon("copy", { size: 20 }), h("span", null, "アドレスをコピー")),
      addrMsg,
      h("label", { class: "a-ct-label a-ct-mail-label", for: "a-ct-mail-text" }, "件名と本文"),
      area,
      h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm a-btn-block a-ct-mail-copy", "data-ct-copy": "text",
        onclick: () => copy(copyText, { done: "文をコピーしました", slot: textMsg, select: () => selectArea(area) }) },
        icon("copy", { size: 20 }), h("span", null, "文をコピー")),
      textMsg),
    h("div", { class: "a-ct-mail-foot" },
      h("button", { type: "button", class: "a-btn a-btn-outline a-btn-block a-ct-mail-back", "data-ct-back": "", onclick: back }, "入力に戻る"),
      h("p", { class: "a-ct-mail-clear-row" },
        h("button", { type: "button", class: "a-link a-link-tap a-ct-mail-clear", "data-ct-clear": "", onclick: clear }, "書いた物を消してマイページへ戻る")))));
  head.focus();
}

/**
 * クリップボードへ写す。写せたらトースト。写せなければ、文字を選んだ状態にして長押しでコピーしてもらう
 * （マイページの引き継ぎのコードと同じ考え方。app/js/mypage.js の showManual）
 */
async function copy(value, { done, slot, select }) {
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); copied = true; }
  } catch { copied = false; }
  if (copied) { slot.replaceChildren(); toast(done); return; }
  select();
  slot.replaceChildren(h("p", { class: "a-note a-ct-mail-manual" }, "コピーできませんでした。選んだ文字を長押し（パソコンは右クリック）して「コピー」を押してください。"));
}

function selectNode(el) {
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* 選べなくても文字は出ている */ }
}

function selectArea(area) {
  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, area.value.length);
  } catch { /* 選べなくても文字は出ている */ }
}

// ---------------------------------------------------------------- 送れたあと
function done(slot) {
  const head = h("h2", { class: "a-ct-done-h", tabindex: "-1" }, icon("check-circle", { size: 22, solid: true }), h("span", null, "送りました。ありがとうございます。"));
  slot.replaceChildren(h("div", { class: "a-card a-ct-done", "data-ct-done": "" },
    head,
    h("p", { class: "a-note a-ct-done-note" }, "返事がほしいとメールアドレスを書いた方には、メールでお返事することがあります。"),
    h("a", { class: "a-btn a-btn-block a-ct-back", href: "#mypage" }, "マイページへ戻る")));
  head.focus({ preventScroll: true });
}
