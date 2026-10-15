// 相談（試作）画面（#consult）。入力 → buildContext → respond → 次の一手カード。AI は呼ばない（決まった文型）。
// 判定・文の作成は js/consult/ にある。ここは画面だけ：入力の状態は consult_state.js、診断結果の取り出しは consult_self.js、
// カードは consult_card.js、開発者向けの表示は consult_dev.js。保存は localStorage の "consult-form-v1" だけ（どこにも送らない）。
import { h, mount, toast } from "./dom.js";
import { PARTNER_QUESTIONS } from "../consult/texts.js";
import { buildContext, refineQuestions, applyPatchToContext } from "../consult/context.js";
import { respond } from "../consult/respond.js";
import { currentAiEndpoint } from "../consult/config.js";
import { isLateNight } from "../consult/timefmt.js";
import {
  GROUPS, TOGGLES, DANGER_ITEMS, SELF_TYPES, TEXT_MAX, SHORT_TEXT_MAX,
  defaultState, loadState, saveState, clearSaved, dangerInfo, buildArgs, applyPatchToState,
} from "./consult_state.js";
import { resolveSelf, deviceResult, domainRows, opposite } from "./consult_self.js";
import { answerCard, fitDrafts } from "./consult_card.js";
import { judgeDetails, promptDetails } from "./consult_dev.js";

// ---------------------------------------------------------------- 画面の中の状態（renderConsult は何度呼ばれても作り直さない）
let root = null;
let state = null;
const syncs = [];          // 状態 → 部品の見た目 を合わせる関数
let last = null;           // 直近のカード { ctx, res }
let dirty = false;         // カードを作ったあとに入力を変えたか
let seq = 0;               // 古い非同期の結果を捨てるための番号
let resultEl = null, formTop = null, genBtn = null, staleEl = null;
let selfRefresh = null;
let clearTimer = null;

const reduceMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const smoothTo = (el, block = "start") => el?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block });
const endpoint = () => { try { return currentAiEndpoint(location.search); } catch { return null; } };
const tzOffsetNow = () => -new Date().getTimezoneOffset();

let saveTimer = null;
function persist(now = false) {
  clearTimeout(saveTimer);
  if (now) { saveState(state); return; }
  saveTimer = setTimeout(() => saveState(state), 250);   // 文字を打つたびには書かない
}
/** 入力が変わった：保存し、カードが古くなったことを知らせる */
function commit(now = false) {
  persist(now);
  if (last && !dirty) { dirty = true; if (staleEl) staleEl.hidden = false; }
}
function reg(fn) { syncs.push(fn); fn(); return fn; }
const syncAll = () => { for (const fn of syncs) fn(); };

// ---------------------------------------------------------------- 入口
let flushBound = false;
export function renderConsult(el) {
  if (root === el && el.firstChild) { selfRefresh?.(); syncAll(); return; }   // 戻ってきたときは、入力もカードも残す
  root = el;
  if (!flushBound) {
    flushBound = true;
    window.addEventListener("pagehide", () => { if (state) saveState(state); });
    let t = null;   // 幅が変わると文面の行数が変わるので、編集欄の高さを合わせ直す
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => fitDrafts(resultEl?.querySelector(".cs-answer")), 120); });
  }
  state = loadState();
  syncs.length = 0; last = null; dirty = false;
  mount(el, buildPage());
  selfRefresh?.();
}

// ---------------------------------------------------------------- 部品
/** 単一選択（本物のラジオボタンを丸い選択肢に見せる） */
function chipGroup(key, { legend = GROUPS[key].label, hint = GROUPS[key].hint, cls = "" } = {}) {
  const name = `cs-${key}`;
  const items = GROUPS[key].options.map(([value, label]) => {
    const input = h("input", { type: "radio", name, value, onchange: () => { state[key] = value; commit(); } });
    return { value, input, el: h("label", { class: "cs-opt" }, input, h("span", null, label)) };
  });
  reg(() => { for (const it of items) it.input.checked = String(state[key]) === it.value; });
  return h("fieldset", { class: ["cs-group", cls], "data-key": key },
    h("legend", null, legend, hint ? h("small", null, `（${hint}）`) : null),
    h("div", { class: "cs-opts" }, items.map(it => it.el)));
}

