// 診断の開始（#diagnose）と、練習カード・質問（#diagnose/q）。仕様：docs/app-screens.md §4.2・§4.3（画像3）
//   中身は今の三択診断をそのまま使う（js/ui/three_store.js。保存のキーも同じなので、今の画面と続き・結果が共通）。js/ の中身は直さない
//   値・操作・文言は今の画面 js/ui/three.js の startView・questionView・practiceView・bindSwipe・キーボードと同じ
//   スワイプは C「触った回答だけ」で固定（決定 U28。js/ui/swipe_variants.js の swipePart("c", …)・swipeAllows("c", …)）
//     つかんだ回答だけが、その向きへだけ動く。回答の外から始めたら、その向きで選ぶ回答が動く
//     向き（決定 U41 の6）：上のカード（選択肢 "left"）は右へ、下のカード（選択肢 "right"）は左へ。読み替えは app/js/swipe_dir.js
//       記録する答えは選択肢のまま（同じカードを選べば前と同じ答え・同じ結果）。今の画面（/#three）は前の向きのまま
//     上＝問題を変える（使い切ったら答えずに進む）、下＝戻る は、問いと回答のまとまり（.a-dg-qcard）ごと動く
//   キーボード：→ で上の回答、← で下の回答、Space で問題を変える（使い切ったら答えずに進む）。練習カードは ← → だけ
//   見た目は app/css/diagnose.css（クラスは a-dg- で始まる）
import { h, icon, topBar, toast, go, rowLink } from "./ui.js";
import { store3, restore3, start3, answer3, swap3, skip3, back3, practice3, practicePending3, onChange3 } from "../../js/ui/three_store.js";
import { PRACTICE_CARD, versionOf, resolveVersion } from "../../js/three_version.js";
import { MAX_SWAPS } from "../../js/adaptive3.js";
import { attachSwipe, isCoarsePointer, prefersReducedMotion } from "../../js/ui/swipe.js";
import { DIR_OF, OPTION_OF, optionOfKey, movingPart, allows } from "./swipe_dir.js";

const ENTER_FROM = { left: "right", right: "left", up: "bottom", down: "top" };   // 飛ばした向きの反対側から次が入る
const ENTER_MS = 240;                                  // diagnose.css の a-dg-in-* と合わせる
const SWIPE_IGNORE = "a, input, select, textarea, summary, label, button:not(.a-dg-ans), [data-no-swipe]";   // 回答はボタンだが、つかんでよい

let view = null;          // いま出している画面 { root, key }。片付けで null
let detach = null;        // スワイプの取り外し（描き直すたびに外して付け直す）
let enterFrom = null;     // 次に描く質問を入れる側（スワイプで確定した直後だけ）
let clipTimer = 0;

// three_store.js の通知は外せないので、ここで1回だけ登録し、いまの画面だけを描き直す
onChange3(() => { if (view) draw(); });

export function render(root, route) {
  restore3();
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
  const s = store3.session;
  // 始めていない → 開始画面へ。答え終わっている → 結果へ（どちらも今の画面の履歴を置き換える）
  if (!s) { location.replace("#diagnose"); return; }
  if (s.isDone()) { location.replace("#result"); return; }
  const practice = practicePending3();
  const screen = practice ? practiceView(s) : questionView(s);
  root.replaceChildren(screen);
  const card = screen.querySelector(".a-dg-qcard");
  bindSwipe(card, practice ? null : s.current());
  startEnter(card);
  // 描き直したら焦点を新しい問いへ（読み上げで次の問いが分かるように）。最初の表示は main.js が [data-focus] へ移す
  if (!first) screen.querySelector("[data-focus]")?.focus({ preventScroll: true });
}

// ================================================================ 開始画面（#diagnose。§4.2）
const phrase = (t) => h("span", { class: "a-dg-phrase" }, t);

function countText(v) {
  const c = versionOf(v).caps, max = 64 + c.wExtra + c.xExtra;   // 今の画面の leadCountText と同じ
  return { questions: `64〜${max}問`, minutes: `${max > 80 ? "8〜12" : "8〜10"}分ほど` };
}

