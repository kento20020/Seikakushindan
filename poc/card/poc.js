// 次の一手カードの試作（統合1・統合3）。案D の流れ：書く → （安全の兆しがあれば確認）→ こう読み取りました → 足りない問（3つまで）→ カード。
// 設計：docs/ui-design-thinking.md §6・§7、決定 U14・U16・U22・U23。DOM を使わない部分は model.js。
// 読み取り・足りない問・一手・文面は本物（js/consult/）。伝えたいこと・相手はたぶん・道のりは試作の決まった文（model.js）。
// 端末の外には何も送らない。保存は localStorage（キーは poc-card-。使えなくても動く）。
import { readText } from "../../js/consult/extract.js";
import { nextQuestion } from "../../js/consult/needed.js";
import { applyPatch } from "../../js/consult/context.js";
import { checkDraft, LEVELS } from "../../js/consult/draft_check.js";
import { doNowLabel } from "../../js/consult/texts.js";
import { isLateNight } from "../../js/consult/timefmt.js";
import { READ_CASES } from "../../tests/fixtures/consult_read_cases.mjs";
import * as M from "./model.js";

// ---------------------------------------------------------------- 小さな道具
const SVG = "http://www.w3.org/2000/svg";
const ICONS = "../../img/icons.svg";
let uidN = 0;
const uid = (p) => `${p}-${++uidN}`;

/** 要素を作る。props：class・text・on〜（イベント）・そのほかは属性（true は空の属性、false/null は付けない） */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  return add(el, kids);
}
/** 子を足す（null・false は飛ばす。配列は平らにする） */
function add(el, ...kids) {
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
/** img/icons.svg の線のアイコン（飾り。意味はボタンの文字で伝える） */
function icon(name, cls = "") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", `icon ${cls}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `${ICONS}#${name}`);
  svg.append(use);
  return svg;
}
/** icons.svg に無い線のアイコン（鍵・時計）。同じ線の太さ・viewBox */
const EXTRA_ICONS = {
  lock: '<rect x="5.75" y="10.75" width="12.5" height="9.5" rx="2"/><path d="M8.75 10.75V8a3.25 3.25 0 0 1 6.5 0v2.75"/><path d="M12 14.5v2"/>',
  clock: '<circle cx="12" cy="13" r="7.75"/><path d="M12 9.25V13l2.5 1.75"/><path d="M9.5 2.75h5"/>',
};
function icon2(name, cls = "") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", `icon ${cls}`.trim());
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = EXTRA_ICONS[name];
  return svg;
}

// 保存（使えない環境では黙って何もしない）
const store = {
  get(key) { try { const v = localStorage.getItem(`poc-card-${key}`); return v == null ? null : JSON.parse(v); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(`poc-card-${key}`, JSON.stringify(v)); return true; } catch { return false; } },
  del(key) { try { localStorage.removeItem(`poc-card-${key}`); } catch { /* 使えない */ } },
};

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------------------------------------------------------------- 状態
const params = new URLSearchParams(location.search);
const S = {
  screen: "write",
  text: "",
  read: null,          // readText の結果
  lateNight: false,
  edits: {},           // 「こう読み取りました」で直した項目（null は「分からない」＝外す）
  editing: null,       // 直している項目
  answers: [],         // 足りない問の答え [{ q, patch, label }]
  extra: {},           // カードで足した差分（［ちがう］［もっと合わせる］）
  safetyShown: false,  // 安全の確認を出したか
  safetyContinue: false,
  returnTo: "write",   // 安全のカードから戻る先
  model: null,
  now: null,
  layout: M.layoutOf(location.search),
  compare: M.compareOf(location.search),
  theme: M.themeOf(location.search, store.get("theme")),
};
const wideMQ = window.matchMedia(`(min-width: ${M.COMPARE_MIN_WIDTH}px)`);
const main = document.getElementById("main");
let timerTick = null;
/** 表示中の戻る時刻の更新（30秒ごと） */
const timeBlocks = new Set();

