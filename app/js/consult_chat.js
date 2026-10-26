// 相談（#consult）のチャットの形（既定。決定 U51）。今までの形は app/js/consult.js（?cv=card。切り替えは app/js/consult_version.js）
//   やりとりを1本の列にし（自分＝右・アプリ＝左の吹き出し。カードはいちばん新しい1枚だけ動く）、下に固定の入力の欄。
//   返事は今の規則と決まった文だけ（AI なし）：読み取り readText → （兆しがあれば）安全の確認 → 受け止め（M.acceptText）→ （じっくりなら1回だけ聞く）
//   → 足りない問（nextQuestion。多くて3つ：決定 U14）→ 次の一手カード（M.buildPoc）→ 往復（app/js/consult_followup.js。10往復まで）。
//   流れと文と数え方は今の consult.js と同じ。違うのは見た目（ボタンは下の列、欄は下の書く欄）と、U51 で足した4つ：
//     (a) 上に「いまの一手」の帯（今の「いまの状況」もここに）  (b) 返し方（おまかせ・短く・じっくり）
//     (c) 送る一文を自分で直す欄（送る前チェックがその場で出る）  (d) 終わったあとに、診断の案内（診断していない人に1回だけ）
//   診断の結果（app/js/diagnosis_version.js の currentStatus。三択か24問）が終わっていれば、本人の8領域の向きとして判定に渡す（切り替えつき）。
//   端末の外には何も送らない。書きかけの文・返し方・タイマーだけ localStorage に残す（使えなくても動く）。カードが出たら履歴に1件（app/js/local.js）。
//   記録の形は consult.js と同じ（data.v 2）＋ data.chat（カードより前のやりとり・返し方・診断を使うか）。履歴の詳細は今の savedView のまま出る。
//   安全の確認の吹き出しと安全のカードは残さない（今の決まり）
//
// 上の「←」は前の画面へ（相談は、カードが出ていれば履歴に残っていて続きから開ける）。上の「危ないときは」は安全のカードを出し、「←」か端末の「戻る」でやりとりに戻る
import { h, icon, topBar, goBack, fmtDate } from "./ui.js";
import { addRecord, removeRecord, getRecord, loadRecords } from "./local.js";
import { readText } from "../../js/consult/extract.js";
import { nextQuestion, applyAnswer } from "../../js/consult/needed.js";
import { applyPatch } from "../../js/consult/context.js";
import { isLateNight } from "../../js/consult/timefmt.js";
import { checkDraft, LEVELS } from "../../js/consult/draft_check.js";
import { CONSULT_EXAMPLES } from "./consult_examples.js";
import * as M from "../../poc/card/model.js";
import * as F from "./consult_followup.js";
import { liveCard, safetyCardView, safetyLine, snapshotOf, savedView, bubbleView, pastCardView, copyText } from "./consult_card.js";
import { currentStatus } from "./diagnosis_version.js";
import * as L from "./consult_chat_logic.js";

const T = L.CHAT_TEXTS;
const MAX_CHARS = L.MAX_CHARS;
const DRAFT_KEY = "seikaku16:app:consult-draft";       // 今の consult.js と同じ（最初の相談の文の書きかけ）
const ACTIVE_KEY = "seikaku16:app:consult-active";     // 今の consult.js と同じ（読み込み直したときに続きから）
const TITLE_CHARS = 32;
/** 書き方の例（今の consult.js の GUIDE_ROWS と同じ） */
const GUIDE_ROWS = [
  ["いつ・どこで", "（例：|昨日の夜|23時ごろ、|LINEで）"],
  ["何があったか", "（例：|私が|「いつも直前に決めるよね」と|送ったら、|「じゃあもういいよ」と|返ってきた）"],
  ["今どうなって|いるか", "（例：|既読のまま|2時間、|返事がない）"],
  ["今の気持ち", "（例：|不安、|腹が立つ、|悲しい）"],
  ["どうしたいか", "（例：|今夜のうちに|仲直りしたい、|謝りたい、|少し落ち着きたい）"],
];
// 安全の確認（今の consult.js の viewSafetyCheck と同じ文）
const SAFETY_Q = "いま、身の危険や強い怖さを感じていますか？";
const SAFETY_SUB = {
  reply: "貼ってくれた返事の中に、気になる言葉がありました。答えに合わせて、このあとを変えます。",
  text: "書いてくれた文の中に、気になる言葉がありました。答えに合わせて、このあとを変えます。",
};
const SAFETY_OPTS = [["stop", "今、危ない"], ["ok", "大丈夫、続ける"], ["other", "昔の話・人の話"]];
// 書く欄のプレースホルダー・名前（今の consult.js の文）
const PH_CONSULT = "ここに自由に入力してください…";
const WAIT_SENT = "上の「どうなった？」から選んでください。";
const WAIT_Q = "上の問いに答えると、一手を考え直します。";
const NAME = { consult: "相談内容", reply: "相手の返事を貼る", talk: "もう少し話したい" };

