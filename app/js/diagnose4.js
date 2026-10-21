// 24問版（v4）の診断の開始（#diagnose）と質問（#diagnose/q）。決定 U42・U44。仕様：docs/diagnosis-v4.md §4・docs/app-screens.md §4.2・§4.3
//   中身は js/ui/four_store.js（保存・再開）と js/data/questions4.js（設問・順）。三択（diagnose.js）は今のまま残す
//   どちらを出すかは main.js が決める（app/js/diagnosis_version.js。#diagnose は ?dv= ＞ 既定 v4、#diagnose/q は今の診断の版）
//
//   開始画面：題『24問で、ふたりのすれ違い方を整理する』・説明（普段8問・場面16問・2つの選択肢から選ぶ）・開始時の案内。分数は出さない
//     三択の診断が途中で、それが今の診断のときは、その続きへの入口も出す（途中の三択は三択のまま続く。消さない）
//   質問（U44）：三択の質問の画面（diagnose.js。U41 のあと）と同じ見た目・動き。部品のクラスも三択と同じ a-dg-
//     問い：普段の問は札「普段の自分について」＋「普段の自分に近いのは、どっち？」（いちばん目立つ）、
//       場面の問は札「場面」＋場面の文（いちばん目立つ）＋「この場面で、自分に近いのは、どっち？」（場面の文が「？」で終わる問は出さない）
//     回答2枚：上＝A（くすんだ赤・右に丸「→」・右へスワイプ）、下＝B（灰青・左に丸「←」・左へスワイプ）。タップでも選べる。
//       スワイプは C「触った回答だけ」（U28）、向きは U41 の6（app/js/swipe_dir.js：選択肢 "left"＝上＝A、"right"＝下＝B）。下へ＝戻る（三択と同じ）。上は無い
//     キーボード：→ で上（A）、← で下（B）
//     その下：案内の1行・細い線・別のボタン「判断できない（経験がない・思い浮かばない）」（点線の枠・「？」の印。静かな見た目）
//     「前の質問に戻る」「中断してあとで続ける（回答は保存されています）」。問題を変える・練習・追加の問は無い。進み具合は /24
//   見た目は app/css/diagnose.css（三択と同じ a-dg- の部品と、a-d4- で始まるクラス）
import { h, icon, topBar, go, rowLink } from "./ui.js";
import { store4, restore4, start4, answer4, back4, onChange4, progress4, current4 } from "../../js/ui/four_store.js";
import { START4, UNKNOWN_LABEL4, KIND_LABEL4, ANSWER4, askOf4 } from "../../js/data/questions4.js";
import { currentVersion, currentResult, dvFromSearch, midV3 } from "./diagnosis_version.js";
import { attachSwipe, isCoarsePointer, prefersReducedMotion } from "../../js/ui/swipe.js";
import { DIR_OF, OPTION_OF, optionOfKey, movingPart, allows } from "./swipe_dir.js";

/** 選択肢（上のカード "left"・下のカード "right"）→ 保存する値（A＝1・B＝−1） */
export const VALUE_OF_OPTION4 = Object.freeze({ left: ANSWER4.A, right: ANSWER4.B });

const ENTER_FROM = { left: "right", right: "left", down: "top" };   // 飛ばした向きの反対側から次が入る（diagnose.js と同じ）
const ENTER_MS = 240;
const SWIPE_IGNORE = "a, input, select, textarea, summary, label, button:not(.a-dg-ans), [data-no-swipe]";
const ARM_MS = 280;       // 描いた直後の取り違えの2度押しを受けない（タップだけ）

let view = null;          // いま出している画面 { root, key }。片付けで null
let detach = null;        // スワイプの取り外し（描き直すたびに外して付け直す）
let enterFrom = null;     // 次に描く質問を入れる側（スワイプで確定した直後だけ）
let clipTimer = 0;
let armedAt = 0;

onChange4(() => { if (view) draw(); });

export function render(root, route) {
  restore4();
  view = { root, key: route.key };
  document.addEventListener("keydown", onKey);
  draw({ first: true });
  return () => {
    view = null;
    enterFrom = null;
    detach?.(); detach = null;
    document.removeEventListener("keydown", onKey);
    releaseClip(0);
  };
}