// ---------------------------------------------------------------- 試作の設定（並び・見比べる・表示）
function setUrl() {
  const p = new URLSearchParams(location.search);
  p.set("v", S.layout);
  if (S.compare) p.set("compare", "1"); else p.delete("compare");
  p.delete("theme");
  history.replaceState(null, "", `${location.pathname}?${p}${location.hash}`);
}
const THEME_LABEL = { auto: "自動", light: "ライト", dark: "ダーク" };
function applyTheme() {
  if (S.theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", S.theme);
  const b = document.querySelector("[data-theme-cycle]");
  if (b) b.textContent = `表示：${THEME_LABEL[S.theme]}`;
}
function syncBar() {
  for (const b of document.querySelectorAll("[data-layout]")) b.setAttribute("aria-pressed", String(b.dataset.layout === S.layout));
  const c = document.querySelector("[data-compare]");
  if (c) c.setAttribute("aria-pressed", String(S.compare));
}
function initBar() {
  for (const b of document.querySelectorAll("[data-layout]")) {
    b.addEventListener("click", () => { S.layout = b.dataset.layout; setUrl(); syncBar(); if (S.screen === "card") render(); });
  }
  document.querySelector("[data-compare]")?.addEventListener("click", () => { S.compare = !S.compare; setUrl(); syncBar(); if (S.screen === "card") render(); });
  document.querySelector("[data-theme-cycle]")?.addEventListener("click", () => {
    S.theme = M.THEMES[(M.THEMES.indexOf(S.theme) + 1) % M.THEMES.length];
    store.set("theme", S.theme);
    applyTheme();
  });
  document.getElementById("back").addEventListener("click", back);
  document.getElementById("danger").addEventListener("click", (e) => { e.preventDefault(); openSafetyCard(); });
  wideMQ.addEventListener?.("change", () => { if (S.screen === "card") render(); });
  syncBar();
  applyTheme();
}

// ---------------------------------------------------------------- 流れ
function known() { return M.knownFrom(S.read?.fields, S.edits, S.answers.map(a => a.patch), { lateNight: S.lateNight }); }
function currentQuestion() { return nextQuestion(known(), S.answers.map(a => a.q)); }

function go(screen) {
  S.screen = screen;
  render();
  window.scrollTo(0, 0);
  main.querySelector("[data-focus]")?.focus({ preventScroll: true });
}
function back() {
  switch (S.screen) {
    case "write": location.href = "../../"; return;
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
function startRead(text) {
  S.text = text;
  S.read = readText(text);
  S.lateNight = isLateNight(new Date());
  S.edits = {}; S.editing = null; S.answers = []; S.extra = {}; S.safetyContinue = false;
  S.safetyShown = M.hasSafetySign(S.read);
  go(S.safetyShown ? "safety" : "read");
}
function proceed() {
  if (currentQuestion()) go("ask");
  else { buildCard(); go("card"); }
}
function buildCard() {
  S.now = new Date();
  S.model = M.buildPoc({ known: known(), extra: S.extra, text: S.text, now: S.now, safetyContinue: S.safetyContinue, safety: S.read?.safety });
}
function rebuildCard(focusHead = true) {
  buildCard();
  render();
  if (focusHead) main.querySelector(".card [data-focus]")?.focus({ preventScroll: true });
}
function openSafetyCard() {
  if (S.screen !== "safetycard") S.returnTo = S.screen;
  go("safetycard");
}

// ---------------------------------------------------------------- 画面
function render() {
  clearInterval(timerTick);
  timerTick = null;
  timeBlocks.clear();
  main.replaceChildren();
  main.classList.toggle("is-wide", S.screen === "card" && S.compare && wideMQ.matches);
  const view = { write: viewWrite, safety: viewSafetyCheck, read: viewRead, ask: viewAsk, card: viewCard, safetycard: viewSafetyCard }[S.screen] || viewWrite;
  add(main, view());
}

// 1. 書く
function viewWrite() {
  const ta = h("textarea", { id: "consult-text", class: "write", rows: "7", "aria-describedby": "write-note",
    placeholder: "例：会って喧嘩したあと、彼から「もういい」ってLINEが来た" });
  ta.value = S.text;
  const list = h("ul", { class: "examples", id: "examples", hidden: true },
    READ_CASES.map(c => h("li", {}, h("button", { type: "button", class: "btn-option example", onclick: () => {
      ta.value = c.text; list.hidden = true; exBtn.setAttribute("aria-expanded", "false"); ta.focus();
    } }, c.text))));
  const exBtn = h("button", { type: "button", class: "linkbtn", "aria-expanded": "false", "aria-controls": "examples", onclick: () => {
    list.hidden = !list.hidden; exBtn.setAttribute("aria-expanded", String(!list.hidden));
  } }, "例を入れる", icon("chevron-down", "chev"));
  return [
    h("h1", { class: "title-xl", tabindex: "-1", "data-focus": true }, "何があった？"),
    h("label", { class: "lead", for: "consult-text" }, "そのまま書いてください。短くても大丈夫です。"),
    ta,
    h("div", { class: "write-tools" }, exBtn),
    list,
    h("button", { type: "button", class: "btn-primary", onclick: () => startRead(ta.value) }, "読み取る"),
    h("p", { class: "note", id: "write-note" }, "書いた文は、この端末の中だけで読み取ります。どこにも送りません。"),
  ];
}

// 2. 安全の確認（規則で兆しを見つけたときだけ。U22）
function safetyLine(resources, lead = "危ないと感じたら") {
  return h("p", { class: "safety-line" }, h("span", {}, lead),
    resources.map(r => h("a", { class: "tel-inline", href: M.telHref(r.contact) }, `${r.name} ${r.contact}`)));
}
function viewSafetyCheck() {
  const cont = () => { S.safetyContinue = true; go("read"); };
  return [
    h("h1", { class: "title", tabindex: "-1", "data-focus": true }, "いま、身の危険や強い怖さを感じていますか？"),
    h("p", { class: "lead" }, "書いてくれた文の中に、気になる言葉がありました。答えに合わせて、このあとを変えます。"),
    h("div", { class: "options" },
      h("button", { type: "button", class: "btn-option is-stop", onclick: () => { S.returnTo = "safety"; go("safetycard"); } }, "今、危ない"),
      h("button", { type: "button", class: "btn-option", onclick: cont }, "大丈夫、続ける"),
      h("button", { type: "button", class: "btn-option", onclick: cont }, "昔の話・人の話")),
    safetyLine(M.safetyLineResources(S.read?.safety), "すぐに話したいとき"),
  ];
}

// 3. こう読み取りました
function viewRead() {
  const k = M.knownFrom(S.read?.fields, S.edits);
  const chips = M.readChips(S.read, k, S.edits);
  const wrap = h("div", { class: "chips", role: "list" });
  for (const c of chips) {
    const open = S.editing === c.key;
    const panelId = `edit-${c.key}`;
    wrap.append(h("div", { role: "listitem", class: "chip-item" },
      h("button", { type: "button", class: `chip${c.weak ? " is-weak" : ""}`, "aria-expanded": String(open), "aria-controls": open ? panelId : null,
        onclick: () => { S.editing = open ? null : c.key; render(); main.querySelector(`[data-chip="${c.key}"]`)?.focus(); }, "data-chip": c.key },
        h("span", {}, c.text), c.weak ? h("span", { class: "chip-flag" }, "たしかめて") : null, icon("chevron-down", "chev"))));
    if (open) wrap.append(editPanel(c, panelId));
  }
  // 直して外した項目・読めなかった項目は、このあと必要なら聞く
  return [
    h("h1", { class: "title", tabindex: "-1", "data-focus": true }, "こう読み取りました"),
    chips.length ? h("p", { class: "lead" }, "ちがうところは、押すと直せます。") : h("p", { class: "lead" }, "読み取れたことはありませんでした。"),
    chips.length ? wrap : null,
    h("p", { class: "note" }, "足りないところは、このあと少しだけ聞きます（多くて3つ）。"),
    h("button", { type: "button", class: "btn-primary", onclick: proceed }, "この内容で進む"),
  ];
}
function editPanel(c, id) {
  const pick = (v) => { S.edits = { ...S.edits, [c.key]: v }; S.editing = null; render(); main.querySelector(`[data-chip="${c.key}"]`)?.focus(); };
  const opts = M.fieldOptions(c.key);
  return h("div", { class: "edit-panel", id, role: "group", "aria-label": `${M.FIELD_NAMES[c.key]}を直す` },
    c.evidence ? h("p", { class: "note" }, `「${c.evidence}」から読み取りました`) : null,
    h("p", { class: "edit-q" }, M.FIELD_NAMES[c.key]),
    h("div", { class: "chip-row" },
      opts.map(([v, label]) => {
        const on = c.value === v;
        return h("button", { type: "button", class: "chip", "aria-pressed": String(on), onclick: () => pick(v) }, on ? icon("check") : null, label);
      }),
      h("button", { type: "button", class: "chip is-quiet", onclick: () => pick(null) }, "分からない（あとで聞く）")));
}

// 4. 足りない問（1画面に1問）
function viewAsk() {
  const q = currentQuestion();
  if (!q) { buildCard(); S.screen = "card"; return viewCard(); }
  const n = S.answers.length + 1;
  const answer = (o) => { S.answers.push({ q, patch: o.patch, label: o.label }); proceed(); };
  const btn = (o) => h("button", { type: "button", class: "btn-option", onclick: () => answer(o) }, o.label);
  const first = q.primary ? q.options.slice(0, q.primary) : q.options;
  const rest = q.primary ? q.options.slice(q.primary) : [];
  const more = h("div", { class: "options", id: "more-options", hidden: true }, rest.map(btn));
  const moreBtn = rest.length ? h("button", { type: "button", class: "linkbtn", "aria-expanded": "false", "aria-controls": "more-options", onclick: () => {
    more.hidden = false; moreBtn.remove(); more.querySelector("button")?.focus();
  } }, q.moreLabel || "ほかの選択肢", icon("chevron-down", "chev")) : null;
  return [
    h("p", { class: "step" }, `あと少しだけ聞きます（${n}つめ・多くて3つ）`),
    h("h1", { class: "title", tabindex: "-1", "data-focus": true }, q.text),
    h("div", { class: "options" }, first.map(btn)),
    moreBtn, rest.length ? more : null,
  ];
}

// 5. カード
function viewCard() {
  if (!S.model) buildCard();
  const showBoth = S.compare && wideMQ.matches;
  const layouts = showBoth ? ["1", "3"] : [S.layout];
  const cards = h("div", { class: `cards${showBoth ? " is-two" : ""}` },
    layouts.map(l => h("section", { class: "card-col", "aria-label": `統合${l}` },
      S.compare ? h("p", { class: "poc-col" }, `統合${l}`) : null,
      cardView(S.model, l))));
  if (timeBlocks.size) timerTick = setInterval(() => { for (const f of timeBlocks) f(); }, 30000);
  return [cards,
    h("p", { class: "card-foot" }, h("button", { type: "button", class: "linkbtn", onclick: () => go("write") }, "最初から書き直す"))];
}

function cardView(m, layout) {
  if (m.mode === "safety") return safetyCardView(m.card);
  const art = h("article", { class: `card enter layout-${layout}` });
  const ids = { head: uid("head") };
  art.setAttribute("aria-labelledby", ids.head);
  const decide = h("div", { class: "c-decide" });
  const later = h("div", { class: "c-later" });
  if (m.safetyLine) add(decide, safetyLine(m.safetyLine));
  const action = m.mode === "send" ? sendBlock(m, layout) : waitBlock(m, layout);
  if (layout === "3") {
    // 統合3：伝えたいのは（小さな1行）→ 結論（＋時刻）→ 理由の1行目［なぜ？］→ 文面［コピー］・足さない方がいい一言／待つ間［預ける］
    add(decide, m.want ? wantLine(m) : null, headline(m, ids.head), timingNote(m), timeBlock(m), reasonFirst(m, true), action);
    add(later, afterBlock3(m), m.road != null ? roadView(m.road, false) : null, confBlock(m, layout));
  } else {
    // 統合1：伝えたいこと（独立した箱）→ 結論＋時刻 → 理由の1行目 → 文面／待つ間 → 避けたい言葉 → 相手はたぶん → その後 → 道のり → ［なぜ？］と確かさ
    add(decide, m.want ? wantBox(m) : null, headline(m, ids.head), timingNote(m), timeBlock(m), reasonFirst(m, false), action);
    add(later, avoidChips(m), guess1(m), after1(m), m.road != null ? roadView(m.road, true) : null, confBlock(m, layout));
  }
  return add(art, decide, h("hr", { class: "c-rule" }), later);
}

// ---- 部品（統合1・3 で共通のもの）
function headline(m, id) {
  return h("h2", { class: "c-head", id, tabindex: "-1", "data-focus": true }, m.card.headline);
}
function timingNote(m) { return m.card.timingLine ? h("p", { class: "c-note" }, m.card.timingLine) : null; }

/** 伝えたいことの選び直し（［ちがう］）。選ぶとカードを作り直す */
function wantChooser(m, id) {
  return h("div", { class: "c-choose", id, hidden: true, role: "group", "aria-label": "どうしたい？" },
    h("p", { class: "edit-q" }, "どうしたい？"),
    h("div", { class: "chip-row" }, M.WANTS.map(w => {
      const on = w.key === m.want.key;
      return h("button", { type: "button", class: "chip", "aria-pressed": String(on), onclick: () => {
        const p = M.wantPatch(w.key, m.ctx.input);
        if (!Object.keys(p).length) { document.getElementById(id).hidden = true; return; }
        S.extra = { ...S.extra, ...p };
        rebuildCard();
      } }, on ? icon("check") : null, w.label);
    })));
}
function toggler(label, panel, cls = "linkbtn") {
  const b = h("button", { type: "button", class: cls, "aria-expanded": "false", "aria-controls": panel.id }, label);
  b.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    b.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) panel.querySelector("button, textarea, a")?.focus({ preventScroll: true });
  });
  return b;
}
function wantLine(m) {
  const chooser = wantChooser(m, uid("want"));
  return h("div", { class: "c-want-wrap" },
    h("p", { class: "c-want" }, h("span", {}, h("b", {}, "伝えたいのは"), "：", m.want.text), toggler("ちがう", chooser, "inline-link")),
    chooser);
}
function wantBox(m) {
  const chooser = wantChooser(m, uid("want"));
  return h("section", { class: "c-want-box" },
    h("p", { class: "c-label is-primary" }, "あなたが伝えたいのは"),
    h("p", { class: "c-want-big" }, m.want.text),
    h("div", { class: "c-want-actions" }, toggler("ちがう", chooser, "chip")),
    chooser);
}

