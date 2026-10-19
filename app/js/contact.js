// お問い合わせ（#contact。タブなし。題「お問い合わせ」）。仕様：docs/app-screens.md §17（決定 U39）
//   持ち主の依頼「マイページにお問い合わせホーム（フォーム）を作る」。送り先は Google フォーム（app/js/contact_form.js の CONTACT_FORM）
//   上：「←」（前の画面。無ければ #mypage）・題（h1）
//   前置き：何を送れるか、と注3つ（送り先は運営者の Google フォーム／相談の中身や相手の名前・連絡先は書かない／返事は約束できない）
//   欄：種類（4つのうち1つ。最初はどれも選ばない）・内容（字数を「123 / 1000」で出す）・返事の連絡先（メールアドレス。任意）・
//     「端末の種類も一緒に送る」（最初はオン。送る文〔「iPhone・ホーム画面のアプリ」など〕をそのまま横に出す）
//   ［送る］：確かめて（contact_form.js の validate）、だめな欄の下に文を出し、最初の欄へ焦点を移す
//     送っているあいだは押せない（「送っています…」）。送れたら「送りました。ありがとうございます。」と［マイページへ戻る］
//     送れなかったら（つながっていないなど）書いた物はそのまま、ボタンの上に「送れませんでした…」（role="alert"）
//   送り先が入っていないとき（isConfigured() が false）：欄は出すが［送る］は押せず、「いまは送れません（送り先を準備しています）。」。何も送らない
//   書きかけ：このモジュールの変数（draft）にだけ持つ。画面を離れて戻っても残るが、ページを閉じる・読み込み直すと消える。
//     localStorage・sessionStorage・IndexedDB には書かない（ほかの人に端末を見られたときのため）
//   見た目は app/css/app.css（a-ct-）
import { h, icon, topBar, goBack, toast } from "./ui.js";
import { CONTACT_FORM, CONTACT_KINDS, BODY_MAX, isConfigured, countChars, validate, deviceLabel, buildBody } from "./contact_form.js";
import { currentDevice, currentStandalone } from "./pwa.js";

const SEND = "送る";
const SENDING = "送っています…";
const SEND_ERROR = "送れませんでした。電波のよい所で、もう一度「送る」を押してください。";
const OFF_NOTE = "いまは送れません（送り先を準備しています）。";
const ORDER = ["kind", "body", "reply"];   // だめな欄が複数あるとき、焦点を移す順
const TIMEOUT_MS = 30000;                  // これより長く返らなければ「送れませんでした」にする（ボタンが押せないままにならないように）

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
  const ready = isConfigured();
  const device = deviceLabel({ platform: currentDevice(), standalone: currentStandalone() });
  const wrap = h("div", { class: "a-ct" },
    topBar({ title: "お問い合わせ", heading: true, back: () => goBack("#mypage") }),
    h("div", { class: "a-ct-intro" },
      h("p", { class: "a-lead" }, "使い方がわからないこと・うまく動かないこと・ご意見を送れます。"),
      h("ul", { class: "a-ct-notes" },
        h("li", { class: "a-note" }, "送った内容は、運営者の Google フォームに届きます。"),
        h("li", { class: "a-note" }, "相談の中身や、相手の名前・連絡先は書かないでください。"),
        h("li", { class: "a-note" }, "試作のため、返事はお約束できません。"))));
  const slot = h("div", { class: "a-ct-slot" });
  wrap.append(slot);
  root.append(wrap);

  const ui = form(slot, { ready, device });
  const mine = (result) => (result === "ok" ? done(slot) : ui.failed());
  listener = mine;
  return () => { if (listener === mine) listener = null; };
}

// ---------------------------------------------------------------- 欄
function form(slot, { ready, device }) {
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

  // 返事の連絡先（任意）
  const reply = h("input", {
    type: "email", id: "a-ct-reply", class: "a-input a-ct-reply", autocomplete: "email", inputmode: "email",
    autocapitalize: "off", spellcheck: "false",
  });
  reply.value = draft.reply;
  reply.addEventListener("input", () => { draft.reply = reply.value; if (errs.reply.textContent) setError("reply", null); });
  const replyField = h("div", { class: "a-ct-field" },
    h("label", { class: "a-ct-label", for: "a-ct-reply" }, "返事がほしいとき：メールアドレス（任意）"),
    reply, errEl("reply"));

  // 端末の種類（最初はオン。送る文をそのまま見せる）
  const withDevice = h("input", { type: "checkbox", id: "a-ct-device", onchange: (e) => { draft.withDevice = e.target.checked; } });
  withDevice.checked = draft.withDevice;
  const deviceRow = h("label", { class: "a-check a-ct-device", for: "a-ct-device" },
    withDevice,
    h("span", { class: "a-check-box", "aria-hidden": "true" }, icon("check")),
    h("span", null, "端末の種類も一緒に送る（不具合を直すため）", h("span", { class: "a-ct-device-val", "data-device": device }, `（${device}）`)));

  // ［送る］と、その上の知らせ（準備中・送れなかった）
  const msg = h("div", { class: "a-ct-msg" });
  const btn = h("button", { type: "submit", class: "a-btn a-btn-block a-ct-send", disabled: !ready || inflight, "aria-describedby": ready ? null : "a-ct-off" },
    inflight ? SENDING : SEND);
  const off = ready ? null : h("p", { class: "a-note a-ct-off", id: "a-ct-off" }, OFF_NOTE);

  const el = h("form", { class: "a-card a-ct-form", novalidate: true, "aria-label": "お問い合わせ", onsubmit: submit },
    kindSet, bodyField, replyField, deviceRow, off, msg, btn);
  slot.replaceChildren(el);

  const fieldsOf = { kind: radios, body: [body], reply: [reply] };
  function setError(key, text) {
    const p = errs[key];
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
    btn.textContent = busy ? SENDING : SEND;
  }

  async function submit(e) {
    e.preventDefault();
    if (!ready || inflight) return;   // 送り先が無い・送っている途中なら何もしない（Enter で送ろうとしたときも）
    msg.replaceChildren();
    // 欄の今の中身を読み直す（ブラウザの自動入力で input が来なかったときのため）
    draft.kind = radios.find((r) => r.checked)?.value || "";
    draft.body = body.value;
    draft.reply = reply.value;
    draft.withDevice = withDevice.checked;
    syncCount();
    const bad = validate(draft);
    for (const key of ORDER) setError(key, bad[key] || null);
    const first = ORDER.find((k) => bad[k]);
    if (first) { fieldsOf[first][0].focus(); return; }

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
  };
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
