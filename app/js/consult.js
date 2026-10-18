// 相談（#consult）。仕様：docs/app-screens.md §4.5（入力・画像5）・§4.6（そのあと）
//   入力 →（危ない兆しがあるときだけ）安全の確認 → 受け止めと状況の整理（ひと続きの文＋ちがうところを直す）→ 足りない問（多くて3つ）→ 次の一手カード
//   流れと中身は poc/card/（統合3。決定 U14・U16・U22〜U26）をそのまま使い、見た目だけ app/ に合わせる。
//   読み取り・足りない問・一手・文面は js/consult/ と poc/card/model.js（どちらも直さない）。カードの部品は app/js/consult_card.js
//   端末の外には何も送らない。書きかけの文とタイマーだけ localStorage に残す（使えなくても動く）。カードが出たら履歴に1件（app/js/local.js）
//
// 戻る：上の「←」は前の段階へ。入力まで戻ったら、もう一度押すと前の画面（ふつうはホーム）へ。
//   段階はハッシュを変えずに進むので、端末の「戻る」でも前の段階に戻れるよう、入力より先にいる間だけ履歴に1つ印を積む（同じ URL）
//
// 履歴の詳細（#history/<id>）との約束：renderSaved(record) が「そのときのカード」を読むだけの形で返す
import { h, icon, topBar, goBack } from "./ui.js";
import { addRecord, removeRecord } from "./local.js";
import { readText } from "../../js/consult/extract.js";
import { nextQuestion } from "../../js/consult/needed.js";
import { applyPatch } from "../../js/consult/context.js";
import { isLateNight } from "../../js/consult/timefmt.js";
import { READ_CASES } from "../../tests/fixtures/consult_read_cases.mjs";
import * as M from "../../poc/card/model.js";
import { liveCard, safetyCardView, safetyLine, snapshotOf, savedView, toggler } from "./consult_card.js";

export const MAX_CHARS = 2000;
const DRAFT_KEY = "seikaku16:app:consult-draft";
/** 「例文を見る」で出す例（tests/fixtures/consult_read_cases.mjs の id。送ったのに返事が来ない／相手からきつい言葉／謝りたい） */
const EXAMPLE_IDS = ["P1", "P2", "P5"];
const TITLE_CHARS = 32;

const draftStore = {
  get() { try { return localStorage.getItem(DRAFT_KEY) ?? ""; } catch { return ""; } },
  set(v) { try { if (v) localStorage.setItem(DRAFT_KEY, v); else localStorage.removeItem(DRAFT_KEY); } catch { /* 使えない */ } },
};

/** 履歴の題：書いた文の冒頭（改行・空白を詰めて、長ければ「…」） */
export function titleOf(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(t);
  return chars.length > TITLE_CHARS ? `${chars.slice(0, TITLE_CHARS).join("")}…` : t;
}