const draftStore = {
  get() { try { return localStorage.getItem(DRAFT_KEY) ?? ""; } catch { return ""; } },
  set(v) { try { if (v) localStorage.setItem(DRAFT_KEY, v); else localStorage.removeItem(DRAFT_KEY); } catch { /* 使えない */ } },
};
const activeStore = {
  get() { try { return sessionStorage.getItem(ACTIVE_KEY); } catch { return null; } },
  set(v) { try { if (v) sessionStorage.setItem(ACTIVE_KEY, v); else sessionStorage.removeItem(ACTIVE_KEY); } catch { /* 使えない */ } },
};
/** 返し方（次の相談にも残す） */
const styleStore = {
  get() { try { const v = localStorage.getItem(L.STYLE_KEY); return L.isStyle(v) ? v : L.DEFAULT_STYLE; } catch { return L.DEFAULT_STYLE; } },
  set(v) { try { localStorage.setItem(L.STYLE_KEY, v); } catch { /* 使えない */ } },
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const media = (q) => { try { return window.matchMedia(q).matches; } catch { return false; } };
const reduceMotion = () => media("(prefers-reduced-motion: reduce)");
/** 指で触る端末（書く欄に焦点を移すと、キーボードが出て足した物を隠すので、そのときは足した吹き出しへ） */
const coarse = () => media("(pointer: coarse)");
const clip = (raw) => String(raw || "").trim().slice(0, MAX_CHARS);

/** 履歴の題：書いた文の冒頭（今の consult.js と同じ） */
export function titleOf(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(t);
  return chars.length > TITLE_CHARS ? `${chars.slice(0, TITLE_CHARS).join("")}…` : t;
}

/** 履歴の詳細で出す「そのときのカード」とやりとり（今の consult.js と同じ savedView。カードより前のやりとりは出さない） */
export function renderSaved(record) {
  try { return savedView(record); } catch (err) { console.error(err); return null; }
}

function latestResumable() {
  try {
    const rec = loadRecords().items.find(x => x.kind === "consult");
    return F.resumable(rec) ? rec : null;
  } catch { return null; }
}

/** 今の診断の結果 → 判定に渡す本人の8領域（無ければ null） */
function diagnosisSelf() {
  try { return L.selfFromStatus(currentStatus()); } catch { return null; }
}
/** 今の診断が終わっているか（向きが無くても終わっていれば true） */
function diagnosisDone() {
  try { return currentStatus()?.state === "done"; } catch { return false; }
}
function diagnosisStatus() {
  try { return currentStatus(); } catch { return null; }
}

export function render(root) {
  const fresh0 = () => ({
    view: "chat",          // "chat" | "safetycard"（上の「危ないときは」）
    text: "",              // 相談の文（あとから書いた文は改行でつなぐ）
    read: null,            // readText の結果（相談の文）
    auto: "normal",        // おまかせのときの返し方（相談の文から）
    lateNight: false,
    edits: {}, editing: null, fixOpen: false,
    answers: [],           // 足りない問の答え [{ q, patch, label }]
    extra: {},
    safetyContinue: false,
    pre: [],               // カードより前のやりとり [{ id, who: "me"|"app"|"safety", text, at, label?, sf? }]（sf：安全の確認。記録に残さない）
    prePend: null,         // カードより前に待っているもの { type: "safety"|"safetyCard"|"deep"|"ask", n, q? }
    acceptN: -1,           // いちばん新しい受け止めの吹き出しの番号（「読み取ったことを直す」を付ける）
    deepDone: false,       // じっくりの「もう少し聞かせて」を出したか（1回の相談で1回）
    model: null, cardInput: null, accept: "", fresh: false, now: null,
    record: { id: null, at: null, text: null },
    fu: null, resumed: false,
    mode: "talk",          // カードのあとの書く欄の行き先 "talk" | "reply"
    modePicked: false,     // 「どうなった？」の［返事が来た］［もう少し話したい］で書く欄を開いたか
    composer: null,        // "end"（「どうなった？」を出している）
    pendingInput: null,    // 安全の確認を待っている入力（続き）{ type, text, read, kind? }
    safetyFrom: null,
    fuSafetyCard: false,   // 続きの安全の確認で「今、危ない」を選んだ
    offer: null,
    statusOpen: false,
    panel: null,           // 下の欄の上に開いている欄 "settings" | "draft"
    draftEdit: null,
    shortOpen: false,      // 短いカードの［くわしく見る］を開いたか
    guideOpen: false,
    invite: false,         // 終えたあとの診断の案内（d）
    scrollY: 0,
  });
  const S = { ...fresh0(), style: styleStore.get(), self: diagnosisSelf(), dxDone: diagnosisDone(), useDx: false, seen: new Set() };
  S.useDx = !!S.self;
  const timers = new Set();
  let tick = null, seq = 0;
  const nid = () => ++seq;

  // ---------------------------------------------------------------- 骨組み（上の題・帯・やりとり・下に固定の入力の欄）
  const topSlot = h("div", { class: "a-ch-top" });
  const bandSlot = h("div", { class: "a-ch-band-slot" });
  const mainSlot = h("div", { class: "a-ch-body" });
  const announcer = h("p", { class: "a-sr", "aria-live": "polite" });
  const panelSlot = h("div", { class: "a-ch-slot" });
  const modeSlot = h("div", { class: "a-ch-slot" });
  const actsSlot = h("div", { class: "a-ch-slot" });
  const footSlot = h("div", { class: "a-ch-slot" });
  const ta = h("textarea", { id: "a-ch-input", class: "a-textarea a-ch-input", rows: "1", maxlength: String(MAX_CHARS), enterkeyhint: "enter" });
  const sendBtn = h("button", { type: "button", class: "a-ch-send", "aria-label": T.send, disabled: true }, icon("arrow-right"));
  const composeRow = h("div", { class: "a-ch-compose" }, ta, sendBtn);
  const dockIn = h("div", { class: "a-ch-dock-in" }, panelSlot, modeSlot, actsSlot, composeRow, footSlot);
  const dock = h("div", { class: "a-ch-dock" }, dockIn);
  const wrap = h("div", { class: "a-cs a-ch" }, topSlot, bandSlot, mainSlot, announcer, dock);
  root.replaceChildren(wrap);

  ta.value = draftStore.get().slice(0, MAX_CHARS);
  ta.addEventListener("input", () => { fit(); syncSend(); if (!S.text) draftStore.set(ta.value); });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener("click", send);

  // 下の欄・上の帯の高さを CSS の変数に（やりとりの下の余白・動かしたときに帯で隠れない余白）
  function sizeVars() {
    wrap.style.setProperty("--a-ch-dock-h", `${Math.ceil(dock.hidden ? 0 : dock.getBoundingClientRect().height)}px`);
    const b = bandSlot.firstElementChild;
    wrap.style.setProperty("--a-ch-band-h", `${b ? Math.ceil(b.getBoundingClientRect().height) : 0}px`);
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(sizeVars) : null;
  ro?.observe(dock);
  ro?.observe(bandSlot);

  /** 書く欄の高さ（1行から6行くらいまで。上限は CSS の max-height） */
  function fit() {
    ta.style.height = "auto";
    if (ta.scrollHeight) ta.style.height = `${ta.scrollHeight + 2}px`;
  }
  function setInput(v) { ta.value = v; fit(); syncSend(); }
  function syncSend() { sendBtn.disabled = !ta.value.trim() || ta.disabled; }

  // ---------------------------------------------------------------- 端末の「戻る」（安全のカードを出している間だけ、同じ URL の印を1つ積む）
  let guarded = false, ignorePop = false, leaving = false;
  const startedOnGuard = !!history.state?.aChGuard;
  function pushGuard() {
    if (guarded) return;
    try { history.pushState({ ...(history.state && typeof history.state === "object" ? history.state : {}), aChGuard: true }, ""); guarded = true; } catch { /* 使えない */ }
  }
  function dropGuard() {
    if (!guarded) return;
    guarded = false;
    ignorePop = true;
    history.back();
  }
  function onPop() {
    if (!location.hash.startsWith("#consult")) return;
    if (leaving) { leaving = false; goBack("#home"); return; }
    if (ignorePop) { ignorePop = false; return; }
    if (!guarded) return;
    guarded = false;
    closeSafetyView(false);
  }
  window.addEventListener("popstate", onPop);
  function leave() {
    if (startedOnGuard && history.state?.aChGuard) { leaving = true; history.back(); return; }
    goBack("#home");
  }
  function back() {
    if (S.view === "safetycard") { closeSafetyView(); return; }
    leave();
  }
  function openSafetyView() {
    S.scrollY = window.scrollY;
    S.view = "safetycard";
    pushGuard();
    paint();
    window.scrollTo(0, 0);
    root.querySelector(".a-ch-view [data-focus]")?.focus({ preventScroll: true });
  }
  function closeSafetyView(drop = true) {
    S.view = "chat";
    if (drop) dropGuard();
    paint();
    window.scrollTo(0, S.scrollY || 0);
    root.querySelector(".a-cs-danger")?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- 返し方・診断
  /** 今の返し方（"short" | "deep" | "normal"）。おまかせで、まだ何も書いていなければ null */
  const effStyle = () => S.style === "short" ? "short" : S.style === "deep" ? "deep" : S.text ? S.auto : null;
  const dxSelf = () => (S.useDx && S.self ? S.self : undefined);
  function setRead() { S.read = readText(S.text); S.auto = L.autoStyle(S.read, S.text); }

  // ---------------------------------------------------------------- カードより前（今の consult.js の startRead・viewRead・viewAsk と同じ中身）
  function known() {
    const k = M.knownFrom(S.read?.fields, S.edits, S.answers.map(a => a.patch), { lateNight: S.lateNight });
    delete k.want;
    return k;
  }
  const currentQuestion = () => nextQuestion(known(), S.answers.map(a => a.q));
  function readKnown() { return M.knownFrom(S.read?.fields, S.edits); }
  function editedEvidence() {
    const ev = { ...(S.read?.evidence || {}) };
    for (const f of Object.keys(S.edits)) delete ev[f];
    if ("want" in S.edits) { delete ev.intent; delete ev.goal; }
    return ev;
  }
  function prePush(item) {
    S.pre.push({ id: nid(), at: new Date().toISOString(), ...item });
    return S.pre.length - 1;
  }

  /** 最初の1回：相談を始める */
  function startChat(raw) {
    const text = clip(raw);
    if (!text) return false;
    const keep = { style: S.style, self: S.self, useDx: S.useDx, seen: S.seen, guideOpen: S.guideOpen };
    Object.assign(S, fresh0(), keep);
    S.text = text;
    S.record = { id: null, at: null, text };
    S.lateNight = isLateNight(new Date());
    prePush({ who: "me", text });
    setRead();
    draftStore.set(text);
    afterRead("full", text);
    paintNew();
    return true;
  }
  /** カードの前にもう一度書いた：相談の文に改行でつないで読み直す（じっくりの問いへの答えなら、短い受け止めを1つ） */
  function appendConsult(raw) {
    const add = clip(raw);
    if (!add) return false;
    const deep = S.prePend?.type === "deep";
    S.prePend = null;
    S.editing = null;
    prePush({ who: "me", text: add });
    S.text = L.joinConsult(S.text, add);
    S.record = { id: null, at: null, text: S.text };
    setRead();
    draftStore.set(S.text);
    afterRead(deep ? "deep" : "full", add);
    paintNew();
    return true;
  }
  function afterRead(kind, added) {
    if (M.hasSafetySign(S.read) && !S.safetyContinue) {
      const n = prePush({ who: "app", text: `${SAFETY_Q}\n${SAFETY_SUB.text}`, sf: true });
      S.prePend = { type: "safety", n };
      return;
    }
    if (kind === "deep") prePush({ who: "app", text: F.talkAccept(readText(added), added) });
    else pushAccept();
    flowOn();
  }
  /** 受け止め（今の受け止めの文。返し方が「短く」なら最初の1文だけ） */
  function acceptNow() {
    const t = M.acceptText({ known: readKnown(), text: S.text, evidence: editedEvidence(), safetyContinue: S.safetyContinue });
    return effStyle() === "short" ? L.firstSentence(t) : t;
  }
  function pushAccept() {
    S.acceptN = prePush({ who: "app", text: acceptNow() });
    S.fixOpen = M.readChips(S.read, S.read.fields).some(c => c.weak);
    S.editing = null;
  }
  /** 受け止めのあと：じっくりなら1回だけ「もう少し聞かせて」、そのあと足りない問かカード */
  function flowOn() {
    if (effStyle() === "deep" && !S.deepDone) {
      S.deepDone = true;
      const n = prePush({ who: "app", text: T.deepAsk });
      S.prePend = { type: "deep", n };
      return;
    }
    askOrCard();
  }
  function askOrCard() {
    const q = currentQuestion();
    if (q) {
      const n = prePush({ who: "app", text: q.text, label: `（${S.answers.length + 1}つめ・多くて3つ）` });
      S.prePend = { type: "ask", n, q };
      return;
    }
    S.prePend = null;
    buildCard();
  }
  function answerAsk(o) {
    const q = S.prePend?.q;
    if (!q) return;
    S.answers.push({ q, patch: o.patch, label: o.label });
    S.prePend = null;
    prePush({ who: "me", text: o.label });
    askOrCard();
    paintNew();
  }
  function skipDeep() {
    S.prePend = null;
    askOrCard();
    paintNew();
  }
  /** 安全の確認（カードの前）：今、危ない → 安全のカード。続ける → 受け止めへ */
  function safetyPick(kind, label) {
    S.prePend = null;
    prePush({ who: "me", text: label, sf: true });
    if (kind === "stop") {
      const n = prePush({ who: "safety", sf: true });
      S.prePend = { type: "safetyCard", n };
      paintNew();
      return;
    }
    continuePre();
  }
  function continuePre() {
    S.prePend = null;
    S.safetyContinue = true;
    pushAccept();
    flowOn();
    paintNew();
  }
  /** 「読み取ったことを直す」で直した：受け止めの文をその場で作り直し、待っている問が変われば出し直す */
  function afterEdit(chipKey) {
    S.editing = null;
    const acc = S.pre[S.acceptN];
    if (acc) acc.text = acceptNow();
    let moved = false;
    if (S.prePend?.type === "ask") {
      const q = currentQuestion();
      if (q && q.id === S.prePend.q.id) S.prePend.q = q;
      else {
        if (S.prePend.n === S.pre.length - 1) S.pre.pop();
        S.prePend = null;
        askOrCard();
        moved = true;
      }
    }
    paintNew({ focusSel: moved ? null : `[data-chip="${chipKey}"]` });
  }

  /** 最初のカード（今の consult.js の buildCard と同じ。診断を使うなら本人の8領域も渡す） */
  function buildCard() {
    S.fresh = true;
    S.shortOpen = false;
    S.now = new Date();
    const k = known();
    const safety = S.read?.safety ?? null;
    S.model = M.buildPoc({ known: k, extra: S.extra, text: S.text, now: S.now, safetyContinue: S.safetyContinue, safety, self: dxSelf() });
    S.cardInput = cardInputOf(k, S.extra, S.safetyContinue, safety, S.now);
    const ka = { ...k };
    delete ka.lateNight;
    S.accept = M.acceptText({ known: ka, text: S.text, evidence: editedEvidence() });
    S.fu = F.newFollow({ known: k, asked: S.answers.map(a => a.q.id), safety, safetyContinue: S.safetyContinue });
    S.fu.thread = [cardItem(S.model, S.now)];
    S.composer = null;
    S.mode = "talk";
    S.modePicked = false;
    S.panel = null;
    saveRecord();
  }
  function cardInputOf(knownV, extra, safetyContinue, safety, at) {
    const ci = { known: knownV, extra: { ...extra }, safetyContinue, safety, at: at.toISOString() };
    const self = dxSelf();
    if (self) ci.self = self;
    return ci;
  }
  /** 今のカードを、その場で作り直す（カードの［ちがう］［もっと合わせる］）。新しいカードにはしない */
  function rebuildCard() {
    S.fresh = true;
    S.now = new Date();
    const ci = S.cardInput;
    const k = S.fu ? { ...S.fu.known, lateNight: !!ci.known?.lateNight } : ci.known;
    S.model = M.buildPoc({ known: k, extra: S.extra, text: S.text, now: S.now, safetyContinue: ci.safetyContinue, safety: ci.safety, self: dxSelf() });
    S.cardInput = cardInputOf(k, S.extra, ci.safetyContinue, ci.safety, S.now);
    const th = S.fu?.thread;
    const i = th ? th.map(x => x.who).lastIndexOf("card") : -1;
    if (i >= 0) th[i] = { ...th[i], at: S.now.toISOString(), card: snapshotOf(S.model) };
    saveRecord();
    paint();
    root.querySelector(".is-live .a-cs-card [data-focus]")?.focus({ preventScroll: true });
  }
  const cardItem = (m, at) => ({ who: "card", at: at.toISOString(), card: snapshotOf(m), action: m.result?.action ?? null });

  /** この相談の履歴（1件だけ。差し替える）。安全のカードは残さない。形は consult.js と同じ＋ data.chat */
  function saveRecord() {
    const m = S.model;
    if (!m || m.mode === "safety" || !S.fu || !S.cardInput) return;
    try {
      const ci = S.cardInput;
      const input = { known: ci.known, extra: ci.extra, safetyContinue: ci.safetyContinue, safety: ci.safety, lateNight: !!ci.known?.lateNight, at: ci.at };
      if (ci.self) input.self = ci.self;
      const data = {
        v: 2,
        text: S.text,
        accept: S.accept,
        card: snapshotOf(m),
        input,
        extra: S.extra,
        fu: S.fu,
        chat: { v: 1, pre: L.prePersist(S.pre), style: S.style, useDx: !!(S.useDx && S.self), self: S.self ?? null },
      };
      if (S.record.id) removeRecord(S.record.id);
      if (!S.record.at) S.record.at = ci.at;
      S.record.id = addRecord({ kind: "consult", at: S.record.at, title: titleOf(S.text), sub: m.headline, data });
      if (S.record.id) {
        draftStore.set("");
        activeStore.set(S.fu.ended || S.fu.closed ? null : S.record.id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  // ---------------------------------------------------------------- 続き（往復。今の consult.js と同じ動き・同じ文・同じ数え方）
  const thread = () => S.fu.thread;
  function push(item) { thread().push({ at: new Date().toISOString(), ...item }); }
  const canTurn = () => !!S.fu && !S.fu.ended && S.fu.turns < F.MAX_TURNS;
  const curAction = () => S.model?.result?.action ?? null;
  const curSafety = () => {
    if (S.pendingInput?.read) return S.pendingInput.read.safety;
    return S.fu?.safety ?? S.read?.safety ?? null;
  };
  const WAIT_PENDS = ["replyKind", "talkQ", "sent"];
  const atLimit = () => !!S.fu && !S.fu.ended && S.fu.turns >= F.MAX_TURNS && !WAIT_PENDS.includes(S.fu.pending?.type) && !S.pendingInput;
  function fold() {
    const r = F.splitExtra(S.fu.known, S.extra);
    S.fu.known = r.known;
    S.extra = r.extra;
  }
  function begin() {
    S.composer = null;
    S.panel = null;
    S.mode = "talk";
    S.modePicked = false;
    fold();
  }
  /** 判定し直す。一手（か安全の扱い）が変わったら新しいカード、変わらなければ吹き出し（今の consult.js の settle。診断を使うなら本人の8領域も渡す） */
  function settle(now = new Date()) {
    const lateNight = isLateNight(now);
    const m = F.rejudge({ known: S.fu.known, extra: S.extra, text: S.text, now, safetyContinue: S.fu.safetyContinue, safety: S.fu.safety, lateNight, self: dxSelf() });
    const changed = F.actionChanged(S.model, m);
    if (changed) {
      const onlySafety = S.model?.result?.action === m.result?.action && S.model?.mode === m.mode;
      takeModel(m, now, lateNight);
      push({ who: "app", text: onlySafety ? "カードを作り直して、危ないと感じたときの窓口を一番上に足しました。" : "いまの状況に合わせて、一手を考え直しました。" });
      thread().push(cardItem(m, now));
    } else {
      push({ who: "app", text: F.keepText(S.model) });
    }
    return changed;
  }
  function takeModel(m, now, lateNight) {
    S.model = m;
    S.now = now;
    S.fresh = true;
    S.shortOpen = false;
    S.cardInput = cardInputOf({ ...S.fu.known, lateNight }, S.extra, S.fu.safetyContinue, { ...S.fu.safety }, now);
  }
  function logTurn(entry, changed) {
    S.fu.log.push({ at: new Date().toISOString(), ...entry, action: curAction(), changed: !!changed });
  }
  function commit() {
    saveRecord();
    paintNew();
  }

  // ［送った］→「どうなった？」［返事が来た］［まだ来ない］［もう少し話したい］
  function doSent() {
    if (!canTurn()) return;
    begin();
    const now = new Date();
    const r = F.afterSent(S.fu.known, curAction(), now);
    S.fu.known = r.known;
    S.fu.sentAt = r.sentAt;
    S.fu.sent = true;
    S.fu.turns++;
    push({ who: "me", text: "送った" });
    push({ who: "app", text: F.TEXTS.sentAsk });
    S.fu.pending = { type: "sent", n: thread().length - 1 };
    logTurn({ btn: "sent" }, false);
    commit();
  }
  function doNoReply() {
    begin();
    const now = new Date();
    const ms = S.fu.sentAt ? now.getTime() - Date.parse(S.fu.sentAt) : 0;
    S.fu.known = F.afterNoReply(S.fu.known, ms);
    push({ who: "me", text: "まだ来ない" });
    push({ who: "app", text: F.sinceText(ms) });
    const n = thread().length - 1;
    const changed = settle(now);
    S.fu.pending = { type: "elapsed", n };
    logTurn({ btn: "noreply", elapsed: S.fu.known.elapsed }, changed);
    commit();
  }
  function pickElapsed(v) {
    begin();
    S.fu.known = { ...S.fu.known, elapsed: v };
    S.fu.pending = null;
    push({ who: "me", text: F.valueLabel("elapsed", v) });
    const changed = settle();
    logTurn({ btn: "elapsed", elapsed: v }, changed);
    commit();
  }

  // ［相手の返事を貼る］
  function submitReply(raw) {
    const text = clip(raw);
    if (!text || !canTurn()) return false;
    const rr = F.readReply(text);
    if (M.hasSafetySign(rr.read)) {
      S.pendingInput = { type: "reply", text, read: rr.read, kind: rr.kind };
      S.safetyFrom = "reply";
      S.fuSafetyCard = false;
      S.composer = null;
      S.panel = null;
      paintNew();
      return true;
    }
    takeReply(text, rr.kind, null);
    return true;
  }
  function takeReply(text, kind, sign = null) {
    begin();
    S.fu.turns++;
    if (sign) markSafety(sign);
    S.fu.pending = null;
    push({ who: "me", label: "相手から来た返事", text, quote: true });
    if (!kind) {
      push({ who: "app", text: F.REPLY_KIND_QUESTION.text });
      S.fu.pending = { type: "replyKind", n: thread().length - 1, text };
      commit();
      return;
    }
    finishReply(text, kind);
  }
  function answerReplyKind(o) {
    const text = S.fu.pending?.text ?? "";
    begin();
    S.fu.pending = null;
    push({ who: "me", text: o.label });
    finishReply(text, o.kind);
  }
  function finishReply(text, kind) {
    const check = F.checkReply(curAction(), kind);
    if (check) {
      push({ who: "app", label: "答え合わせ", text: check.text, check: check.result });
      S.fu.checks.push({ at: new Date().toISOString(), kind, result: check.result, action: curAction() });
    }
    S.fu.known = F.afterReply(S.fu.known, kind, { sent: S.fu.sent });
    const wasSent = S.fu.sent;
    S.fu.sent = false;
    const changed = settle();
    logTurn({ btn: "reply", text, kind, check: check?.result ?? null, sent: wasSent }, changed);
    commit();
  }

  // ［もう少し話したい］
  function submitTalk(raw) {
    const text = clip(raw);
    if (!text || !canTurn()) return false;
    const read = readText(text);
    if (M.hasSafetySign(read)) {
      S.pendingInput = { type: "talk", text, read };
      S.safetyFrom = "talk";
      S.fuSafetyCard = false;
      S.composer = null;
      S.panel = null;
      paintNew();
      return true;
    }
    takeTalk(text, read, false);
    return true;
  }
  function takeTalk(text, read, safetyCont) {
    begin();
    S.fu.turns++;
    if (safetyCont) markSafety(read.safety);
    S.fu.pending = null;
    push({ who: "me", text });
    S.fu.known = F.mergeTalk(S.fu.known, read.fields);
    push({ who: "app", text: safetyCont ? M.ACCEPT_SAFETY : F.talkAccept(read, text) });
    const q = F.talkQuestion(S.fu.known, S.fu.asked, { ...S.extra, lateNight: isLateNight(new Date()) });
    if (q) {
      S.fu.asked.push(q.id);
      push({ who: "app", text: q.text });
      S.fu.pending = { type: "talkQ", n: thread().length - 1, q, text };
      commit();
      return;
    }
    finishTalk(text, null);
  }
  function answerTalk(o) {
    const text = S.fu.pending?.text ?? "";
    begin();
    S.fu.pending = null;
    if (o) {
      push({ who: "me", text: o.label });
      S.fu.known = applyAnswer(S.fu.known, o.patch);
    }
    finishTalk(text, o ? o.label : null);
  }
  function finishTalk(text, answer) {
    const changed = settle();
    logTurn({ btn: "talk", text, answer }, changed);
    commit();
  }

  function markSafety(sf) {
    S.fu.safetyContinue = true;
    S.fu.safety = { selfHarm: !!(S.fu.safety?.selfHarm || sf?.selfHarm), partnerThreat: !!(S.fu.safety?.partnerThreat || sf?.partnerThreat) };
  }
  function continueAfterSafety() {
    const p = S.pendingInput;
    S.pendingInput = null;
    S.safetyFrom = null;
    S.fuSafetyCard = false;
    if (!p) { paint(); return; }
    if (p.type === "reply") takeReply(p.text, p.kind, p.read.safety);
    else takeTalk(p.text, p.read, true);
  }
  function fuSafetyStop() {
    S.fuSafetyCard = true;
    paintNew();
  }

  // 「いまの状況」を直す → 判定し直し（往復には数えない）
  function editStatus(key, v) {
    begin();
    const k = { ...S.fu.known };
    if (v === null) delete k[key]; else k[key] = v;
    S.fu.known = k;
    push({ who: "me", text: `直した：${F.editName(key)}は「${F.valueLabel(key, v)}」` });
    S.statusOpen = false;
    const changed = settle();
    logTurn({ btn: "edit", key, value: v }, changed);
    commit();
  }

  // 診断の結果を使うかを、カードのあとに変えた → 判定し直し（往復には数えない。自分の吹き出しは出さない）
  function redoForDx() {
    begin();
    const now = new Date();
    const lateNight = isLateNight(now);
    const m = F.rejudge({ known: S.fu.known, extra: S.extra, text: S.text, now, safetyContinue: S.fu.safetyContinue, safety: S.fu.safety, lateNight, self: dxSelf() });
    const changed = F.actionChanged(S.model, m);
    const head = S.useDx ? T.dxRedoOn : T.dxRedoOff;
    if (changed) {
      takeModel(m, now, lateNight);
      push({ who: "app", text: head });
      thread().push(cardItem(m, now));
    } else {
      push({ who: "app", text: `${head}${F.keepText(S.model)}` });
    }
    logTurn({ btn: "dx", useDx: !!S.useDx }, changed);
    commit();
  }

  // 「相談を終える」→「どうなった？」→ 履歴に残す（診断していない人には、［仲直りできた］［まだ］のあとに1行の案内）
  function openEnd() {
    if (!S.fu || S.fu.ended) return;
    S.composer = "end";
    S.panel = null;
    paintNew();
  }
  function cancelEnd() {
    S.composer = null;
    paint();
    footSlot.querySelector(".a-ch-end")?.focus({ preventScroll: true });
  }
  function finishEnd(key) {
    begin();
    S.pendingInput = null;
    S.safetyFrom = null;
    S.fuSafetyCard = false;
    const o = F.outcomeOf(key);
    if (o) push({ who: "me", text: o.label });
    push({ who: "app", text: o ? o.reply : F.OUTCOME_SKIP_REPLY });
    S.fu.outcome = o ? o.key : null;
    S.fu.ended = true;
    S.fu.pending = null;
    S.invite = L.dxInvite(S.fu.outcome, diagnosisStatus());
    commit();
  }
  /** ［新しく相談する］：今の相談は閉じて（履歴には残る）、始める前へ */
  function startNew() {
    if (S.fu && !S.fu.ended) { S.fu.closed = true; saveRecord(); }
    activeStore.set(null);
    S.self = diagnosisSelf();
    S.dxDone = diagnosisDone();
    Object.assign(S, fresh0(), { useDx: !!S.self, seen: new Set() });
    draftStore.set("");
    setInput("");
    paint({ initial: true });
    window.scrollTo(0, 0);
    ta.focus({ preventScroll: true });
  }

  /** 履歴の記録から続きを開く（読み込み直したとき・「前の続き」の［続きから］）。カードより前のやりとりも戻す */
  function resume(rec) {
    const d = rec.data;
    const ci = d.input;
    const ch = d.chat && typeof d.chat === "object" ? d.chat : null;
    const at = new Date(ci.at);
    const now = Number.isNaN(at.getTime()) ? new Date() : at;
    const cself = ci.self && L.hasSide(ci.self) ? ci.self : undefined;
    const model = M.buildPoc({ known: ci.known || {}, extra: ci.extra || {}, text: d.text, now, safetyContinue: !!ci.safetyContinue, safety: ci.safety ?? undefined, self: cself });
    const selfNow = S.self;
    Object.assign(S, fresh0(), { seen: new Set() });
    S.text = d.text;
    S.auto = L.autoStyle(readText(d.text), d.text);
    S.accept = typeof d.accept === "string" ? d.accept : "";
    S.fu = clone(d.fu);
    for (const k of ["thread", "log", "checks", "asked"]) if (!Array.isArray(S.fu[k])) S.fu[k] = [];
    S.extra = { ...(d.extra && typeof d.extra === "object" ? d.extra : ci.extra || {}) };
    S.cardInput = clone(ci);
    S.model = model;
    S.now = now;
    S.safetyContinue = !!ci.safetyContinue;
    S.record = { id: rec.id, at: rec.at, text: d.text };
    S.resumed = true;
    S.deepDone = true;
    S.pre = L.preFrom(ch?.pre).map(x => ({ ...x, id: nid() }));
    S.self = ch && L.hasSide(ch.self) ? ch.self : selfNow;
    S.useDx = ch ? !!ch.useDx && !!S.self : !!cself;
    activeStore.set(rec.id);
    setInput("");
    paint({ initial: true });
    // いちばん新しいやりとりを見せる（画面の切り替えが先頭へ戻したあとに）
    setTimeout(() => {
      const last = [...mainSlot.querySelectorAll(".a-ch-thread > li")].pop();
      if (!last?.isConnected) return;
      last.scrollIntoView({ block: "start" });
      (last.querySelector("[data-focus]") || last).focus({ preventScroll: true });
    }, 0);
  }
  function dismissOffer() {
    const rec = S.offer;
    S.offer = null;
    try {
      const fresh = rec ? getRecord(rec.id) : null;
      if (fresh && F.resumable(fresh)) {
        const data = { ...fresh.data, fu: { ...fresh.data.fu, closed: true } };
        removeRecord(fresh.id);
        addRecord({ kind: "consult", at: fresh.at, title: fresh.title, sub: fresh.sub, data });
      }
    } catch (err) { console.error(err); }
    paint();
    ta.focus();
  }

  // ---------------------------------------------------------------- 書く欄
  /** 書く欄の様子 { show, enabled, ph, name } */
  function composeState() {
    if (!S.model) return { show: true, enabled: true, ph: PH_CONSULT, name: NAME.consult };
    const fu = S.fu;
    if (!fu || fu.ended || atLimit()) return { show: false, enabled: false, ph: "", name: NAME.talk };
    if (S.pendingInput) return { show: true, enabled: false, ph: WAIT_Q, name: NAME.talk };
    const p = fu.pending?.type;
    if (p === "replyKind" || p === "talkQ") return { show: true, enabled: false, ph: WAIT_Q, name: NAME.talk };
    if (p === "sent" && !S.modePicked) return { show: true, enabled: false, ph: WAIT_SENT, name: NAME.talk };
    const reply = S.mode === "reply";
    return { show: true, enabled: true, ph: reply ? T.phReply : T.phTalk, name: reply ? NAME.reply : NAME.talk };
  }
  function send() {
    const v = ta.value;
    if (!v.trim() || ta.disabled) return;
    setInput("");
    const act = !S.text ? startChat : !S.model ? appendConsult : S.mode === "reply" ? submitReply : submitTalk;
    if (!act(v)) setInput(v);
  }
  /** ［相手の返事を貼る］［もう少し話したい］（と「どうなった？」の［返事が来た］）：書く欄の行き先を変えて、欄へ */
  function pickMode(mode) {
    S.mode = mode;
    S.modePicked = true;
    S.panel = null;
    paintDock();
    ta.focus();
  }
  function cancelReply() {
    S.mode = "talk";
    S.modePicked = false;
    paintDock();
    (actsSlot.querySelector('[data-act="reply"]') || mainSlot.querySelector(".a-ch-opts button") || ta).focus();
  }
  function pickExample(c) {
    const cur = ta.value.trim();
    if (cur && cur !== c.text && !window.confirm("書いた文を、この例文に入れ替えますか？")) return;
    setInput(c.text);
    if (!S.text) draftStore.set(c.text);
    ta.focus();
  }

  // ---------------------------------------------------------------- 返し方と診断の欄・文を自分で直す欄
  function togglePanel(name) {
    S.panel = S.panel === name ? null : name;
    S.draftEdit = null;
    paintDock();
    if (S.panel === "settings") panelSlot.querySelector("button[aria-pressed='true'], button")?.focus();
    else if (S.panel === "draft") panelSlot.querySelector("textarea")?.focus();
    else (name === "settings" ? footSlot.querySelector(".a-ch-set") : actsSlot.querySelector('[data-act="draft"]'))?.focus();
  }
  function setStyle(v) {
    if (!L.isStyle(v) || S.style === v) return;
    S.style = v;
    styleStore.set(v);
    applyStyle();
    paintDock();
    panelSlot.querySelector(`[data-style="${v}"]`)?.focus();
  }
  /** 返し方を変えた：今のカードの見た目（短い／全部）だけを変える（やりとりは足さない） */
  function applyStyle() {
    const short = effStyle() === "short" && S.model?.mode !== "safety";
    const art = mainSlot.querySelector("#a-ch-live-card");
    if (art && S.model?.mode !== "safety") art.classList.toggle("a-ch-short", short && !S.shortOpen);
    const more = mainSlot.querySelector(".a-ch-more");
    if (more) {
      more.hidden = !short;
      more.setAttribute("aria-expanded", String(S.shortOpen));
    }
  }
  function toggleShort() {
    S.shortOpen = !S.shortOpen;
    applyStyle();
  }
  function setDx(on) {
    if (!S.self || S.useDx === on) return;
    S.useDx = on;
    if (S.model && S.fu && !S.fu.ended) { redoForDx(); return; }
    if (!S.text) {
      paint();
      (panelSlot.querySelector(`[data-dx="${on ? "on" : "off"}"]`) || mainSlot.querySelector("[data-dx-toggle]"))?.focus();
    } else {
      paintDock();
      panelSlot.querySelector(`[data-dx="${on ? "on" : "off"}"]`)?.focus();
    }
  }
  const canEditDraft = () => !!(S.model && S.model.mode !== "safety" && S.model.card?.drafts?.length && S.fu && !S.fu.ended);
  /** 今カードで見えている送る一文（「別の言い方」を選んでいればそれ） */
  function shownDraft() {
    const b = mainSlot.querySelector(".is-live .a-cs-bubble");
    return (b?.textContent || S.model?.card?.drafts?.[0]?.text || "").trim();
  }
  function closeBtn(onClick) {
    return h("button", { type: "button", class: "a-link a-link-tap a-ch-close", onclick: onClick }, "閉じる");
  }
  function settingsPanel() {
    const eff = effStyle();
    return h("section", { class: "a-ch-panel", id: "a-ch-settings", "aria-labelledby": "a-ch-settings-h" },
      h("div", { class: "a-ch-panel-head" },
        h("h2", { class: "a-ch-panel-h", id: "a-ch-settings-h" }, T.settings),
        closeBtn(() => togglePanel("settings"))),
      h("p", { class: "a-ch-mini", id: "a-ch-style-h" }, T.styleHead),
      h("div", { class: "a-ch-choices", role: "group", "aria-labelledby": "a-ch-style-h" }, L.STYLE_OPTIONS.map(o =>
        h("button", { type: "button", class: "a-ch-choice", "aria-pressed": String(S.style === o.key), "data-style": o.key, onclick: () => setStyle(o.key) },
          h("span", { class: "a-ch-choice-name" }, S.style === o.key ? icon("check", { size: 16 }) : null, o.key === "auto" ? L.styleLabel("auto", eff) : o.label),
          h("span", { class: "a-ch-choice-desc" }, o.desc)))),
      // 診断：向きがあれば［使う］［この相談では使わない］。診断していなければ「まだ診断していません。」。終わっていて向きが無ければ出さない
      S.self ? [h("p", { class: "a-ch-mini", id: "a-ch-dx-h" }, T.dxHead),
        h("p", { class: "a-ch-note" }, S.useDx ? T.dxUsing : T.dxOff),
        h("div", { class: "a-cs-chip-row", role: "group", "aria-labelledby": "a-ch-dx-h" },
          dxChip(T.dxUse, true), dxChip(T.dxSkip, false))]
        : S.dxDone ? null
          : [h("p", { class: "a-ch-mini" }, T.dxHead), h("p", { class: "a-ch-note" }, T.dxNone)]);
  }
  function dxChip(label, on) {
    const pressed = S.useDx === on;
    return h("button", { type: "button", class: "a-cs-chip", "aria-pressed": String(pressed), "data-dx": on ? "on" : "off", onclick: () => setDx(on) }, pressed ? icon("check", { size: 16 }) : null, label);
  }
  function draftPanel() {
    const t = h("textarea", { id: "a-ch-draft-input", class: "a-textarea a-ch-draft-input", rows: "3", maxlength: String(MAX_CHARS) });
    t.value = S.draftEdit ?? shownDraft();
    const level = h("p", { class: "a-cs-level" });
    const hits = h("ul", { class: "a-cs-hits" });
    const result = h("div", { class: "a-cs-check", "aria-live": "polite" }, level, hits);
    // 今の urgePanel と同じ送る前チェック（届きやすさ3段階と印。数字は出さない）。一手と、その局面の避ける言葉で見る
    const run = () => {
      const v = t.value.trim();
      hits.replaceChildren();
      if (!v) { level.replaceChildren("書くと、相手に届きやすいかをここに出します。"); level.className = "a-cs-level is-empty"; return; }
      const r = checkDraft(v, { action: S.model?.result?.action ?? null, avoid: S.model?.result?.avoid ?? null });
      level.className = `a-cs-level${r.level === LEVELS[2] ? " is-stop" : ""}`;
      level.replaceChildren("届きやすさ：", h("b", null, r.level));
      for (const x of r.hits) {
        hits.append(h("li", null, x.id === "long" || x.id === "missing_time"
          ? M.HIT_LABELS[x.id]
          : h("span", null, h("mark", null, `「${x.text}」`), M.HIT_LABELS[x.id] ?? "")));
      }
    };
    t.addEventListener("input", () => { S.draftEdit = t.value; run(); });
    run();
    return h("section", { class: "a-ch-panel", id: "a-ch-draft", "aria-labelledby": "a-ch-draft-h" },
      h("div", { class: "a-ch-panel-head" },
        h("label", { class: "a-ch-panel-h", id: "a-ch-draft-h", for: "a-ch-draft-input" }, T.editHead),
        closeBtn(() => togglePanel("draft"))),
      t, result,
      h("div", { class: "a-ch-panel-row" },
        h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm a-cs-copy-all", onclick: () => copyText(t.value, t) }, icon("copy", { size: 18 }), "この文をコピー")),
      h("p", { class: "a-note" }, T.editNote));
  }

  // ---------------------------------------------------------------- 描く
  /**
   * 上の題・帯・やりとり・下の欄を描き直す。描いたあと、前に無かった項目（新しく足した物）を返す
   * @param {{ initial?: boolean }} [o]  initial：開いたとき（新しい物として動かさない）
   */
  function paint({ initial = false } = {}) {
    clearInterval(tick);
    tick = null;
    timers.clear();
    const view = S.view === "safetycard";
    topSlot.replaceChildren(topBar({
      title: "相談",
      back,
      heading: true,
      right: view ? null : h("button", { type: "button", class: "a-cs-danger", onclick: openSafetyView }, "危ないときは"),
    }));
    if (view) {
      bandSlot.replaceChildren();
      const { card } = M.buildSafetyCard({ text: S.text, safety: curSafety() ?? undefined });
      mainSlot.replaceChildren(h("div", { class: "a-ch-view" }, safetyCardView(card, { fresh: true })));
      dock.hidden = true;
      sizeVars();
      return [];
    }
    dock.hidden = false;
    if (S.fu && S.model) bandSlot.replaceChildren(bandView()); else bandSlot.replaceChildren();
    const list = threadView();
    mainSlot.replaceChildren(list);
    paintDock();
    if (timers.size) tick = setInterval(() => { for (const f of timers) f(); }, 30000);
    const lis = [...list.children];
    const added = initial ? [] : lis.filter(li => !S.seen.has(li.dataset.k));
    S.seen = new Set(lis.map(li => li.dataset.k));
    if (!reduceMotion()) added.forEach((li, i) => { li.classList.add("a-ch-in"); li.style.setProperty("--a-ch-i", String(i)); });
    sizeVars();
    return added;
  }
  /** 描き直して、新しく足した最初の物が見える所まで動かし、焦点を移す（問いの選択肢があればその最初のボタン、ほかは書く欄） */
  function paintNew({ focusSel = null } = {}) {
    const added = paint();
    if (focusSel) root.querySelector(focusSel)?.focus({ preventScroll: true });
    if (!added.length) return;
    added[0].scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
    announce(added);
    if (focusSel) return;
    const opt = added.map(li => li.querySelector(".a-ch-opts button")).find(Boolean);
    if (opt) { opt.focus({ preventScroll: true }); return; }
    const cs = composeState();
    if (cs.show && cs.enabled && !coarse()) { ta.focus({ preventScroll: true }); return; }
    const act = !cs.enabled ? actsSlot.querySelector("button, a") : null;
    if (act) { act.focus({ preventScroll: true }); return; }
    (added.find(li => li.dataset.who !== "me") || added[0]).focus({ preventScroll: true });
  }
  /** 新しく足した吹き出しを読み上げる（やりとりの列は描き直すので、別の小さな場所で知らせる） */
  function announce(added) {
    const text = added.map(li => li.dataset.say).filter(Boolean).join("\n");
    announcer.textContent = "";
    if (!text) return;
    requestAnimationFrame(() => { announcer.textContent = text; });
  }

  function li(key, who, cls, say, ...kids) {
    return h("li", { class: cls, "data-k": key, "data-who": who, "data-say": say || null, tabindex: "-1" }, kids);
  }
  const sayOf = (who, text) => `${who === "me" ? "あなた" : "アプリ"}：${text}`;
  function msg(key, item, ...extra) {
    const me = item.who === "me";
    return li(key, item.who, ["a-cs-msg", me ? "is-me" : "is-app"], sayOf(item.who, item.label ? `${item.label}。${item.text}` : item.text), bubbleView(item), extra);
  }
  function chip(label, onClick, cls = null) {
    return h("button", { type: "button", class: ["a-cs-chip", cls], onclick: onClick }, label);
  }
  const opts = (...kids) => h("div", { class: "a-cs-msg-opts a-ch-opts" }, kids);

  /** やりとり：あいさつ →（始める前）診断・例文・書き方の例・前の続き → カードより前のやりとり → カードと続き → 待っている問など */
  function threadView() {
    const list = h("ol", { class: "a-cs-thread a-ch-thread", "aria-label": "やりとり" });
    // 始める前：あいさつ（と診断を使うか）→ 前の相談の続き（あれば。画面の上の方で見えるように）→ 例文・書き方の例
    list.append(msg("g", { who: "app", text: T.greet }, S.text ? null : dxLine()));
    if (!S.text && S.offer) list.append(offerItem(S.offer));
    if (!S.text) list.append(li("e", "app", "a-cs-msg is-app", null, startExtras()));
    S.pre.forEach((x, i) => { const el = preItem(x, i); if (el) list.append(el); });
    if (S.fu) fuItems(list);
    tailItems(list);
    return list;
  }

  /** 始める前：あいさつの下に小さく、診断の結果を使うか（使える診断があるときだけ） */
  function dxLine() {
    if (!S.self) return null;
    return h("div", { class: "a-ch-start" }, h("p", { class: "a-ch-dx" },
      h("span", null, S.useDx ? T.dxOn : T.dxOff), " ",
      h("button", { type: "button", class: "a-cs-inline a-ch-dx-btn", "data-dx-toggle": "1", onclick: () => setDx(!S.useDx) }, S.useDx ? T.dxSkip : T.dxUse)));
  }
  /** 始める前：例文・書き方の例 */
  function startExtras() {
    const box = h("div", { class: "a-ch-start" });
    box.append(h("div", { class: "a-ch-examples" },
      h("p", { class: "a-ch-mini", id: "a-ch-ex-h" }, T.examples),
      h("div", { class: "a-cs-chip-row", role: "group", "aria-labelledby": "a-ch-ex-h" },
        CONSULT_EXAMPLES.map((c, i) => chip(c.label || `${T.examples} ${i + 1}`, () => pickExample(c), "a-ch-ex")))));
    const panel = guideView();
    panel.id = "a-ch-guide";
    panel.hidden = !S.guideOpen;
    const tg = h("button", { type: "button", class: "a-link a-link-tap a-cs-toggle a-ch-guide-btn", "aria-expanded": String(S.guideOpen), "aria-controls": "a-ch-guide" },
      h("span", null, T.guide), icon("chevron-down", { size: 16 }));
    tg.addEventListener("click", () => {
      S.guideOpen = !S.guideOpen;
      panel.hidden = !S.guideOpen;
      tg.setAttribute("aria-expanded", String(S.guideOpen));
    });
    box.append(h("div", { class: "a-ch-guide-wrap" }, tg, panel));
    return box;
  }
  /** 書き方の例（今の consult.js の guideView と同じ表と一言） */
  function guideView() {
    const keep = (...parts) => parts.map(t => h("span", { class: "a-cs-keep" }, t));
    return h("div", { class: "a-cs-guide" },
      h("p", { class: "a-cs-guide-h", id: "a-ch-guide-h" }, keep("たとえば、こんなことを書くと", "伝わりやすくなります")),
      h("dl", { class: "a-cs-guide-list", "aria-labelledby": "a-ch-guide-h" }, GUIDE_ROWS.map(([what, ex]) =>
        h("div", { class: "a-cs-guide-row" }, h("dt", null, keep(...what.split("|"))), h("dd", null, keep(...ex.split("|")))))),
      h("p", { class: "a-cs-guide-foot" },
        keep("相手の言葉は「」で", "そのまま書くと、", "読み取りやすくなります。", "全部そろっていなくても", "大丈夫です。", "足りないところは、", "あとで少しだけ聞きます。")));
  }
  function offerItem(rec) {
    const left = Math.max(0, F.MAX_TURNS - (Number(rec.data?.fu?.turns) || 0));
    return msg("o", { who: "app", text: `${T.offer}「${rec.title || titleOf(rec.data?.text)}」` },
      h("p", { class: "a-note a-ch-under" }, `${fmtDate(rec.at)}に始めた相談・あと${left}回`),
      h("div", { class: "a-cs-msg-opts" },
        h("button", { type: "button", class: "a-btn a-btn-sm", onclick: () => resume(rec) }, "続きから", icon("arrow-right")),
        h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm", onclick: dismissOffer }, "新しく相談する")));
  }

  /** カードより前の1つ（吹き出し・安全のカード）と、待っている問の選択肢・「読み取ったことを直す」 */
  function preItem(x, i) {
    const key = `p${x.id}`;
    const pend = S.prePend && S.prePend.n === i ? S.prePend : null;
    if (x.who === "safety") {
      const { card } = M.buildSafetyCard({ text: S.text, safety: S.read?.safety ?? undefined });
      return li(key, "safety", "a-cs-thread-card a-ch-safety", card.headline, safetyCardView(card),
        pend?.type === "safetyCard" ? opts(chip(T.continue, continuePre)) : null);
    }
    if (x.who !== "me" && x.who !== "app") return null;
    const extra = [];
    if (pend?.type === "safety") {
      extra.push(opts(SAFETY_OPTS.map(([k, label]) => chip(label, () => safetyPick(k, label), k === "stop" ? "a-ch-stop" : null))),
        safetyLine(M.safetyLineResources(S.read?.safety ?? {}), "すぐに話したいとき"));
    } else if (pend?.type === "deep") {
      extra.push(opts(chip(T.deepSkip, skipDeep)));
    } else if (pend?.type === "ask") {
      extra.push(askOptions(pend.q));
    }
    if (i === S.acceptN && !S.model && !["safety", "safetyCard"].includes(S.prePend?.type)) extra.push(fixView());
    return msg(key, x, extra);
  }
  /** 足りない問の選択肢（今の viewAsk と同じ：primary の数だけ先に、残りは「ほかの選択肢」） */
  function askOptions(q) {
    const answer = (o) => chip(o.label, () => answerAsk(o));
    const first = q.primary ? q.options.slice(0, q.primary) : q.options;
    const rest = q.primary ? q.options.slice(q.primary) : [];
    const more = h("div", { class: "a-cs-chip-row", id: "a-ch-more-options", hidden: true }, rest.map(answer));
    const moreBtn = rest.length ? h("button", { type: "button", class: "a-link a-link-tap a-cs-toggle", "aria-expanded": "false", "aria-controls": "a-ch-more-options" },
      h("span", null, q.moreLabel || "ほかの選択肢"), icon("chevron-down", { size: 16 })) : null;
    moreBtn?.addEventListener("click", () => { more.hidden = false; moreBtn.remove(); more.querySelector("button")?.focus(); });
    return h("div", { class: "a-cs-msg-opts a-ch-opts is-group" },
      h("div", { class: "a-cs-chip-row" }, first.map(answer)),
      moreBtn, rest.length ? more : null);
  }
  /** 「読み取ったことを直す」（今の viewRead の「ちがうところを直す」と同じチップ。カードが出たあとは出さない） */
  function fixView() {
    const k = readKnown();
    const chips = fixChips(k);
    const weak = chips.some(c => c.weak);
    const panel = h("div", { class: "a-cs-fix-panel", id: "a-ch-fix-panel", hidden: !S.fixOpen },
      h("p", { class: "a-note" }, weak ? "点線のところは、読み取りが確かではありません。押して確かめてください。" : "押すと、選び直せます。"),
      chipList(chips));
    const btn = h("button", { type: "button", class: "a-link a-link-tap a-cs-toggle a-ch-fix-btn", "aria-expanded": String(S.fixOpen), "aria-controls": "a-ch-fix-panel" },
      h("span", null, T.fix), icon("chevron-down", { size: 16 }));
    btn.addEventListener("click", () => {
      S.fixOpen = !S.fixOpen;
      S.editing = null;
      paint();
      mainSlot.querySelector(".a-ch-fix-btn")?.focus({ preventScroll: true });
    });
    return h("div", { class: "a-cs-fix a-ch-fix" }, btn, panel);
  }
  function fixChips(k) {
    const all = M.readChips(S.read, k, S.edits);
    const facts = all.filter(c => M.FACT_KEYS.includes(c.key));
    const low = new Set([...(S.read?.lowConfidence || []), ...(S.read?.conflicts || [])]);
    const feel = [];
    const temp = all.find(c => c.key === "selfTemp");
    feel.push(temp || { key: "selfTemp", value: undefined, text: "いまの気持ちを選ぶ", evidence: null, weak: false, empty: true });
    const wt = M.wantChipText(k);
    feel.push({ key: "want", value: M.knownWantKey(k), text: wt || "どうしたいかを選ぶ", evidence: S.read?.evidence?.intent ?? S.read?.evidence?.goal ?? null,
      weak: !("intent" in S.edits || "goal" in S.edits) && (low.has("intent") || low.has("goal")), empty: !wt });
    const cause = all.find(c => c.key === "cause");
    if (cause) feel.push(cause);
    return [...facts, ...feel];
  }
  function chipList(chips) {
    const wrapEl = h("div", { class: "a-cs-chips", role: "list" });
    for (const c of chips) {
      const open = S.editing === c.key;
      const panelId = `a-ch-edit-${c.key}`;
      wrapEl.append(h("div", { role: "listitem", class: "a-cs-chip-item" },
        h("button", {
          type: "button", class: ["a-cs-chip", c.weak && "is-weak", c.empty && "is-quiet"], "aria-expanded": String(open), "aria-controls": open ? panelId : null, "data-chip": c.key,
          onclick: () => { S.editing = open ? null : c.key; paint(); mainSlot.querySelector(`[data-chip="${c.key}"]`)?.focus({ preventScroll: true }); },
        }, h("span", null, c.text), c.weak ? h("span", { class: "a-cs-chip-flag" }, "たしかめて") : null, icon("chevron-down", { size: 16 }))));
      if (open) wrapEl.append(editPanel(c, panelId));
    }
    return wrapEl;
  }
  function editPanel(c, id) {
    const pick = (v) => { S.edits = { ...S.edits, [c.key]: v }; afterEdit(c.key); };
    const isWant = c.key === "want";
    const optsList = isWant ? M.WANTS.map(w => [w.key, w.label]) : M.fieldOptions(c.key);
    const choose = isWant ? (v) => { S.edits = { ...S.edits, ...M.wantPatch(v, {}, { full: true }), want: v }; afterEdit(c.key); } : pick;
    const forget = isWant ? () => { S.edits = { ...S.edits, intent: null, goal: null, want: null }; afterEdit(c.key); } : () => pick(null);
    const name = isWant ? "どうしたい？" : M.FIELD_NAMES[c.key];
    return h("div", { class: "a-cs-edit", id, role: "group", "aria-label": `${name}を直す` },
      c.evidence ? h("p", { class: "a-note" }, `「${c.evidence}」から読み取りました`) : null,
      h("p", { class: "a-cs-edit-q" }, name),
      h("div", { class: "a-cs-chip-row" },
        optsList.map(([v, label]) => {
          const on = c.value === v;
          return h("button", { type: "button", class: "a-cs-chip", "aria-pressed": String(on), onclick: () => choose(v) }, on ? icon("check", { size: 16 }) : null, label);
        }),
        h("button", { type: "button", class: "a-cs-chip is-quiet", onclick: forget }, "分からない（あとで聞く）")));
  }

  /** カードと続きのやりとり（今の consult.js の threadView と同じ。いちばん新しいカードだけ動く、前のカードはたたむ） */
  function fuItems(list) {
    const items = thread();
    const lastCard = items.map(x => x.who).lastIndexOf("card");
    const pend = S.fu.pending;
    items.forEach((x, i) => {
      const key = `t${i}`;
      if (x.who === "card") {
        if (i === lastCard) list.append(liveItem(key, i));
        else {
          const v = pastCardView(x.card, x.at);
          if (v) list.append(li(key, "card", "a-cs-thread-card", null, v));
        }
        return;
      }
      if (x.who !== "me" && x.who !== "app") return;
      list.append(msg(key, x, pend && pend.n === i && !S.fu.ended ? pendingView(pend) : null));
    });
  }
  function liveItem(key, i) {
    const m = S.model;
    const card = liveCard(m, {
      now: S.now, fresh: S.fresh, timers,
      onWant: (p) => { S.extra = { ...S.extra, ...p }; rebuildCard(); },
      onRefine: (p) => { S.extra = applyPatch(S.extra, p); rebuildCard(); },
    });
    S.fresh = false;
    card.id = "a-ch-live-card";
    const short = effStyle() === "short" && m.mode !== "safety";
    if (short && !S.shortOpen) card.classList.add("a-ch-short");
    const more = h("button", { type: "button", class: "a-link a-link-tap a-cs-toggle a-ch-more", "aria-expanded": String(S.shortOpen), "aria-controls": "a-ch-live-card", hidden: !short },
      h("span", null, T.more), icon("chevron-down", { size: 16 }));
    more.addEventListener("click", toggleShort);
    const firstOnly = i === 0 && thread().length === 1 && !S.resumed;
    const first = firstOnly ? h("div", { class: "a-ch-first" },
      S.record.id ? h("p", { class: "a-note" }, "このカードは履歴に残しました（この端末の中だけ）。") : null,
      h("div", { class: "a-ch-style-line" },
        h("span", { class: "a-ch-mini" }, T.styleLead),
        chip(T.shorter, () => setStyle("short"), "a-ch-small-chip"),
        chip(T.listen, () => { setStyle("deep"); pickMode("talk"); }, "a-ch-small-chip"))) : null;
    const say = m.mode === "safety" ? m.card?.headline : `次の一手：${m.headline}`;
    return li(key, "card", "a-cs-thread-card is-live", say, card, h("div", { class: "a-ch-card-foot" }, more, first));
  }
  /** 待っている問の選択肢（今の consult.js の pendingView と同じ） */
  function pendingView(p) {
    const left = S.fu.turns < F.MAX_TURNS;
    if (p.type === "sent") {
      return opts(
        left ? chip("返事が来た", () => pickMode("reply")) : null,
        chip("まだ来ない", doNoReply),
        left ? chip("もう少し話したい", () => pickMode("talk")) : null);
    }
    if (p.type === "elapsed") {
      const cur = S.fu.known.elapsed;
      return h("div", { class: "a-cs-msg-opts a-ch-opts is-group", role: "group", "aria-label": "最後のやりとりから" },
        h("p", { class: "a-note" }, "ちがうときは選び直せます"),
        h("div", { class: "a-cs-chip-row" }, F.editOptions("elapsed").map(([v, label]) =>
          h("button", { type: "button", class: "a-cs-chip", "aria-pressed": String(v === cur), onclick: () => { if (v !== cur) pickElapsed(v); } }, v === cur ? icon("check", { size: 16 }) : null, label))));
    }
    if (p.type === "replyKind") {
      return h("div", { class: "a-cs-msg-opts a-ch-opts is-group", role: "group", "aria-label": F.REPLY_KIND_QUESTION.text },
        h("div", { class: "a-cs-chip-row" }, F.REPLY_KIND_QUESTION.options.map(o => chip(o.label, () => answerReplyKind(o)))));
    }
    if (p.type === "talkQ") {
      return h("div", { class: "a-cs-msg-opts a-ch-opts is-group", role: "group", "aria-label": p.q.text },
        h("div", { class: "a-cs-chip-row" }, p.q.options.map(o => chip(o.label, () => answerTalk(o)))),
        h("button", { type: "button", class: "a-link a-link-tap a-cs-skip", onclick: () => answerTalk(null) }, "答えずに進む"));
    }
    return null;
  }

  /** やりとりの後ろの、記録に残さない物：続きの安全の確認・「どうなった？」・上限・終えたあと（窓口の1行・診断の案内） */
  function tailItems(list) {
    const fu = S.fu;
    const p = S.pendingInput;
    if (fu && p) {
      list.append(msg("x-sme", p.type === "reply" ? { who: "me", label: "相手から来た返事", text: p.text, quote: true } : { who: "me", text: p.text }));
      list.append(msg("x-sq", { who: "app", text: `${SAFETY_Q}\n${p.type === "reply" ? SAFETY_SUB.reply : SAFETY_SUB.text}` },
        S.fuSafetyCard ? null : [
          opts(SAFETY_OPTS.map(([k, label]) => chip(label, k === "stop" ? fuSafetyStop : continueAfterSafety, k === "stop" ? "a-ch-stop" : null))),
          safetyLine(M.safetyLineResources(curSafety() ?? {}), "すぐに話したいとき")]));
      if (S.fuSafetyCard) {
        list.append(msg("x-sstop", { who: "me", text: SAFETY_OPTS[0][1] }));
        const { card } = M.buildSafetyCard({ text: S.text, safety: curSafety() ?? undefined });
        list.append(li("x-scard", "safety", "a-cs-thread-card a-ch-safety", card.headline, safetyCardView(card), opts(chip(T.continue, continueAfterSafety))));
      }
    }
    if (fu && !fu.ended && S.composer === "end") {
      list.append(msg("x-end", { who: "app", text: "どうなった？" },
        h("div", { class: "a-cs-msg-opts a-ch-opts is-group" },
          h("p", { class: "a-note" }, "答えなくても大丈夫です。この相談は履歴に残ります。"),
          h("div", { class: "a-cs-chip-row" }, F.OUTCOMES.map(o => chip(o.label, () => finishEnd(o.key)))),
          h("div", { class: "a-ch-row" },
            h("button", { type: "button", class: "a-link a-link-tap", onclick: cancelEnd }, "まだ続ける"),
            h("button", { type: "button", class: "a-link a-link-tap", onclick: () => finishEnd(null) }, "答えずに終える")))));
    } else if (atLimit()) {
      list.append(msg("x-limit", { who: "app", label: F.TEXTS.limit, text: `1回の相談で続けられるのは${F.MAX_TURNS}回までです。続きは、新しい相談で書いてください。` }));
    }
    if (fu?.ended) {
      if (fu.outcome === "worse") list.append(li("x-worse", "app", "a-ch-line", null, safetyLine(M.safetyLineResources(fu.safety), "危ないときは")));
      if (S.invite) {
        list.append(msg("x-invite", { who: "app", text: T.invite },
          h("div", { class: "a-cs-msg-opts" }, h("a", { class: "a-btn a-btn-outline a-btn-sm", href: "#diagnose" }, T.inviteBtn, icon("arrow-right")))));
      }
    }
  }

  /** (a) 上の帯：「いまの一手」（押すとカードへ）と「いまの状況」（たたむと1行） */
  function bandView() {
    const m = S.model;
    const head = m.mode === "safety" ? T.nowSafety : m.headline;
    const now = h("button", { type: "button", class: "a-ch-now" },
      h("span", { class: "a-ch-now-label" }, T.nowLabel),
      h("span", { class: "a-ch-now-text" }, head));
    now.addEventListener("click", () => {
      const el = mainSlot.querySelector(".is-live .a-cs-headline");
      if (!el) return;
      el.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
      el.focus({ preventScroll: true });
    });
    const { toggle, panel } = statusBand();
    return h("section", { class: "a-ch-band", "aria-label": T.nowLabel }, h("div", { class: "a-ch-band-row" }, now, toggle), panel);
  }
  /** 帯の右の小さな開け閉め（見える文字は「状況」、読み上げは「いまの状況」）と、開くと帯の下に出る「いまの状況」の3行・［ちがうところがある］ */
  function statusBand() {
    const lines = F.statusLines(S.fu.known);
    const panel = h("div", { class: "a-cs-status-panel a-ch-status-panel", id: "a-ch-status-panel", role: "group", "aria-label": "いまの状況", hidden: !S.statusOpen },
      h("ul", { class: "a-cs-status-lines" }, lines.map(t => h("li", null, t))),
      statusEditor());
    const toggle = h("button", { type: "button", class: "a-ch-st-btn", "aria-label": "いまの状況", "aria-expanded": String(S.statusOpen), "aria-controls": "a-ch-status-panel" },
      h("span", { "aria-hidden": "true" }, "状況"), icon("chevron-down", { size: 16 }));
    toggle.addEventListener("click", () => {
      S.statusOpen = !S.statusOpen;
      panel.hidden = !S.statusOpen;
      toggle.setAttribute("aria-expanded", String(S.statusOpen));
    });
    return { toggle, panel };
  }
  function statusEditor() {
    const id = "a-ch-status-edit";
    const box = h("div", { class: "a-cs-status-edit", id, hidden: true },
      h("p", { class: "a-note" }, "直したい項目を押して、選び直してください。直すと、一手を考え直します。"));
    let openKey = null;
    const rows = h("div", { class: "a-cs-chips", role: "list" });
    const draw = () => {
      rows.replaceChildren();
      for (const key of F.EDIT_KEYS) {
        const cur = S.fu.known[key];
        const open = openKey === key;
        const pid = `a-ch-st-${key}`;
        const b = h("button", { type: "button", class: "a-cs-chip", "aria-expanded": String(open), "aria-controls": open ? pid : null, "data-st": key },
          h("span", null, `${F.editName(key)}：${F.valueLabel(key, cur)}`), icon("chevron-down", { size: 16 }));
        b.addEventListener("click", () => { openKey = open ? null : key; draw(); rows.querySelector(`[data-st="${key}"]`)?.focus(); });
        rows.append(h("div", { role: "listitem", class: "a-cs-chip-item" }, b));
        if (open) {
          rows.append(h("div", { class: "a-cs-edit", id: pid, role: "group", "aria-label": `${F.editName(key)}を直す` },
            h("p", { class: "a-cs-edit-q" }, F.editName(key)),
            h("div", { class: "a-cs-chip-row" },
              F.editOptions(key).map(([v, label]) => h("button", { type: "button", class: "a-cs-chip", "aria-pressed": String(cur === v), onclick: () => { if (cur !== v) editStatus(key, v); else { openKey = null; draw(); } } },
                cur === v ? icon("check", { size: 16 }) : null, label)),
              cur !== undefined ? h("button", { type: "button", class: "a-cs-chip is-quiet", onclick: () => editStatus(key, null) }, "分からない") : null)));
        }
      }
    };
    draw();
    box.append(rows);
    const toggle = h("button", { type: "button", class: "a-link a-link-tap a-cs-toggle", "aria-expanded": "false", "aria-controls": id }, h("span", null, "ちがうところがある"), icon("chevron-down", { size: 16 }));
    toggle.addEventListener("click", () => {
      box.hidden = !box.hidden;
      toggle.setAttribute("aria-expanded", String(!box.hidden));
      if (!box.hidden) box.querySelector("button")?.focus();
    });
    return h("div", { class: "a-cs-status-fix" }, toggle, box);
  }

  /** 下の欄（返し方と診断・文を直す欄・相手の返事を貼っています・ボタンの列・書く欄・小さな1行） */
  function paintDock() {
    if (S.panel === "draft" && !canEditDraft()) S.panel = null;
    const cs = composeState();
    panelSlot.replaceChildren(...(S.panel === "settings" ? [settingsPanel()] : S.panel === "draft" ? [draftPanel()] : []));
    modeSlot.replaceChildren(...(cs.show && cs.enabled && S.model && S.mode === "reply"
      ? [h("div", { class: "a-ch-modebar" }, h("span", null, T.pasting), h("button", { type: "button", class: "a-link a-link-tap", onclick: cancelReply }, "やめる"))]
      : []));
    actsSlot.replaceChildren(...actsView());
    composeRow.hidden = !cs.show;
    ta.disabled = !cs.show || !cs.enabled;
    ta.placeholder = cs.ph;
    ta.setAttribute("aria-label", cs.name);
    if (!S.model) ta.setAttribute("aria-describedby", "a-ch-privacy"); else ta.removeAttribute("aria-describedby");
    footSlot.replaceChildren(...footView());
    syncSend();
    fit();
  }
  function actBtn(ic, text, onClick, act, expanded = null) {
    return h("button", { type: "button", class: "a-ch-act", "data-act": act, "aria-expanded": expanded == null ? null : String(expanded), "aria-controls": expanded ? "a-ch-draft" : null, onclick: onClick },
      icon(ic, { size: 18 }), h("span", null, text));
  }
  function actsView() {
    const fu = S.fu;
    if (!fu || !S.model) return [];
    if (fu.ended) {
      return [h("div", { class: "a-ch-acts is-end" },
        h("button", { type: "button", class: "a-btn a-btn-sm", onclick: startNew }, "新しく相談する", icon("arrow-right")),
        h("a", { class: "a-link a-link-tap", href: "#history" }, "履歴を見る"))];
    }
    // 「どうなった？」を出している間と、上に欄（返し方と診断・送る一文を直す）を開いている間は出さない（狭い画面で欄の場所をあける）
    if (S.composer === "end" || S.panel) return [];
    if (atLimit()) return [h("div", { class: "a-ch-acts is-end" }, h("button", { type: "button", class: "a-btn a-btn-sm", onclick: startNew }, "新しく相談する", icon("arrow-right")))];
    const pend = fu.pending?.type;
    if (S.pendingInput || WAIT_PENDS.includes(pend)) return [];
    return [h("div", { class: "a-ch-acts", role: "group", "aria-label": "続きの相談" },
      actBtn("copy", "相手の返事を貼る", () => pickMode("reply"), "reply"),
      actBtn("check", "送った", doSent, "sent"),
      actBtn("chat", "もう少し話したい", () => pickMode("talk"), "talk"),
      canEditDraft() ? actBtn("pencil", T.editDraft, () => togglePanel("draft"), "draft", S.panel === "draft") : null)];
  }
  function footView() {
    const set = h("button", { type: "button", class: "a-link a-link-tap a-ch-set", "aria-expanded": String(S.panel === "settings"), "aria-controls": S.panel === "settings" ? "a-ch-settings" : null, onclick: () => togglePanel("settings") },
      T.settings, h("span", { class: "a-ch-cur" }, `・${L.styleLabel(S.style, effStyle())}`));
    if (!S.model) return [h("div", { class: "a-ch-foot" }, h("p", { class: "a-ch-privacy", id: "a-ch-privacy" }, T.privacy), set)];
    if (!S.fu || S.fu.ended) return [];
    const left = Math.max(0, F.MAX_TURNS - S.fu.turns);
    // 安全の確認に答えるまでは「相談を終える」を出さない（今の consult.js でも、安全の確認の画面には無い）
    return [h("div", { class: "a-ch-foot is-meta" },
      h("span", { class: "a-ch-left" }, `あと${left}回`),
      set,
      S.pendingInput ? null : h("button", { type: "button", class: "a-link a-link-tap a-ch-end", onclick: openEnd }, "相談を終える"))];
  }

  // ---------------------------------------------------------------- 開いたとき：読み込み直したなら続きから。そうでなければ、続きがあれば「前の相談の続き」
  const activeId = activeStore.get();
  const active = activeId ? getRecord(activeId) : null;
  if (F.resumable(active)) {
    try { resume(active); } catch (err) { console.error(err); activeStore.set(null); paint({ initial: true }); }
  } else {
    activeStore.set(null);
    S.offer = latestResumable();
    paint({ initial: true });
  }
  return () => {
    clearInterval(tick);
    timers.clear();
    ro?.disconnect();
    window.removeEventListener("popstate", onPop);
    activeStore.set(null);
  };
}