/** 戻る時刻（大きな数字）＋細い進み具合の線＋［タイマー］。時刻まで待つ一手だけ */
function timeBlock(m) {
  const r = m.ret;
  if (!r) return null;
  const fill = h("i", {}), dot = h("b", {});
  const remain = h("span", { class: "c-remain", "aria-live": "polite" });
  const btnLabel = h("span", {}, "タイマー");
  const btn = h("button", { type: "button", class: "timer-btn", "aria-pressed": "false" }, icon2("clock"), btnLabel);
  const key = r.at.toISOString();
  const update = () => {
    const t = store.get("timer");
    const on = t?.at === key;
    btn.setAttribute("aria-pressed", String(on));
    btnLabel.textContent = on ? "タイマーを止める" : "タイマー";
    const now = new Date();
    const p = on ? M.progressOf(new Date(t.start), r.at, now) : 0;
    fill.style.width = `${(p * 100).toFixed(1)}%`;
    dot.style.left = `${(p * 100).toFixed(1)}%`;
    remain.textContent = on ? M.remainingText(r.at, now) : "";
  };
  btn.addEventListener("click", () => {
    const t = store.get("timer");
    if (t?.at === key) store.del("timer");
    else store.set("timer", { at: key, start: new Date().toISOString() });
    update();
  });
  update();
  timeBlocks.add(update);
  return h("div", { class: "c-time" },
    h("div", { class: "c-time-row" },
      h("p", { class: "c-time-main" }, h("span", { class: "c-label" }, M.timeLabel(m.result.action)), h("span", { class: "c-big" }, r.text)),
      btn),
    h("div", { class: "track", "aria-hidden": "true" }, fill, dot),
    h("p", { class: "c-time-foot" }, h("span", {}, `いま ${M.clockOf(S.now)}${r.approx ? `（朝は${M.MORNING_HOUR}時を目安にしています）` : ""}`), remain));
}