/** はい／いいえ */
function toggle(key, label) {
  const input = h("input", { type: "checkbox", onchange: () => { state[key] = input.checked; commit(); } });
  reg(() => { input.checked = !!state[key]; });
  return h("label", { class: "cs-toggle", "data-key": key }, input, h("span", { class: "cs-toggle-text" }, label), h("span", { class: "cs-switch", "aria-hidden": "true" }));
}

/** 短い自由記述 */
function textField(key, label, placeholder) {
  const id = `cs-${key}`;
  const input = h("input", { type: "text", id, class: "cs-input", maxlength: SHORT_TEXT_MAX, placeholder, autocomplete: "off",
    oninput: () => { state[key] = input.value; commit(); } });
  reg(() => { if (input.value !== state[key]) input.value = state[key]; });
  return h("div", { class: "cs-field" }, h("label", { for: id }, label), input);
}

function step(no, title, sub, ...body) {
  return h("section", { class: "cs-step", "aria-labelledby": `cs-h-${no}` },
    h("div", { class: "cs-step-head" }, h("span", { class: "cs-step-no", "aria-hidden": "true" }, no),
      h("h2", { id: `cs-h-${no}`, class: "cs-step-title" }, title), sub),
    h("div", { class: "cs-step-body" }, body));
}

// ---------------------------------------------------------------- 1. あなたのタイプ
function selfStep() {
  const sum = h("span", { class: "cs-sum" });
  const radios = SELF_TYPES.map(([value, label]) => {
    const input = h("input", { type: "radio", name: "cs-selftype", value, onchange: () => {
      state.selfType = value; state.corrections = {}; state.mainConfirmed = false; commit(true); selfRefresh(); } });
    const note = h("small", { class: "cs-radio-note" });
    return { value, label, input, note, el: h("label", { class: "cs-radio" }, input, h("span", null, h("b", null, label), note)) };
  });
  const dyn = h("div", { class: "cs-self-dyn" });
  const det = h("details", { class: "cs-step cs-collapsible", id: "cs-self", open: state.selfOpen },
    h("summary", null,
      h("span", { class: "cs-step-no", "aria-hidden": "true" }, "1"),
      h("span", { class: "cs-step-title" }, "あなたのタイプ"),
      sum),
    h("div", { class: "cs-step-body" },
      h("fieldset", { class: "cs-radios" }, h("legend", { class: "visually-hidden" }, "あなたのタイプの使い方"), radios.map(r => r.el)),
      dyn));
  det.addEventListener("toggle", () => { state.selfOpen = det.open; persist(); });
  reg(() => { det.open = !!state.selfOpen; });

  function flip(d) {
    const self = resolveSelf(state);
    const b = self.base?.[d];
    if (!b?.side) return;
    if (state.corrections[d]) delete state.corrections[d];
    else state.corrections[d] = { from: b.side, to: opposite(b.side) };
    commit(true); selfRefresh();
    dyn.querySelector(`[data-domain="${d}"] .cs-flip`)?.focus({ preventScroll: true });
  }

  selfRefresh = () => {
    const dev = deviceResult();
    const self = resolveSelf(state);
    for (const r of radios) {
      r.input.checked = r.value === self.type;
      if (r.value === "three") {
        r.input.disabled = !dev;
        r.note.replaceChildren(dev ? `${dev.name}${dev.estimated ? "（推定）" : ""}` : "まだ三択の診断が終わっていません。", dev ? "" : h("a", { class: "cs-nowrap", href: "#three" }, "三択診断へ"));
      } else if (r.value === "none") r.note.textContent = "自分のタイプは使わずに考えます";
      else r.note.textContent = "5択回答から作ったサンプルです";
    }
    const fixedN = Object.keys(self.corrections).length;
    sum.textContent = self.type === "none" ? "診断なし" : `${self.name}${fixedN ? `・${fixedN}領域を直した` : ""}`;
    if (self.type === "none") { dyn.replaceChildren(h("p", { class: "note" }, "診断なしで、いまの状況と相手の情報から一手を決めます。")); return; }
    const rows = domainRows(self);
    const tagCls = { "確か": "sure", "弱め": "est", "不明": "none", "直した": "fixed" };
    const known = rows.filter(r => r.known).length;
    dyn.replaceChildren(
      h("p", { class: "cs-domains-lead" }, h("b", null, "8つの場面でのあなたの傾向"), h("small", null, `　向きが決まったのは ${known} / 8`)),
      h("ul", { class: "cs-domains" }, rows.map(r =>
        h("li", { class: ["cs-domain", r.fixed && "is-fixed", !r.known && "is-unknown"], "data-domain": r.d },
          h("div", { class: "cs-domain-main" },
            h("span", { class: "cs-domain-name" }, `${r.d}　${r.name}`,
              h("span", { class: ["cs-tag", `cs-tag-${tagCls[r.tag]}`], title: r.why || null }, r.tag)),
            h("span", { class: "cs-domain-text" }, r.text)),
          r.known ? h("button", { type: "button", class: "btn small ghost cs-flip", "aria-label": `${r.name}：${r.fixed ? "直したのを元に戻す" : "これは違う"}`, onclick: () => flip(r.d) }, r.fixed ? "元に戻す" : "これは違う") : null))),
      h("p", { class: "note cs-domains-note" }, "確か＝診断ではっきり出た／弱め＝出たが弱い／不明＝診断では決まらなかった／直した＝あなたが直した。「これは違う」を押すと、その場面は反対の向きとして考えます。"),
      self.main ? mainBlock(self.main) : null);
  };
  return det;
}

