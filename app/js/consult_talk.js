// 相談（#consult）の「ふつうのチャット」の形（既定。決定 U56）。ボタンつきのチャットは app/js/consult_chat.js（?cv=chat）、段階ごとの画面は app/js/consult.js（?cv=card）。
//   切り替えは app/js/consult_version.js。DOM の無い部分は app/js/consult_talk_logic.js、見た目は app/css/consult_talk.css（クラスは a-tk-）。
//
//   ChatGPT や Claude のような会話の形：やりとりを1本の列にし（自分＝右・アプリ＝左の吹き出し。絵なし）、下に固定の書く欄。選ぶボタンは出さない。
//     残すボタンは、危ない兆しの確かめ［今、危ない］［大丈夫、続ける］［昔の話・人の話］だけ（今と同じ）。
//   上の帯は「いまの状況」の3行だけ（やりとり・時間・気持ち。consult_chat_logic.js の statusRows。最初の文を読んだ直後から、やりとりのたびに変わる。「たたむ」で1行目だけに）。
//   返事は今の規則と決まった文だけ（AI なし）：読み取り readText →（兆しがあれば）安全の確かめ → 受け止め（M.acceptText）
//     → 足りない問を文で（nextQuestion。多くて3つ：決定 U14。答えは matchAnswer で当てはめ、だめなら1回だけ聞き直し、それでもだめなら分からないまま）
//     → 一手を吹き出しの文章で（M.buildPoc → L.moveText。カードは出さない）→ 往復（10回まで。書いた文を L.classifyFollow で分ける：
//       「」があれば相手の返事・送った・まだ来ない・それ以外はもう少し話したい。中身は app/js/consult_followup.js と同じ）。
//   診断の結果（app/js/diagnosis_version.js の currentStatus）が終わっていれば、黙って本人の8領域として判定に渡す（切り替え・印は出さない）。
//   端末の外には何も送らない。最初の文の書きかけだけ localStorage に残す（使えなくても動く）。一手が出たら履歴に1件（app/js/local.js）。
//   記録の形は consult_chat.js と同じ（kind "consult"・data.v 2・text・accept・card・input・extra・fu）＋ data.talk（やりとりの列と、文で答えるのを待っている問）。
//     履歴の詳細は今の savedView のまま出る。?cv=chat・?cv=card で開いても続きになる。安全の確かめの吹き出し・安全のカードは残さない（今の決まり）
//
// 上の「←」は前の画面へ。上の「新しく相談」は今の相談を閉じて（履歴には残る）始める前へ。上の「危ないときは」は安全のカードを出す（「←」か端末の「戻る」でやりとりへ）
import { h, icon, topBar, goBack, fmtDate } from "./ui.js";
import { addRecord, removeRecord, getRecord, loadRecords } from "./local.js";
import { readText } from "../../js/consult/extract.js";
import { nextQuestion, applyAnswer } from "../../js/consult/needed.js";
import { isLateNight } from "../../js/consult/timefmt.js";
import * as M from "../../poc/card/model.js";
import * as F from "./consult_followup.js";
import { safetyCardView, safetyLine, snapshotOf, savedView, bubbleView, copyText } from "./consult_card.js";
import { currentStatus } from "./diagnosis_version.js";
import { statusRows, selfFromStatus, hasSide, joinConsult, preFrom } from "./consult_chat_logic.js";
import * as L from "./consult_talk_logic.js";

const T = L.TALK_TEXTS;
const MAX_CHARS = L.MAX_CHARS;
const DRAFT_KEY = "seikaku16:app:consult-draft";       // 今の consult.js・consult_chat.js と同じ（最初の相談の文の書きかけ）
const ACTIVE_KEY = "seikaku16:app:consult-active";     // 今と同じ（読み込み直したときに続きから）
const TITLE_CHARS = 32;
const STATUS_ID = "a-tk-status";
// 安全の確かめ（今の consult.js・consult_chat.js と同じ文）
const SAFETY_Q = "いま、身の危険や強い怖さを感じていますか？";
const SAFETY_SUB = "書いてくれた文の中に、気になる言葉がありました。答えに合わせて、このあとを変えます。";
const SAFETY_OPTS = [["stop", "今、危ない"], ["ok", "大丈夫、続ける"], ["other", "昔の話・人の話"]];
// 書く欄（今の consult.js の文）
const PH = "ここに自由に入力してください…";
const WAIT_Q = "上の問いに答えると、一手を考え直します。";
const NAME = "相談内容";
const ANSWER_PENDS = ["replyKind", "talkQ"];

const draftStore = {
  get() { try { return localStorage.getItem(DRAFT_KEY) ?? ""; } catch { return ""; } },
  set(v) { try { if (v) localStorage.setItem(DRAFT_KEY, v); else localStorage.removeItem(DRAFT_KEY); } catch { /* 使えない */ } },
};
const activeStore = {
  get() { try { return sessionStorage.getItem(ACTIVE_KEY); } catch { return null; } },
  set(v) { try { if (v) sessionStorage.setItem(ACTIVE_KEY, v); else sessionStorage.removeItem(ACTIVE_KEY); } catch { /* 使えない */ } },
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const media = (q) => { try { return window.matchMedia(q).matches; } catch { return false; } };
const reduceMotion = () => media("(prefers-reduced-motion: reduce)");
/** 指で触る端末（書く欄に焦点を移すとキーボードが足した物を隠すので、そのときは足した吹き出しへ） */
const coarse = () => media("(pointer: coarse)");
const clip = (raw) => String(raw || "").trim().slice(0, MAX_CHARS);

/** 履歴の題：書いた文の冒頭（今の consult.js と同じ） */
export function titleOf(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(t);
  return chars.length > TITLE_CHARS ? `${chars.slice(0, TITLE_CHARS).join("")}…` : t;
}

/** 履歴の詳細で出す「そのときのカード」とやりとり（今の savedView。この形の吹き出しの列は出さない） */
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
  try { return selfFromStatus(currentStatus()); } catch { return null; }
}

