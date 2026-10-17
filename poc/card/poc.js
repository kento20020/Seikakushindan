// 次の一手カードの試作（統合1・統合3）。案D の流れ：書く → （安全の兆しがあれば確認）→ 受け止め（事実と気持ちをひと続きの文で。直せる）→ 足りない問（3つまで）→ カード。
// 設計：docs/ui-design-thinking.md §6・§7、決定 U14・U16・U22・U23。DOM を使わない部分は model.js。
// 読み取り・足りない問・一手・文面は本物（js/consult/）。伝えたいこと・相手はたぶん・道のりは試作の決まった文（model.js）。
// 端末の外には何も送らない。保存は localStorage（キーは poc-card-。タイマーと表示だけ。使えなくても動く）。預ける機能は持ち主の判断で外した。
// URL：?v=1|3（並び。既定 3）、?compare=1（幅 900px 以上で統合1と統合3を左右に）、?theme=light|dark、?ex=P2 など（例の文を入れておく。tests/fixtures/consult_read_cases.mjs の id）
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
/** icons.svg に無い線のアイコン（時計）。同じ線の太さ・viewBox */
const EXTRA_ICONS = {
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
  fixOpen: false,      // 「ちがうところを直す」を開いているか
  answers: [],         // 足りない問の答え [{ q, patch, label }]
  extra: {},           // カードで足した差分（［ちがう］［もっと合わせる］）
  safetyShown: false,  // 安全の確認を出したか
  safetyContinue: false,
  returnTo: "write",   // 安全のカードから戻る先
  model: null,
  fresh: false,        // 作ったばかりのカード（出るときだけ短くフェードする）
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
  // 幅が変わって「左右に並べるか」が変わったときだけ描き直す（書きかけの文や開いた欄を消さないため）
  wideMQ.addEventListener?.("change", () => { if (S.screen === "card" && S.compare && showBoth() !== shownBoth) render(); });
  syncBar();
  applyTheme();
}

// ---------------------------------------------------------------- 流れ
function known() {
  const k = M.knownFrom(S.read?.fields, S.edits, S.answers.map(a => a.patch), { lateNight: S.lateNight });
  delete k.want;   // 「どうしたい」のチップの印（判定の入力ではない）
  return k;
}
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
  // 食い違い・確率が低い項目があれば、直す欄を開いておく
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
  main.classList.toggle("is-wide", S.screen === "card" && showBoth());
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