function startView() {
  const s = store3.session;
  const p = s && !s.isDone() ? s.progress() : null;
  const mid = !!p && p.answered > 0;
  const fresh = !!p && p.answered === 0;
  const done = !!(s && s.isDone() && store3.result);
  // 新しく始める診断の設問の版：URL の ?qv= ＞ 既定（v3）。途中の診断は始めたときの版のまま続く
  const v = resolveVersion({ search: location.search });
  const n = countText(mid || fresh ? s.version : v);

  const begin = () => { start3({ adaptive: true, version: v }); go("#diagnose/q"); };
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

  return h("div", { class: "a-dg-start" },
    topBar({ title: "診断", help: true }),
    h("section", { class: "a-dg-intro", "aria-labelledby": "a-dg-title" },
      h("h1", { class: "a-dg-title", id: "a-dg-title", "data-focus": "" }, phrase("左か、右か。"), phrase("迷ったら問題を変える")),
      h("p", { class: "a-lead a-dg-lead" }, "どの質問も、2つの選択肢のうち自分に近い方を選ぶだけ。")),
    h("ul", { class: "a-card a-dg-how", "aria-label": "答え方" },
      h("li", null,
        h("span", { class: "a-dg-how-ic a-dg-how-pair", "aria-hidden": "true" },
          h("span", { class: "a-dg-dot-top" }, icon("arrow-right", { size: 16 })), h("span", { class: "a-dg-dot-bottom" }, icon("arrow-left", { size: 16 }))),
        h("p", null, h("b", null, "自分に近い方を選ぶ"),
          h("span", null, "左右にスワイプするか、タップで選びます。"))),
      h("li", null,
        h("span", { class: "a-dg-how-ic", "aria-hidden": "true" }, icon("redo", { size: 22 })),
        h("p", null, h("b", null, "迷ったら「問題を変える」"),
          h("span", null, "同じ枠の別の場面に差し替えます（1問につき2回まで）。"))),
      h("li", null,
        h("span", { class: "a-dg-how-ic", "aria-hidden": "true" }, icon("paper", { size: 22 })),
        h("p", null, h("b", null, `${n.questions}、${n.minutes}`),
          h("span", null, "決めきれないところだけ、追加で聞きます。")))),
    h("p", { class: "a-note a-dg-note" },
      "前半の32問は同じ場面での2つの動き方、後半の32問は別々の場面の行動どうしを比べます。途中でやめても、続きから答えられます。"),
    h("div", { class: "a-dg-actions" }, actions),
    done && !mid ? h("div", { class: "a-rows a-dg-prev" }, rowLink({ href: "#result", ic: "paper", text: "前回の結果を見る" })) : null);
}

// ================================================================ 質問（#diagnose/q。§4.3・画像3）
/** 上の題（← はホームへ。回答は保存されたまま）と、答えた数 / 今の予定の数 */
function qTop(p) {
  return topBar({
    title: "診断", back: "#home", heading: true, help: true,   // 右の数の右に「危ないときは」（決定 U47）
    right: h("p", { class: "a-dg-count", "aria-label": `${p.total}問中 ${p.answered}問 回答済み` },
      h("span", { "aria-hidden": "true" }, `${p.answered} / ${p.total}`)),
  });
}

function progressBar(p) {
  return h("div", { class: "a-dg-progress", role: "progressbar", "aria-label": "回答の進み具合", "aria-valuemin": 0, "aria-valuemax": p.total, "aria-valuenow": p.answered },
    h("i", { style: { width: `${Math.round(p.ratio * 100)}%` } }));
}

/**
 * 回答のカード（上＝選択肢 "left"、下＝選択肢 "right"）。押しても、つかんで動かしても答えられる
 *   向き（決定 U41 の6）：上のカードは右へ（文・縦線・右に丸「→」）、下のカードは左へ（左に丸「←」・縦線・文）。色はカードのまま（上＝くすんだ赤、下＝灰青）
 */
function answerCard(side, text, { picked = false, onPick }) {
  const top = side === "left";
  const dot = h("span", { class: "a-dg-ans-dot", "aria-hidden": "true" }, icon(`arrow-${DIR_OF[side]}`, { size: 26 }));
  const body = h("span", { class: "a-dg-ans-text" }, h("span", { class: "a-sr" }, top ? "上の回答：" : "下の回答："), text);
  return h("button", { type: "button", class: ["a-dg-ans", `a-dg-ans-${side}`, picked && "is-picked"], "data-side": side,
    "aria-pressed": picked ? "true" : "false", onclick: onPick },
    DIR_OF[side] === "left" ? [dot, body] : [body, dot],
    picked ? h("span", { class: "a-dg-ans-picked" }, icon("check", { size: 14 }), "前に選んだ回答") : null);
}

/** 小さな手のアイコンと「左右にスワイプ、またはタップで選ぶ」の1行（質問より目立たせない。決定 U41 の4） */
function swipeHint({ practice = false } = {}) {
  return h("div", { class: "a-dg-hint" },
    h("p", { class: "a-dg-hint-text" },
      h("span", { class: "a-dg-hand", "aria-hidden": "true" }, icon("arrow-left", { size: 12 }), icon("hand", { size: 20 }), icon("arrow-right", { size: 12 })),
      h("span", null, "左右にスワイプ、またはタップで選ぶ")),
    isCoarsePointer() ? null
      : h("p", { class: "a-dg-kbd" }, practice ? "キーボード：→ 上 ／ ← 下" : "キーボード：→ 上 ／ ← 下 ／ Space 問題を変える（使い切ったら答えずに進む）"));
}