/** 理由の1行目（無料で全員に。U23）。統合3 は直後に［なぜ？］で2行目から */
function reasonFirst(m, withWhy) {
  const rs = m.card.reasons;
  const p = h("p", { class: "c-reason" }, rs[0] ?? "");
  if (!withWhy || rs.length < 2) return p;
  const panel = whyPanel(m);
  add(p, " ", toggler("なぜ？", panel, "inline-link is-strong"));
  return [p, panel];
}
function whyPanel(m) {
  return h("ul", { class: "c-why", id: uid("why"), hidden: true }, m.card.reasons.slice(1).map(t => h("li", {}, t)));
}

/** 送る吹き出し（相手の画面にこう届く）＋［コピー］ */
function bubbleUnit(drafts, { primary = true } = {}) {
  let i = 0;
  const bubble = h("p", { class: "bubble" }, drafts[0].text);
  const copy = h("button", { type: "button", class: primary ? "btn-primary" : "btn-secondary", onclick: () => copyText(bubble.textContent, bubble) },
    icon("copy"), "コピー");
  let alt = null;
  if (drafts[1]) {
    alt = h("button", { type: "button", class: "inline-link", "aria-pressed": "false" }, "別の言い方");
    alt.addEventListener("click", () => {
      i = 1 - i;
      bubble.textContent = drafts[i].text;
      alt.textContent = i ? "最初の言い方" : "別の言い方";
      alt.setAttribute("aria-pressed", String(!!i));
    });
  }
  return { bubble, copy, alt };
}
function sendBlock(m, layout) {
  const d = m.card.drafts;
  const { bubble, copy, alt } = bubbleUnit(d);
  const out = h("div", { class: "c-send" },
    h("div", { class: "c-send-top" }, h("span", { class: "c-label" }, d[0].label), alt),
    bubble, copy);
  return add(out, layout === "3" ? avoidLine(m) : null, m.card.doNow ? keepRow(m) : null);
}
/** 送る一手の「送りたくなった文は、ここに預けて」（書く欄は押すと開く） */
function keepRow(m) {
  const box = keepBox(m, uid("keep"), "送りたくなった文を、ここに書いて預けられます");
  const panel = h("div", { class: "c-keep-panel", id: uid("keeppanel"), hidden: true }, box.box, box.button, box.hint);
  return h("div", { class: "c-keep-row" },
    h("div", { class: "c-keep-line" }, h("p", { class: "c-small" }, m.card.doNow), toggler("書いて預ける", panel, "btn-secondary is-small")),
    panel);
}
/** 送らない吹き出し（預ける箱）。鍵の印。［預ける］で端末に保存 */
function keepBox(m, id, placeholder) {
  const saved = store.get("kept");
  const ta = h("textarea", { id, class: "keep-input", rows: "3", placeholder, "aria-label": "預ける文（送りません）" });
  if (saved?.consult === S.text) ta.value = saved.text;
  const hint = h("p", { class: "c-hint", hidden: true }, "預けたい文を書いてから押してください。");
  const button = h("button", { type: "button", class: "btn-primary", onclick: () => {
    const v = ta.value.trim();
    if (!v) { hint.hidden = false; ta.focus(); return; }
    hint.hidden = true;
    store.set("kept", { text: v, savedAt: new Date().toISOString(), returnAt: m.ret?.at?.toISOString?.() ?? null, consult: S.text });
    toast("預けました。戻る時刻に読み直せます");
  } }, icon2("lock"), "預ける");
  const box = h("div", { class: "keep" }, ta, icon2("lock", "keep-lock"));
  return { box, button, hint, ta };
}
const KEEP_PLACEHOLDER = {
  wait_until: "送りたくなった文を、ここに書いて預けられます",
  self_calm: "何が引っかかっているか、1つだけ",
  prepare_points: "出来事：\n気持ち：\nお願い：",
};
function waitBlock(m, layout) {
  const a = m.result.action;
  const kb = keepBox(m, uid("keep"), KEEP_PLACEHOLDER[a] || KEEP_PLACEHOLDER.wait_until);
  const out = h("div", { class: "c-send is-wait" },
    h("div", { class: "c-send-top" }, h("span", { class: "c-label" }, doNowLabel(a))),
    m.card.doNow ? h("p", { class: "c-donow" }, m.card.doNow) : null,
    kb.box, kb.button, kb.hint);
  // ［それでも今送りたい］と「期限が来たら、この1通」
  const urge = urgePanel(m, kb.ta);
  const links = h("div", { class: "c-links" }, toggler("それでも今送りたい", urge));
  let later = null;
  if (m.card.drafts.length) {
    const u = bubbleUnit(m.card.drafts, { primary: false });
    later = h("div", { class: "c-later-draft", id: uid("laterdraft"), hidden: true }, u.alt ? h("div", { class: "c-send-top" }, u.alt) : null, u.bubble, u.copy);
    const t = toggler(m.card.drafts[0].label, later);
    t.append(icon("chevron-down", "chev"));
    links.append(t);
  }
  return add(out, links, urge, later, layout === "3" ? avoidLine(m) : null);
}
/** それでも今送りたい：送りたい文の欄 → 送る前チェック（届きやすさ3段階・数字なし）と避けたい言葉の印 */
function urgePanel(m, keepTa) {
  const id = uid("urge");
  const ta = h("textarea", { class: "urge-input", rows: "3", "aria-label": "送りたい文", placeholder: "送りたい文を書いてください" });
  const level = h("p", { class: "c-level" });
  const hits = h("ul", { class: "c-hits" });
  const result = h("div", { class: "c-check", "aria-live": "polite" }, level, hits);
  const run = () => {
    const v = ta.value.trim();
    hits.replaceChildren();
    if (!v) { level.replaceChildren("書くと、相手に届きやすいかをここに出します。"); level.className = "c-level is-empty"; return; }
    const r = checkDraft(v, { action: null, avoid: m.result.avoid });
    level.className = `c-level${r.level === LEVELS[2] ? " is-stop" : ""}`;
    level.replaceChildren("届きやすさ：", h("b", {}, r.level));
    for (const x of r.hits) hits.append(h("li", {}, x.id === "long" || x.id === "missing_time" ? M.HIT_LABELS[x.id] : h("span", {}, h("mark", {}, `「${x.text}」`), M.HIT_LABELS[x.id] ?? "")));
  };
  ta.addEventListener("input", run);
  const panel = h("div", { class: "c-urge", id, hidden: true },
    ta, result,
    h("button", { type: "button", class: "btn-secondary", onclick: () => copyText(ta.value, ta) }, icon("copy"), "この文をコピー"),
    h("p", { class: "c-small" }, "送る前に、上の箱に預けて、戻る時刻に読み直すこともできます。"));
  // 開いたとき、預ける箱に書いた文があれば写す
  const obs = new MutationObserver(() => { if (!panel.hidden && !ta.value && keepTa.value) { ta.value = keepTa.value; } run(); });
  obs.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  run();
  return panel;
}

