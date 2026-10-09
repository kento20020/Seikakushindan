// テスト協力モード（三択版）の画面。仕様：docs/feedback-spec.md §1〜2
//   開始画面のチェック・同意・参加者コード／質問カードの下の「一言」／結果の前の質問（パート1）／ブラインド比較／
//   結果のカードごとの評価（パート2）／振り返り（パート3）／送信画面。
// three.js からは小さな差し込み口（fbBody・fbRendered・fbQuestionExtra・fbCard など）だけを呼ぶ。テスト協力の記録が無いときは
// どれも null を返す（またはそのまま返す）ので、通常の三択診断の動きは変わらない。
// 記録は store3.fb（three_store.js が localStorage に一緒に保存）。記録の形と送信用テキストは js/feedback_collect.js。
import { h, toast, download } from "./dom.js";
import { store3, setSub, toStart3, discard3, save3, showFb3, setFbMode3, onAction3 } from "./three_store.js";
import { isCoarsePointer } from "./swipe.js";
import { PATTERN_BY_ID } from "../data/patterns.js";
import { DOMAINS } from "../engine.js";
import {
  phaseAtLeast, FLAG_CODES, FLAG_LABEL, HARD_CODES, HARD_LABEL, SELF_CODES, SELF_LABEL, SELF_DESC, ACT_QUESTIONS, ACT_NA_LABEL,
  TIME_CODES, TIME_LABEL, MAIN_CODES, MAIN_LABEL, SCENE_LABEL, DOMAIN_KEYS, CODE_MAX,
  newFeedback, normalizeCode, codeLength, isoLocal, makeClock, recordAction, flagsOf, toggleFlag,
  topIds, pickDecoy, pickHard, splitSentences, buildText, filenameFor, itemTexts,
} from "../feedback_collect.js";

const LAST_KEY = "seikaku16:three:fb-last";   // 最後に作った送信用テキストの控え（別の診断で記録が消えても、もう一度表示できるように）
const clock = makeClock();
let lastOnly = false;                          // 控えのテキストだけを表示している（記録そのものは無い）

// ?fb=1 でハッシュが無いときは、三択タブを開く（app.js がタブを決める前に。three.js から読み込まれる時点で走る）
try {
  if (new URLSearchParams(location.search).get("fb") === "1" && !location.hash) history.replaceState(null, "", `${location.pathname}${location.search}#three`);
} catch { /* 無視 */ }

const at = (p) => phaseAtLeast(store3.fb, p);
const flowReady = () => !!(store3.fb && store3.session?.isDone() && store3.result);

// ================================================================ 記録（回答時間・入力方法・戻る）
onAction3(({ type, before, via }) => {
  const fb = store3.fb;
  if (!fb || fb.phase !== "q" || !before) return;
  lastOnly = false;
  const ms = type === "answer" || type === "skip" ? clock.take(fb, before.key, before.question.id) : 0;
  recordAction(fb, { type, before, via, ms });
  if (store3.session?.isDone()) { clock.pause(); fb.phase = "part1"; }
});

const askingNow = () => store3.fb?.phase === "q" && store3.sub === "diagnose" && store3.screen === "question" &&
  !!document.querySelector("#view-three:not([hidden]) .t3-qcard");

function pauseClock() { if (clock.running) { clock.pause(); save3(); } }
function resumeIfAsking() {
  if (document.hidden || !askingNow()) return;
  const c = store3.session?.current();
  if (c) clock.show(store3.fb, c.key, c.question.id);
}
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseClock(); else resumeIfAsking(); });
window.addEventListener("pagehide", () => { pauseClock(); flushText(); });
window.addEventListener("hashchange", () => { if (location.hash !== "#three") pauseClock(); });

/** three.js の描画のたびに呼ぶ。c＝表示した質問（質問画面でなければ null） */
export function fbRendered(c) {
  const fb = store3.fb;
  if (!fb || fb.phase !== "q" || !c) { pauseClock(); return; }
  if (document.hidden) return;              // 見えるようになったら visibilitychange で動かす
  clock.show(fb, c.key, c.question.id);
}

// テキスト入力の保存は少し遅らせる（打つたびに全部を書き出さない）。離れるときは必ず書き出す
let textTimer = 0;
function saveSoon() { clearTimeout(textTimer); textTimer = setTimeout(() => { textTimer = 0; save3(); }, 400); }
function flushText() { if (textTimer) { clearTimeout(textTimer); textTimer = 0; save3(); } }

function go(phase, { sub = "diagnose" } = {}) {
  flushText();
  lastOnly = false;
  if (store3.fb && phase) store3.fb.phase = phase;
  if (sub === "result") { store3.screen = "fb"; save3(); setSub("result"); }
  else showFb3();
  window.scrollTo(0, 0);
}