function mainBlock(main) {
  const input = h("input", { type: "checkbox", onchange: () => { state.mainConfirmed = input.checked; commit(true); } });
  input.checked = !!state.mainConfirmed;   // この部品は選び直すたびに作り直すので、reg には載せない
  return h("div", { class: "cs-main" },
    h("p", { class: "cs-main-label" }, "診断で出たあなたの主軸"),
    h("p", { class: "cs-main-headline" }, main.headline),
    h("label", { class: "cs-toggle cs-toggle-check", "data-key": "mainConfirmed" }, input, h("span", { class: "cs-toggle-text" }, "この説明は当たっている"), h("span", { class: "cs-switch", "aria-hidden": "true" })),
    h("p", { class: "note" }, "チェックすると、この説明も参考にして一手を考えます。"));
}

// ---------------------------------------------------------------- 2. 相手のタイプ
function partnerStep() {
  const countEl = h("span", { class: "cs-sub" });
  const resetBtn = h("button", { type: "button", class: "linkish cs-partner-reset", onclick: () => {
    for (const d of Object.keys(PARTNER_QUESTIONS)) state.partner[d] = null;
    commit(true); syncAll(); } }, "すべて「分からない」に戻す");
  reg(() => {
    const n = Object.values(state.partner).filter(Boolean).length;
    countEl.textContent = `答えた ${n} / 8`;
    resetBtn.hidden = n === 0;
  });
  const qs = Object.entries(PARTNER_QUESTIONS).map(([d, q]) => {
    const name = `cs-p${d}`;
    const opt = (value, label, cls) => {
      const input = h("input", { type: "radio", name, value, onchange: () => { state.partner[d] = value || null; commit(); syncAll(); } });
      reg(() => { input.checked = (state.partner[d] ?? "") === value; });
      return h("label", { class: ["cs-opt", cls] }, input, h("span", null, value ? [h("b", null, value), h("em", null, label)] : label));
    };
    // fieldset の legend は枠線の上に乗って線が横切るので、div + role="group" にする
    return h("div", { class: "cs-pq", role: "group", "aria-labelledby": `cs-pq-${d}`, "data-domain": d },
      h("p", { class: "cs-pq-q", id: `cs-pq-${d}` }, h("span", { class: "cs-pq-no" }, d), q.text),
      h("div", { class: "cs-pq-opts" }, opt("A", q.A, "cs-opt-ab cs-opt-a"), opt("B", q.B, "cs-opt-ab cs-opt-b"), opt("", "分からない", "cs-opt-skip")));
  });
  return step("2", "相手のタイプ（分かる範囲で）", countEl,
    h("p", { class: "note cs-step-lead" }, "外から見える様子で選んでください。分からないところは、そのままで大丈夫です。"),
    qs, h("div", { class: "cs-partner-foot" }, resetBtn));
}