/** 統合3：足さない方がいい一言（文面のすぐ下） */
function avoidLine(m) {
  if (!m.card.avoid.length) return null;
  return h("p", { class: "c-dont" }, h("span", { class: "stop" }, "足さない方がいい一言："), m.card.avoid.map(M.avoidPhrase).join(""));
}
/** 統合1：避けたい言葉（チップ） */
function avoidChips(m) {
  if (!m.card.avoid.length) return null;
  return h("section", { class: "c-sec" }, h("h3", { class: "c-label" }, "避けたい言葉"),
    h("ul", { class: "stop-chips" }, m.card.avoid.map(t => h("li", {}, t))));
}

/** 「返事が来たら → …」を「返事が来たら、…」に（条件を太く） */
function condLine(text) {
  const i = text.indexOf(" → ");
  if (i < 0) return h("p", { class: "c-cond" }, text);
  return h("p", { class: "c-cond" }, h("b", {}, text.slice(0, i)), "、", text.slice(i + 3));
}
function guessP(m) {
  if (!m.guess) return null;
  return h("p", { class: "c-guess" }, h("b", {}, "相手はたぶん"), "、", m.guess, " ", h("span", { class: "tag", title: "AI がつながるまでの、決まった仮の文です" }, "仮の文"));
}
function afterBlock3(m) {
  return h("section", { class: "c-sec" },
    h("h3", { class: "c-label" }, "このあと"),
    guessP(m),
    m.card.addonLines.map(t => h("p", { class: "c-cond" }, t)),
    m.card.ifReply ? condLine(m.card.ifReply) : null,
    m.card.ifNoReply ? condLine(m.card.ifNoReply) : null);
}
function guess1(m) {
  if (!m.guess) return null;
  return h("section", { class: "c-sec" }, h("h3", { class: "c-label" }, "相手はたぶん"),
    h("p", { class: "c-guess" }, m.guess, " ", h("span", { class: "tag", title: "AI がつながるまでの、決まった仮の文です" }, "仮の文")));
}
function after1(m) {
  const lines = [...m.card.addonLines.map(t => h("p", { class: "c-cond" }, t)),
    m.card.ifReply ? condLine(m.card.ifReply) : null, m.card.ifNoReply ? condLine(m.card.ifNoReply) : null].filter(Boolean);
  if (!lines.length) return null;
  return h("section", { class: "c-sec" }, h("h3", { class: "c-label" }, "その後"), lines);
}
/** 道のり：①落ち着く → ②話す場をつくる → ③伝える → ④分かってもらう。いまの段を示す */
function roadView(step, withLabel) {
  const marks = ["①", "②", "③", "④"];
  return h("section", { class: "c-sec" },
    withLabel ? h("h3", { class: "c-label" }, "道のり") : null,
    h("ol", { class: "road", "aria-label": "仲直りまでの道のり" }, M.ROAD.map((name, i) =>
      h("li", { "aria-current": i === step ? "step" : null }, `${marks[i]}${name}`, i === step ? h("span", { class: "here" }, "いまはここ") : null))));
}
/** 確かさ＋相手のタイプで変わるところ＋［もっと合わせる］。統合1 は［なぜ？］もここ */
function confBlock(m, layout) {
  const out = h("section", { class: "c-sec c-conf" });
  if (layout === "1" && m.card.reasons.length > 1) {
    const panel = whyPanel(m);
    out.append(h("div", { class: "c-why-wrap" }, toggler("なぜ？", panel, "btn-secondary is-small")), panel);
  }
  const line = h("div", { class: "c-conf-line" }, h("p", { class: "c-small" }, `確かさ：${m.card.confidenceLine ?? ""}`));
  out.append(line);
  if (m.card.variantLines.length) out.append(h("ul", { class: "c-variants" }, m.card.variantLines.map(t => h("li", {}, t.replace(" → ", "、")))));
  if (m.refine.length) {
    const panel = h("div", { class: "c-refine", id: uid("refine"), hidden: true },
      m.refine.map(q => h("div", { class: "c-refine-q", role: "group", "aria-label": q.text },
        h("p", { class: "edit-q" }, q.text),
        h("div", { class: "chip-row" }, q.options.map(o => h("button", { type: "button", class: "chip", onclick: () => {
          S.extra = applyPatch(S.extra, o.patch);
          rebuildCard();
        } }, o.label))))));
    line.append(toggler("もっと合わせる", panel, "btn-secondary is-small"));
    out.append(panel);
  }
  return out;
}

