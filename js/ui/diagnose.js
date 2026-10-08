// 診断タブ：スタート画面と設問画面
import { h, mount, toast } from "./dom.js";
import { store, startSession, resumeSession, discardSession, toStart, answer, swapWording, back,
  runSample, loadProfileSample, loadJSON, SAMPLES, PROFILE_SAMPLES } from "./store.js";
import { LIKERT_CHOICES, duelChoices, ROLE_LABEL, STAGE_LABEL } from "../adaptive.js";
import { DOMAINS } from "../engine.js";

let root = null;

export function renderDiagnose(el) {
  root = el;
  const s = store.session;
  if (store.screen === "question" && s && !s.isDone()) return renderQuestion(el, s);
  return renderStart(el);
}

// ---------------------------------------------------------------- スタート画面
function renderStart(el) {
  const s = store.session;
  const inProgress = s && !s.isDone() && s.progress().answered > 0;
  const fresh = s && !s.isDone() && s.progress().answered === 0;
  const done = s && s.isDone();

  const adaptive = h("input", { type: "checkbox", id: "opt-adaptive", checked: true });
  const wA = h("input", { type: "radio", name: "wording", value: "0", id: "opt-w0", checked: true });
  const wB = h("input", { type: "radio", name: "wording", value: "1", id: "opt-w1" });
  const start = () => startSession({ adaptive: adaptive.checked, startWording: wB.checked ? 1 : 0 });

  const fileInput = h("input", { type: "file", accept: ".json,application/json", id: "file-json", class: "visually-hidden",
    onchange: async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try { loadJSON(JSON.parse(await f.text()), f.name); }
      catch (err) { toast(err.message || "読み込めませんでした"); }
      e.target.value = "";
    } });

  mount(el,
    h("div", { class: "intro" },
      h("h1", { class: "intro-title" }, "喧嘩のとき、あなたはどう動く？"),
      h("p", { class: "lead" },
        "恋人との喧嘩や気まずい場面での動き方を、8つの領域・16の傾向で測ります。",
        "どの領域も「向き合う／距離を取る」のように両側を別々に測るので、「両方強い」「どちらも弱い」も結果に出ます。"),
      h("p", { class: "lead" },
        "質問は72問の「当てはまる度」と8問の「どちらに近いか」。所要時間は10〜15分ほどです。直感で答えてください。")),

    inProgress ? h("div", { class: "resume" },
      h("p", null, `途中まで答えた診断があります（${s.progress().answered}問回答済み）。`),
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: resumeSession }, "続きから答える"),
        h("button", { class: "btn ghost", onclick: () => { if (confirm("途中までの回答を消して、最初からやり直しますか？")) discardSession(); } }, "回答を消す"))) : null,
    fresh ? h("div", { class: "resume" },
      h("p", null, "はじめたばかりの診断があります。"),
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: resumeSession }, "続きから答える"))) : null,
    done && store.result ? h("div", { class: "resume" },
      h("p", null, `前回の診断結果があります（${store.source?.name ?? "あなたの回答"}）。`),
      h("div", { class: "row" }, h("a", { class: "btn", href: "#result" }, "結果を見る"))) : null,

    h("form", { class: "start-form", onsubmit: (e) => { e.preventDefault(); start(); } },
      h("fieldset", { class: "opt" },
        h("legend", null, "聞き方"),
        h("label", { class: "check", for: "opt-adaptive" }, adaptive,
          h("span", null, h("b", null, "「どちらでもない」が多い傾向は、言い換えて追加で聞く"),
            h("small", null, "はっきりしない傾向だけ最大16問、決めきれない領域だけ追加の二択を最大8問足します。オフにすると固定の80問です。")))),
      h("fieldset", { class: "opt" },
        h("legend", null, "質問の表現"),
        h("label", { class: "check", for: "opt-w0" }, wA,
          h("span", null, h("b", null, "表現A：気持ちで答える"), h("small", null, "例：「話し合いを終えるなら、同じことが起きたときの対応まで決めたい。」"))),
        h("label", { class: "check", for: "opt-w1" }, wB,
          h("span", null, h("b", null, "表現B：行動で答える"), h("small", null, "例：「話し合いを終える前に、次に同じことが起きたときの対応を相手と決める。」"))),
        h("p", { class: "note" }, "どちらを選んでも、答えにくい質問は「別の言い方で聞く」でもう一方の表現に切り替えられます。")),
      h("div", { class: "row" }, h("button", { class: "btn primary big", type: "submit" }, inProgress ? "最初から診断する" : "診断をはじめる"))),

    h("section", { class: "samples", "aria-labelledby": "samples-h" },
      h("h2", { id: "samples-h" }, "サンプルで試す"),
      h("p", { class: "note" }, "実際の回答者2名の回答を流し込むと、質問を飛ばして結果まで進みます。"),
      h("div", { class: "row wrap-row" },
        SAMPLES.map((smp, i) => h("button", { class: "btn", "data-sample": i, onclick: () => runSample(i) }, `${smp.name}で診断を実行`))),
      h("p", { class: "note" }, "16の傾向スコアだけを持つ合成プロファイル P1〜P5 は、結果とロジックだけを見られます。"),
      h("div", { class: "row wrap-row" },
        PROFILE_SAMPLES.map((p, i) => h("button", { class: "btn small", "data-profile": i, title: p.name, onclick: () => loadProfileSample(i) }, p.name))),
      h("p", { class: "note" }, "保存した結果JSON・途中保存・回答表（{\"1\":4, \"2\":1, …}）・スコア（{\"scores\":{…}}）も読み込めます。"),
      h("div", { class: "row" }, fileInput, h("label", { class: "btn small", for: "file-json" }, "JSONを読み込む"))),
  );
}