export function render(root) {
  const fresh0 = () => ({
    view: "chat",          // "chat" | "safetycard"（上の「危ないときは」）
    text: "",              // 相談の文（あとから書いた文は改行でつなぐ）
    read: null,            // readText の結果（相談の文）
    lateNight: false,
    answers: [],           // 足りない問の答え [{ q, patch, label }]（分からないままのときは patch {}）
    extra: {},
    safetyContinue: false,
    tk: [],                // やりとりの列 [{ id, who: "me"|"app"|"safety", text, at, label?, quote?, check?, move?, draft?, lead?, safetyLine?, sf?, old? }]
    pend: null,            // 文（か安全の確かめのボタン）で答えるのを待っているもの { type: "ask"|"replyKind"|"talkQ"|"safety"|"safetyCard", ... }
    model: null, cardInput: null, accept: "", now: null,
    record: { id: null, at: null, text: null },
    fu: null,
    offer: null,
    bandCollapsed: false,  // 上の帯をたたんだか（この相談の間だけ。新しい相談・読み込み直しでは開いた形）
    scrollY: 0,
  });
  const S = { ...fresh0(), self: diagnosisSelf(), seen: new Set() };
  let seq = 0;
  const nid = () => ++seq;

  // ---------------------------------------------------------------- 骨組み（上の題・帯・やりとり・下に固定の書く欄）
  const topSlot = h("div", { class: "a-tk-top-slot" });
  const bandSlot = h("div", { class: "a-tk-band-slot" });
  const mainSlot = h("div", { class: "a-tk-body" });
  const announcer = h("p", { class: "a-sr", "aria-live": "polite" });
  const footSlot = h("div", { class: "a-tk-slot" });
  const ta = h("textarea", { id: "a-tk-input", class: "a-textarea a-tk-input", rows: "1", maxlength: String(MAX_CHARS), enterkeyhint: "enter" });
  const sendBtn = h("button", { type: "button", class: "a-tk-send", "aria-label": T.send, disabled: true }, icon("arrow-right"));
  const composeRow = h("div", { class: "a-tk-compose" }, ta, sendBtn);
  const dock = h("div", { class: "a-tk-dock" }, h("div", { class: "a-tk-dock-in" }, composeRow, footSlot));
  const wrap = h("div", { class: "a-cs a-tk" }, topSlot, bandSlot, mainSlot, announcer, dock);
  root.replaceChildren(wrap);

  ta.value = draftStore.get().slice(0, MAX_CHARS);
  ta.addEventListener("input", () => { fit(); syncSend(); if (!S.text) draftStore.set(ta.value); });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener("click", send);

  // 下の欄・上の帯の高さを CSS の変数に（やりとりの下の余白・動かしたときに帯で隠れない余白・帯の高さの上限）
  function sizeVars() {
    wrap.style.setProperty("--a-tk-dock-h", `${Math.ceil(dock.hidden ? 0 : dock.getBoundingClientRect().height)}px`);
    const b = bandSlot.firstElementChild;
    wrap.style.setProperty("--a-tk-band-h", `${b ? Math.ceil(b.getBoundingClientRect().height) : 0}px`);
    wrap.style.setProperty("--a-tk-band-y0", `${Math.max(0, Math.ceil(topSlot.getBoundingClientRect().bottom + window.scrollY))}px`);
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(sizeVars) : null;
  ro?.observe(dock);
  ro?.observe(bandSlot);
  ro?.observe(topSlot);

  /** 書く欄の高さ（1行から6行くらいまで。上限は CSS の max-height） */
  function fit() {
    ta.style.height = "auto";
    if (ta.scrollHeight) ta.style.height = `${ta.scrollHeight + 2}px`;
  }
  function setInput(v) { ta.value = v; fit(); syncSend(); }
  function syncSend() { sendBtn.disabled = !ta.value.trim() || ta.disabled; }

  // ---------------------------------------------------------------- 端末の「戻る」（安全のカードを出している間だけ、同じ URL の印を1つ積む。今の consult_chat.js と同じ）
  let guarded = false, ignorePop = false, leaving = false;
  const startedOnGuard = !!history.state?.aTkGuard;
  function pushGuard() {
    if (guarded) return;
    try { history.pushState({ ...(history.state && typeof history.state === "object" ? history.state : {}), aTkGuard: true }, ""); guarded = true; } catch { /* 使えない */ }
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
    if (startedOnGuard && history.state?.aTkGuard) { leaving = true; history.back(); return; }
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
    root.querySelector(".a-tk-view [data-focus]")?.focus({ preventScroll: true });
  }
  function closeSafetyView(drop = true) {
    S.view = "chat";
    if (drop) dropGuard();
    paint();
    window.scrollTo(0, S.scrollY || 0);
    root.querySelector(".a-cs-danger")?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- やりとりの列に足す
  /**
   * 吹き出しを1つ足す（画面の列 S.tk）。一手のあと（S.fu があるとき）は、安全の確かめ（sf）でない自分・アプリの吹き出しを
   * 今の記録のやりとり（fu.thread。履歴の詳細・?cv=chat・?cv=card が読む）にも同じ形で足す。足した位置（S.tk の番号）を返す
   */
  function say(item) {
    const at = new Date().toISOString();
    S.tk.push({ id: nid(), at, ...item });
    if (S.fu && !item.sf && !item.move && (item.who === "me" || item.who === "app")) fuPush(S.tk[S.tk.length - 1]);
    return S.tk.length - 1;
  }
  function fuPush(x) {
    const o = { who: x.who, text: x.text, at: x.at || new Date().toISOString() };
    if (x.label) o.label = x.label;
    if (x.check) o.check = x.check;
    S.fu.thread.push(o);
  }
  const fuLast = () => S.fu.thread.length - 1;
  /** 一手の吹き出し（lead：前に置く1文。一手が変わったときの「考え直しました」）。安全のモードは安全のカードを置く */
  function sayMove(m, lead = null) {
    const mt = L.moveText(m);
    if (mt.safety) { say({ who: "safety", sf: true, card: m.card }); return; }
    const text = lead ? `${lead}\n${mt.text}` : mt.text;
    say({ who: "app", text, move: mt.parts, draft: mt.draft, safetyLine: mt.safetyLine, lead });
  }

  // ---------------------------------------------------------------- 一手の前（読み取り・安全の確かめ・受け止め・足りない問。中身は今の consult_chat.js と同じ）
  function known() {
    const k = M.knownFrom(S.read?.fields, {}, S.answers.map(a => a.patch), { lateNight: S.lateNight });
    delete k.want;
    return k;
  }
  const readKnown = () => M.knownFrom(S.read?.fields, {});
  const selfArg = () => (S.self ? S.self : undefined);
  function setRead() { S.read = readText(S.text); }
  /** 相談の文に、あとから書いた文をつないで読み直す（今の joinConsult と同じ） */
  function joinRead(texts) {
    for (const t of texts) S.text = joinConsult(S.text, t);
    S.record = { id: null, at: null, text: S.text };
    setRead();
    draftStore.set(S.text);
  }

  /** 最初の1回：相談を始める */
  function startTalk(text) {
    Object.assign(S, fresh0(), { self: S.self, seen: S.seen });
    S.text = text;
    S.record = { id: null, at: null, text };
    S.lateNight = isLateNight(new Date());
    say({ who: "me", text });
    setRead();
    draftStore.set(text);
    afterRead();
  }
  /** 一手の前にもう一度書いた（安全の確かめを待っている間・安全のカードのあと）：相談の文につないで読み直す */
  function appendConsult(text) {
    say({ who: "me", text });
    joinRead([text]);
    afterRead();
  }
  function afterRead() {
    if (M.hasSafetySign(S.read) && !S.safetyContinue) { askSafety("pre", null, S.read.safety); return; }
    pushAccept();
    askOrMove();
  }
  function pushAccept() {
    say({ who: "app", text: M.acceptText({ known: readKnown(), text: S.text, evidence: S.read?.evidence || {}, safetyContinue: S.safetyContinue }) });
  }
  /** 足りない問があれば文で聞く（答え方の例を1行）。無ければ一手 */
  function askOrMove() {
    const q = nextQuestion(known(), S.answers.map(a => a.q));
    if (q) {
      const n = say({ who: "app", text: `${q.text}\n${L.exampleLine(q)}` });
      S.pend = { type: "ask", q, tries: 0, failed: [], n };
      return;
    }
    S.pend = null;
    buildMove();
  }
  /** 足りない問への答え（文）：当てはまれば次へ。だめなら1回だけ聞き直し、2回目もだめなら分からないまま次へ（書いた文は相談の文につないで読み直す） */
  function answerPre(text) {
    const p = S.pend;
    const q = p.q;
    say({ who: "me", text });
    const sign = M.hasSafetySign(readText(text)) && !S.safetyContinue;
    const hit = L.matchAnswer(q, text);
    if (hit) {
      S.answers.push({ q, patch: hit.patch, label: hit.label });
      S.pend = null;
      if (sign) { joinRead([text]); askSafety("pre", null, S.read.safety); return; }
      askOrMove();
      return;
    }
    if (!sign && !p.tries) {
      p.tries = 1;
      p.failed = [text];
      p.n = say({ who: "app", text: L.retryText(q) });
      return;
    }
    S.answers.push({ q, patch: {}, label: null });
    S.pend = null;
    joinRead([...(p.failed || []), text]);
    afterReadNoAccept();
  }
  function afterReadNoAccept() {
    if (M.hasSafetySign(S.read) && !S.safetyContinue) { askSafety("pre", null, S.read.safety); return; }
    askOrMove();
  }

  // ---------------------------------------------------------------- 安全の確かめ（ボタンはここだけ。今の consult_chat.js と同じ文と動き）
  /**
   * @param {"pre"|"fu"} from  一手の前か、一手のあとか
   * @param {object|null} input  一手のあと：待っている入力 { text, read, kind: "follow"|"answer", prev, tk }
   */
  function askSafety(from, input, safety) {
    const n = say({ who: "app", text: `${SAFETY_Q}\n${SAFETY_SUB}`, sf: true });
    S.pend = { type: "safety", from, n, input, safety: { selfHarm: !!safety?.selfHarm, partnerThreat: !!safety?.partnerThreat } };
  }
  function safetyPick(kind, label) {
    const p = S.pend;
    if (p?.type !== "safety") return;
    say({ who: "me", text: label, sf: true });
    if (kind === "stop") {
      const n = say({ who: "safety", sf: true, safety: p.safety });
      S.pend = { type: "safetyCard", from: p.from, n, input: p.input, safety: p.safety };
      paintNew();
      return;
    }
    if (p.from === "pre") {
      S.pend = null;
      S.safetyContinue = true;
      pushAccept();
      askOrMove();
      paintNew();
      return;
    }
    // 一手のあと：待っていた入力を続ける（自分の吹き出しは記録にも残す）
    const inp = p.input;
    S.pend = inp.prev ?? null;
    const me = S.tk[inp.tk];
    if (me) { me.sf = false; fuPush(me); }
    markSafety(inp.read.safety);
    if (inp.kind === "answer") answerFu(inp.text);
    else follow(inp.text, true);
    commit();
  }
  function markSafety(sf) {
    S.fu.safetyContinue = true;
    S.fu.safety = { selfHarm: !!(S.fu.safety?.selfHarm || sf?.selfHarm), partnerThreat: !!(S.fu.safety?.partnerThreat || sf?.partnerThreat) };
  }

  // ---------------------------------------------------------------- 一手（今の consult_chat.js の buildCard と同じ。カードの代わりに吹き出しの文章）
  function buildMove() {
    S.now = new Date();
    const k = known();
    const safety = S.read?.safety ?? null;
    S.model = M.buildPoc({ known: k, extra: S.extra, text: S.text, now: S.now, safetyContinue: S.safetyContinue, safety, self: selfArg() });
    S.cardInput = cardInputOf(k, S.extra, S.safetyContinue, safety, S.now);
    const ka = { ...k };
    delete ka.lateNight;
    S.accept = M.acceptText({ known: ka, text: S.text, evidence: S.read?.evidence || {} });
    sayMove(S.model);
    S.fu = F.newFollow({ known: k, asked: S.answers.map(a => a.q.id), safety, safetyContinue: S.safetyContinue });
    S.fu.thread = [cardItem(S.model, S.now)];
    saveRecord();
  }
  function cardInputOf(knownV, extra, safetyContinue, safety, at) {
    const ci = { known: knownV, extra: { ...extra }, safetyContinue, safety, at: at.toISOString() };
    if (S.self) ci.self = S.self;
    return ci;
  }
  const cardItem = (m, at) => ({ who: "card", at: at.toISOString(), card: snapshotOf(m), action: m.result?.action ?? null });

  /** この相談の履歴（1件だけ。差し替える）。安全のカードは残さない。形は consult_chat.js と同じ＋ data.talk */
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
        talk: { v: 1, thread: L.talkPersist(S.tk), pending: L.pendPersist(S.pend) },
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

  // ---------------------------------------------------------------- 一手のあと（往復。今の consult_chat.js と同じ動き・数え方。ボタンの代わりに書いた文で分ける）
  const canTurn = () => !!S.fu && !S.fu.ended && S.fu.turns < F.MAX_TURNS;
  const curAction = () => S.model?.result?.action ?? null;
  const atLimit = () => !!S.fu && !S.fu.ended && S.fu.turns >= F.MAX_TURNS && !ANSWER_PENDS.includes(S.pend?.type) && !["safety", "safetyCard"].includes(S.pend?.type);
  function begin() {
    const r = F.splitExtra(S.fu.known, S.extra);
    S.fu.known = r.known;
    S.extra = r.extra;
  }
  /** 判定し直す。一手（か安全の扱い）が変わったら「考え直しました」と新しい一手の文章、変わらなければ短い1文（今の settle と同じ判定） */
  function settle(now = new Date()) {
    const lateNight = isLateNight(now);
    const m = F.rejudge({ known: S.fu.known, extra: S.extra, text: S.text, now, safetyContinue: S.fu.safetyContinue, safety: S.fu.safety, lateNight, self: selfArg() });
    const changed = F.actionChanged(S.model, m);
    if (changed) {
      S.model = m;
      S.now = now;
      S.cardInput = cardInputOf({ ...S.fu.known, lateNight }, S.extra, S.fu.safetyContinue, { ...S.fu.safety }, now);
      S.fu.thread.push({ who: "app", text: T.redo, at: now.toISOString() });
      S.fu.thread.push(cardItem(m, now));
      sayMove(m, T.redo);
    } else {
      say({ who: "app", text: L.keepText(S.model) });
    }
    return changed;
  }
  function logTurn(entry, changed) {
    S.fu.log.push({ at: new Date().toISOString(), ...entry, action: curAction(), changed: !!changed });
  }
  function commit() {
    saveRecord();
    paintNew();
  }

  /** 一手のあとに書いた：安全の兆しを見てから、文の種類で分ける（待っている問があれば、その答え） */
  function fuText(text) {
    const p = S.pend;
    if (p?.type === "safety") return;
    if (p?.type === "safetyCard") {
      // ［今、危ない］のあと：書けば続く（待っていた入力は使わず、安全を優先した扱いだけ残す）
      markSafety(p.safety);
      S.pend = p.input?.kind === "answer" ? p.input.prev : null;
    }
    const answering = ANSWER_PENDS.includes(S.pend?.type);
    if (!answering && !canTurn()) return;
    const c = L.classifyFollow(text, { sent: S.fu.sent });
    const sf = readText(text).safety;
    const rs = c.quoted.length ? F.readReply(c.quoted.join(" ")).safety : null;
    const safety = { selfHarm: !!(sf.selfHarm || rs?.selfHarm), partnerThreat: !!(sf.partnerThreat || rs?.partnerThreat) };
    if (safety.selfHarm || safety.partnerThreat) {
      const tk = say({ who: "me", text, sf: true });
      askSafety("fu", { text, read: { safety }, kind: answering ? "answer" : "follow", prev: answering ? S.pend : null, tk }, safety);
      paintNew();
      return;
    }
    say({ who: "me", text });
    if (answering) answerFu(text); else follow(text, false);
    commit();
  }
  /** 待っている問がないときの1通（相手の返事・送った・まだ来ない・もう少し話したい） */
  function follow(text, safetyCont) {
    begin();
    const c = L.classifyFollow(text, { sent: S.fu.sent });
    if (c.kind === "reply") { takeReply(c); return; }
    if (c.kind === "sent") { doSent(); return; }
    if (c.kind === "noreply") { doNoReply(); return; }
    takeTalk(text, readText(text), safetyCont);
  }
  // 「」の中＝相手の返事（今の［相手の返事を貼る］と同じ）。「」の外の文も読んで状況に重ねる
  function takeReply(c) {
    S.fu.turns++;
    const qt = c.quoted.join(" ");
    if (c.rest) S.fu.known = F.mergeTalk(S.fu.known, readText(c.rest).fields);
    const rr = F.readReply(qt);
    if (!rr.kind) {
      say({ who: "app", text: `${L.REPLY_KIND_Q.text}\n${L.exampleLine(L.REPLY_KIND_Q)}` });
      S.pend = { type: "replyKind", q: L.REPLY_KIND_Q, tries: 0, text: qt };
      S.fu.pending = { type: "replyKind", n: fuLast(), text: qt };
      return;
    }
    finishReply(qt, rr.kind);
  }
  function finishReply(text, kind) {
    const check = F.checkReply(curAction(), kind);
    if (check) {
      say({ who: "app", label: T.check, text: check.text, check: check.result });
      S.fu.checks.push({ at: new Date().toISOString(), kind, result: check.result, action: curAction() });
    }
    S.fu.known = F.afterReply(S.fu.known, kind, { sent: S.fu.sent });
    const wasSent = S.fu.sent;
    S.fu.sent = false;
    const changed = settle();
    logTurn({ btn: "reply", text, kind, check: check?.result ?? null, sent: wasSent }, changed);
  }
  // 送った（今の［送った］と同じ書き換え。「どうなった？」の代わりに、続きの書き方を1文で）
  function doSent() {
    const r = F.afterSent(S.fu.known, curAction(), new Date());
    S.fu.known = r.known;
    S.fu.sentAt = r.sentAt;
    S.fu.sent = true;
    S.fu.turns++;
    S.fu.pending = null;
    say({ who: "app", text: T.sentAck });
    logTurn({ btn: "sent" }, false);
  }
  // まだ来ない（今の［まだ来ない］と同じ。送ってからの時間を入れて判定し直す）。送ったすぐあとの1回は数えない（今は［送った］の続きの選択だった）
  function doNoReply() {
    if (S.fu.log[S.fu.log.length - 1]?.btn !== "sent") S.fu.turns++;
    const now = new Date();
    const ms = S.fu.sentAt ? now.getTime() - Date.parse(S.fu.sentAt) : 0;
    S.fu.known = F.afterNoReply(S.fu.known, ms);
    say({ who: "app", text: F.sinceText(ms) });
    const changed = settle(now);
    logTurn({ btn: "noreply", elapsed: S.fu.known.elapsed }, changed);
  }
  // もう少し話したい（今の takeTalk と同じ。1問は文で聞く）
  function takeTalk(text, read, safetyCont) {
    S.fu.turns++;
    S.fu.pending = null;
    S.fu.known = F.mergeTalk(S.fu.known, read.fields);
    say({ who: "app", text: safetyCont ? M.ACCEPT_SAFETY : F.talkAccept(read, text) });
    const q = F.talkQuestion(S.fu.known, S.fu.asked, { ...S.extra, lateNight: isLateNight(new Date()) });
    if (q) {
      S.fu.asked.push(q.id);
      say({ who: "app", text: `${q.text}\n${L.exampleLine(q)}` });
      S.pend = { type: "talkQ", q, tries: 0, text };
      S.fu.pending = { type: "talkQ", n: fuLast(), q, text };
      return;
    }
    finishTalk(text, null);
  }
  function finishTalk(text, answer) {
    const changed = settle();
    logTurn({ btn: "talk", text, answer }, changed);
  }
  /** 待っている問（相手の返事の種類・もう少し話したいあとの1問）への答え。往復には数えない */
  function answerFu(text) {
    begin();
    const p = S.pend;
    const hit = L.matchAnswer(p.q, text);
    if (hit) {
      S.pend = null;
      S.fu.pending = null;
      if (p.type === "replyKind") finishReply(p.text, hit.patch.partnerLast ?? null);
      else { S.fu.known = applyAnswer(S.fu.known, hit.patch); finishTalk(p.text, hit.label); }
      return;
    }
    if (!p.tries) {
      p.tries = 1;
      say({ who: "app", text: L.retryText(p.q) });
      if (S.fu.pending) S.fu.pending.n = fuLast();
      return;
    }
    S.pend = null;
    S.fu.pending = null;
    if (p.type === "replyKind") finishReply(p.text, null); else finishTalk(p.text, null);
  }

  // ---------------------------------------------------------------- 新しく相談・前の相談の続き
  /** 上の「新しく相談」：今の相談は閉じて（履歴には残る）、始める前へ。確かめは出さない（今の consult_chat.js の startNew と同じ） */
  function startNew() {
    if (S.fu && !S.fu.ended) { S.fu.closed = true; saveRecord(); }
    else if (!S.text && S.offer) closeOffer(S.offer);
    activeStore.set(null);
    Object.assign(S, fresh0(), { self: diagnosisSelf(), seen: new Set() });
    draftStore.set("");
    setInput("");
    paint({ initial: true });
    window.scrollTo(0, 0);
    ta.focus({ preventScroll: true });
  }
  function closeOffer(rec) {
    try {
      const fresh = rec ? getRecord(rec.id) : null;
      if (fresh && F.resumable(fresh)) {
        const data = { ...fresh.data, fu: { ...fresh.data.fu, closed: true } };
        removeRecord(fresh.id);
        addRecord({ kind: "consult", at: fresh.at, title: fresh.title, sub: fresh.sub, data });
      }
    } catch (err) { console.error(err); }
  }

  /**
   * 記録から続きを開く（読み込み直したとき・前の続きに書いたとき）。この形の記録なら吹き出しの列も戻す。
   * ほかの形（?cv=chat・?cv=card）の記録は、書いた文・受け止め（チャットならカードより前のやりとり）・続きのやりとりから列を作る（カードは一手の文章に）
   */
  function resume(rec) {
    const d = rec.data;
    const ci = d.input;
    const at = new Date(ci.at);
    const now = Number.isNaN(at.getTime()) ? new Date() : at;
    const cself = ci.self && hasSide(ci.self) ? ci.self : null;
    const model = M.buildPoc({ known: ci.known || {}, extra: ci.extra || {}, text: d.text, now, safetyContinue: !!ci.safetyContinue, safety: ci.safety ?? undefined, self: cself || undefined });
    Object.assign(S, fresh0(), { seen: new Set() });
    S.self = cself;
    S.text = d.text;
    S.read = readText(d.text);
    S.accept = typeof d.accept === "string" ? d.accept : "";
    S.fu = clone(d.fu);
    for (const k of ["thread", "log", "checks", "asked"]) if (!Array.isArray(S.fu[k])) S.fu[k] = [];
    S.extra = { ...(d.extra && typeof d.extra === "object" ? d.extra : ci.extra || {}) };
    S.cardInput = clone(ci);
    S.model = model;
    S.now = now;
    S.safetyContinue = !!ci.safetyContinue;
    S.record = { id: rec.id, at: rec.at, text: d.text };
    const tk = d.talk && typeof d.talk === "object" && Array.isArray(d.talk.thread) ? L.talkFrom(d.talk.thread) : null;
    S.tk = (tk && tk.length ? tk : threadFromOther(d)).map(x => ({ ...x, id: nid(), old: true }));
    // 文で答えるのを待っている問：この形の記録ならそれ、ほかの形なら今の待ち（相手の返事の種類・1問）を文で答える形に。［送った］のあとの選択などは外す
    let pend = d.talk ? L.pendFrom(d.talk.pending) : null;
    const fp = S.fu.pending;
    if (!pend && fp && ANSWER_PENDS.includes(fp.type)) pend = L.pendFrom({ type: fp.type, q: fp.q, text: fp.text, tries: 0 });
    S.pend = pend;
    if (!pend) S.fu.pending = null;
    activeStore.set(rec.id);
  }
  function threadFromOther(d) {
    const out = [];
    const pre = d.chat && typeof d.chat === "object" ? preFrom(d.chat.pre) : [];
    if (pre.length) out.push(...pre);
    else {
      out.push({ who: "me", text: d.text, at: d.input?.at ?? null });
      if (typeof d.accept === "string" && d.accept) out.push({ who: "app", text: d.accept, at: d.input?.at ?? null });
    }
    for (const x of d.fu.thread) {
      if (!x || typeof x !== "object") continue;
      if (x.who === "card") {
        const mt = L.moveText(x.card);
        if (!mt.safety) out.push({ who: "app", text: mt.text, at: x.at ?? null, move: mt.parts, draft: mt.draft, safetyLine: mt.safetyLine });
        continue;
      }
      if ((x.who === "me" || x.who === "app") && typeof x.text === "string") {
        const o = { who: x.who, text: x.quote ? `「${x.text}」` : x.text, at: x.at ?? null };
        if (x.label) o.label = x.label;
        if (x.check) o.check = x.check;
        out.push(o);
      }
    }
    return out;
  }
  /** 前の続きがあるときに書いた：その相談の続きとして扱う */
  function continueOffer(text) {
    const rec = S.offer ? getRecord(S.offer.id) : null;
    S.offer = null;
    if (!F.resumable(rec)) return false;
    // 前の相談の往復を使い切っていれば、続きにせず新しい相談にする（前の相談は閉じる）
    if ((Number(rec.data.fu.turns) || 0) >= F.MAX_TURNS) { closeOffer(rec); return false; }
    try { resume(rec); } catch (err) { console.error(err); activeStore.set(null); Object.assign(S, fresh0(), { self: diagnosisSelf(), seen: new Set() }); return false; }
    draftStore.set("");
    paint({ initial: true });
    fuText(text);
    return true;
  }

  // ---------------------------------------------------------------- 書く欄
  /** 書く欄の様子 { enabled, ph } */
  function composeState() {
    if (atLimit()) return { enabled: false, ph: "" };
    if (S.fu && S.pend?.type === "safety") return { enabled: false, ph: WAIT_Q };
    return { enabled: true, ph: PH };
  }
  function send() {
    const v = clip(ta.value);
    if (!v || ta.disabled) return;
    setInput("");
    if (!S.text) {
      if (S.offer && continueOffer(v)) return;
      startTalk(v);
      paintNew();
      return;
    }
    if (!S.model) {
      const p = S.pend;
      if (p?.type === "ask") answerPre(v);
      else {
        if (p?.type === "safetyCard") S.safetyContinue = true;   // ［今、危ない］のあと：書けば続く
        S.pend = null;
        appendConsult(v);
      }
      paintNew();
      return;
    }
    fuText(v);
  }

  // ---------------------------------------------------------------- 描く
  /** 上の題・帯・やりとり・下の欄を描き直す。描いたあと、前に無かった項目（新しく足した物）を返す */
  function paint({ initial = false } = {}) {
    const view = S.view === "safetycard";
    const showNew = !view && (!!S.text || !!S.offer);
    const top = topBar({
      title: "相談",
      back,
      heading: true,
      right: view ? null : [
        showNew ? h("button", { type: "button", class: "a-tk-new", onclick: startNew }, T.newConsult) : null,
        h("button", { type: "button", class: "a-cs-danger", onclick: openSafetyView }, "危ないときは"),
      ],
    });
    top.classList.add("a-tk-top");
    if (showNew) top.classList.add("has-new");
    topSlot.replaceChildren(top);
    if (view) {
      bandSlot.replaceChildren();
      const { card } = M.buildSafetyCard({ text: S.text, safety: curSafety() ?? undefined });
      mainSlot.replaceChildren(h("div", { class: "a-tk-view" }, safetyCardView(card, { fresh: true })));
      dock.hidden = true;
      sizeVars();
      return [];
    }
    dock.hidden = false;
    const band = bandView();
    bandSlot.replaceChildren(...(band ? [band] : []));
    const list = threadView();
    mainSlot.replaceChildren(list);
    paintDock();
    const lis = [...list.children];
    const added = initial ? [] : lis.filter(li => !S.seen.has(li.dataset.k));
    S.seen = new Set(lis.map(li => li.dataset.k));
    if (!reduceMotion()) added.forEach((li, i) => { li.classList.add("a-tk-in"); li.style.setProperty("--a-tk-i", String(i)); });
    sizeVars();
    return added;
  }
  /** 描き直して、新しく足した最初の物が見える所まで動かし（動きを減らす設定ではすぐ）、読み上げで知らせ、焦点を移す */
  function paintNew() {
    const added = paint();
    if (!added.length) return;
    added[0].scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
    announce(added);
    const opt = added.map(li => li.querySelector(".a-tk-opts button")).find(Boolean);
    if (opt) { opt.focus({ preventScroll: true }); return; }
    const cs = composeState();
    if (cs.enabled && !coarse()) { ta.focus({ preventScroll: true }); return; }
    (added.find(li => li.dataset.who !== "me") || added[0]).focus({ preventScroll: true });
  }
  function announce(added) {
    const text = added.map(li => li.dataset.say).filter(Boolean).join("\n");
    announcer.textContent = "";
    if (!text) return;
    requestAnimationFrame(() => { announcer.textContent = text; });
  }
  const curSafety = () => (S.pend?.safety ?? S.fu?.safety ?? S.read?.safety ?? null);

  function li(key, who, cls, say, ...kids) {
    return h("li", { class: cls, "data-k": key, "data-who": who, "data-say": say || null, tabindex: "-1" }, kids);
  }
  const sayOf = (who, text) => `${who === "me" ? "あなた" : "アプリ"}：${text}`;
  function msg(key, item, ...extra) {
    const me = item.who === "me";
    return li(key, item.who, ["a-cs-msg", me ? "is-me" : "is-app"], sayOf(item.who, item.label ? `${item.label}。${item.text}` : item.text), bubbleView(item), extra);
  }

  /** やりとり：あいさつと「」の案内 →（始める前）前の相談の続き → 列 →（上限なら）ここまで */
  function threadView() {
    const list = h("ol", { class: "a-cs-thread a-tk-thread", "aria-label": "やりとり" });
    list.append(msg("g", { who: "app", text: T.greet }), msg("g2", { who: "app", text: T.quoteGuide }));
    if (!S.text && S.offer) {
      const rec = S.offer;
      const left = Math.max(0, F.MAX_TURNS - (Number(rec.data?.fu?.turns) || 0));
      list.append(msg("o", { who: "app", text: `${T.offer}「${rec.title || titleOf(rec.data?.text)}」` },
        h("p", { class: "a-note a-tk-under" }, `${fmtDate(rec.at)}に始めた相談・あと${left}回`)));
      list.append(msg("o2", { who: "app", text: T.offerHow }));
    }
    S.tk.forEach((x, i) => { const el = itemView(x, i); if (el) list.append(el); });
    if (atLimit()) list.append(msg("x-limit", { who: "app", text: T.limit }));
    return list;
  }
  function itemView(x, i) {
    const key = `k${x.id}`;
    if (x.who === "safety") {
      const card = x.card || M.buildSafetyCard({ text: S.text, safety: x.safety ?? curSafety() ?? undefined }).card;
      return li(key, "safety", "a-cs-thread-card a-tk-safety", card.headline, safetyCardView(card));
    }
    if (x.who === "app" && Array.isArray(x.move)) {
      return li(key, "app", "a-cs-msg is-app", sayOf("app", x.text), moveBubble(x));
    }
    if (x.who !== "me" && x.who !== "app") return null;
    const p = S.pend;
    const extra = p?.type === "safety" && p.n === i ? [
      h("div", { class: "a-cs-msg-opts a-tk-opts" }, SAFETY_OPTS.map(([k, label]) =>
        h("button", { type: "button", class: ["a-cs-chip", k === "stop" && "a-tk-stop"], onclick: () => safetyPick(k, label) }, label))),
      safetyLine(M.safetyLineResources(p.safety), "すぐに話したいとき"),
    ] : null;
    return msg(key, x, extra);
  }
  /** 一手の吹き出し：（考え直したとき）前置きの1文 →（続けるときの）窓口の1行 → 太字の一手 → 文 → 送る一文（小さな見出し・引用の箱・右上に［コピー］）→ 文 */
  function moveBubble(x) {
    const kids = [h("span", { class: "a-sr" }, "アプリ：")];
    if (x.lead) kids.push(h("p", { class: "a-tk-p" }, x.lead));
    if (x.safetyLine?.length) kids.push(safetyLine(x.safetyLine));
    for (const p of x.move) {
      if (p.k === "head") kids.push(h("p", { class: "a-tk-head" }, p.text));
      else if (p.k === "draft") kids.push(draftView(p));
      else if (p.k === "ret") kids.push(h("p", { class: "a-tk-p" }, h("b", { class: "a-tk-lead" }, p.lead), x.old || !p.text ? fmtDate(p.at) : p.text));
      else kids.push(h("p", { class: "a-tk-p" }, p.lead ? h("b", { class: ["a-tk-lead", p.tone === "stop" && "is-stop"] }, p.lead) : null, p.text,
        p.tag ? [" ", h("span", { class: "a-cs-tag", title: p.tagTitle || null }, p.tag)] : null));
    }
    return h("div", { class: "a-cs-msg-bubble a-tk-move" }, kids);
  }
  /** 送る一文：小さな見出しと、右寄せの引用の箱（今のカードの送る文の吹き出しと同じ色）。右上に小さな［コピー］ */
  function draftView(p) {
    const bubble = h("p", { class: "a-cs-bubble a-tk-quote" }, p.text);
    return h("div", { class: "a-tk-draft" },
      h("div", { class: "a-cs-send-top" }, p.label ? h("span", { class: "a-cs-label" }, p.label) : h("span"), copyButton(bubble)),
      bubble);
  }
  /** ［コピー］（今のカードの右上の小さな札と同じ形。押すと「コピー済み」に2秒） */
  function copyButton(el) {
    let resetT = null;
    const slot = h("span", { class: "a-cs-copy-ic" }, icon("copy", { size: 16 }));
    const word = h("span", null, "コピー");
    const btn = h("button", { type: "button", class: "a-cs-copy" }, h("span", { class: "a-cs-copy-pill" }, slot, word));
    const setDone = (on) => {
      word.textContent = on ? "コピー済み" : "コピー";
      slot.replaceChildren(icon(on ? "check" : "copy", { size: 16 }));
      btn.classList.toggle("is-done", on);
    };
    btn.addEventListener("click", async () => {
      if (await copyText(el.textContent, el)) {
        setDone(true);
        clearTimeout(resetT);
        resetT = setTimeout(() => setDone(false), 2000);
      }
    });
    return btn;
  }

  /**
   * 上の帯「いまの状況」：3行（見出し やりとり・時間・気持ち と文。statusRows）と、右の小さな開け閉め（「たたむ」／「状況」）。
   * 最初の文を読んだ直後から（一手の前は読み取りと答え、あとは往復の状況）。たたむと1行目だけ（この相談の間だけ）
   */
  function bandView() {
    const k = S.fu ? S.fu.known : S.read ? known() : null;
    if (!k) return null;
    const rows = statusRows(k);
    const dl = h("dl", { class: "a-tk-st-rows", id: STATUS_ID }, rows.flatMap(r => [h("dt", { "data-row": r.key }, r.label), h("dd", { "data-row": r.key }, r.text)]));
    const word = h("span", { class: "a-tk-st-word" });
    const toggle = h("button", { type: "button", class: "a-tk-st-btn", "aria-controls": STATUS_ID }, word, icon("chevron-down", { size: 16 }));
    const band = h("section", { class: "a-tk-band", "aria-label": T.status }, h("div", { class: "a-tk-band-in" }, dl, toggle));
    const sync = () => {
      const open = !S.bandCollapsed;
      band.classList.toggle("is-collapsed", !open);
      toggle.setAttribute("aria-expanded", String(open));
      word.textContent = open ? T.collapse : T.expand;
    };
    toggle.addEventListener("click", () => { S.bandCollapsed = !S.bandCollapsed; sync(); });
    sync();
    return band;
  }

  /** 下の欄（書く欄と送る・小さな1行） */
  function paintDock() {
    const cs = composeState();
    ta.disabled = !cs.enabled;
    ta.placeholder = cs.ph;
    ta.setAttribute("aria-label", NAME);
    if (!S.text) ta.setAttribute("aria-describedby", "a-tk-privacy"); else ta.removeAttribute("aria-describedby");
    const left = Math.max(0, F.MAX_TURNS - (S.fu?.turns ?? 0));
    footSlot.replaceChildren(h("p", { class: "a-tk-foot" }, !S.text
      ? h("span", { class: "a-tk-privacy", id: "a-tk-privacy" }, T.privacy)
      : h("span", { class: "a-tk-left" }, `あと${left}回`)));
    syncSend();
    fit();
  }

  // ---------------------------------------------------------------- 開いたとき：読み込み直したなら続きから。そうでなければ、続きがあれば「前の相談の続き」
  const activeId = activeStore.get();
  const active = activeId ? getRecord(activeId) : null;
  if (F.resumable(active)) {
    try {
      resume(active);
      setInput("");
      paint({ initial: true });
      // いちばん新しいやりとりを見せる（画面の切り替えが先頭へ戻したあとに）
      setTimeout(() => {
        const last = [...mainSlot.querySelectorAll(".a-tk-thread > li")].pop();
        if (!last?.isConnected) return;
        last.scrollIntoView({ block: "start" });
        last.focus({ preventScroll: true });
      }, 0);
    } catch (err) {
      console.error(err);
      activeStore.set(null);
      Object.assign(S, fresh0(), { self: diagnosisSelf(), seen: new Set() });
      paint({ initial: true });
    }
  } else {
    activeStore.set(null);
    S.offer = latestResumable();
    paint({ initial: true });
  }
  return () => {
    ro?.disconnect();
    window.removeEventListener("popstate", onPop);
    activeStore.set(null);
  };
}