// ================================================================ 差し込み口（three.js）
/** テスト協力の画面。該当しなければ null（通常の画面を出す） */
export function fbBody(sub) {
  if (lastOnly && sub === "diagnose" && store3.screen === "fb" && !flowReady()) return sendView(null);
  const fb = store3.fb;
  if (!fb || !store3.session) return null;
  if (fb.phase === "code") return sub === "diagnose" && store3.screen === "fb" ? codeView(fb) : null;
  if (!flowReady()) return null;   // 質問中は通常どおり
  if (!at("cards") && (sub === "result" || sub === "logic")) return gateView();
  if (sub !== "diagnose" || store3.screen !== "fb") return null;
  if (fb.phase === "part1") return part1View(fb);
  if (fb.phase === "blind") return blindView(fb);
  if (fb.phase === "cards") return cardsPointer();
  if (fb.phase === "part3") return part3View(fb);
  if (fb.phase === "send") return sendView(fb);
  return null;
}

/** 結果の前（パート1・ブラインド比較）は、開始画面の「前回の結果があります」を出さない */
export function fbHidesDone() { return flowReady() && !at("cards"); }

// ---------------------------------------------------------------- 流れの目印（6段階）
const STEP_PHASES = ["q", "part1", "blind", "cards", "part3", "send"];
const STEP_LABEL = ["質問", "結果の前に", "比べる", "結果の評価", "振り返り", "送信"];
function steps(phase) {
  const k = Math.max(0, STEP_PHASES.indexOf(phase));
  return h("div", { class: "fb-steps", "aria-label": `テスト協力 ${k + 1}/6：${STEP_LABEL[k]}` },
    h("span", { class: "fb-steps-label" }, h("b", null, `テスト協力 ${k + 1}/6`), STEP_LABEL[k]),
    h("span", { class: "fb-steps-bar", "aria-hidden": "true" }, STEP_PHASES.map((_, i) => h("i", { class: i < k ? "done" : i === k ? "now" : null }))));
}
const foot = () => h("p", { class: "q-foot fb-foot" },
  h("button", { type: "button", class: "linkish", onclick: () => { flushText(); toStart3(); } }, "中断して最初の画面へ（自動で保存されています）"));

// ================================================================ 開始画面
export function fbStartFields() {
  const box = h("div", { class: "fb-consent", id: "fb-consent", hidden: !store3.fbMode },
    h("p", { class: "fb-consent-h" }, "テスト協力のお願い"),
    h("ul", { class: "fb-list" },
      h("li", null, "回答は名前を伏せて扱います（参加者コードだけで区別します）。"),
      h("li", null, "自由記述に、パートナー（相手）のことは書かないでください。"),
      h("li", null, "いつでもやめて大丈夫です。途中でやめても、どこにも送られません。")),
    h("p", { class: "note" }, "最後に、回答の記録と感想をまとめたテキストが出ます。それをコピーして送ってもらうだけで、自動ではどこにも送信しません。所要時間は本体10〜15分＋感想5〜7分です。"),
    h("label", { class: "check fb-agree", for: "fb-agree" },
      h("input", { type: "checkbox", id: "fb-agree", onchange: () => hideErr() }),
      h("span", null, h("b", null, "上の内容に同意して協力する"))),
    h("label", { class: "fb-field", for: "fb-code" },
      h("span", { class: "fb-field-label" }, "参加者コード", h("small", null, `（ニックネーム可・1〜${CODE_MAX}文字）`)),
      h("input", { type: "text", id: "fb-code", class: "fb-input", maxlength: CODE_MAX * 2, autocomplete: "off", autocapitalize: "off", spellcheck: "false",
        placeholder: "空欄なら自動で作ります", oninput: () => hideErr() })),
    h("p", { class: "note" }, "再検査のときも同じコードを使います。"),
    h("p", { class: "fb-err", id: "fb-err", role: "alert", hidden: true }));
  const cb = h("input", { type: "checkbox", id: "fb-mode", checked: store3.fbMode, onchange: (e) => { setFbMode3(e.target.checked); box.hidden = !e.target.checked; hideErr(); } });
  return h("fieldset", { class: "opt fb-start" },
    h("legend", null, "テスト協力"),
    h("label", { class: "check", for: "fb-mode" }, cb,
      h("span", null, h("b", null, "テスト協力モード（回答時間・感想を記録して、最後に送ってもらう）"),
        h("small", null, "協力をお願いされた方だけ使ってください。オフなら通常の診断です。"))),
    box);
}
function hideErr() { const e = document.getElementById("fb-err"); if (e) e.hidden = true; }

/** 開始ボタンで呼ぶ。モードがオフなら null、入力が足りなければ false（エラーを表示）、よければ新しい記録 */
export function fbStartOptions(form) {
  const mode = form?.querySelector("#fb-mode");
  if (!mode?.checked) {
    // テスト協力の途中で、モードを外して通常の診断を始める：記録が消えるので確かめる
    if (store3.fb && !store3.fb.finishedAt && !confirm(UNFINISHED_MSG)) return false;
    return null;
  }
  const agree = form.querySelector("#fb-agree"), codeIn = form.querySelector("#fb-code"), err = form.querySelector("#fb-err");
  const fail = (msg, el) => { err.textContent = msg; err.hidden = false; el?.focus(); return false; };
  const code = normalizeCode(codeIn.value);
  if (!agree.checked) return fail("協力していただける場合は、同意のチェックを入れてください。", agree);
  if (codeLength(code) > CODE_MAX) return fail(`参加者コードは${CODE_MAX}文字までにしてください。`, codeIn);
  if (store3.fb && !confirm("前回のテスト協力の記録が消えます（送信用テキストの控えは残ります）。最初からやり直しますか？")) return false;
  lastOnly = false;
  return newFeedback({ code });
}