// ---------------------------------------------------------------- 3. いまの状況
function situationStep() {
  const ta = h("textarea", { id: "cs-text", class: "cs-textarea", rows: 3, maxlength: TEXT_MAX, "aria-describedby": "cs-text-count cs-text-note",
    placeholder: "思い出せる範囲で、短くで大丈夫です" });
  const counter = h("span", { id: "cs-text-count", class: "cs-text-count" });
  const harmNote = h("p", { class: "cs-harm-note", role: "status", hidden: true },
    "書かれた言葉から、仲直りの文面ではなく、安全のための案内を出します。");
  const updateText = () => {
    counter.textContent = `${[...ta.value].length} / ${TEXT_MAX}`;
    harmNote.hidden = !dangerInfo(state).textSelfHarm;
  };
  ta.addEventListener("input", () => { state.text = ta.value; updateText(); commit(); });
  reg(() => { if (ta.value !== state.text) ta.value = state.text; updateText(); });

  const lateHint = h("p", { class: "note cs-late-hint" });
  reg(() => {
    const now = new Date();
    const late = isLateNight(now, tzOffsetNow());
    const t = `${now.getHours()}時${String(now.getMinutes()).padStart(2, "0")}分`;
    lateHint.textContent = state.lateNight === "auto" ? `いまは${t}なので、${late ? "深夜として" : "深夜ではないものとして"}考えます。`
      : state.lateNight === "yes" ? "深夜として考えます（0時〜6時の扱い）。" : "深夜ではないものとして考えます。";
  });

  const moreDet = h("details", { class: "cs-more", open: state.moreOpen },
    h("summary", null, h("b", null, "詳しく"), h("small", null, "　あとから足してもOK")),
    h("div", { class: "cs-more-body" },
      chipGroup("severity"),
      h("div", { class: "cs-toggles" }, toggle("repeat", TOGGLES.repeat), toggle("afterMakeup", TOGGLES.afterMakeup)),
      chipGroup("intent"),
      h("div", { class: "cs-toggles" }, toggle("talkScheduled", TOGGLES.talkScheduled)),
      chipGroup("medium"),
      chipGroup("register"),
      textField("partnerCall", "相手の呼び方", "例：〇〇ちゃん"),
      chipGroup("lateNight", { hint: "自動はいまの時刻" }), lateHint,
      h("h3", { class: "cs-more-sub" }, "ふたりのこと"),
      textField("calmDownTime", "相手が落ち着くまでの時間", "例：半日くらい"),
      chipGroup("coupleMedium"),
      h("div", { class: "cs-toggles" }, toggle("livingTogether", TOGGLES.livingTogether))));
  moreDet.addEventListener("toggle", () => { state.moreOpen = moreDet.open; persist(); });
  reg(() => { moreDet.open = !!state.moreOpen; });

  return step("3", "いまの状況", null,
    h("div", { class: "cs-field cs-field-text" },
      h("label", { for: "cs-text" }, "何があったか", h("small", null, "（任意）")),
      ta,
      h("div", { class: "cs-text-foot" }, h("span", { id: "cs-text-note", class: "note" }, "書いた内容は、この端末の中にだけ残ります。"), counter),
      harmNote),
    chipGroup("lastSender"),
    chipGroup("elapsed"),
    h("div", { class: "cs-toggles" }, toggle("ongoing", TOGGLES.ongoing)),
    chipGroup("partnerLast"),
    chipGroup("selfLast"),
    chipGroup("selfTemp"),
    chipGroup("cause"),
    chipGroup("goal"),
    moreDet);
}