function noticeOf(c, s) {
  // 追加の質問・差し替えの短い案内（今の画面と同じ文）
  if (c.stage === "W追加") return s.version === "v1" ? "左右が拮抗した領域を、別の場面でもう一度聞いています。" : "左右がはっきりしない（または強さと食い違う）領域を、別の場面でもう一度聞いています。";
  if (c.stage === "X追加") return "強さがはっきりしない傾向を、別の組み合わせでもう一度比べています。";
  if (c.swapsUsed > 0) return `差し替えた設問です（この枠で${c.swapsUsed}回目）。`;
  return null;
}

function takeEnter() {
  const e = enterFrom && !prefersReducedMotion() ? enterFrom : null;
  enterFrom = null;
  return e;
}

function questionView(s) {
  const c = s.current();
  const p = s.progress();
  const q = c.question;
  const notice = noticeOf(c, s);
  const W = q.kind === "W";

  const swapBtn = c.canSwap
    ? h("button", { type: "button", class: "a-btn a-btn-outline a-dg-swap", id: "a-dg-swap", onclick: () => swap3("t"),
      "aria-label": `問題を変える（残り${c.swapsLeft}回）` },
      icon("redo"),
      h("span", { class: "a-dg-swap-label" }, "問題を変える"),
      h("span", { class: "a-dg-swap-left", "aria-hidden": "true" }, "残り", h("b", null, String(c.swapsLeft)), "回"))
    : h("button", { type: "button", class: "a-btn a-btn-outline a-dg-swap", id: "a-dg-skip", onclick: () => skip3("t") },
      icon("arrow-right"), h("span", { class: "a-dg-swap-label" }, "答えずに進む"));

  return h("div", { class: "a-dg-q", "data-kind": q.kind },
    qTop(p),
    progressBar(p),
    h("div", { class: ["a-dg-qcard", `a-dg-kind-${q.kind}`], "data-enter": takeEnter() },
      notice ? h("p", { class: "a-dg-notice" }, notice) : null,
      h("p", { class: "a-dg-kicker" }, W ? "この場面で" : "別々の場面の行動を比べて"),
      h("p", { class: W ? "a-dg-stem" : "a-dg-prompt", id: "a-dg-q", tabindex: "-1", "data-focus": "" }, W ? q.stem : q.prompt),
      W ? h("p", { class: "a-dg-ask" }, q.prompt) : null,
      h("div", { class: "a-dg-pair", role: "group", "aria-labelledby": "a-dg-q" },
        answerCard("left", q.left.text, { picked: c.answer === "left", onPick: () => answer3("left", "t") }),
        answerCard("right", q.right.text, { picked: c.answer === "right", onPick: () => answer3("right", "t") })),
      h("span", { class: "a-dg-badge", "aria-hidden": "true" })),
    swipeHint(),
    h("hr", { class: "a-dg-sep" }),
    h("div", { class: "a-dg-tools" },
      swapBtn,
      c.canSkip ? h("p", { class: "a-note a-dg-skipnote" }, c.swapsUsed >= MAX_SWAPS
        ? "この枠の差し替えは使い切りました。どうしても選べなければ「答えずに進む」（集計には入れません）。"
        : "この枠には差し替えられる設問が残っていません。どうしても選べなければ「答えずに進む」（集計には入れません）。") : null),
    h("div", { class: "a-dg-foot" },
      c.index > 0 ? h("button", { type: "button", class: "a-link a-link-tap a-dg-back", id: "a-dg-back", onclick: () => back3("t") }, "前の質問に戻る") : null,
      h("a", { class: "a-link a-link-tap a-dg-pause", href: "#diagnose" },
        h("span", { class: "a-nowrap" }, "中断して最初の画面へ"), h("span", { class: "a-nowrap" }, "（回答は保存されています）"))));
}