// 3. 受け止め（事実と気持ちをひと続きの文で）→ ちがうところを直す → 次へ
function readKnown() { return M.knownFrom(S.read?.fields, S.edits); }
function viewRead() {
  const k = readKnown();
  const text = M.acceptText({ known: k, text: S.text, evidence: editedEvidence(), safetyContinue: S.safetyContinue });
  const chips = fixChips(k);
  const weak = chips.some(c => c.weak);
  const panel = h("div", { class: "fix-panel", id: "fix-panel", hidden: !S.fixOpen },
    h("p", { class: "note" }, weak ? "点線のところは、読み取りが確かではありません。押して確かめてください。" : "押すと、選び直せます。"),
    chipList(chips));
  const fixBtn = h("button", { type: "button", class: "linkbtn", "aria-expanded": String(S.fixOpen), "aria-controls": "fix-panel", onclick: () => {
    S.fixOpen = !S.fixOpen; S.editing = null; render(); main.querySelector("[aria-controls='fix-panel']")?.focus();
  } }, "ちがうところを直す", icon("chevron-down", "chev"));
  S.answers = []; S.extra = {};
  const next = currentQuestion();
  return [
    h("h1", { class: "accept", tabindex: "-1", "data-focus": true }, text),
    h("div", { class: "fix" }, fixBtn, panel),
    h("button", { type: "button", class: "btn-primary", onclick: proceed }, next ? "次へ" : "次の一手を見る"),
    next ? h("p", { class: "note" }, "足りないところを、このあと少しだけ聞きます（多くて3つ）。") : null,
  ];
}
/** 直した項目の根拠の言葉は使わない（直した値と書いた文の「」が食い違うため） */
function editedEvidence() {
  const ev = { ...(S.read?.evidence || {}) };
  for (const f of Object.keys(S.edits)) delete ev[f];
  if ("want" in S.edits) { delete ev.intent; delete ev.goal; }
  return ev;
}
/** 直すチップ：事実（読めたものだけ）＋気持ち・どうしたいか（読めていなくても選べる） */
function fixChips(k) {
  const facts = M.readChips(S.read, k, S.edits).filter(c => M.FACT_KEYS.includes(c.key));
  const low = new Set([...(S.read?.lowConfidence || []), ...(S.read?.conflicts || [])]);
  const feel = [];
  const temp = M.readChips(S.read, k, S.edits).find(c => c.key === "selfTemp");
  feel.push(temp || { key: "selfTemp", value: undefined, text: "いまの気持ちを選ぶ", evidence: null, weak: false, empty: true });
  const wt = M.wantChipText(k);
  feel.push({ key: "want", value: M.knownWantKey(k), text: wt || "どうしたいかを選ぶ", evidence: S.read?.evidence?.intent ?? S.read?.evidence?.goal ?? null,
    weak: !("intent" in S.edits || "goal" in S.edits) && (low.has("intent") || low.has("goal")), empty: !wt });
  const cause = M.readChips(S.read, k, S.edits).find(c => c.key === "cause");
  if (cause) feel.push(cause);
  return [...facts, ...feel];
}
function chipList(chips) {
  const wrap = h("div", { class: "chips", role: "list" });
  for (const c of chips) {
    const open = S.editing === c.key;
    const panelId = `edit-${c.key}`;
    wrap.append(h("div", { role: "listitem", class: "chip-item" },
      h("button", { type: "button", class: `chip${c.weak ? " is-weak" : ""}${c.empty ? " is-quiet" : ""}`, "aria-expanded": String(open), "aria-controls": open ? panelId : null,
        onclick: () => { S.editing = open ? null : c.key; render(); main.querySelector(`[data-chip="${c.key}"]`)?.focus(); }, "data-chip": c.key },
        h("span", {}, c.text), c.weak ? h("span", { class: "chip-flag" }, "たしかめて") : null, icon("chevron-down", "chev"))));
    if (open) wrap.append(editPanel(c, panelId));
  }
  return wrap;
}
function editPanel(c, id) {
  const done = () => { S.editing = null; S.answers = []; render(); main.querySelector(`[data-chip="${c.key}"]`)?.focus(); };
  const pick = (v) => { S.edits = { ...S.edits, [c.key]: v }; done(); };
  const isWant = c.key === "want";
  const opts = isWant ? M.WANTS.map(w => [w.key, w.label]) : M.fieldOptions(c.key);
  const choose = isWant
    ? (v) => { S.edits = { ...S.edits, ...M.wantPatch(v, {}, { full: true }), want: v }; done(); }
    : pick;
  const forget = isWant
    ? () => { S.edits = { ...S.edits, intent: null, goal: null, want: null }; done(); }
    : () => pick(null);
  const name = isWant ? "どうしたい？" : M.FIELD_NAMES[c.key];
  return h("div", { class: "edit-panel", id, role: "group", "aria-label": `${name}を直す` },
    c.evidence ? h("p", { class: "note" }, `「${c.evidence}」から読み取りました`) : null,
    h("p", { class: "edit-q" }, name),
    h("div", { class: "chip-row" },
      opts.map(([v, label]) => {
        const on = c.value === v;
        return h("button", { type: "button", class: "chip", "aria-pressed": String(on), onclick: () => choose(v) }, on ? icon("check") : null, label);
      }),
      h("button", { type: "button", class: "chip is-quiet", onclick: forget }, "分からない（あとで聞く）")));
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
const showBoth = () => S.compare && wideMQ.matches;
let shownBoth = false;
function viewCard() {
  if (!S.model) buildCard();
  shownBoth = showBoth();
  const layouts = shownBoth ? ["1", "3"] : [S.layout];
  const cards = h("div", { class: `cards${shownBoth ? " is-two" : ""}` },
    layouts.map(l => h("section", { class: "card-col", "aria-label": `統合${l}` },
      S.compare ? h("p", { class: "poc-col" }, `統合${l}`) : null,
      cardView(S.model, l))));
  S.fresh = false;
  if (timeBlocks.size) timerTick = setInterval(() => { for (const f of timeBlocks) f(); }, 30000);
  return [S.answers.length ? readLine() : null, cards,
    h("p", { class: "card-foot" }, h("button", { type: "button", class: "linkbtn", onclick: () => go("write") }, "最初から書き直す"))];
}

/**
 * カードの上の小さな1行「読み取った内容」（足りない問に答えたときだけ。押すと、答えも入れた受け止めの文と「ちがうところを直す」が開く）。
 * 最初の画面を押し下げないよう、閉じた状態は1行（44px）だけ
 */
function readLine() {
  const k = known();
  delete k.lateNight;
  const panel = h("div", { class: "read-line-panel", id: "read-line-panel", hidden: true },
    h("p", {}, M.acceptText({ known: k, text: S.text, evidence: editedEvidence() })),
    h("button", { type: "button", class: "linkbtn", onclick: () => { S.fixOpen = true; go("read"); } }, "ちがうところを直す"));
  const b = toggler("読み取った内容", panel, "linkbtn read-line-btn");
  b.append(icon("chevron-down", "chev"));
  return h("div", { class: "read-line" }, b, panel);
}

function cardView(m, layout) {
  if (m.mode === "safety") return safetyCardView(m.card);
  const art = h("article", { class: `card${S.fresh ? " enter" : ""} layout-${layout}` });
  const ids = { head: uid("head") };
  art.setAttribute("aria-labelledby", ids.head);
  const decide = h("div", { class: "c-decide" });
  const later = h("div", { class: "c-later" });
  if (m.safetyLine) add(decide, safetyLine(m.safetyLine));
  const action = m.mode === "send" ? sendBlock(m, layout) : waitBlock(m, layout);
  if (layout === "3") {
    // 統合3：伝えたいのは（小さな1行）→ 結論（＋時刻）→ 理由の1行目［なぜ？］→ 文面（右上に小さな［コピー］）・足さない方がいい一言／待つ間に
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
  return h("h2", { class: "c-head", id, tabindex: "-1", "data-focus": true }, m.headline);
}
function timingNote(m) { return m.timingLine ? h("p", { class: "c-note" }, m.timingLine) : null; }

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
  const rs = m.reasons;
  const p = h("p", { class: "c-reason" }, rs[0] ?? "");
  if (!withWhy || rs.length < 2) return p;
  const panel = whyPanel(m);
  add(p, " ", toggler("なぜ？", panel, "inline-link is-strong"));
  return [p, panel];
}
function whyPanel(m) {
  return h("ul", { class: "c-why", id: uid("why"), hidden: true }, m.reasons.slice(1).map(t => h("li", {}, t)));
}

/**
 * 送る吹き出し（相手の画面にこう届く）。［コピー］は吹き出しの右上の小さなボタン（見た目は小さく、押せる範囲は 44px）。
 * 押すと「コピーしました」と、ボタンの文字を少しの間「コピー済み」に。「別の言い方」に切り替えても、表示中の文をコピーする
 */
function draftUnit(drafts, label) {
  let i = 0, resetT = null;
  const bubble = h("p", { class: "bubble" }, drafts[0].text);
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `${ICONS}#copy`);
  const ic = document.createElementNS(SVG, "svg");
  ic.setAttribute("class", "icon");
  ic.setAttribute("aria-hidden", "true");
  ic.append(use);
  const word = h("span", {}, "コピー");
  const copy = h("button", { type: "button", class: "copy-mini" }, h("span", { class: "copy-pill" }, ic, word));
  const setDone = (on) => {
    word.textContent = on ? "コピー済み" : "コピー";
    use.setAttribute("href", `${ICONS}#${on ? "check" : "copy"}`);
    copy.classList.toggle("is-done", on);
  };
  copy.addEventListener("click", async () => {
    if (await copyText(bubble.textContent, bubble)) {
      setDone(true);
      clearTimeout(resetT);
      resetT = setTimeout(() => setDone(false), 2000);
    }
  });
  let alt = null;
  if (drafts[1]) {
    alt = h("button", { type: "button", class: "inline-link", "aria-pressed": "false" }, "別の言い方");
    alt.addEventListener("click", () => {
      i = 1 - i;
      bubble.textContent = drafts[i].text;
      alt.textContent = i ? "最初の言い方" : "別の言い方";
      alt.setAttribute("aria-pressed", String(!!i));
      clearTimeout(resetT);
      setDone(false);
    });
  }
  return [
    h("div", { class: "c-send-top" }, label ? h("span", { class: "c-label" }, label) : h("span", {}), copy),
    bubble,
    alt ? h("div", { class: "c-send-foot" }, alt) : null,
  ];
}
function sendBlock(m, layout) {
  const d = m.card.drafts;
  return h("div", { class: "c-send" }, draftUnit(d, d[0].label), layout === "3" ? avoidLine(m) : null);
}
/** 待つ一手：待つ間に（預けるは無し）→［それでも今送りたい］と「期限が来たら、この1通」（押すと、そのすぐ下に開く） */
function waitBlock(m, layout) {
  const a = m.result.action;
  const urge = urgePanel(m);
  const links = h("div", { class: "c-links" }, h("div", {}, toggler("それでも今送りたい", urge)), urge);
  if (m.card.drafts.length) {
    const later = h("div", { class: "c-later-draft", id: uid("laterdraft"), hidden: true }, draftUnit(m.card.drafts, null));
    const t = toggler(m.card.drafts[0].label, later);
    t.append(icon("chevron-down", "chev"));
    add(links, h("div", {}, t), later);
  }
  return h("div", { class: "c-send is-wait" },
    m.doNow ? h("p", { class: "c-donow" }, h("span", { class: "c-label" }, doNowLabel(a)), m.doNow) : null,
    links,
    layout === "3" ? avoidLine(m) : null);
}
/** それでも今送りたい：送りたい文の欄 → 送る前チェック（届きやすさ3段階・数字なし）と避けたい言葉の印 */
function urgePanel(m) {
  const id = uid("urge");
  const ta = h("textarea", { class: "urge-input", rows: "3", "aria-label": "送りたい文", placeholder: "送りたい文を書いてください" });
  const level = h("p", { class: "c-level" });
  const hits = h("ul", { class: "c-hits" });
  const result = h("div", { class: "c-check", "aria-live": "polite" }, level, hits);
  const run = () => {
    const v = ta.value.trim();
    hits.replaceChildren();
    if (!v) { level.replaceChildren("書くと、相手に届きやすいかをここに出します。"); level.className = "c-level is-empty"; return; }
    // 一手に逆らって送る文なので、局面の避ける言葉に限らず全部を見る
    const r = checkDraft(v, { action: null, avoid: null });
    level.className = `c-level${r.level === LEVELS[2] ? " is-stop" : ""}`;
    level.replaceChildren("届きやすさ：", h("b", {}, r.level));
    for (const x of r.hits) hits.append(h("li", {}, x.id === "long" || x.id === "missing_time" ? M.HIT_LABELS[x.id] : h("span", {}, h("mark", {}, `「${x.text}」`), M.HIT_LABELS[x.id] ?? "")));
  };
  ta.addEventListener("input", run);
  const panel = h("div", { class: "c-urge", id, hidden: true },
    ta, result,
    h("button", { type: "button", class: "btn-secondary", onclick: () => copyText(ta.value, ta) }, icon("copy"), "この文をコピー"));
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
  if (layout === "1" && m.reasons.length > 1) {
    const panel = whyPanel(m);
    out.append(h("div", { class: "c-why-wrap" }, toggler("なぜ？", panel, "btn-secondary is-small")), panel);
  }
  const line = h("div", { class: "c-conf-line" }, h("p", { class: "c-small" }, `確かさ：${m.card.confidenceLine ?? ""}`));
  out.append(line);
  if (m.variantLines.length) out.append(h("ul", { class: "c-variants" }, m.variantLines.map(t => h("li", {}, t.replace(" → ", "、")))));
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
  if (!v) return false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
    await navigator.clipboard.writeText(v);
    toast("コピーしました");
    return true;
  } catch {
    selectText(el);
    toast("文を選びました。そのままコピーできます");
    return false;
  }
}

// ---------------------------------------------------------------- はじめ
initBar();
const ex = params.get("ex");
const exCase = ex && READ_CASES.find(c => c.id === ex);
if (exCase) S.text = exCase.text;
render();