const UNFINISHED_MSG = "テスト協力の途中の記録（回答時間・感想）が消えます。よろしいですか？";
// 開始画面のサンプルボタンも診断を置き換える。テスト協力の途中なら確かめる（キャンセルならボタンの処理まで届かせない）
document.addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest("#view-three [data-t3-sample], #view-three [data-t3-profile]") : null;
  if (!b || !store3.fb || store3.fb.finishedAt) return;
  if (!confirm(UNFINISHED_MSG)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

/** 開始画面の上に出す「続きから」「送信用テキストをもう一度表示」 */
export function fbStartBlocks() {
  const fb = store3.fb, s = store3.session;
  const out = [];
  if (fb && s && fb.phase === "code") {
    out.push(h("div", { class: "resume fb-resume" },
      h("p", null, `テスト協力をはじめたところです（コード ${fb.code}）。`),
      h("div", { class: "row" }, h("button", { class: "btn primary", id: "fb-resume", onclick: () => go(null) }, "続きから"))));
  } else if (flowReady() && !at("send")) {
    const k = STEP_PHASES.indexOf(fb.phase);
    out.push(h("div", { class: "resume fb-resume" },
      h("p", null, `テスト協力の続きがあります（コード ${fb.code}・いま「${STEP_LABEL[k] ?? ""}」）。`),
      h("div", { class: "row" }, h("button", { class: "btn primary", id: "fb-resume", onclick: () => go(null, { sub: fb.phase === "cards" ? "result" : "diagnose" }) }, "続きから"))));
  }
  const finished = flowReady() && !!fb.finishedAt;
  const last = finished ? null : readLast();
  if (finished || last) {
    out.push(h("div", { class: "resume fb-resume fb-resume-send" },
      h("p", null, finished ? `テスト協力の送信用テキストができています（コード ${fb.code}）。まだ送っていなければ、送ってください。`
        : `前回のテスト協力の送信用テキストの控えがあります（コード ${last.code}）。`),
      h("div", { class: "row" }, h("button", { class: "btn", id: "fb-show-text", onclick: () => {
        if (finished) go("send");
        else { lastOnly = true; showFb3(); window.scrollTo(0, 0); }
      } }, "送信用テキストをもう一度表示"))));
  }
  return out;
}

function readLast() {
  try { const v = JSON.parse(localStorage.getItem(LAST_KEY) || "null"); return v && typeof v.text === "string" ? v : null; } catch { return null; }
}
function writeLast(fb, text) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ code: fb.code, ts: fb.ts, text, savedAt: isoLocal() })); } catch { /* 保存できなくても続ける */ }
}

// ---------------------------------------------------------------- 自動で作ったコードを見せる
function codeView(fb) {
  return h("div", { class: "fb-screen fb-codeview" },
    h("h1", { class: "fb-h1" }, "テスト協力ありがとうございます"),
    h("p", { class: "lead" }, "あなたの参加者コードは"),
    h("p", { class: "fb-code", id: "fb-code-big" }, fb.code),
    h("p", { class: "fb-code-msg" }, "このコードを覚えておいてください（再検査で使います）"),
    h("p", { class: "note" }, "スクリーンショットかメモを残しておくと確実です。最後の送信画面にも表示します。"),
    h("div", { class: "row" }, h("button", { type: "button", class: "btn primary big", id: "fb-begin", onclick: () => {
      fb.phase = "q"; store3.screen = "question"; save3({ render: true }); window.scrollTo(0, 0);
    } }, "診断をはじめる")),
    foot());
}

// ================================================================ 質問カードの下の「一言」
export function fbQuestionExtra(c) {
  const fb = store3.fb;
  if (fb && fb.phase === "code" && c) fb.phase = "q";   // コードの画面を飛ばして「続きから答える」で質問に来た
  if (!fb || fb.phase !== "q" || !c) return null;
  const key = c.key, itemId = c.question.id;
  const count = h("span", { class: "fb-hito-count" });
  const btn = h("button", { type: "button", class: "fb-hito-btn", id: "fb-hito", "aria-expanded": "false", "aria-controls": "fb-hito-panel",
    onclick: () => { const open = panel.hidden; panel.hidden = !open; btn.setAttribute("aria-expanded", String(open)); } },
    "一言", count);
  const chips = FLAG_CODES.map(code => h("button", { type: "button", class: "fb-chip", "data-flag": code, "aria-pressed": "false",
    onclick: () => { toggleFlag(fb, key, itemId, code); paint(); save3(); } }, FLAG_LABEL[code]));
  const panel = h("div", { class: "fb-hito-panel", id: "fb-hito-panel", hidden: true, role: "group", "aria-label": "この設問への一言" },
    h("div", { class: "fb-chips" }, chips),
    h("p", { class: "fb-hito-note" }, "答えにはなりません（いま表示している設問に付きます。複数選べます）。"));
  function paint() {
    const sel = flagsOf(fb, key, itemId);
    for (const ch of chips) ch.setAttribute("aria-pressed", sel.includes(ch.dataset.flag) ? "true" : "false");
    count.textContent = sel.length ? `✓${sel.length}` : "";
    btn.classList.toggle("on", sel.length > 0);
  }
  paint();
  return h("div", { class: "fb-hito", "data-no-swipe": "" },
    h("div", { class: "fb-hito-row" }, btn, h("span", { class: "fb-code-chip", title: "参加者コード" }, `テスト協力中・コード ${fb.code}`)),
    panel);
}