function dangerBlock() {
  const items = DANGER_ITEMS.map(x => {
    const input = h("input", { type: "checkbox", name: "cs-danger", value: x.id, onchange: () => { state.danger[x.id] = input.checked; commit(true); } });
    reg(() => { input.checked = !!state.danger[x.id]; });
    return h("label", { class: "cs-danger-item" }, input, h("span", null, x.label));
  });
  return h("fieldset", { class: "cs-danger", id: "cs-danger" },
    h("legend", null, "危ないサイン"),
    h("p", { class: "note" }, "当てはまるものがあれば選んでください。選ぶと、仲直りの文面ではなく、安全のための案内を出します。"),
    h("div", { class: "cs-danger-list" }, items));
}

// ---------------------------------------------------------------- ページ全体
function buildPage() {
  const initial = endpoint() ? "ai" : "template";
  const lead = endpoint()
    ? "AI につないで回答を作ります。うまくいかないときは、決まった文型に戻します。"
    : "AI はまだつないでいません。いまは決まった文型で回答を作っています。";
  genBtn = h("button", { type: "button", class: "btn primary big cs-generate", id: "cs-generate", onclick: () => generate() }, "次の一手を出す");
  resultEl = h("section", { class: "cs-result", id: "cs-result", "aria-label": "回答", hidden: true });
  formTop = h("div", { class: "cs-form-top", id: "cs-form-top" });
  return h("div", { class: "cs" },
    h("p", { class: "cs-back" }, h("a", { href: "#three" }, "← 三択診断へ")),
    h("header", { class: "cs-head" },
      h("div", { class: "cs-title-row" }, h("h1", { class: "cs-title" }, "相談（試作）"), statusChip(initial)),
      h("p", { class: "cs-lead" }, lead)),
    formTop,
    h("form", { class: "cs-form", novalidate: true, onsubmit: (e) => e.preventDefault(), autocomplete: "off" },
      selfStep(), partnerStep(), situationStep(), dangerBlock(),
      h("div", { class: "cs-submit" }, genBtn,
        h("p", { class: "note" }, "選ばなくても、初期値のままで出せます。入力はどこにも送らず、この端末の中で計算します。"))),
    resultEl);
}

function statusChip(source) {
  return h("span", { class: "cs-status", "data-source": source, role: "status" }, `回答：${source === "ai" ? "AI" : "文型"}`);
}
function setSource(source) {
  for (const el of root.querySelectorAll(".cs-status")) {
    el.dataset.source = source;
    el.textContent = `回答：${source === "ai" ? "AI" : "文型"}`;
  }
}

// ---------------------------------------------------------------- 回答を作る
async function generate() {
  const my = ++seq;
  genBtn.disabled = true; genBtn.textContent = "考えています…";
  try {
    persist(true);
    const self = resolveSelf(state);
    const ctx = buildContext(buildArgs(state, { selfDomains: self.domains, selfMain: self.main, now: new Date() }));
    const res = await respond(ctx, { endpoint: endpoint() });
    if (my !== seq) return;
    showResult(ctx, res, { scroll: true });
  } catch (err) {
    console.error(err);
    if (my !== seq) return;
    resultEl.hidden = false;
    mount(resultEl, h("p", { class: "error" }, `回答を作る途中でエラーが起きました：${err.message}`));
  } finally {
    if (my === seq) { genBtn.disabled = false; genBtn.textContent = "次の一手を出す"; }
  }
}

/** 問いに答えた：差分を当てて作り直し、入力欄にも映す。ページは動かさない */
async function refine(q, opt) {
  if (!last) return;
  const my = ++seq;
  const ctx = applyPatchToContext(last.ctx, opt.patch);
  applyPatchToState(state, opt.patch);
  persist(true); syncAll();
  try {
    const res = await respond(ctx, { endpoint: endpoint() });
    if (my !== seq) return;
    showResult(ctx, res, { scroll: false, notice: `「${q.text}」→「${opt.label}」として作り直しました。` });
    toast("答えを反映して、作り直しました");
  } catch (err) {
    console.error(err);
    toast("作り直せませんでした");
  }
}