// ---------------------------------------------------------------- 練習カード（v2・v3。1問目の前。採点しない・時間を測らない・記録しない）
function practiceView(s) {
  const pc = PRACTICE_CARD;
  const p = s.progress();
  return h("div", { class: "a-dg-q a-dg-practice", "data-kind": "practice" },
    qTop(p),
    progressBar(p),
    h("div", { class: "a-dg-qcard a-dg-kind-practice", "data-enter": takeEnter() },
      h("p", { class: "a-dg-kicker" }, h("span", { class: "a-dg-tag" }, "練習"), "結果には入りません"),
      h("p", { class: "a-dg-prompt a-dg-prompt-practice", id: "a-dg-q", tabindex: "-1", "data-focus": "" }, pc.stem),
      h("div", { class: "a-dg-pair", role: "group", "aria-labelledby": "a-dg-q" },
        answerCard("left", pc.left, { onPick: () => practiceDone("left") }),
        answerCard("right", pc.right, { onPick: () => practiceDone("right") })),
      h("span", { class: "a-dg-badge", "aria-hidden": "true" })),
    swipeHint({ practice: true }),
    h("p", { class: "a-note a-dg-practice-note" }, "この1問は結果に入りません。"),
    h("div", { class: "a-dg-foot" },
      h("a", { class: "a-link a-link-tap a-dg-pause", href: "#diagnose" }, "中断して最初の画面へ")));
}

function practiceDone(side) {
  if (practice3(side)) toast("練習はここまで。次の質問から本番です");
}

// ================================================================ スワイプ
// 飛ばす・入る間は、カードが画面の横にはみ出してページが横に広がらないようにする（diagnose.css の html.a-dg-swiping）
function holdClip() { clearTimeout(clipTimer); document.documentElement.classList.add("a-dg-swiping"); }
function releaseClip(ms = 0) { clearTimeout(clipTimer); clipTimer = setTimeout(() => document.documentElement.classList.remove("a-dg-swiping"), ms); }

function startEnter(card) {
  const dir = card?.dataset.enter;
  if (!dir) return;
  delete card.dataset.enter;
  card.classList.add(`a-dg-enter-${dir}`);
  holdClip(); releaseClip(ENTER_MS + 80);
}

/** c が null なら練習カード（左右だけ） */
function bindSwipe(card, c) {
  if (!card) return;
  const badge = card.querySelector(".a-dg-badge");
  const parts = { card, left: card.querySelector(".a-dg-ans-left"), right: card.querySelector(".a-dg-ans-right") };
  const sides = [parts.left, parts.right];
  const label = c ? { up: c.canSwap ? "問題を変える" : "答えずに進む", down: "戻る" } : {};
  // 指を置いた回答の選択肢（"left"＝上 | "right"＝下）。回答の外（問いの文など）から始めたときは null
  const sideOf = (start) => {
    const b = start instanceof Element ? start.closest(".a-dg-ans") : null;
    return b && card.contains(b) ? b.dataset.side : null;
  };
  const go = (dir, fn) => () => { enterFrom = ENTER_FROM[dir]; try { fn(); } finally { enterFrom = null; } };
  // 右へ＝上の回答（選択肢 "left"）、左へ＝下の回答（選択肢 "right"）。決定 U41 の6
  const handlers = c
    ? {
      onLeft: go("left", () => answer3(OPTION_OF.left, "s")),
      onRight: go("right", () => answer3(OPTION_OF.right, "s")),
      onUp: go("up", c.canSwap ? () => swap3("s") : () => skip3("s")),
      onDown: c.index > 0 ? go("down", () => back3("s")) : undefined,
    }
    : { onLeft: go("left", () => practiceDone(OPTION_OF.left)), onRight: go("right", () => practiceDone(OPTION_OF.right)) };
  detach = attachSwipe(card, {
    ignore: SWIPE_IGNORE,
    maxTilt: 5,
    target: ({ axis, dir, start }) => {
      const el = parts[movingPart({ axis, dir, startOption: sideOf(start) })] || card;
      if (el !== card) el.classList.add("a-dg-moving");   // 動いている間だけ前面に（onEnd で外す）
      return el;
    },
    allow: (dir, { start }) => allows(dir, sideOf(start)),
    ...handlers,
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

// ================================================================ キーボード（→ で上の回答・← で下の回答〔U41 の6〕、Space で問題を変える／答えずに進む）
function onKey(e) {
  if (!view || view.key !== "diagnose/q") return;
  const s = store3.session;
  if (!s || s.isDone()) return;
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  const opt = optionOfKey(e.key);   // → ＝上（"left"）、← ＝下（"right"）
  if (practicePending3()) {   // 練習カード：← → だけ
    if (opt) { e.preventDefault(); practiceDone(opt); }
    return;
  }
  if (opt) { e.preventDefault(); answer3(opt, "k"); }
  else if (e.key === " " || e.code === "Space") {
    if (t && (t.tagName === "BUTTON" || t.tagName === "A" || t.tagName === "SUMMARY")) return;   // 焦点のあるボタンはそのまま押させる
    e.preventDefault();
    if (s.current().canSwap) swap3("k"); else skip3("k");
  }
}