// ================================================================ 共通：ラジオの丸ボタン
/** name の選択肢（[値, 表示]…）。選ぶと onPick(値) */
function pills(name, options, value, onPick, { cls = "", disabled = false } = {}) {
  return h("div", { class: ["fb-pills", cls], role: "radiogroup" }, options.map(([v, label]) =>
    h("label", { class: "fb-pill" },
      h("input", { type: "radio", name, value: String(v), checked: value !== undefined && value !== null && value !== "" && String(value) === String(v), disabled,
        onchange: (e) => { if (e.target.checked) { e.target.closest(".fb-q")?.classList.remove("fb-missing"); onPick(v); } } }),
      h("span", null, label))));
}

function markMissing(nodes, msg) {
  nodes.forEach(n => n.classList.add("fb-missing"));
  nodes[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
  toast(msg);
}

// ================================================================ パート1：結果を見る前の質問
function part1View(fb) {
  const selfQs = DOMAIN_KEYS.map(d => {
    const D = DOMAINS[d], S = SELF_DESC[d];
    return h("fieldset", { class: "fb-q fb-self", "data-d": d },
      h("legend", null, h("span", { class: "dnum" }, d), D.name),
      h("div", { class: "fb-ab" },
        h("p", { class: "fb-ab-a" }, h("b", null, "A ", S.a[0]), h("span", null, S.a[1])),
        h("p", { class: "fb-ab-b" }, h("b", null, "B ", S.b[0]), h("span", null, S.b[1]))),
      pills(`fb-self-${d}`, SELF_CODES.map(c => [c, SELF_LABEL[c]]), fb.self?.[d], (v) => { (fb.self ||= {})[d] = v; save3(); }, { cls: "fb-pills-5" }));
  });
  const actQs = DOMAIN_KEYS.map(d => {
    const Q = ACT_QUESTIONS[d];
    return h("fieldset", { class: "fb-q fb-act", "data-d": d, disabled: !!fb.actSkip },
      h("legend", null, h("span", { class: "dnum" }, d), Q.q),
      pills(`fb-act-${d}`, [["A", Q.a], ["B", Q.b], ["na", ACT_NA_LABEL]], fb.actSkip ? "" : fb.act?.[d], (v) => { (fb.act ||= {})[d] = v; save3(); }, { cls: "fb-pills-stack" }));
  });
  const skipBtn = h("button", { type: "button", class: "btn small", id: "fb-act-skip", onclick: () => {
    fb.actSkip = !fb.actSkip; save3({ render: true });
    document.getElementById("fb-act-h")?.scrollIntoView({ block: "start" });
  } }, fb.actSkip ? "やっぱり答える" : "思い出せる場面がない（この8問をスキップ）");

  const next = () => {
    const missSelf = [...document.querySelectorAll(".fb-self")].filter(f => !fb.self?.[f.dataset.d]);
    const missAct = fb.actSkip ? [] : [...document.querySelectorAll(".fb-act")].filter(f => !fb.act?.[f.dataset.d]);
    const miss = [...missSelf, ...missAct];
    if (miss.length) return markMissing(miss, `まだ答えていない質問があります（${miss.length}問）`);
    if (!fb.blind) prepareBlind(fb);
    go("blind");
  };

  return h("div", { class: "fb-screen fb-part1" },
    steps("part1"),
    h("h1", { class: "fb-h1" }, "結果を見る前に"),
    h("p", { class: "lead" }, "結果を見ると答えが引っ張られるので、先に2つのことを聞かせてください。答えはその場で保存されます。"),
    h("section", { class: "fb-sec", "aria-labelledby": "fb-self-h" },
      h("h2", { id: "fb-self-h" }, "1. 自分ではどう思う？"),
      h("p", { class: "note" }, "8つの領域それぞれ、喧嘩や気まずい場面での自分は A と B のどちら寄りだと思いますか。"),
      selfQs),
    h("section", { class: "fb-sec", "aria-labelledby": "fb-act-h" },
      h("h2", { id: "fb-act-h" }, "2. 実際にはどうした？"),
      h("p", { class: "fb-recall" }, "最近の喧嘩や気まずくなった場面を1つ思い出してください。"),
      h("p", { class: "note" }, "その場面で、実際にしたことに近い方を選んでください。"),
      h("div", { class: "row" }, skipBtn),
      fb.actSkip ? h("p", { class: "fb-skipped" }, "スキップしました（8問とも「覚えていない・当てはまらない」として記録します）。") : null,
      h("div", { class: ["fb-act-list", fb.actSkip && "fb-off"] }, actQs)),
    h("div", { class: "row fb-next" }, h("button", { type: "button", class: "btn primary big", id: "fb-part1-next", onclick: next }, "次へ")),
    foot());
}

// ================================================================ ブラインド比較
function prepareBlind(fb) {
  const d = pickDecoy(store3.result.select.chosen);
  fb.blind = { decoy: d.key, top: d.top, order: Math.random() < 0.5 ? "own-first" : "decoy-first", pick: "" };
  save3();
}

function blindView(fb) {
  if (!fb.blind) prepareBlind(fb);
  const b = fb.blind;
  const own = topIds(store3.result.select.chosen);
  const sides = b.order === "own-first" ? [["own", own], ["decoy", b.top]] : [["decoy", b.top], ["own", own]];
  const col = (label, ids) => h("section", { class: "fb-blind-col", "aria-label": `結果 ${label}` },
    h("h2", { class: "fb-blind-tag" }, label),
    h("ol", { class: "fb-blind-list" }, ids.map(id => {
      const p = PATTERN_BY_ID[id];
      return h("li", null, h("p", { class: "fb-blind-head" }, p?.headline ?? id), p?.text?.one ? h("p", { class: "fb-blind-one" }, p.text.one) : null);
    })));
  let pick = b.pick || "";
  const choose = (v) => { pick = v; for (const x of btns) x.setAttribute("aria-pressed", x.dataset.pick === v ? "true" : "false"); ok.disabled = !pick; };
  const btns = sides.map(([who], i) => h("button", { type: "button", class: "btn fb-blind-pick", "data-pick": who, "data-side": "AB"[i], "aria-pressed": pick === who ? "true" : "false", onclick: () => choose(who) },
    `${"AB"[i]} の方が近い`));
  const ok = h("button", { type: "button", class: "btn primary big", id: "fb-blind-ok", disabled: !pick, onclick: () => {
    if (!pick) return;
    b.pick = pick;
    go("cards", { sub: "result" });
  } }, "決めて、結果を見る");
  return h("div", { class: "fb-screen fb-blind" },
    steps("blind"),
    h("h1", { class: "fb-h1" }, "どちらが自分に近い？"),
    h("p", { class: "lead" }, "2つの結果を、名前を伏せて並べています。片方はあなたの回答から出た結果、もう片方は別の回答の結果です。"),
    h("div", { class: "fb-blind-grid" }, sides.map(([, ids], i) => col("AB"[i], ids))),
    h("p", { class: "fb-ask" }, "どちらがより自分に近いと思いますか？"),
    h("div", { class: "fb-blind-btns" }, btns),
    h("div", { class: "row fb-next" }, ok),
    foot());
}

function gateView() {
  return h("div", { class: "fb-screen fb-gate" },
    h("h1", { class: "fb-h1" }, "結果はもう少しあとで"),
    h("p", { class: "lead" }, "テスト協力モードでは、いくつかの質問に答えてから結果を表示します（先に結果を見ると、答えが引っ張られるため）。"),
    h("div", { class: "row" }, h("button", { type: "button", class: "btn primary", id: "fb-gate-go", onclick: () => go(null) }, "質問に進む")));
}

function cardsPointer() {
  return h("div", { class: "fb-screen" },
    steps("cards"),
    h("h1", { class: "fb-h1" }, "結果の評価"),
    h("p", { class: "lead" }, "結果の画面で、解釈ごとの評価に答えてください。"),
    h("div", { class: "row" }, h("button", { type: "button", class: "btn primary", onclick: () => go(null, { sub: "result" }) }, "結果を見る")),
    foot());
}

// ================================================================ パート2：結果のカードごとの評価
export function fbResultTop() {
  if (!flowReady() || !at("cards")) return null;
  return h("div", { class: "fb-banner" },
    steps("cards"),
    h("p", null, "各解釈の下の「評価」に答えてください。説明のうち「違う」と思う文は、タップで印を付けられます。最後に「足りない特徴」を書いて、振り返りへ進みます。"));
}

const cardOf = (fb, id) => {
  const c = ((fb.cards ||= {})[id] ||= { r: 0, ng: [], sc: ["", ""], main: "" });
  if (!Array.isArray(c.ng)) c.ng = [];
  if (!Array.isArray(c.sc)) c.sc = ["", ""];
  return c;
};
const peekCard = (fb, id) => fb.cards?.[id] || { r: 0, ng: [], sc: ["", ""], main: "" };

/** パターンカード（article）に評価欄を足す。テスト協力の結果評価の段階でなければ、そのまま返す */
export function fbCard(article, hit) {
  const fb = store3.fb;
  if (!flowReady() || !at("cards")) return article;
  const id = hit.meta.id;
  const t = PATTERN_BY_ID[id]?.text;
  const st = peekCard(fb, id);
  article.classList.add("fb-pcard");

  // 1. 詳細説明の文をタップして「違う」
  const det = article.querySelector(".detail");
  if (det && t) {
    const sents = splitSentences(t.detail);
    const spans = sents.map((txt, i) => {
      const sp = h("span", { class: "fb-sent", role: "button", tabindex: "0", "data-i": i, "aria-pressed": st.ng?.includes(i) ? "true" : "false",
        onclick: () => toggleSent(i, sp),
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSent(i, sp); } } }, txt);
      return sp;
    });
    det.replaceChildren(...spans);
    det.classList.add("fb-detail");
    det.before(h("p", { class: "fb-hint" }, "違うと思う文があればタップ（もう一度タップで取り消し）"));
  }
  function toggleSent(i, sp) {
    const c = cardOf(fb, id);
    const on = !c.ng.includes(i);
    c.ng = on ? [...c.ng, i].sort((a, b) => a - b) : c.ng.filter(x => x !== i);
    sp.setAttribute("aria-pressed", on ? "true" : "false");
    save3();
  }

  // 2. 場面例それぞれ「ありそう／なさそう」
  const lis = [...article.querySelectorAll(".scenes li")].slice(0, 2);
  if (lis.length) {
    article.querySelector(".scenes")?.before(h("p", { class: "fb-hint" }, "場面例は、自分にありそうかどうかを選んでください"));
    lis.forEach((li, i) => {
      const yn = ["y", "n"].map(v => h("button", { type: "button", class: "fb-yn-btn", "data-v": v, "aria-pressed": st.sc?.[i] === v ? "true" : "false",
        onclick: () => {
          const c = cardOf(fb, id);
          c.sc[i] = c.sc[i] === v ? "" : v;
          for (const b of yn) b.setAttribute("aria-pressed", b.dataset.v === c.sc[i] ? "true" : "false");
          save3();
        } }, SCENE_LABEL[v]));
      li.classList.add("fb-scene");
      li.append(h("span", { class: "fb-yn", role: "group", "aria-label": `場面${i + 1}はありそうか` }, yn));
    });
  }

  // 3. 当てはまり度（1〜5）と、主軸だけ「喧嘩の中心か」
  const rate = [1, 2, 3, 4, 5].map(n => h("button", { type: "button", class: "fb-rate-btn", "data-v": n, "aria-pressed": st.r === n ? "true" : "false",
    "aria-label": `当てはまり度 ${n}`, onclick: () => {
      const c = cardOf(fb, id);
      c.r = c.r === n ? 0 : n;
      for (const b of rate) b.setAttribute("aria-pressed", +b.dataset.v === c.r ? "true" : "false");
      panel.classList.remove("fb-missing");
      save3();
    } }, String(n)));
  const isMain = hit.role === "主軸";
  const mainBtns = isMain ? MAIN_CODES.map(v => h("button", { type: "button", class: "fb-main-btn", "data-v": v, "aria-pressed": st.main === v ? "true" : "false",
    onclick: () => {
      const c = cardOf(fb, id);
      c.main = c.main === v ? "" : v;
      for (const b of mainBtns) b.setAttribute("aria-pressed", b.dataset.v === c.main ? "true" : "false");
      save3();
    } }, MAIN_LABEL[v])) : null;
  const panel = h("div", { class: "fb-cardfb", "data-id": id },
    h("h4", { class: "fb-cardfb-h" }, "評価（テスト協力）"),
    h("div", { class: "fb-rate" },
      h("p", { class: "fb-lbl" }, "当てはまり度"),
      h("div", { class: "fb-rate-row", role: "group", "aria-label": "当てはまり度（1〜5）" }, rate),
      h("p", { class: "fb-rate-ends", "aria-hidden": "true" }, h("span", null, "1 当てはまらない"), h("span", null, "5 当てはまる"))),
    isMain ? h("div", { class: "fb-main" },
      h("p", { class: "fb-lbl" }, "これはあなたの喧嘩の中心ですか"),
      h("div", { class: "fb-main-row", role: "group", "aria-label": "喧嘩の中心か" }, mainBtns)) : null);
  const why = article.querySelector(".why");
  if (why) why.before(panel); else article.append(panel);
  return article;
}

