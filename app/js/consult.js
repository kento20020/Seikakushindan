// 相談（#consult）。仕様：docs/app-screens.md §4.5（入力・画像5）・§4.6（そのあと）・§11（続き＝往復。決定 U30）
//   入力 →（危ない兆しがあるときだけ）安全の確認 → 受け止めと状況の整理（ひと続きの文＋ちがうところを直す）→ 足りない問（多くて3つ）→ 次の一手カード
//   → 続き：上に「いまの状況」の帯、やりとり（自分＝右・アプリ＝左の吹き出し。一手が変わったときだけ新しいカード、前のカードはたたむ）、
//     下に［相手の返事を貼る］［送った］［もう少し話したい］と「あと n 回」・「相談を終える」。1回の相談は10往復まで
//   流れと中身は poc/card/（統合3。決定 U14・U16・U22〜U26）をそのまま使い、見た目だけ app/ に合わせる。
//   読み取り・足りない問・一手・文面は js/consult/ と poc/card/model.js（どちらも直さない）。カードと吹き出しの部品は app/js/consult_card.js、
//   往復の状況の書き換え・答え合わせ・判定し直しは app/js/consult_followup.js（DOM なし）
//   端末の外には何も送らない。書きかけの文とタイマーだけ localStorage に残す（使えなくても動く）。カードが出たら履歴に1件（app/js/local.js）。
//   1回の相談＝履歴の1件（やりとり・今のカード・状況の項目・答え合わせ）。読み込み直しても続きから（この端末のこのタブの間）。
//   次に #consult を開いたとき、続きがあれば入力の画面の上に「前の続き」。安全のカードは残さない
//
// 戻る：上の「←」は前の段階へ。入力まで戻ったら、もう一度押すと前の画面（ふつうはホーム）へ。続き（往復）を始めたあとは、カードの画面から前の画面へ
//   （相談は履歴に残っていて、続きから開ける）。段階はハッシュを変えずに進むので、端末の「戻る」でも前の段階に戻れるよう、入力より先にいる間だけ
//   履歴に1つ印を積む（同じ URL）
//
// 履歴の詳細（#history/<id>）との約束：renderSaved(record) が「そのときのカード」と、そのあとのやりとりを読むだけの形で返す
import { h, icon, topBar, goBack, fmtDate, rowLink } from "./ui.js";
import { addRecord, removeRecord, getRecord, loadRecords } from "./local.js";
import { readText } from "../../js/consult/extract.js";
import { nextQuestion, applyAnswer } from "../../js/consult/needed.js";
import { applyPatch } from "../../js/consult/context.js";
import { isLateNight } from "../../js/consult/timefmt.js";
import { CONSULT_EXAMPLES } from "./consult_examples.js";
import * as M from "../../poc/card/model.js";
import * as F from "./consult_followup.js";
import { liveCard, safetyCardView, safetyLine, snapshotOf, savedView, bubbleView, pastCardView } from "./consult_card.js";

export const MAX_CHARS = 2000;
const DRAFT_KEY = "seikaku16:app:consult-draft";
/** 読み込み直したときに続きから開くための印（このタブの間だけ。ほかの画面へ移ったら消す） */
const ACTIVE_KEY = "seikaku16:app:consult-active";
/** 入力の画面の「書き方の例」（決定 U41 の1）：[何を書くか, 例]。「|」は狭い幅で折り返してよい所（文節の切れ目。表示には出ない） */
const GUIDE_ROWS = [
  ["いつ・どこで", "（例：|昨日の夜|23時ごろ、|LINEで）"],
  ["何があったか", "（例：|私が|「いつも直前に決めるよね」と|送ったら、|「じゃあもういいよ」と|返ってきた）"],
  ["今どうなって|いるか", "（例：|既読のまま|2時間、|返事がない）"],
  ["今の気持ち", "（例：|不安、|腹が立つ、|悲しい）"],
  ["どうしたいか", "（例：|今夜のうちに|仲直りしたい、|謝りたい、|少し落ち着きたい）"],
];
const TITLE_CHARS = 32;