/** 履歴の詳細で出す「そのときのカード」（記録の形が違えば null） */
export function renderSaved(record) {
  try { return savedView(record); } catch (err) { console.error(err); return null; }
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
    model: null,
    fresh: false,
    now: null,
    examplesOpen: false,
    record: { id: null, at: null, text: null },   // この相談の履歴（同じ相談では1件だけ。作り直したら差し替える）
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
    if (stage === "write") dropGuard(); else pushGuard();
  }
  function leave() {
    if (startedOnGuard && history.state?.aCsGuard) { leaving = true; history.back(); return; }
    goBack("#home");
  }
  function back() {
    switch (S.stage) {
      case "write": leave(); return;
      case "safety": go("write"); return;
      case "read": go(S.safetyShown ? "safety" : "write"); return;
      case "ask":
        if (S.answers.length) { S.answers.pop(); go("ask"); } else go("read");
        return;
      case "card":
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
    if (S.record.text !== text) S.record = { id: null, at: null, text };
    S.text = text;
    S.read = readText(text);
    S.lateNight = isLateNight(new Date());
    S.edits = {}; S.editing = null; S.answers = []; S.extra = {}; S.safetyContinue = false;
    // 食い違い・確かでない項目があれば、直す欄を開いておく
    S.fixOpen = M.readChips(S.read, S.read.fields).some(c => c.weak);
    S.safetyShown = M.hasSafetySign(S.read);
    go(S.safetyShown ? "safety" : "read");
  }
  function proceed() {
    if (currentQuestion()) go("ask");
    else { buildCard(); go("card"); }
  }
  function buildCard() {
    S.fresh = true;
    S.now = new Date();
    S.model = M.buildPoc({ known: known(), extra: S.extra, text: S.text, now: S.now, safetyContinue: S.safetyContinue, safety: S.read?.safety });
    saveRecord(S.model);
  }
  function rebuildCard() {
    buildCard();
    paint();
    root.querySelector(".a-cs-card [data-focus]")?.focus({ preventScroll: true });
  }
  function openSafetyCard() {
    if (S.stage !== "safetycard") S.returnTo = S.stage;
    go("safetycard");
  }

  /** カードが出たら履歴に1件（同じ相談では差し替えて1件だけ）。安全のカードは残さない */
  function saveRecord(m) {
    if (!m || m.mode === "safety") return;
    try {
      const k = known();
      delete k.lateNight;
      const data = {
        v: 1,
        text: S.text,
        accept: M.acceptText({ known: k, text: S.text, evidence: editedEvidence() }),
        card: snapshotOf(m),
        input: { known: known(), extra: S.extra, safetyContinue: S.safetyContinue, lateNight: S.lateNight },
      };
      if (S.record.id) removeRecord(S.record.id);
      if (!S.record.at) S.record.at = S.now.toISOString();
      S.record.id = addRecord({ kind: "consult", at: S.record.at, title: titleOf(S.text), sub: m.headline, data });
      if (S.record.id) draftStore.set("");
    } catch (err) {
      console.error(err);
    }
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

    const examples = EXAMPLE_IDS.map(id => READ_CASES.find(c => c.id === id)).filter(Boolean);
    const list = h("div", { class: "a-cs-examples", id: "a-cs-examples", hidden: !S.examplesOpen },
      h("p", { class: "a-note" }, "選ぶと、入力欄に入ります。"),
      h("ul", { class: "a-cs-example-list" }, examples.map(c => h("li", null,
        h("button", { type: "button", class: "a-cs-example", onclick: () => {
          const cur = ta.value.trim();
          if (cur && cur !== c.text && !window.confirm("書いた文を、この例文に入れ替えますか？")) return;
          ta.value = c.text;
          sync();
          draftStore.set(ta.value);
          setOpen(false);
          ta.focus();
        } }, c.text)))));
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
        h("div", { class: "a-cs-intro" },
          h("h1", { class: "a-h1 a-cs-title", tabindex: "-1", "data-focus": true }, "なんでも相談する"),
          h("p", { class: "a-lead" }, "今の気持ちや出来事を自由に書いてください。"),
          h("p", { class: "a-lead" }, "あなたの状況に合わせて、", h("br"), "客観的な視点と具体的なアドバイスをお伝えします。")),
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

  // 2. 安全の確認（規則で兆しを見つけたときだけ。U22）
  function viewSafetyCheck() {
    const cont = () => { S.safetyContinue = true; go("read"); };
    return {
      main: [
        h("h1", { class: "a-cs-q", tabindex: "-1", "data-focus": true }, "いま、身の危険や強い怖さを感じていますか？"),
        h("p", { class: "a-cs-sub" }, "書いてくれた文の中に、気になる言葉がありました。答えに合わせて、このあとを変えます。"),
        h("div", { class: "a-cs-options" },
          option("今、危ない", () => { S.returnTo = "safety"; go("safetycard"); }, "is-stop"),
          option("大丈夫、続ける", cont),
          option("昔の話・人の話", cont)),
        safetyLine(M.safetyLineResources(S.read?.safety), "すぐに話したいとき"),
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

  // 5. 次の一手カード
  function viewCard() {
    if (!S.model) buildCard();
    const card = liveCard(S.model, {
      now: S.now, fresh: S.fresh, timers,
      onWant: (p) => { S.extra = { ...S.extra, ...p }; rebuildCard(); },
      onRefine: (p) => { S.extra = applyPatch(S.extra, p); rebuildCard(); },
    });
    S.fresh = false;
    return {
      main: [
        S.answers.length ? readLine() : null,
        card,
        h("div", { class: "a-cs-foot" },
          S.record.id ? h("p", { class: "a-note" }, "このカードは履歴に残しました（この端末の中だけ）。") : null,
          h("button", { type: "button", class: "a-link a-link-tap", onclick: () => go("write") }, "最初から書き直す")),
      ],
    };
  }
  /**
   * カードの上の小さな1行「読み取った内容」（足りない問に答えたときだけ）。押すと、答えも入れた受け止めの文と「ちがうところを直す」が開く
   */
  function readLine() {
    const k = known();
    delete k.lateNight;
    const panel = h("div", { class: "a-cs-readline-panel", id: "a-cs-readline-panel", hidden: true },
      h("p", null, M.acceptText({ known: k, text: S.text, evidence: editedEvidence() })),
      h("button", { type: "button", class: "a-link a-link-tap", onclick: () => { S.fixOpen = true; go("read"); } }, "ちがうところを直す"));
    return h("div", { class: "a-cs-readline" }, toggler("読み取った内容", panel, "a-link a-link-tap a-cs-toggle a-cs-readline-btn", { chevron: true }), panel);
  }

  // 安全のカード（「今、危ない」か「危ないときは」）
  function viewSafetyCard() {
    const { card } = M.buildSafetyCard({ text: S.text, safety: S.read?.safety });
    return { main: [safetyCardView(card, { fresh: true })] };
  }

  paint();
  return () => {
    clearInterval(tick);
    timers.clear();
    window.removeEventListener("popstate", onPop);
  };
}