/** 結果エリアの中身を入れ替える。scroll: true のときだけカードまで動かす（問いの答えなど、あとの描き直しでは動かさない） */
function showResult(ctx, res, { scroll = false, notice = null } = {}) {
  last = { ctx, res }; dirty = false;
  const card = answerCard(res.card, ctx.result);
  const refineEl = refineArea(ctx, notice);

  // 描き直しでページが跳ばないよう、問いの欄の画面上の位置を覚えておいて、入れ替え後に合わせる
  const keep = !scroll && !resultEl.hidden && refineEl && resultEl.querySelector(".cs-refine");
  const anchorTop = keep ? resultEl.querySelector(".cs-refine").getBoundingClientRect().top : null;
  const y = window.scrollY, held = resultEl.offsetHeight;
  if (!scroll) resultEl.style.minHeight = `${held}px`;

  staleEl = h("p", { class: "cs-stale", role: "status", hidden: true },
    "入力が変わっています。反映するには「次の一手を出す」を押してください。");
  resultEl.hidden = false;
  mount(resultEl,
    h("div", { class: "cs-result-bar" },
      statusChip(res.source),
      h("span", { class: "cs-result-time" }, `${ctx.now.getHours()}時${String(ctx.now.getMinutes()).padStart(2, "0")}分の時点`)),
    staleEl,
    card,
    refineEl,
    h("div", { class: "cs-actions" },
      h("button", { type: "button", class: "btn", id: "cs-again", onclick: () => smoothTo(formTop) }, "条件を変えてもう一度"),
      clearButton()),
    judgeDetails(ctx),
    promptDetails(res, endpoint()));
  setSource(res.source);
  fitDrafts(card);

  if (scroll) {
    requestAnimationFrame(() => {
      fitDrafts(card);
      smoothTo(resultEl, "start");
      document.getElementById("cs-headline")?.focus({ preventScroll: true });
    });
  } else {
    if (anchorTop != null) {
      const now = resultEl.querySelector(".cs-refine").getBoundingClientRect().top;
      if (Math.abs(now - anchorTop) > 1) window.scrollBy(0, now - anchorTop);
    } else if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
    requestAnimationFrame(() => { resultEl.style.minHeight = ""; });
  }
}

function refineArea(ctx, notice) {
  const qs = refineQuestions(ctx);
  const wrap = h("section", { class: "cs-refine", "aria-label": "もう少し教えてください", hidden: !notice && !qs.length });
  if (notice) wrap.append(h("p", { class: "cs-refine-notice", role: "status" }, notice, " ",
    h("button", { type: "button", class: "linkish", onclick: () => smoothTo(resultEl) }, "カードの先頭へ")));
  if (qs.length) {
    wrap.append(h("h3", { class: "cs-sec-title" }, "もう少し教えてください"),
      h("p", { class: "note" }, "答えると、その場でカードを作り直します。分からなければ飛ばして大丈夫です。"));
    for (const q of qs) {
      wrap.append(h("div", { class: "cs-q", "data-q": q.id },
        h("p", { class: "cs-q-text", id: `cs-q-${q.id}` }, q.text),
        h("div", { class: "cs-q-opts", role: "group", "aria-labelledby": `cs-q-${q.id}` },
          q.options.map(o => h("button", { type: "button", class: "btn cs-q-opt", onclick: () => refine(q, o) }, o.label)))));
    }
  }
  return wrap;
}

/** 入力を消す（押し間違いを防ぐため、2回押す） */
function clearButton() {
  const btn = h("button", { type: "button", class: "btn ghost cs-clear", id: "cs-clear" }, "入力を消す");
  btn.addEventListener("click", () => {
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1"; btn.textContent = "もう一度押すと、入力とカードが消えます";
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => { delete btn.dataset.armed; btn.textContent = "入力を消す"; }, 4000);
      return;
    }
    clearTimeout(clearTimer);
    clearAll();
  });
  return btn;
}

function clearAll() {
  seq++;
  Object.assign(state, defaultState());
  clearSaved();
  last = null; dirty = false;
  mount(resultEl); resultEl.hidden = true; resultEl.style.minHeight = "";
  setSource(endpoint() ? "ai" : "template");
  selfRefresh(); syncAll();
  window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
  toast("入力を消しました（この端末の三択の結果は残っています）");
}
