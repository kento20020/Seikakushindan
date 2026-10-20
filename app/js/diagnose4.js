// 24問版（v4）の診断の開始（#diagnose）と質問（#diagnose/q）。決定 U42。仕様：docs/diagnosis-v4.md §5・docs/app-screens.md §4.2・§4.3
//   中身は js/ui/four_store.js（保存・再開）と js/data/questions4.js（設問・順・選択肢）。三択（diagnose.js）は今のまま残す
//   どちらを出すかは main.js が決める（app/js/diagnosis_version.js。#diagnose は ?dv= ＞ 既定 v4、#diagnose/q は今の診断の版）
//
//   開始画面：題『24問で、ふたりのすれ違い方を整理する』・説明『普段の自分への16問と、場面ごとの8問です』・開始時の案内。分数は出さない
//     三択の診断が途中で、それが今の診断のときは、その続きへの入口も出す（途中の三択は三択のまま続く。消さない）
//   質問：1画面に1問。タップ → 保存 → 次へ。スワイプ・問題を変える・練習カード・追加の質問の案内は無い。進み具合は 24問で固定
//     R（普段の自分）：文 ＋ 5段階「まったく当てはまらない」…「とても当てはまる」
//     P（場面）：場面 ＋ 共通の問い ＋ A・B の文（A・B の印つき）＋ 5段階「Aにかなり近い」…「Bにかなり近い」
//     その下に、線で分けた別のボタン「判断できない（経験がない・思い浮かばない）」（点線の枠と「？」の印。色だけに頼らない）
//     見た目の強さ：問い（文・場面）がいちばん目立ち、次に答えのボタン。進み具合・戻る・中断は薄く（ただし文字は 4.5:1 以上）
//   「前の質問に戻る」「中断してあとで続ける」（→ 開始画面。答えは保存されたまま）
//   キーボード：Tab で答えのボタンへ移り、Enter・Space で選ぶ（ふつうのボタン）
//   見た目は app/css/diagnose.css（a-d4- で始まるクラス。開始画面は三択と同じ a-dg- の部品も使う）
import { h, icon, topBar, go, rowLink } from "./ui.js";
import { store4, restore4, start4, answer4, back4, onChange4, progress4, current4 } from "../../js/ui/four_store.js";
import { START4, RATING_CHOICES4, PREF_CHOICES4, UNKNOWN_LABEL4, PAIR_QUESTION4 } from "../../js/data/questions4.js";
import { currentVersion, currentResult, dvFromSearch, midV3 } from "./diagnosis_version.js";

let view = null;          // いま出している画面 { root, key }。片付けで null
let armedAt = 0;          // 描いた直後の取り違えの2度押しを受けない（この時刻までの押し下げは無視）
const ARM_MS = 280;

onChange4(() => { if (view) draw(); });

export function render(root, route) {
  restore4();
  view = { root, key: route.key };
  draw({ first: true });
  return () => { view = null; };
}

function draw({ first = false } = {}) {
  const { root, key } = view;
  if (key === "diagnose") {
    root.replaceChildren(startView());
    return;
  }
  const s = store4.session;
  if (!s) { location.replace("#diagnose"); return; }
  if (s.completed) { location.replace("#result"); return; }
  const screen = questionView(s, { first });
  root.replaceChildren(screen);
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
      h("p", { class: "a-lead a-dg-lead" }, `${START4.lead}。`)),
    h("section", { class: "a-card a-d4-guide", "aria-labelledby": "a-d4-guide-h" },
      h("h2", { class: "a-kicker", id: "a-d4-guide-h" }, "答える前に"),
      h("p", { class: "a-d4-guide-text" }, START4.guide)),
    h("ul", { class: "a-card a-dg-how", "aria-label": "答え方" },
      h("li", null,
        h("span", { class: "a-dg-how-ic", "aria-hidden": "true" }, icon("paper", { size: 22 })),
        h("p", null, h("b", null, "1問ずつ、5段階から選ぶ"),
          h("span", null, "普段の自分についての文は当てはまる程度を、場面の問いは A と B のどちらに近いかを選びます。"))),
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
    right: h("p", { class: "a-dg-count a-d4-count", "aria-label": `${p.total}問中 ${p.answered}問 回答済み` },
      h("span", { "aria-hidden": "true" }, `${p.answered} / ${p.total}`)),
  });
}

function progressBar(p) {
  return h("div", { class: "a-dg-progress a-d4-progress", role: "progressbar", "aria-label": "回答の進み具合", "aria-valuemin": 0, "aria-valuemax": p.total, "aria-valuenow": p.answered },
    h("i", { style: { width: `${Math.round(p.ratio * 100)}%` } }));
}