// ---------------------------------------------------------------- 設問画面
function renderQuestion(el, s) {
  const c = s.current();
  const p = s.progress();
  const q = c.item;

  const stagePills = h("ol", { class: "stages", "aria-label": "段階" },
    p.stages.map(st => h("li", { class: ["stage", st.stage === c.stage && "now", st.planned && st.answered === st.total && st.total > 0 && "done"] },
      h("span", { class: "stage-name" }, st.label),
      h("span", { class: "stage-count" },
        !st.planned ? "あとで決定" : st.total === 0 ? "なし" : st.stage === c.stage ? `${c.stageIndex + 1}/${st.total}` : `${st.answered}/${st.total}`))));

  const bar = h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": p.total, "aria-valuenow": p.answered, "aria-label": "回答の進み具合" },
    h("i", { style: { width: `${Math.round(p.ratio * 100)}%` } }));

  const notice = c.stage === 2
    ? h("p", { class: "notice" }, "さきほど「どちらともいえない」だった質問を、別の言い方でもう一度聞いています。")
    : c.stage === 4 ? h("p", { class: "notice" }, "決めきれなかった組み合わせを、別の場面でもう一度比べます。") : null;

  let body, choices;
  if (c.kind === "likert") {
    body = h("p", { class: "q-text", id: "q-text", tabindex: "-1" }, c.text);
    choices = h("div", { class: "likert", role: "group", "aria-labelledby": "q-text" },
      LIKERT_CHOICES.map(ch => h("button", {
        class: ["choice", c.answer === ch.v && "picked"], "data-v": ch.v, "aria-pressed": c.answer === ch.v ? "true" : "false",
        onclick: () => answer(ch.v),
      }, h("span", { class: "key", "aria-hidden": "true" }, ch.v), h("span", { class: "label" }, splitLabel(ch.label)))));
  } else {
    const v = c.variant;
    body = h("div", { class: "duel-head" },
      h("p", { class: "q-text", id: "q-text", tabindex: "-1" }, v.stem),
      h("div", { class: "duel-pair" },
        h("p", { class: "duel-side side-a" }, v.a),
        h("span", { class: "duel-or", "aria-hidden": "true" }, "か"),
        h("p", { class: "duel-side side-b" }, v.b)));
    choices = h("div", { class: "duel-choices", role: "group", "aria-labelledby": "q-text" },
      duelChoices(v).map(ch => h("button", {
        class: ["choice", "duel-choice", `dv${ch.v}`, c.answer === ch.v && "picked"], "data-v": ch.v, "aria-pressed": c.answer === ch.v ? "true" : "false",
        onclick: () => answer(ch.v),
      }, h("span", { class: "key", "aria-hidden": "true" }, ch.v),
        h("span", { class: "label" }, ch.tag ? h("small", null, ch.tag) : null, ch.text))));
  }

  const D = DOMAINS[q.domain];
  const aim = h("details", { class: "aim" },
    h("summary", null, "この設問の狙い"),
    h("dl", null,
      h("dt", null, "設問"), h("dd", null, `${q.id}（${ROLE_LABEL[q.role]}）・${STAGE_LABEL[c.stage]}の段階`),
      h("dt", null, "領域"), h("dd", null, `${q.domain} ${D.name}（${D.a}／${D.b}）`),
      h("dt", null, "測るもの"), h("dd", null, c.kind === "likert" ? `「${q.trait}」の傾向` : `「${q.sideA}」と「${q.sideB}」のどちらを優先するか`),
      c.kind === "likert" ? [h("dt", null, "表現"), h("dd", null, c.wordingIndex === 0 ? "表現A（気持ち）" : "表現B（行動）")] : null,
      c.reason ? [h("dt", null, "追加の理由"), h("dd", null, c.reason)] : null));

  mount(el,
    h("div", { class: "q-screen" },
      h("div", { class: "q-progress" }, stagePills, bar,
        h("p", { class: "q-count" }, h("b", null, `${c.stageLabel} ${c.stageIndex + 1}/${c.stageTotal}`), h("span", null, `全体 ${p.answered}/${p.total}問 回答済み`))),
      h("div", { class: ["q-card", c.kind === "duel" && "is-duel"] }, notice, body, choices),
      h("div", { class: "q-tools" },
        h("button", { class: "btn ghost", onclick: back, disabled: c.index === 0 }, "戻る"),
        h("button", { class: "btn ghost", id: "btn-swap", onclick: swapWording, disabled: !c.canSwap,
          title: c.canSwap ? "同じ内容を別の言い方で表示します" : "この設問には別の言い方がありません" }, "別の言い方で聞く"),
        h("button", { class: "btn ghost", onclick: () => answer(null) }, "答えずに進む")),
      aim,
      h("p", { class: "q-foot" }, h("span", { class: "hint" }, "キーボードの 1〜5 でも答えられます。"),
        h("button", { class: "linkish", onclick: toStart }, "中断して最初の画面へ（回答は保存されています）"))));

  document.getElementById("q-text")?.focus({ preventScroll: true });
  // スタート画面をスクロールしたまま始めたときなど、進み具合が画面外なら上へ戻す
  const top = el.getBoundingClientRect().top;
  if (top < 0) window.scrollTo(0, window.scrollY + top);
}

/** 「まったく｜当てはまらない」のように語の切れ目に <wbr> を入れる（CSS は keep-all） */
function splitLabel(label) {
  const m = /^(まったく|あまり|どちらとも|やや|とても)(.+)$/.exec(label);
  return m ? [m[1], h("wbr"), m[2]] : label;
}

// キーボード 1〜5 で回答
document.addEventListener("keydown", (e) => {
  if (!root || root.hidden || store.screen !== "question" || !store.session || store.session.isDone()) return;
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;   // 押しっぱなしで連続回答しない
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if (/^[1-5]$/.test(e.key)) { e.preventDefault(); answer(+e.key); }
});