function draw({ first = false } = {}) {
  const { root, key } = view;
  detach?.(); detach = null;
  if (key === "diagnose") {
    root.replaceChildren(startView());
    return;
  }
  const s = store4.session;
  if (!s) { location.replace("#diagnose"); return; }
  if (s.completed) { location.replace("#result"); return; }
  const screen = questionView(s);
  root.replaceChildren(screen);
  const card = screen.querySelector(".a-dg-qcard");
  bindSwipe(card, current4(s));
  startEnter(card);
  armedAt = now() + ARM_MS;
  if (!first) screen.querySelector("[data-focus]")?.focus({ preventScroll: true });
  if (!first) window.scrollTo(0, 0);
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const armed = () => now() >= armedAt;

// ================================================================ 開始画面（#diagnose）
const phrase = (t) => h("span", { class: "a-dg-phrase" }, t);

function startView() {
  const s = store4.session;
  const p = s && !s.completed ? progress4(s) : null;
  const mid = !!p && p.answered > 0;
  const fresh = !!p && p.answered === 0;
  // 前回の結果（今の診断の結果。三択の結果でもよい。#result がその版の結果の画面を出す）
  let done = false;
  try { done = !!currentResult(); } catch { done = false; }
  // 三択の途中の診断（それが今の診断で、URL で版を決めていないとき）。三択のまま続ける入口を出す
  let old = null;
  try { old = !dvFromSearch(location.search) && currentVersion() === "v3" ? midV3() : null; } catch { old = null; }

  const begin = () => { start4(); go("#diagnose/q"); };
  const restart = () => {
    if (!window.confirm("途中までの回答を消して、最初からやり直しますか？")) return;
    begin();
  };

  const actions = mid
    ? [
      h("p", { class: "a-dg-resume" }, "途中まで答えた診断があります", h("span", { class: "a-nowrap" }, `（${p.answered}問回答済み）。`)),
      h("a", { class: "a-btn a-btn-block", href: "#diagnose/q", id: "a-dg-resume" }, "続きから答える", icon("arrow-right")),
      h("button", { type: "button", class: "a-btn a-btn-outline a-btn-block", id: "a-dg-restart", onclick: restart }, "最初からやり直す"),
    ]
    : fresh
      ? [h("a", { class: "a-btn a-btn-block", href: "#diagnose/q", id: "a-dg-start" }, "診断をはじめる", icon("arrow-right"))]
      : [h("button", { type: "button", class: "a-btn a-btn-block", id: "a-dg-start", onclick: begin }, "診断をはじめる", icon("arrow-right"))];

  return h("div", { class: "a-dg-start a-d4-start", "data-dv": "v4" },
    topBar({ title: "診断" }),
    h("section", { class: "a-dg-intro", "aria-labelledby": "a-dg-title" },
      h("h1", { class: "a-dg-title a-d4-title", id: "a-dg-title", "data-focus": "" }, phrase("24問で、"), phrase("ふたりのすれ違い方を"), phrase("整理する")),
      h("p", { class: "a-lead a-dg-lead" }, START4.lead)),
    h("section", { class: "a-card a-d4-guide", "aria-labelledby": "a-d4-guide-h" },
      h("h2", { class: "a-kicker", id: "a-d4-guide-h" }, "答える前に"),
      h("p", { class: "a-d4-guide-text" }, START4.guide)),
    h("ul", { class: "a-card a-dg-how", "aria-label": "答え方" },
      h("li", null,
        h("span", { class: "a-dg-how-ic a-dg-how-pair", "aria-hidden": "true" },
          h("span", { class: "a-dg-dot-top" }, icon("arrow-right", { size: 16 })), h("span", { class: "a-dg-dot-bottom" }, icon("arrow-left", { size: 16 }))),
        h("p", null, h("b", null, "自分に近い方を選ぶ"),
          h("span", null, "上の文は右へ、下の文は左へスワイプするか、タップで選びます。"))),
      h("li", null,
        h("span", { class: "a-dg-how-ic a-d4-how-q", "aria-hidden": "true" }, "？"),
        h("p", null, h("b", null, "思い浮かばないときは「判断できない」"),
          h("span", null, "経験がない・思い浮かばない問いは、無理に選ばなくてかまいません。"))),
      h("li", null,
        h("span", { class: "a-dg-how-ic", "aria-hidden": "true" }, icon("redo", { size: 22 })),
        h("p", null, h("b", null, "途中でやめても、続きから"),
          h("span", null, "答えは選ぶたびにこの端末に残ります。前の質問に戻って直すこともできます。")))),
    h("div", { class: "a-dg-actions" }, actions),
    old && !mid ? oldBlock(old) : null,
    done && !mid ? h("div", { class: "a-rows a-dg-prev" }, rowLink({ href: "#result", ic: "paper", text: "前回の結果を見る" })) : null);
}

/** 三択の途中の診断（今の診断のとき）。三択のまま続ける */
function oldBlock(old) {
  return h("div", { class: "a-card a-d4-old" },
    h("p", { class: "a-d4-old-text" }, "前の形式（三択）で途中まで答えた診断があります", h("span", { class: "a-nowrap" }, `（${old.answered}問回答済み）。`)),
    h("a", { class: "a-btn a-btn-outline a-btn-block a-btn-sm", href: "#diagnose/q", id: "a-d4-old-resume" }, "三択の続きから答える", icon("arrow-right")));
}

// ================================================================ 質問（#diagnose/q）
function qTop(p) {
  return topBar({
    title: "診断", back: "#home", heading: true,
    right: h("p", { class: "a-dg-count", "aria-label": `${p.total}問中 ${p.answered}問 回答済み` },
      h("span", { "aria-hidden": "true" }, `${p.answered} / ${p.total}`)),
  });
}

function progressBar(p) {
  return h("div", { class: "a-dg-progress", role: "progressbar", "aria-label": "回答の進み具合", "aria-valuemin": 0, "aria-valuemax": p.total, "aria-valuenow": p.answered },
    h("i", { style: { width: `${Math.round(p.ratio * 100)}%` } }));
}

/** 回答のカード（三択の diagnose.js の answerCard と同じ形。上＝選択肢 "left"＝A、下＝選択肢 "right"＝B） */
function answerCard(option, text, { picked = false, onPick }) {
  const top = option === "left";
  const dot = h("span", { class: "a-dg-ans-dot", "aria-hidden": "true" }, icon(`arrow-${DIR_OF[option]}`, { size: 26 }));
  const body = h("span", { class: "a-dg-ans-text" }, h("span", { class: "a-sr" }, top ? "上の回答：" : "下の回答："), text);
  return h("button", { type: "button", class: ["a-dg-ans", `a-dg-ans-${option}`, picked && "is-picked"], "data-side": option,
    "data-value": String(VALUE_OF_OPTION4[option]), "aria-pressed": picked ? "true" : "false", onclick: onPick },
    DIR_OF[option] === "left" ? [dot, body] : [body, dot],
    picked ? h("span", { class: "a-dg-ans-picked" }, icon("check", { size: 14 }), "前に選んだ回答") : null);
}

/** 案内の1行（三択と同じ。キーボードは → 上 ／ ← 下 だけ） */
function swipeHint() {
  return h("div", { class: "a-dg-hint" },
    h("p", { class: "a-dg-hint-text" },
      h("span", { class: "a-dg-hand", "aria-hidden": "true" }, icon("arrow-left", { size: 12 }), icon("hand", { size: 20 }), icon("arrow-right", { size: 12 })),
      h("span", null, "左右にスワイプ、またはタップで選ぶ")),
    isCoarsePointer() ? null : h("p", { class: "a-dg-kbd" }, "キーボード：→ 上 ／ ← 下"));
}

/** UNKNOWN_LABEL4 を「判断できない」と「（…）」に分ける（つなぐと元の文と同じ） */
function unknownParts() {
  const i = UNKNOWN_LABEL4.indexOf("（");
  if (i < 0) return UNKNOWN_LABEL4;
  return [h("span", { class: "a-nowrap" }, UNKNOWN_LABEL4.slice(0, i)), h("span", { class: "a-d4-unknown-sub" }, UNKNOWN_LABEL4.slice(i))];
}

const pickedValue = (c) => (c.answer ? (c.answer.status === "unknown" ? null : c.answer.value) : undefined);

function takeEnter() {
  const e = enterFrom && !prefersReducedMotion() ? enterFrom : null;
  enterFrom = null;
  return e;
}

/** タップ・キーボードで選ぶ（option は "left"＝A・"right"＝B、null＝判断できない） */
function choose(option) {
  if (!armed()) return;
  answer4(option === null ? null : VALUE_OF_OPTION4[option]);
}

function questionView(s) {
  const c = current4(s);
  const p = progress4(s);
  const it = c.item;
  const prev = pickedValue(c);
  const ask = askOf4(it);
  const U = it.kind === "U";

  const head = U
    ? [h("p", { class: "a-dg-prompt", id: "a-dg-q", tabindex: "-1", "data-focus": "" }, ask)]
    : [
      h("p", { class: "a-dg-stem", id: "a-dg-q", tabindex: "-1", "data-focus": "" }, it.scene),
      ask ? h("p", { class: "a-dg-ask" }, ask) : null,
    ];

  return h("div", { class: "a-dg-q a-d4-q", "data-kind": it.kind, "data-id": it.id, "data-dv": "v4" },
    qTop(p),
    progressBar(p),
    h("div", { class: ["a-dg-qcard", `a-d4-kind-${it.kind}`], "data-enter": takeEnter() },
      h("p", { class: "a-dg-kicker" }, KIND_LABEL4[it.kind]),
      head,
      h("div", { class: "a-dg-pair", role: "group", "aria-labelledby": "a-dg-q" },
        answerCard("left", it.a, { picked: prev === ANSWER4.A, onPick: () => choose("left") }),
        answerCard("right", it.b, { picked: prev === ANSWER4.B, onPick: () => choose("right") })),
      h("span", { class: "a-dg-badge", "aria-hidden": "true" })),
    swipeHint(),
    h("hr", { class: "a-dg-sep" }),
    h("div", { class: "a-dg-tools a-d4-tools" },
      h("button", {
        type: "button", class: ["a-d4-unknown", prev === null && "is-picked"], id: "a-d4-unknown", "data-value": "unknown",
        "aria-pressed": prev === null ? "true" : "false", onclick: () => choose(null),
      },
      h("span", { class: "a-d4-unknown-mark", "aria-hidden": "true" }, "？"),
      // 「判断できない」と「（経験がない・思い浮かばない）」で折り返す（文は省かない）
      h("span", { class: "a-d4-unknown-label" }, unknownParts()),
      prev === null ? h("span", { class: "a-d4-picked" }, icon("check", { size: 14 }), "前に選んだ回答") : null)),
    h("div", { class: "a-dg-foot" },
      c.index > 0 ? h("button", { type: "button", class: "a-link a-link-tap a-dg-back", id: "a-dg-back", onclick: () => back4() }, "前の質問に戻る") : null,
      h("a", { class: "a-link a-link-tap a-dg-pause", href: "#diagnose" },
        h("span", { class: "a-nowrap" }, "中断してあとで続ける"), h("span", { class: "a-nowrap" }, "（回答は保存されています）"))));
}

// ================================================================ スワイプ（diagnose.js の bindSwipe と同じ形。上〔問題を変える〕は無い）
function holdClip() { clearTimeout(clipTimer); document.documentElement.classList.add("a-dg-swiping"); }
function releaseClip(ms = 0) { clearTimeout(clipTimer); clipTimer = setTimeout(() => document.documentElement.classList.remove("a-dg-swiping"), ms); }

function startEnter(card) {
  const dir = card?.dataset.enter;
  if (!dir) return;
  delete card.dataset.enter;
  card.classList.add(`a-dg-enter-${dir}`);
  holdClip(); releaseClip(ENTER_MS + 80);
}

function bindSwipe(card, c) {
  if (!card || !c) return;
  const badge = card.querySelector(".a-dg-badge");
  const parts = { card, left: card.querySelector(".a-dg-ans-left"), right: card.querySelector(".a-dg-ans-right") };
  const sides = [parts.left, parts.right];
  const label = { down: "戻る" };
  // 指を置いた回答の選択肢（"left"＝上＝A | "right"＝下＝B）。回答の外（問いの文など）から始めたときは null
  const sideOf = (start) => {
    const b = start instanceof Element ? start.closest(".a-dg-ans") : null;
    return b && card.contains(b) ? b.dataset.side : null;
  };
  const goDir = (dir, fn) => () => { enterFrom = ENTER_FROM[dir] ?? null; try { fn(); } finally { enterFrom = null; } };
  // 右へ＝上の回答（A）、左へ＝下の回答（B）。決定 U41 の6
  detach = attachSwipe(card, {
    ignore: SWIPE_IGNORE,
    maxTilt: 5,
    target: ({ axis, dir, start }) => {
      const el = parts[movingPart({ axis, dir, startOption: sideOf(start) })] || card;
      if (el !== card) el.classList.add("a-dg-moving");
      return el;
    },
    allow: (dir, { start }) => allows(dir, sideOf(start)),
    onLeft: goDir("left", () => answer4(VALUE_OF_OPTION4[OPTION_OF.left])),
    onRight: goDir("right", () => answer4(VALUE_OF_OPTION4[OPTION_OF.right])),
    onDown: c.index > 0 ? goDir("down", () => back4()) : undefined,
    onStart: () => { holdClip(); card.classList.add("is-dragging"); },
    onEnd: () => {
      releaseClip(0);
      card.classList.remove("is-dragging", "is-ready");
      for (const x of card.querySelectorAll(".a-dg-moving")) x.classList.remove("a-dg-moving");
    },
    onProgress: ({ dir, progress, ready, dragging }) => {
      card.classList.toggle("is-dragging", dragging);
      card.classList.toggle("is-ready", ready);
      if (dir) card.dataset.swipe = dir; else delete card.dataset.swipe;
      badge.textContent = dir && label[dir] ? label[dir] : "";
      card.style.setProperty("--p", progress.toFixed(3));
      for (const b of sides) b.classList.toggle("is-hot", dir === DIR_OF[b.dataset.side] && progress >= 0.2);
    },
  });
}

// ================================================================ キーボード（→ で上の回答〔A〕・← で下の回答〔B〕。U41 の6）
function onKey(e) {
  if (!view || view.key !== "diagnose/q") return;
  const s = store4.session;
  if (!s || s.completed) return;
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  const opt = optionOfKey(e.key);   // → ＝上（"left"＝A）、← ＝下（"right"＝B）
  if (!opt) return;
  e.preventDefault();
  answer4(VALUE_OF_OPTION4[opt]);
}