/** 答えのボタン1つ。前に選んだ答えには「前に選んだ回答」の印（文字とアイコン。色だけに頼らない） */
function choiceButton({ label, value, picked, cls = null, side = null }) {
  return h("button", {
    type: "button", class: ["a-d4-choice", cls, picked && "is-picked"], "data-value": value === null ? "unknown" : String(value),
    "data-side": side, "aria-pressed": picked ? "true" : "false",
    onclick: () => { if (armed()) answer4(value); },
  },
  h("span", { class: "a-d4-choice-label" }, label),
  picked ? h("span", { class: "a-d4-picked" }, icon("check", { size: 14 }), "前に選んだ回答") : null);
}

/** UNKNOWN_LABEL4 を「判断できない」と「（…）」に分ける（つなぐと元の文と同じ） */
function unknownParts() {
  const i = UNKNOWN_LABEL4.indexOf("（");
  if (i < 0) return UNKNOWN_LABEL4;
  return [h("span", { class: "a-nowrap" }, UNKNOWN_LABEL4.slice(0, i)), h("span", { class: "a-d4-unknown-sub" }, UNKNOWN_LABEL4.slice(i))];
}

const pickedValue = (c) => (c.answer ? (c.answer.status === "unknown" ? null : c.answer.value) : undefined);

function questionView(s, { first }) {
  const c = current4(s);
  const p = progress4(s);
  const it = c.item;
  const prev = pickedValue(c);
  const R = it.kind === "R";

  const choices = R
    ? RATING_CHOICES4.map((x) => choiceButton({ label: x.label, value: x.value, picked: prev === x.value }))
    : PREF_CHOICES4.map((x) => choiceButton({ label: x.label, value: x.value, picked: prev === x.value, side: x.value > 0 ? "a" : x.value < 0 ? "b" : "mid" }));

  const head = R
    ? [
      h("p", { class: "a-d4-kicker" }, "普段の自分について"),
      h("p", { class: "a-d4-statement", id: "a-d4-q", tabindex: "-1", "data-focus": "" }, it.text),
    ]
    : [
      h("p", { class: "a-d4-kicker" }, "場面"),
      h("p", { class: "a-d4-scene", id: "a-d4-scene", tabindex: "-1", "data-focus": "" }, it.scene),
      h("p", { class: "a-d4-ask", id: "a-d4-q" }, PAIR_QUESTION4),
      h("div", { class: "a-d4-ab" },
        h("div", { class: "a-d4-opt a-d4-opt-a", id: "a-d4-opt-a" },
          h("span", { class: "a-d4-opt-mark", "aria-hidden": "true" }, "A"),
          h("p", { class: "a-d4-opt-text" }, h("span", { class: "a-sr" }, "A："), it.a)),
        h("div", { class: "a-d4-opt a-d4-opt-b", id: "a-d4-opt-b" },
          h("span", { class: "a-d4-opt-mark", "aria-hidden": "true" }, "B"),
          h("p", { class: "a-d4-opt-text" }, h("span", { class: "a-sr" }, "B："), it.b))),
    ];

  return h("div", { class: "a-d4-q", "data-kind": it.kind, "data-id": it.id },
    qTop(p),
    progressBar(p),
    h("div", { class: ["a-d4-qcard", !first && "a-d4-enter"] },
      head,
      h("div", { class: ["a-d4-choices", R ? "a-d4-choices-r" : "a-d4-choices-p"], role: "group", "aria-labelledby": "a-d4-q",
        "aria-describedby": R ? null : "a-d4-scene a-d4-opt-a a-d4-opt-b" }, choices),
      h("div", { class: "a-d4-unknown-wrap" },
        h("button", {
          type: "button", class: ["a-d4-unknown", prev === null && "is-picked"], "data-value": "unknown", "aria-pressed": prev === null ? "true" : "false",
          onclick: () => { if (armed()) answer4(null); },
        },
        h("span", { class: "a-d4-unknown-mark", "aria-hidden": "true" }, "？"),
        // 「判断できない」と「（経験がない・思い浮かばない）」で折り返す（文は省かない）
        h("span", { class: "a-d4-unknown-label" }, unknownParts()),
        prev === null ? h("span", { class: "a-d4-picked" }, icon("check", { size: 14 }), "前に選んだ回答") : null))),
    h("div", { class: "a-dg-foot a-d4-foot" },
      c.index > 0 ? h("button", { type: "button", class: "a-link a-link-tap a-dg-back", id: "a-dg-back", onclick: () => back4() }, "前の質問に戻る") : null,
      h("a", { class: "a-link a-link-tap a-dg-pause", href: "#diagnose" },
        h("span", { class: "a-nowrap" }, "中断してあとで続ける"), h("span", { class: "a-nowrap" }, "（回答は保存されています）"))));
}