// ---- 安全のカード
function viewSafetyCard() {
  const { card } = M.buildSafetyCard({ text: S.text, safety: S.read?.safety });
  return [safetyCardView(card)];
}
function safetyCardView(card) {
  const s = card.safety;
  return h("article", { class: "card enter card--safety", "aria-labelledby": "safety-head" },
    h("h2", { class: "c-head is-plain", id: "safety-head", tabindex: "-1", "data-focus": true }, card.headline),
    h("p", { class: "c-reason" }, s.intro),
    h("ul", { class: "res" }, s.resources.map(r => h("li", {},
      h("span", { class: "res-name" }, r.name),
      h("a", { class: "tel", href: M.telHref(r.contact) }, r.contact),
      h("span", { class: "c-small" }, r.note)))),
    h("ul", { class: "steps" }, s.steps.map(t => h("li", {}, t))),
    h("p", { class: "c-small" }, s.closing));
}

// ---------------------------------------------------------------- コピー
function selectText(el) {
  try {
    if (el.select) { el.focus(); el.select(); return; }
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  } catch { /* 選べない */ }
}
async function copyText(text, el) {
  const v = String(text || "").trim();
  if (!v) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
    await navigator.clipboard.writeText(v);
    toast("コピーしました");
  } catch {
    selectText(el);
    toast("文を選びました。そのままコピーできます");
  }
}

// ---------------------------------------------------------------- はじめ
initBar();
const ex = params.get("ex");
const exCase = ex && READ_CASES.find(c => c.id === ex);
if (exCase) S.text = exCase.text;
render();