/** 結果の最後：足りない特徴（自由記述）と「振り返りへ」 */
export function fbResultTail(r) {
  const fb = store3.fb;
  if (!flowReady() || !at("cards")) return null;
  const ta = h("textarea", { id: "fb-missing", class: "fb-textarea", rows: 4, maxlength: 400,
    placeholder: "例：言い返したあとで、すぐに自分から謝りたくなる",
    oninput: (e) => { fb.missing = e.target.value; saveSoon(); }, onblur: flushText });
  ta.value = fb.missing || "";
  const ids = r.select.chosen.map(x => x.meta.id);
  const next = () => {
    flushText();
    const unrated = ids.filter(id => !(fb.cards?.[id]?.r > 0));
    if (unrated.length && fb.phase === "cards") {
      document.querySelectorAll(".fb-cardfb").forEach(p => { if (unrated.includes(p.dataset.id)) p.classList.add("fb-missing"); });
      if (!confirm(`当てはまり度をまだ選んでいない解釈が ${unrated.length}本 あります。このまま振り返りへ進みますか？`)) {
        document.querySelector(".fb-cardfb.fb-missing")?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
    }
    if (!fb.hardList) fb.hardList = pickHard(fb, store3.result.records);
    go(at("part3") ? null : "part3");
  };
  return h("section", { class: "block fb-tail", "aria-labelledby": "fb-missing-h" },
    h("h2", { id: "fb-missing-h" }, "この結果に足りない、自分の特徴"),
    h("p", { class: "note" }, "結果に出てこなかったけれど、喧嘩のときの自分らしいところがあれば書いてください（任意）。パートナーのことは書かないでください。"),
    ta,
    h("div", { class: "row fb-next" }, h("button", { type: "button", class: "btn primary big", id: "fb-to-part3", onclick: next },
      at("send") ? "送信画面に戻る" : at("part3") ? "振り返りに戻る" : "次へ（振り返り）")));
}

// ================================================================ パート3：振り返り
function hardWhy(fb, id) {
  const r = store3.result.records.find(x => x.shown.includes(id));
  if (!r) return "";
  if (flagsOf(fb, r.key, id).length) return `一言：${flagsOf(fb, r.key, id).map(c => FLAG_LABEL[c]).join("・")}`;
  if (r.itemId !== id) return "差し替えた設問";
  const ds = fb.slots?.[r.key]?.ds;
  return ds != null ? `回答に ${(ds / 10).toFixed(1)}秒` : "";
}

function part3View(fb) {
  if (!fb.hardList) { fb.hardList = pickHard(fb, store3.result.records); save3(); }
  const list = fb.hardList;
  const hardQs = list.map((id, i) => {
    const t = itemTexts(id);
    return h("fieldset", { class: "fb-q fb-hard", "data-id": id },
      h("legend", null, h("span", { class: "dnum" }, i + 1), h("span", { class: "fb-why" }, hardWhy(fb, id))),
      t.stem ? h("p", { class: "fb-hard-stem" }, t.stem) : h("p", { class: "fb-hard-stem fb-x" }, "別々の場面の行動を比べて"),
      h("ul", { class: "fb-hard-opts" }, h("li", null, t.a), h("li", null, t.b)),
      h("p", { class: "fb-lbl" }, "迷った理由に近いもの"),
      pills(`fb-hard-${i}`, HARD_CODES.map(c => [c, HARD_LABEL[c]]), fb.hard?.[id], (v) => { (fb.hard ||= {})[id] = v; save3(); }, { cls: "fb-pills-wrap" }));
  });
  const min = Math.round((fb.activeMs || 0) / 60000);
  const usedSwipe = (fb.swipes || 0) > 0;
  const swipeOpts = [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], ...(usedSwipe ? [] : [[0, "使わなかった"]])];
  const freeTa = h("textarea", { id: "fb-free", class: "fb-textarea", rows: 4, maxlength: 600,
    placeholder: "分かりにくかったところ・気になったところなど",
    oninput: (e) => { fb.free = e.target.value; saveSoon(); }, onblur: flushText });
  freeTa.value = fb.free || "";

  const next = () => {
    flushText();
    const miss = [...document.querySelectorAll(".fb-hard")].filter(f => !fb.hard?.[f.dataset.id]);
    if (!fb.time) miss.push(document.getElementById("fb-time-q"));
    if (fb.swipe == null || (usedSwipe && fb.swipe === 0)) miss.push(document.getElementById("fb-swipe-q"));
    if (miss.length) return markMissing(miss.filter(Boolean), `まだ答えていない質問があります（${miss.length}問）`);
    fb.finishedAt ||= isoLocal();
    go("send");
  };

  return h("div", { class: "fb-screen fb-part3" },
    steps("part3"),
    h("h1", { class: "fb-h1" }, "振り返り"),
    h("p", { class: "lead" }, "最後に、答えていたときのことを聞かせてください。"),
    h("section", { class: "fb-sec", "aria-labelledby": "fb-hard-h" },
      h("h2", { id: "fb-hard-h" }, "迷ったかもしれない設問"),
      h("p", { class: "note" }, "一言を付けた・差し替えた・時間がかかった設問を、自動で選んでいます。それぞれ、近いものを1つ選んでください。"),
      list.length ? hardQs : h("p", { class: "note" }, "迷った設問はありませんでした。")),
    h("section", { class: "fb-sec", "aria-labelledby": "fb-time-h" },
      h("fieldset", { class: "fb-q", id: "fb-time-q" },
        h("legend", { id: "fb-time-h" }, "所要時間はどう感じましたか", h("small", null, min > 0 ? `（今回の回答時間 約${min}分）` : "")),
        pills("fb-time", TIME_CODES.map(c => [c, TIME_LABEL[c]]), fb.time, (v) => { fb.time = v; save3(); }, { cls: "fb-pills-3" }))),
    h("section", { class: "fb-sec", "aria-labelledby": "fb-swipe-h" },
      h("fieldset", { class: "fb-q", id: "fb-swipe-q" },
        h("legend", { id: "fb-swipe-h" }, "スワイプ（カードを左右に動かして答える操作）の使いやすさ"),
        pills("fb-swipe", swipeOpts, fb.swipe, (v) => { fb.swipe = +v; save3(); }, { cls: "fb-pills-scale" }),
        h("p", { class: "fb-rate-ends", "aria-hidden": "true" }, h("span", null, "1 使いにくい"), h("span", null, "5 使いやすい")))),
    h("section", { class: "fb-sec", "aria-labelledby": "fb-free-h" },
      h("h2", { id: "fb-free-h" }, "ひとこと（自由記述・任意）"),
      h("p", { class: "note" }, "感想や、分かりにくかったところなど。パートナーのことは書かないでください。"),
      freeTa),
    h("div", { class: "row fb-next" }, h("button", { type: "button", class: "btn primary big", id: "fb-part3-next", onclick: next }, "送信用テキストを作る")),
    foot());
}