const draftStore = {
  get() { try { return localStorage.getItem(DRAFT_KEY) ?? ""; } catch { return ""; } },
  set(v) { try { if (v) localStorage.setItem(DRAFT_KEY, v); else localStorage.removeItem(DRAFT_KEY); } catch { /* 使えない */ } },
};
const activeStore = {
  get() { try { return sessionStorage.getItem(ACTIVE_KEY); } catch { return null; } },
  set(v) { try { if (v) sessionStorage.setItem(ACTIVE_KEY, v); else sessionStorage.removeItem(ACTIVE_KEY); } catch { /* 使えない */ } },
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const reduceMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

/** 履歴の題：書いた文の冒頭（改行・空白を詰めて、長ければ「…」） */
export function titleOf(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(t);
  return chars.length > TITLE_CHARS ? `${chars.slice(0, TITLE_CHARS).join("")}…` : t;
}

/** 履歴の詳細で出す「そのときのカード」とやりとり（記録の形が違えば null） */
export function renderSaved(record) {
  try { return savedView(record); } catch (err) { console.error(err); return null; }
}

/** いちばん新しい相談の記録が、続きにできれば返す（終えた・閉じた相談、古い形の記録は null） */
function latestResumable() {
  try {
    const rec = loadRecords().items.find(x => x.kind === "consult");
    return F.resumable(rec) ? rec : null;
  } catch { return null; }
}

export function render(root) {
  const S = {
    stage: "write",
    text: draftStore.get().slice(0, MAX_CHARS),
    read: null,          // readText の結果
    lateNight: false,
    edits: {},           // 受け止めの画面で直した項目（null は「分からない」＝外す）
    editing: null,       // 直している項目
    fixOpen: false,      // 「ちがうところを直す」を開いているか
    answers: [],         // 足りない問の答え [{ q, patch, label }]
    extra: {},           // カードで足した差分（［ちがう］［もっと合わせる］）
    safetyShown: false,
    safetyContinue: false,
    returnTo: "write",   // 安全のカードから戻る先
    model: null,         // 今のカード（buildPoc の結果）
    cardInput: null,     // 今のカードの判定の入力 { known, extra, safetyContinue, safety, at }（読み込み直したときに同じカードを作り直す）
    accept: "",          // 受け止めの文（最初のカードを作ったとき）
    fresh: false,
    now: null,
    examplesOpen: false,
    record: { id: null, at: null, text: null },   // この相談の履歴（同じ相談では1件だけ。作り直したら差し替える）
    // 続き（往復）
    fu: null,            // consult_followup.js の newFollow の形（記録に残す）
    resumed: false,      // 履歴から続きを開いた（前の段階には戻らない）
    composer: null,      // 下で開いている欄："reply" | "talk" | "end"
    pendingInput: null,  // 安全の確認を待っている入力 { type: "reply" | "talk", text, read, kind? }
    safetyFrom: null,    // 安全の確認の出どころ（null＝最初に書いた文、"reply"・"talk"＝続き）
    newFrom: null,       // やりとりのうち、今の操作で足した最初の番号（描いたあと、そこへ焦点と表示を移す）
    offer: null,         // 入力の画面の上に出す「前の続き」の記録
    statusOpen: false,   // 「いまの状況」を開いているか
  };
  const timers = new Set();
  let tick = null;

  // ---------------------------------------------------------------- 端末の「戻る」（入力より先にいる間だけ、同じ URL の印を1つ積む）
  let guarded = false, ignorePop = false, leaving = false;
  const startedOnGuard = !!history.state?.aCsGuard;
  function pushGuard() {
    if (guarded) return;
    try { history.pushState({ ...(history.state && typeof history.state === "object" ? history.state : {}), aCsGuard: true }, ""); guarded = true; } catch { /* 使えない */ }
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
    back();
  }
  window.addEventListener("popstate", onPop);

  // ---------------------------------------------------------------- 流れ
  function known() {
    const k = M.knownFrom(S.read?.fields, S.edits, S.answers.map(a => a.patch), { lateNight: S.lateNight });
    delete k.want;   // 「どうしたい」のチップの印（判定の入力ではない）
    return k;
  }
  const currentQuestion = () => nextQuestion(known(), S.answers.map(a => a.q));

  function go(stage) {
    S.stage = stage;
    paint();
    window.scrollTo(0, 0);
    root.querySelector("[data-focus]")?.focus({ preventScroll: true });
    if (stage === "write") { dropGuard(); activeStore.set(null); } else pushGuard();
  }
  function leave() {
    if (startedOnGuard && history.state?.aCsGuard) { leaving = true; history.back(); return; }
    goBack("#home");
  }
  /** 続き（往復）を始めたか（始めたら、カードの画面から前の段階には戻らない） */
  const followStarted = () => !!S.fu && (S.resumed || S.fu.turns > 0 || S.fu.thread.length > 1 || S.fu.ended);
  function back() {
    switch (S.stage) {
      case "write": leave(); return;
      case "safety":
        if (S.safetyFrom) { S.pendingInput = null; S.safetyFrom = null; go("card"); return; }
        go("write"); return;
      case "read": go(S.safetyShown ? "safety" : "write"); return;
      case "ask":
        if (S.answers.length) { S.answers.pop(); go("ask"); } else go("read");
        return;
      case "card":
        if (followStarted()) { leave(); return; }
        S.extra = {};
        if (S.answers.length) { S.answers.pop(); go("ask"); } else go("read");
        return;
      case "safetycard": go(S.returnTo || "write"); return;
      default: go("write");
    }
  }
  function startRead(raw) {
    const text = String(raw || "").trim().slice(0, MAX_CHARS);
    if (!text) return;
    if (S.record.text !== text || S.resumed) S.record = { id: null, at: null, text };
    S.resumed = false;
    S.text = text;
    S.read = readText(text);
    S.lateNight = isLateNight(new Date());
    S.edits = {}; S.editing = null; S.answers = []; S.extra = {}; S.safetyContinue = false;
    S.safetyFrom = null; S.pendingInput = null; S.composer = null; S.fu = null;
    // 食い違い・確かでない項目があれば、直す欄を開いておく
    S.fixOpen = M.readChips(S.read, S.read.fields).some(c => c.weak);
    S.safetyShown = M.hasSafetySign(S.read);
    go(S.safetyShown ? "safety" : "read");
  }
  function proceed() {
    if (currentQuestion()) go("ask");
    else { buildCard(); go("card"); }
  }
  /** 最初のカード（入力 → 受け止め → 足りない問のあと）。続き（往復）の状態もここで始める */
  function buildCard() {
    S.fresh = true;
    S.now = new Date();
    const k = known();
    const safety = S.read?.safety ?? null;
    S.model = M.buildPoc({ known: k, extra: S.extra, text: S.text, now: S.now, safetyContinue: S.safetyContinue, safety });
    S.cardInput = { known: k, extra: { ...S.extra }, safetyContinue: S.safetyContinue, safety, at: S.now.toISOString() };
    const ka = { ...k };
    delete ka.lateNight;
    S.accept = M.acceptText({ known: ka, text: S.text, evidence: editedEvidence() });
    S.fu = F.newFollow({ known: k, asked: S.answers.map(a => a.q.id), safety, safetyContinue: S.safetyContinue });
    S.fu.thread = [cardItem(S.model, S.now)];
    S.composer = null;
    saveRecord();
  }
  /** 今のカードを、その場で作り直す（カードの［ちがう］［もっと合わせる］）。新しいカードにはしない */
  function rebuildCard() {
    S.fresh = true;
    S.now = new Date();
    const ci = S.cardInput;
    // 状況は今のもの（往復で書き換えたあとでも、カードの選び直しが古い状況に戻らないように）。深夜かどうかはそのカードのまま
    const k = S.fu ? { ...S.fu.known, lateNight: !!ci.known?.lateNight } : ci.known;
    S.model = M.buildPoc({ known: k, extra: S.extra, text: S.text, now: S.now, safetyContinue: ci.safetyContinue, safety: ci.safety });
    S.cardInput = { ...ci, known: k, extra: { ...S.extra }, at: S.now.toISOString() };
    const th = S.fu?.thread;
    const i = th ? th.map(x => x.who).lastIndexOf("card") : -1;
    if (i >= 0) th[i] = { ...th[i], at: S.now.toISOString(), card: snapshotOf(S.model) };
    saveRecord();
    paint();
    root.querySelector(".a-cs-card [data-focus]")?.focus({ preventScroll: true });
  }
  function openSafetyCard() {
    if (S.stage !== "safetycard") S.returnTo = S.stage;
    go("safetycard");
  }
  const cardItem = (m, at) => ({ who: "card", at: at.toISOString(), card: snapshotOf(m), action: m.result?.action ?? null });

  /** この相談の履歴（1件だけ。差し替える）。安全のカードは残さない */
  function saveRecord() {
    const m = S.model;
    if (!m || m.mode === "safety" || !S.fu || !S.cardInput) return;
    try {
      const ci = S.cardInput;
      const data = {
        v: 2,
        text: S.text,
        accept: S.accept,
        card: snapshotOf(m),
        input: { known: ci.known, extra: ci.extra, safetyContinue: ci.safetyContinue, safety: ci.safety, lateNight: !!ci.known?.lateNight, at: ci.at },
        extra: S.extra,   // 今のカードで足した差分（続きから開いたときに使う。状況の項目は往復のたびに fu.known へ移す）
        fu: S.fu,
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

  // ---------------------------------------------------------------- 続き（往復）
  const thread = () => S.fu.thread;
  function push(item) { thread().push({ at: new Date().toISOString(), ...item }); }
  const canTurn = () => !!S.fu && !S.fu.ended && S.fu.turns < F.MAX_TURNS;
  const curAction = () => S.model?.result?.action ?? null;
  const curSafety = () => {
    if (S.safetyFrom && S.pendingInput?.read) return S.pendingInput.read.safety;
    return S.fu?.safety ?? S.read?.safety ?? null;
  };
  /** カードで足した差分のうち状況の項目は、状況の側へ移す（往復の書き換えが差分に上書きされないように） */
  function fold() {
    const r = F.splitExtra(S.fu.known, S.extra);
    S.fu.known = r.known;
    S.extra = r.extra;
  }
  /** 往復の操作を始める（今の操作で足す最初の番号を覚え、開いていた欄を閉じる） */
  function begin() {
    S.newFrom = thread().length;
    S.composer = null;
    fold();
  }
  /**
   * 判定し直す。一手（か安全の扱い）が変わったら新しいカードを足し、変わらなければ吹き出し「一手はこのままで大丈夫です。」
   * @returns {boolean} 一手が変わったか
   */
  function settle(now = new Date()) {
    const lateNight = isLateNight(now);
    const m = F.rejudge({ known: S.fu.known, extra: S.extra, text: S.text, now, safetyContinue: S.fu.safetyContinue, safety: S.fu.safety, lateNight });
    const changed = F.actionChanged(S.model, m);
    if (changed) {
      const onlySafety = S.model?.result?.action === m.result?.action && S.model?.mode === m.mode;
      S.model = m;
      S.now = now;
      S.fresh = true;
      S.cardInput = { known: { ...S.fu.known, lateNight }, extra: { ...S.extra }, safetyContinue: S.fu.safetyContinue, safety: { ...S.fu.safety }, at: now.toISOString() };
      push({ who: "app", text: onlySafety ? "カードを作り直して、危ないと感じたときの窓口を一番上に足しました。" : "いまの状況に合わせて、一手を考え直しました。" });
      thread().push(cardItem(m, now));
    } else {
      push({ who: "app", text: F.keepText(S.model) });
    }
    return changed;
  }
  function logTurn(entry, changed) {
    S.fu.log.push({ at: new Date().toISOString(), ...entry, action: curAction(), changed: !!changed });
  }
  function commit() {
    saveRecord();
    paintFollow();
  }
  /** 描き直して、今の操作で足した所へ表示と焦点を移す（足した物が無ければ、開いた欄へ） */
  function paintFollow() {
    const from = S.newFrom;
    S.newFrom = null;
    paint();
    const items = from == null ? [] : [...root.querySelectorAll(".a-cs-thread > li[data-idx]")].filter(li => Number(li.dataset.idx) >= from);
    const first = items[0];
    const focusTo = items.find(li => li.dataset.who !== "me") || first;
    const target = focusTo?.querySelector("[data-focus]") || focusTo || root.querySelector(".a-cs-fu [data-autofocus]");
    if (first) first.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
    else target?.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
    target?.focus({ preventScroll: true });
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
  // ［まだ来ない］：送った時刻から今までの時間で、どれくらい前かを入れて判定し直す（違えば4つから選び直せる）
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

  // ［相手の返事を貼る］：安全の言葉を毎回見る → 読む → 読めなければ1問 → 答え合わせの1行 → 判定し直し
  function submitReply(raw) {
    const text = String(raw || "").trim().slice(0, MAX_CHARS);
    if (!text || !canTurn()) return;
    const rr = F.readReply(text);
    if (M.hasSafetySign(rr.read)) {
      S.pendingInput = { type: "reply", text, read: rr.read, kind: rr.kind };
      S.safetyFrom = "reply";
      S.composer = null;
      go("safety");
      return;
    }
    takeReply(text, rr.kind, null);
  }
  function takeReply(text, kind, sign = null) {
    begin();
    S.fu.turns++;
    if (sign) markSafety(sign);
    S.fu.pending = null;
    push({ who: "me", label: "相手から来た返事", text, quote: true });
    if (!kind) {
      const q = F.REPLY_KIND_QUESTION;
      push({ who: "app", text: q.text });
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

  // ［もう少し話したい］：安全 → 読む → 気持ちの受け止め → 1つだけ聞く → 判定し直し
  function submitTalk(raw) {
    const text = String(raw || "").trim().slice(0, MAX_CHARS);
    if (!text || !canTurn()) return;
    const read = readText(text);
    if (M.hasSafetySign(read)) {
      S.pendingInput = { type: "talk", text, read };
      S.safetyFrom = "talk";
      S.composer = null;
      go("safety");
      return;
    }
    takeTalk(text, read, false);
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

  /** 安全の確認で「続ける」を選んだ：このあとのカードの一番上に窓口の1行を出す */
  function markSafety(sf) {
    S.fu.safetyContinue = true;
    S.fu.safety = { selfHarm: !!(S.fu.safety?.selfHarm || sf?.selfHarm), partnerThreat: !!(S.fu.safety?.partnerThreat || sf?.partnerThreat) };
  }
  function continueAfterSafety() {
    const p = S.pendingInput;
    S.pendingInput = null;
    S.safetyFrom = null;
    S.stage = "card";
    pushGuard();
    if (!p) { paint(); return; }
    if (p.type === "reply") {
      takeReply(p.text, p.kind, p.read.safety);
    } else {
      takeTalk(p.text, p.read, true);
    }
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

  // 「相談を終える」→「どうなった？」（答えなくてもよい）→ 履歴に残す
  function finishEnd(key) {
    begin();
    const o = F.outcomeOf(key);
    if (o) push({ who: "me", text: o.label });
    push({ who: "app", text: o ? o.reply : F.OUTCOME_SKIP_REPLY });
    S.fu.outcome = o ? o.key : null;
    S.fu.ended = true;
    S.fu.pending = null;
    commit();
  }
  /** ［新しく相談する］：今の相談は閉じて（履歴には残る）、入力の画面へ */
  function startNew() {
    if (S.fu && !S.fu.ended) { S.fu.closed = true; saveRecord(); }
    activeStore.set(null);
    S.fu = null; S.model = null; S.cardInput = null; S.resumed = false; S.composer = null;
    S.text = ""; S.read = null; S.answers = []; S.edits = {}; S.extra = {};
    S.record = { id: null, at: null, text: null };
    S.offer = null;
    draftStore.set("");
    go("write");
  }

  /** 履歴の記録から続きを開く（読み込み直したとき・「前の続き」の［続きから］） */
  function resume(rec) {
    const d = rec.data;
    const ci = d.input;
    const now = new Date(ci.at);
    const model = M.buildPoc({ known: ci.known || {}, extra: ci.extra || {}, text: d.text, now: Number.isNaN(now.getTime()) ? new Date() : now, safetyContinue: !!ci.safetyContinue, safety: ci.safety ?? undefined });
    S.text = d.text;
    S.read = null;
    S.accept = typeof d.accept === "string" ? d.accept : "";
    S.fu = clone(d.fu);
    for (const k of ["thread", "log", "checks", "asked"]) if (!Array.isArray(S.fu[k])) S.fu[k] = [];
    S.extra = { ...(d.extra && typeof d.extra === "object" ? d.extra : ci.extra || {}) };
    S.cardInput = clone(ci);
    S.model = model;
    S.now = Number.isNaN(now.getTime()) ? new Date() : now;
    S.safetyContinue = !!ci.safetyContinue;
    S.record = { id: rec.id, at: rec.at, text: d.text };
    S.resumed = true;
    S.fresh = false;
    S.composer = null;
    S.offer = null;
    activeStore.set(rec.id);
    go("card");
    // いちばん新しいやりとりを見せる（画面の切り替えが先頭へ戻したあとに）
    if (thread().length > 1) {
      setTimeout(() => {
        const last = [...root.querySelectorAll(".a-cs-thread > li")].pop();
        if (!last?.isConnected) return;
        last.scrollIntoView({ block: "start" });
        (last.querySelector("[data-focus]") || last).focus({ preventScroll: true });
      }, 0);
    }
  }
  /** 「前の続き」の［新しく相談する］：前の相談を閉じる（履歴には残る） */
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
    root.querySelector("#a-cs-text")?.focus();
  }

  // ---------------------------------------------------------------- 描く
  function paint() {
    clearInterval(tick);
    tick = null;
    timers.clear();
    const view = { write: viewWrite, safety: viewSafetyCheck, read: viewRead, ask: viewAsk, card: viewCard, safetycard: viewSafetyCard }[S.stage] || viewWrite;
    const body = view();
    const dock = body.dock || null;
    const isCard = S.stage === "card" || S.stage === "safetycard";
    root.replaceChildren(
      h("div", { class: ["a-cs", `a-cs-stage-${S.stage}`, dock && "has-dock"], "data-stage": S.stage },
        topBar({
          title: "相談",
          back,
          heading: isCard,
          right: S.stage === "safetycard" ? null : h("button", { type: "button", class: "a-cs-danger", onclick: openSafetyCard }, "危ないときは"),
        }),
        h("div", { class: "a-cs-body" }, body.main),
        dock ? h("div", { class: "a-cs-dock" }, h("div", { class: "a-cs-dock-in" }, dock)) : null));
    if (timers.size) tick = setInterval(() => { for (const f of timers) f(); }, 30000);
  }

  // 1. 入力（画像5）
  function viewWrite() {
    const count = h("p", { class: "a-cs-count", id: "a-cs-count" });
    const ta = h("textarea", {
      id: "a-cs-text", class: "a-textarea a-cs-text", rows: "8", maxlength: String(MAX_CHARS),
      placeholder: "ここに自由に入力してください…", "aria-describedby": "a-cs-count a-cs-privacy",
    });
    ta.value = S.text;
    const submit = h("button", { type: "button", class: "a-btn a-cs-submit", onclick: () => startRead(ta.value) },
      icon("sparkle"), h("span", null, "相談する"), icon("arrow-right"));
    const sync = () => {
      S.text = ta.value;
      count.textContent = `${ta.value.length} / ${MAX_CHARS}`;
      submit.disabled = !ta.value.trim();
    };
    ta.addEventListener("input", () => { sync(); draftStore.set(ta.value); });
    sync();

    // 例文（app/js/consult_examples.js。決定 U41 の2）。ボタンの中に、小さな題（あれば）と例文の全文
    const list = h("div", { class: "a-cs-examples", id: "a-cs-examples", hidden: !S.examplesOpen },
      h("p", { class: "a-note" }, "選ぶと、入力欄に入ります。"),
      h("ul", { class: "a-cs-example-list" }, CONSULT_EXAMPLES.map(c => h("li", null,
        h("button", { type: "button", class: "a-cs-example", onclick: () => {
          const cur = ta.value.trim();
          if (cur && cur !== c.text && !window.confirm("書いた文を、この例文に入れ替えますか？")) return;
          ta.value = c.text;
          sync();
          draftStore.set(ta.value);
          setOpen(false);
          ta.focus();
        } },
          c.label ? h("span", { class: "a-cs-example-label" }, c.label, h("span", { class: "a-sr" }, "：")) : null,
          h("span", { class: "a-cs-example-text" }, c.text))))));
    const exBtn = h("button", { type: "button", class: "a-cs-ex-btn", "aria-controls": "a-cs-examples", onclick: () => setOpen(!S.examplesOpen) },
      h("span", null, "例文を見る"), icon("chevron-right", { size: 18 }));
    function setOpen(open) {
      S.examplesOpen = open;
      list.hidden = !open;
      exBtn.setAttribute("aria-expanded", String(open));
    }
    setOpen(S.examplesOpen);

    return {
      main: [
        S.offer ? offerView(S.offer) : null,
        h("div", { class: "a-cs-intro" },
          h("h1", { class: "a-h1 a-cs-title", tabindex: "-1", "data-focus": true }, "なんでも相談する"),
          h("p", { class: "a-lead" }, "今の気持ちや出来事を自由に書いてください。"),
          h("p", { class: "a-lead" }, "あなたの状況に合わせて、", h("br"), "客観的な視点と具体的なアドバイスをお伝えします。"),
          guideView()),
        h("section", { class: "a-card a-cs-form", "aria-labelledby": "a-cs-label" },
          h("div", { class: "a-cs-form-head" },
            h("label", { class: "a-cs-label-main", id: "a-cs-label", for: "a-cs-text" }, icon("pencil"), h("span", null, "相談内容")),
            exBtn),
          list,
          h("div", { class: "a-cs-field" }, ta, count)),
        h("p", { class: "a-note a-cs-privacy", id: "a-cs-privacy" }, "書いた文は、この端末の中だけで読み取ります。どこにも送りません。"),
      ],
      dock: submit,
    };
  }
  /** 入力の画面の「書き方の例」（見出しの2つの文の下。決定 U41 の1）。小さな箱に、何を書くかと例の表、下に一言 */
  function guideView() {
    // 文節のまとまり（途中で折り返さない。幅が足りなければ中でも折り返す）
    const keep = (...parts) => parts.map(t => h("span", { class: "a-cs-keep" }, t));
    return h("div", { class: "a-cs-guide" },
      h("p", { class: "a-cs-guide-h", id: "a-cs-guide-h" }, keep("たとえば、こんなことを書くと", "伝わりやすくなります")),
      h("dl", { class: "a-cs-guide-list", "aria-labelledby": "a-cs-guide-h" }, GUIDE_ROWS.map(([what, ex]) =>
        h("div", { class: "a-cs-guide-row" }, h("dt", null, keep(...what.split("|"))), h("dd", null, keep(...ex.split("|")))))),
      h("p", { class: "a-cs-guide-foot" },
        keep("相手の言葉は「」で", "そのまま書くと、", "読み取りやすくなります。", "全部そろっていなくても", "大丈夫です。", "足りないところは、", "あとで少しだけ聞きます。")));
  }
  /** 入力の画面の上：「前の続き：（書いた文の冒頭）」［続きから］［新しく相談する］ */
  function offerView(rec) {
    const left = Math.max(0, F.MAX_TURNS - (Number(rec.data?.fu?.turns) || 0));
    return h("section", { class: "a-cs-resume", "aria-labelledby": "a-cs-resume-h" },
      h("p", { class: "a-cs-resume-h", id: "a-cs-resume-h" }, h("span", { class: "a-cs-label" }, "前の続き"), h("span", { class: "a-cs-resume-text" }, rec.title || titleOf(rec.data?.text))),
      h("p", { class: "a-note" }, `${fmtDate(rec.at)}に始めた相談・あと${left}回`),
      h("div", { class: "a-cs-resume-btns" },
        h("button", { type: "button", class: "a-btn a-btn-sm", onclick: () => resume(rec) }, "続きから", icon("arrow-right")),
        h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm", onclick: dismissOffer }, "新しく相談する")));
  }

  // 2. 安全の確認（規則で兆しを見つけたときだけ。U22）。続きで貼った返事・書いた文にも毎回
  function viewSafetyCheck() {
    const fromFollow = !!S.safetyFrom;
    const cont = fromFollow ? continueAfterSafety : () => { S.safetyContinue = true; go("read"); };
    const sub = S.safetyFrom === "reply" ? "貼ってくれた返事の中に、気になる言葉がありました。答えに合わせて、このあとを変えます。"
      : S.safetyFrom === "talk" ? "書いてくれた文の中に、気になる言葉がありました。答えに合わせて、このあとを変えます。"
      : "書いてくれた文の中に、気になる言葉がありました。答えに合わせて、このあとを変えます。";
    return {
      main: [
        h("h1", { class: "a-cs-q", tabindex: "-1", "data-focus": true }, "いま、身の危険や強い怖さを感じていますか？"),
        h("p", { class: "a-cs-sub" }, sub),
        h("div", { class: "a-cs-options" },
          option("今、危ない", () => { S.returnTo = "safety"; go("safetycard"); }, "is-stop"),
          option("大丈夫、続ける", cont),
          option("昔の話・人の話", cont)),
        safetyLine(M.safetyLineResources(curSafety() ?? {}), "すぐに話したいとき"),
      ],
    };
  }
  function option(label, onClick, cls = null) {
    return h("button", { type: "button", class: ["a-cs-option", cls], onclick: onClick }, h("span", null, label), icon("chevron-right", { size: 18 }));
  }

  // 3. 受け止めと状況の整理（事実と気持ちをひと続きの文で。U26）→ ちがうところを直す → 次へ
  function readKnown() { return M.knownFrom(S.read?.fields, S.edits); }
  /** 直した項目の根拠の言葉は使わない（直した値と書いた文の「」が食い違うため） */
  function editedEvidence() {
    const ev = { ...(S.read?.evidence || {}) };
    for (const f of Object.keys(S.edits)) delete ev[f];
    if ("want" in S.edits) { delete ev.intent; delete ev.goal; }
    return ev;
  }
  function viewRead() {
    const k = readKnown();
    const text = M.acceptText({ known: k, text: S.text, evidence: editedEvidence(), safetyContinue: S.safetyContinue });
    const chips = fixChips(k);
    const weak = chips.some(c => c.weak);
    const panel = h("div", { class: "a-cs-fix-panel", id: "a-cs-fix-panel", hidden: !S.fixOpen },
      h("p", { class: "a-note" }, weak ? "点線のところは、読み取りが確かではありません。押して確かめてください。" : "押すと、選び直せます。"),
      chipList(chips));
    const fixBtn = h("button", { type: "button", class: "a-link a-link-tap a-cs-toggle", "aria-expanded": String(S.fixOpen), "aria-controls": "a-cs-fix-panel", onclick: () => {
      S.fixOpen = !S.fixOpen; S.editing = null; paint(); root.querySelector("[aria-controls='a-cs-fix-panel']")?.focus();
    } }, h("span", null, "ちがうところを直す"), icon("chevron-down", { size: 16 }));
    S.answers = []; S.extra = {};
    const next = currentQuestion();
    return {
      main: [
        h("h1", { class: "a-cs-accept", tabindex: "-1", "data-focus": true }, text),
        h("div", { class: "a-cs-fix" }, fixBtn, panel),
        next ? h("p", { class: "a-note a-cs-next-note" }, "足りないところを、このあと少しだけ聞きます（多くて3つ）。") : null,
      ],
      dock: h("button", { type: "button", class: "a-btn a-btn-block a-cs-next", onclick: proceed }, next ? "次へ" : "次の一手を見る", icon("arrow-right")),
    };
  }
  /** 直すチップ：事実（読めたものだけ）＋気持ち・どうしたいか（読めていなくても選べる） */
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
    const wrap = h("div", { class: "a-cs-chips", role: "list" });
    for (const c of chips) {
      const open = S.editing === c.key;
      const panelId = `a-cs-edit-${c.key}`;
      wrap.append(h("div", { role: "listitem", class: "a-cs-chip-item" },
        h("button", {
          type: "button", class: ["a-cs-chip", c.weak && "is-weak", c.empty && "is-quiet"], "aria-expanded": String(open), "aria-controls": open ? panelId : null, "data-chip": c.key,
          onclick: () => { S.editing = open ? null : c.key; paint(); root.querySelector(`[data-chip="${c.key}"]`)?.focus(); },
        }, h("span", null, c.text), c.weak ? h("span", { class: "a-cs-chip-flag" }, "たしかめて") : null, icon("chevron-down", { size: 16 }))));
      if (open) wrap.append(editPanel(c, panelId));
    }
    return wrap;
  }
  function editPanel(c, id) {
    const done = () => { S.editing = null; S.answers = []; paint(); root.querySelector(`[data-chip="${c.key}"]`)?.focus(); };
    const pick = (v) => { S.edits = { ...S.edits, [c.key]: v }; done(); };
    const isWant = c.key === "want";
    const opts = isWant ? M.WANTS.map(w => [w.key, w.label]) : M.fieldOptions(c.key);
    const choose = isWant ? (v) => { S.edits = { ...S.edits, ...M.wantPatch(v, {}, { full: true }), want: v }; done(); } : pick;
    const forget = isWant ? () => { S.edits = { ...S.edits, intent: null, goal: null, want: null }; done(); } : () => pick(null);
    const name = isWant ? "どうしたい？" : M.FIELD_NAMES[c.key];
    return h("div", { class: "a-cs-edit", id, role: "group", "aria-label": `${name}を直す` },
      c.evidence ? h("p", { class: "a-note" }, `「${c.evidence}」から読み取りました`) : null,
      h("p", { class: "a-cs-edit-q" }, name),
      h("div", { class: "a-cs-chip-row" },
        opts.map(([v, label]) => {
          const on = c.value === v;
          return h("button", { type: "button", class: "a-cs-chip", "aria-pressed": String(on), onclick: () => choose(v) }, on ? icon("check", { size: 16 }) : null, label);
        }),
        h("button", { type: "button", class: "a-cs-chip is-quiet", onclick: forget }, "分からない（あとで聞く）")));
  }

  // 4. 足りない問（1画面に1問）
  function viewAsk() {
    const q = currentQuestion();
    if (!q) { buildCard(); S.stage = "card"; return viewCard(); }
    const n = S.answers.length + 1;
    const answer = (o) => { S.answers.push({ q, patch: o.patch, label: o.label }); proceed(); };
    const btn = (o) => option(o.label, () => answer(o));
    const first = q.primary ? q.options.slice(0, q.primary) : q.options;
    const rest = q.primary ? q.options.slice(q.primary) : [];
    const more = h("div", { class: "a-cs-options", id: "a-cs-more-options", hidden: true }, rest.map(btn));
    const moreBtn = rest.length ? h("button", { type: "button", class: "a-link a-link-tap a-cs-toggle", "aria-expanded": "false", "aria-controls": "a-cs-more-options", onclick: () => {
      more.hidden = false; moreBtn.remove(); more.querySelector("button")?.focus();
    } }, h("span", null, q.moreLabel || "ほかの選択肢"), icon("chevron-down", { size: 16 })) : null;
    return {
      main: [
        h("p", { class: "a-cs-step" }, `あと少しだけ聞きます（${n}つめ・多くて3つ）`),
        h("h1", { class: "a-cs-q", tabindex: "-1", "data-focus": true }, q.text),
        h("div", { class: "a-cs-options" }, first.map(btn)),
        moreBtn ? h("div", { class: "a-cs-more" }, moreBtn) : null,
        rest.length ? more : null,
      ],
    };
  }

  // 5. 次の一手カードと、続き（往復）
  function viewCard() {
    if (!S.model) buildCard();
    return {
      main: [
        S.fu ? statusBand() : null,
        threadView(),
        S.fu ? nextArea() : null,
      ],
    };
  }

  /** やりとり：カード（いちばん新しいものだけ動く。前のカードはたたむ）と吹き出し。待っている問には選択肢を付ける */
  function threadView() {
    const items = S.fu ? thread() : [{ who: "card" }];
    const lastCard = items.map(x => x.who).lastIndexOf("card");
    const pend = S.fu?.pending;
    const list = h("ol", { class: "a-cs-thread", "aria-label": "やりとり" });
    items.forEach((x, i) => {
      if (x.who === "card") {
        if (i === lastCard) {
          const card = liveCard(S.model, {
            now: S.now, fresh: S.fresh, timers,
            onWant: (p) => { S.extra = { ...S.extra, ...p }; rebuildCard(); },
            onRefine: (p) => { S.extra = applyPatch(S.extra, p); rebuildCard(); },
          });
          S.fresh = false;
          list.append(h("li", { class: "a-cs-thread-card is-live", "data-idx": String(i), "data-who": "card" }, card));
        } else {
          const v = pastCardView(x.card, x.at);
          if (v) list.append(h("li", { class: "a-cs-thread-card", "data-idx": String(i), "data-who": "card" }, v));
        }
        return;
      }
      if (x.who !== "me" && x.who !== "app") return;
      const li = h("li", { class: ["a-cs-msg", x.who === "me" ? "is-me" : "is-app"], "data-idx": String(i), "data-who": x.who, tabindex: "-1" }, bubbleView(x));
      if (pend && pend.n === i && !S.fu.ended) li.append(pendingView(pend));
      list.append(li);
    });
    return list;
  }

  /** 待っている問の選択肢（吹き出しの下） */
  function pendingView(p) {
    const left = S.fu.turns < F.MAX_TURNS;
    if (p.type === "sent") {
      return h("div", { class: "a-cs-msg-opts" },
        left ? chip("返事が来た", () => openComposer("reply")) : null,
        chip("まだ来ない", doNoReply),
        left ? chip("もう少し話したい", () => openComposer("talk")) : null);
    }
    if (p.type === "elapsed") {
      const cur = S.fu.known.elapsed;
      return h("div", { class: "a-cs-msg-opts is-group", role: "group", "aria-label": "最後のやりとりから" },
        h("p", { class: "a-note" }, "ちがうときは選び直せます"),
        h("div", { class: "a-cs-chip-row" }, F.editOptions("elapsed").map(([v, label]) =>
          h("button", { type: "button", class: "a-cs-chip", "aria-pressed": String(v === cur), onclick: () => { if (v !== cur) pickElapsed(v); } }, v === cur ? icon("check", { size: 16 }) : null, label))));
    }
    if (p.type === "replyKind") {
      return h("div", { class: "a-cs-msg-opts is-group", role: "group", "aria-label": F.REPLY_KIND_QUESTION.text },
        h("div", { class: "a-cs-chip-row" }, F.REPLY_KIND_QUESTION.options.map(o => chip(o.label, () => answerReplyKind(o)))));
    }
    if (p.type === "talkQ") {
      return h("div", { class: "a-cs-msg-opts is-group", role: "group", "aria-label": p.q.text },
        h("div", { class: "a-cs-chip-row" }, p.q.options.map(o => chip(o.label, () => answerTalk(o)))),
        h("button", { type: "button", class: "a-link a-link-tap a-cs-skip", onclick: () => answerTalk(null) }, "答えずに進む"));
    }
    return null;
  }
  function chip(label, onClick) {
    return h("button", { type: "button", class: "a-cs-chip", onclick: onClick }, label);
  }

  /** 「いまの状況」の帯（たたむと1行。開くと3行と［ちがうところがある］） */
  function statusBand() {
    const lines = F.statusLines(S.fu.known);
    const panel = h("div", { class: "a-cs-status-panel", id: "a-cs-status-panel", hidden: !S.statusOpen },
      h("ul", { class: "a-cs-status-lines" }, lines.map(t => h("li", null, t))),
      statusEditor());
    const head = h("button", { type: "button", class: "a-cs-status-head", "aria-expanded": String(S.statusOpen), "aria-controls": "a-cs-status-panel" },
      h("span", { class: "a-cs-status-label" }, "いまの状況"),
      h("span", { class: "a-cs-status-one", "aria-hidden": S.statusOpen ? "true" : null }, S.statusOpen ? "" : lines.slice(0, 2).join("。")),
      icon("chevron-down", { size: 18 }));
    head.addEventListener("click", () => {
      S.statusOpen = !S.statusOpen;
      panel.hidden = !S.statusOpen;
      head.setAttribute("aria-expanded", String(S.statusOpen));
      head.querySelector(".a-cs-status-one").textContent = S.statusOpen ? "" : lines.slice(0, 2).join("。");
    });
    return h("section", { class: "a-cs-status", "aria-label": "いまの状況" }, head, panel);
  }
  /** ［ちがうところがある］：項目ごとに選び直す（選ぶと判定し直し） */
  function statusEditor() {
    const id = "a-cs-status-edit";
    const box = h("div", { class: "a-cs-status-edit", id, hidden: true },
      h("p", { class: "a-note" }, "直したい項目を押して、選び直してください。直すと、一手を考え直します。"));
    let openKey = null;
    const rows = h("div", { class: "a-cs-chips", role: "list" });
    const draw = () => {
      rows.replaceChildren();
      for (const key of F.EDIT_KEYS) {
        const cur = S.fu.known[key];
        const open = openKey === key;
        const pid = `a-cs-st-${key}`;
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

  function openComposer(mode) {
    S.composer = mode;
    paint();
    const t = root.querySelector(".a-cs-fu [data-autofocus]");
    t?.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
    t?.focus({ preventScroll: true });
  }

  /** 下：3つのボタン・「あと n 回」・「相談を終える」。開いた欄（貼る・書く・終える）、上限、終えたあと */
  function nextArea() {
    const fu = S.fu;
    const left = Math.max(0, F.MAX_TURNS - fu.turns);
    const pend = fu.pending?.type;
    const sec = (...kids) => h("section", { class: "a-card a-cs-fu", "aria-labelledby": "a-cs-fu-h" }, h("h2", { class: "a-sr", id: "a-cs-fu-h" }, "続きの相談"), kids);

    if (fu.ended) {
      return sec(
        fu.outcome === "worse" ? safetyLine(M.safetyLineResources(fu.safety), "危ないときは") : null,
        h("button", { type: "button", class: "a-btn a-btn-block", onclick: startNew, "data-autofocus": true }, "新しく相談する", icon("arrow-right")),
        h("a", { class: "a-link a-link-tap a-cs-fu-home", href: "#history" }, "履歴を見る"));
    }
    if (S.composer === "end") {
      return sec(
        h("p", { class: "a-cs-fu-q", tabindex: "-1", "data-autofocus": true }, "どうなった？"),
        h("p", { class: "a-note" }, "答えなくても大丈夫です。この相談は履歴に残ります。"),
        h("div", { class: "a-cs-chip-row" }, F.OUTCOMES.map(o => chip(o.label, () => finishEnd(o.key)))),
        h("div", { class: "a-cs-fu-row" },
          h("button", { type: "button", class: "a-link a-link-tap", onclick: () => { S.composer = null; paint(); root.querySelector(".a-cs-end")?.focus(); } }, "まだ続ける"),
          h("button", { type: "button", class: "a-link a-link-tap", onclick: () => finishEnd(null) }, "答えずに終える")));
    }
    if (S.composer === "reply" || S.composer === "talk") return sec(inputPanel(S.composer));

    const foot = h("div", { class: "a-cs-fu-foot" },
      h("p", { class: "a-cs-left" }, `あと${left}回`),
      h("button", { type: "button", class: "a-link a-link-tap a-cs-end", onclick: () => openComposer("end") }, "相談を終える"));
    const firstOnly = fu.thread.length === 1 && !S.resumed;
    const note = firstOnly ? h("div", { class: "a-cs-fu-meta" },
      S.record.id ? h("p", { class: "a-note" }, "このカードは履歴に残しました（この端末の中だけ）。") : null,
      h("button", { type: "button", class: "a-link a-link-tap", onclick: () => go("write") }, "最初から書き直す")) : null;

    if (fu.turns >= F.MAX_TURNS && !["replyKind", "talkQ", "sent"].includes(pend)) {
      return sec(
        h("p", { class: "a-cs-fu-q" }, F.TEXTS.limit),
        h("p", { class: "a-note" }, `1回の相談で続けられるのは${F.MAX_TURNS}回までです。続きは、新しい相談で書いてください。`),
        h("button", { type: "button", class: "a-btn a-btn-block", onclick: startNew }, "新しく相談する", icon("arrow-right")),
        foot);
    }
    // 問に答えるまでは、3つのボタンを出さない（選択肢は吹き出しの下）
    if (pend === "replyKind" || pend === "talkQ" || pend === "sent") {
      return sec(h("p", { class: "a-note a-cs-fu-wait" }, pend === "sent" ? "上の「どうなった？」から選んでください。" : "上の問いに答えると、一手を考え直します。"), foot);
    }
    return sec(
      h("div", { class: "a-rows a-cs-acts" },
        rowLink({ ic: "copy", text: "相手の返事を貼る", onClick: () => openComposer("reply"), attrs: { "data-act": "reply" } }),
        rowLink({ ic: "check", text: "送った", onClick: doSent, attrs: { "data-act": "sent" } }),
        rowLink({ ic: "pencil", text: "もう少し話したい", onClick: () => openComposer("talk"), attrs: { "data-act": "talk" } })),
      foot,
      note);
  }

  /** 貼る欄・書く欄 */
  function inputPanel(mode) {
    const isReply = mode === "reply";
    const id = `a-cs-${mode}-input`;
    const ta = h("textarea", { id, class: "a-textarea a-cs-fu-input", rows: "4", maxlength: String(MAX_CHARS), "data-autofocus": true,
      placeholder: isReply ? "相手から来た文を、そのまま貼ってください" : "いまの気持ちや、気になっていることを書いてください" });
    const go2 = h("button", { type: "button", class: "a-btn a-btn-sm", disabled: true, onclick: () => (isReply ? submitReply : submitTalk)(ta.value) },
      isReply ? "読む" : "送る", icon("arrow-right"));
    ta.addEventListener("input", () => { go2.disabled = !ta.value.trim(); });
    return [
      h("label", { class: "a-cs-fu-q", for: id }, isReply ? "相手の返事を貼る" : "もう少し話したい"),
      ta,
      h("p", { class: "a-note" }, "この端末の中だけで読み取ります。どこにも送りません。"),
      h("div", { class: "a-cs-fu-row" },
        h("button", { type: "button", class: "a-link a-link-tap", onclick: () => {
          S.composer = null;
          paint();
          (root.querySelector(`[data-act="${mode}"]`) || root.querySelector(".a-cs-msg-opts button"))?.focus();
        } }, "やめる"),
        go2),
    ];
  }

  // 安全のカード（「今、危ない」か「危ないときは」）
  function viewSafetyCard() {
    const { card } = M.buildSafetyCard({ text: S.text, safety: curSafety() ?? undefined });
    return { main: [safetyCardView(card, { fresh: true })] };
  }

  // 読み込み直したとき（このタブで続きを開いていた）は続きから。そうでなければ、続きがあれば入力の画面の上に「前の続き」
  const activeId = activeStore.get();
  const active = activeId ? getRecord(activeId) : null;
  if (F.resumable(active)) {
    try { resume(active); } catch (err) { console.error(err); activeStore.set(null); paint(); }
  } else {
    activeStore.set(null);
    S.offer = latestResumable();
    paint();
  }
  return () => {
    clearInterval(tick);
    timers.clear();
    window.removeEventListener("popstate", onPop);
    activeStore.set(null);
  };
}