// ================================================================ 送信画面
function sendView(fb) {
  let text, code, ts;
  if (fb) {
    ({ text } = buildText({ session: store3.session, result: store3.result, fb, ua: isCoarsePointer() ? "m" : "d" }));
    code = fb.code; ts = fb.ts;
    writeLast(fb, text);
  } else {
    const last = readLast();
    if (!last) { lastOnly = false; return null; }
    ({ text, code, ts } = last);
  }
  const ta = h("textarea", { id: "fb-text", class: "fb-text", readonly: true, rows: 9, spellcheck: "false", "aria-label": "送信用テキスト",
    onfocus: (e) => e.target.select() });
  ta.value = text;
  const status = h("span", { class: "fb-copied", id: "fb-copied", role: "status", "aria-live": "polite" });
  const say = (msg) => { status.textContent = msg; clearTimeout(say.t); say.t = setTimeout(() => { status.textContent = ""; }, 4000); };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
    if (!ok) {
      try { ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); ok = document.execCommand("copy"); } catch { ok = false; }
    }
    if (ok) { say("コピーしました"); toast("コピーしました"); }
    else { ta.focus(); ta.select(); say("テキストを選択しました。長押しして「コピー」を選んでください"); }
  };
  const share = async () => {
    try { await navigator.share({ text }); say("共有の画面を開きました"); }
    catch (err) { if (err?.name !== "AbortError") say("共有できませんでした。「コピー」を使ってください"); }
  };
  const save = () => { download(filenameFor(code, ts), text, "text/plain;charset=utf-8"); say("ファイルに保存しました"); };

  return h("div", { class: "fb-screen fb-send" },
    fb ? steps("send") : null,
    h("h1", { class: "fb-h1" }, "送信用テキスト"),
    h("p", { class: "fb-send-lead" }, "このテキストを全部、LINEかメールで送ってください"),
    h("p", { class: "note" }, "いちばん下の行（16DFB1 から END まで）が回答の記録です。途中で切れると読めなくなるので、最後まで全部送ってください。名前は入っていません。長すぎて送れないときは「ファイルに保存」した .txt を送ってください。"),
    ta,
    h("p", { class: "fb-count" }, h("span", { id: "fb-count" }, `${[...text].length.toLocaleString("ja-JP")}文字`), status),
    h("div", { class: "fb-send-btns" },
      canShare ? h("button", { type: "button", class: "btn primary", id: "fb-share", onclick: share }, "共有する") : null,
      h("button", { type: "button", class: ["btn", !canShare && "primary"], id: "fb-copy", onclick: copy }, "コピー"),
      h("button", { type: "button", class: "btn", id: "fb-save", onclick: save }, "ファイルに保存（.txt）")),
    h("div", { class: "fb-codebox" },
      h("p", null, "あなたの参加者コード ", h("b", { class: "fb-code-inline" }, code)),
      h("p", { class: "fb-code-msg" }, "このコードを覚えておいてください（再検査で使います）")),
    fb ? h("div", { class: "fb-send-links" },
      h("button", { type: "button", class: "linkish", onclick: () => go(null, { sub: "result" }) }, "結果と評価を見直す"),
      h("button", { type: "button", class: "linkish", onclick: () => go("part3") }, "振り返りを直す")) : null,
    h("div", { class: "fb-send-links" },
      h("button", { type: "button", class: "linkish", onclick: () => { lastOnly = false; toStart3(); } }, "最初の画面へ"),
      fb ? h("button", { type: "button", class: "linkish fb-restart", id: "fb-restart", onclick: () => {
        if (!confirm("いまの回答と感想を消して、最初からやり直しますか？（送信用テキストの控えは残ります）")) return;
        discard3(); window.scrollTo(0, 0);
      } }, "最初からやり直す") : null),
    fb ? null : h("p", { class: "note" }, "これは前回作った送信用テキストの控えです（回答の記録そのものは、別の診断を始めたため残っていません）。"));
}


