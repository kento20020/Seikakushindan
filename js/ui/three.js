// 三択診断タブ（#three）。5択版とは別の状態（three_store.js）で動く。
// サブ画面：診断（開始・質問）／結果／ロジック／設問。ロジックと設問は three_logic.js。
import { h, mount, num, pct, signed, table, toast, download, copyText } from "./dom.js";
import { ROLE_CLASS, kindLabel, domainLine, uniqueLabel } from "./labels.js";
import { byRole } from "./result.js";
import { PATTERN_BY_ID } from "../data/patterns.js";
import { DOMAINS } from "../engine.js";
import { TH3, LEFT_RATE_HIGH, LEFT_RATE_LOW } from "../engine3.js";
import { MAX_SWAPS, ITEM3, SRC_LABEL, W_EXTRA_CAP, X_EXTRA_CAP } from "../adaptive3.js";
import { store3, onChange3, restore3, setSub, SUBS, start3, resume3, toStart3, discard3, answer3, swap3, skip3, back3,
  runSample3, runProfile3, loadJSON3, sessionJSON, SAMPLES3, PROFILE_SAMPLES3 } from "./three_store.js";
import { renderLogic3, renderQuestions3 } from "./three_logic.js";
import { attachSwipe, isCoarsePointer, prefersReducedMotion } from "./swipe.js";
import { fbBody, fbRendered, fbStartFields, fbStartOptions, fbStartBlocks, fbHidesDone, fbQuestionExtra, fbCard, fbResultTop, fbResultTail } from "./feedback.js";

const HI = TH3.high, LO = TH3.low + 1;
let root = null;
let lastSub = null;
let detachSwipe = null;   // 質問カードのスワイプ。再描画のたびに外して付け直す
let lastAsking = false;   // 直前の描画が質問画面だったか（質問から質問への再描画かどうかの判定用）
let lastEpoch = -1, tabEpoch = 0;   // タブを離れて戻った（hashchange があった）ときは、スクロール位置を引き継がない
let renderSeq = 0;
window.addEventListener("hashchange", () => { tabEpoch++; });

export function renderThree(el) {
  detachSwipe?.(); detachSwipe = null;
  stopDemo();
  root = el;
  restore3();
  const sub = store3.sub;
  el.classList.toggle("view-wide", sub === "logic" || sub === "questions");
  const s = store3.session;
  const asking = sub === "diagnose" && store3.screen === "question" && s && !s.isDone();
  // 質問から質問へ（回答・差し替え・戻る）の再描画では、画面をスクロールさせない。
  //   中身を作り直す間にページが短くなってもスクロール位置が押し戻されないよう、いまの高さを下限にしておく。
  const keep = !!asking && lastAsking && lastEpoch === tabEpoch;
  const y0 = window.scrollY;
  el.style.minHeight = keep ? `${el.offsetHeight}px` : "";
  let body;
  try {
    body = fbBody(sub) ?? (sub === "result" ? resultView()
      : sub === "logic" ? renderLogic3()
      : sub === "questions" ? renderQuestions3()
      : asking ? questionView(s) : startView());
  } catch (err) {
    console.error(err);
    body = h("p", { class: "error" }, `表示中にエラーが起きました：${err.message}`);
  }
  // 質問から質問へは、質問画面（.t3-q）だけを1回の replaceWith で差し替える。サブ画面の切り替えと枠は残すので、
  //   中身が空になる瞬間がなく、ページの高さが縮んでスクロール位置が押し戻されることもない。それ以外は節ごと作り直す
  const prevQ = keep ? el.querySelector(":scope > .t3-body > .t3-q") : null;
  if (prevQ && body instanceof Element && body.classList.contains("t3-q")) prevQ.replaceWith(body);
  else mount(el,
    h("nav", { class: "t3-subnav", "aria-label": "三択診断の画面" },
      h("span", { class: "t3-mode-badge", title: "左／右／問題を変える の3つだけで答える版（5択版とは別に動きます）" }, "三択版"),
      SUBS.map(([k, label]) => h("button", { type: "button", "data-sub": k, "aria-current": k === sub ? "page" : null, onclick: () => setSub(k) }, label))),
    h("div", { class: "t3-body" }, body));

  const changed = lastSub !== null && lastSub !== sub;
  lastSub = sub; lastAsking = !!asking; lastEpoch = tabEpoch;
  fbRendered(asking ? s.current() : null);   // テスト協力モード：回答時間の時計（質問画面が見えている間だけ進む）
  const seq = ++renderSeq;
  if (asking) {
    const card = el.querySelector(".t3-qcard");
    bindSwipe(card, s.current());
    document.getElementById("t3-q")?.focus({ preventScroll: true });
    if (keep) {
      if (Math.abs(window.scrollY - y0) > 1) window.scrollTo(0, y0);   // 同期で戻す（短くなったページに押し戻された分）
      revealCard(card);
      settleScroll(el, seq);                                           // 次のフレームでも戻してから、高さの下限を外す
    } else {
      // 質問画面を開いたとき（開始画面から・別のタブから）だけ、節の先頭が画面の上に出ていれば先頭まで戻す
      const top = el.getBoundingClientRect().top;
      if (top < 0) window.scrollTo(0, window.scrollY + top);
    }
    startEnter(card);
    planDemo(card, s);
  } else if (changed) {
    window.scrollTo(0, 0);
  }
}

// 次のカードが画面から一部はみ出していたら、見える最小限だけ動かす（block: "nearest"。"start" にはしない）。
//   画面より高いカードは動かさない。滑り込みのアニメーション（transform）を付ける前に測るので、位置がずれない
function revealCard(card) {
  if (!card || card.offsetHeight > window.innerHeight) return;
  const r = card.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= window.innerHeight) return;
  card.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function settleScroll(el, seq) {
  const y = window.scrollY;
  requestAnimationFrame(() => {
    if (seq !== renderSeq) return;     // 続けて再描画された（新しい描画が自分の面倒を見る）
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
    el.style.minHeight = "";
  });
}

// 飛ばした向きの反対側から滑り込ませる（スクロール位置を決めたあとにクラスを付ける）
function startEnter(card) {
  const dir = card?.dataset.enter;
  if (!dir) return;
  delete card.dataset.enter;
  card.classList.add(`t3-enter-${dir}`);
  holdClip(); releaseClip(ENTER_MS + 100);   // 滑り込む間も横にはみ出さないように
}

onChange3(() => { if (root && !root.hidden) renderThree(root); });

// ---------------------------------------------------------------- 開始画面
function startView() {
  const s = store3.session;
  const p = s && !s.isDone() ? s.progress() : null;
  const inProgress = p && p.answered > 0;
  const fresh = p && p.answered === 0;
  const done = s && s.isDone() && store3.result;

  const adaptive = h("input", { type: "checkbox", id: "t3-adaptive", checked: true });
  const fileInput = h("input", { type: "file", accept: ".json,application/json", id: "t3-file", class: "visually-hidden",
    onchange: async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try { loadJSON3(JSON.parse(await f.text()), f.name); }
      catch (err) { toast(err.message || "読み込めませんでした"); }
      e.target.value = "";
    } });
  const saveSession = () => {
    const data = sessionJSON(); if (!data) return;
    download(`seikaku16-three-session-${stamp()}.json`, JSON.stringify(data, null, 1));
    toast("回答をJSONで保存しました");
  };

  return [
    h("div", { class: "intro" },
      h("h1", { class: "intro-title" }, h("span", { class: "t3-phrase" }, "左か、右か。"), h("span", { class: "t3-phrase" }, "迷ったら問題を変える")),
      h("p", { class: "lead" },
        "5択版の「どちらともいえない」をなくした版です。どの質問も、2つの文のうち自分に近い方を選ぶだけ。",
        "どちらとも決めにくいときは「問題を変える」で同じ枠の別の場面に差し替えます（1問につき2回まで）。"),
      h("p", { class: "lead" },
        "前半の32問は同じ場面での2つの動き方（W）、後半の32問は別々の場面の行動どうし（X）を比べます。",
        "決めきれない領域・傾向だけ追加で聞くので、全部で64〜96問、8〜12分ほどです。")),

    inProgress ? h("div", { class: "resume" },
      h("p", null, `途中まで答えた三択診断があります（${p.answered}問回答済み・いま「${p.stageLabel}」）。`),
      h("div", { class: "row wrap-row" },
        h("button", { class: "btn primary", id: "t3-resume", onclick: resume3 }, "続きから答える"),
        h("button", { class: "btn ghost", onclick: () => { if (confirm("途中までの回答を消して、最初からやり直しますか？")) discard3(); } }, "回答を消す"))) : null,
    fresh ? h("div", { class: "resume" },
      h("p", null, "はじめたばかりの三択診断があります。"),
      h("div", { class: "row" }, h("button", { class: "btn primary", id: "t3-resume", onclick: resume3 }, "続きから答える"))) : null,
    fbStartBlocks(),
    done && !fbHidesDone() ? h("div", { class: "resume" },
      h("p", null, `前回の結果があります（${store3.source?.name ?? "あなたの回答"}）。`),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => setSub("result") }, "結果を見る"))) : null,

    h("form", { class: "start-form", onsubmit: (e) => {
      e.preventDefault();
      const fb = fbStartOptions(e.currentTarget);   // テスト協力モードの同意・コード（モードがオフなら null、入力が足りなければ false）
      if (fb !== false) start3({ adaptive: adaptive.checked, fb });
    } },
      h("fieldset", { class: "opt" },
        h("legend", null, "聞き方"),
        h("label", { class: "check", for: "t3-adaptive" }, adaptive,
          h("span", null, h("b", null, "決めきれないところだけ追加で聞く（可変モード）"),
            h("small", null, `左右が拮抗した領域に最大${W_EXTRA_CAP}問、強さが曖昧な傾向に最大${X_EXTRA_CAP}問を足します（合計96問まで）。オフにすると固定の64問です。`)))),
      fbStartFields(),
      h("div", { class: "row" }, h("button", { class: "btn primary big", type: "submit", id: "t3-start" }, inProgress ? "最初から診断する" : "三択で診断をはじめる"))),

    h("section", { class: "samples", "aria-labelledby": "t3-samples-h" },
      h("h2", { id: "t3-samples-h" }, "サンプルで試す"),
      h("p", { class: "note" }, "5択版の実回答2名を三択の答えに変換して流し、結果まで進みます（同じ番号の設問どうしで高い方を選ぶ、など）。実際に三択で答えた結果ではないので、画面には「5択回答からの推定」と出します。"),
      h("div", { class: "row wrap-row" },
        SAMPLES3.map((smp, i) => h("button", { class: "btn", "data-t3-sample": i, onclick: () => runSample3(i) }, smp.label))),
      h("p", { class: "note" }, "16スコアだけの合成プロファイル P1〜P5 は、スコアの高い方を選ぶ答えに変換します（左右の差が10未満の領域は拮抗させる）。"),
      h("div", { class: "row wrap-row" },
        PROFILE_SAMPLES3.map((p, i) => h("button", { class: "btn small", "data-t3-profile": i, title: p.label, onclick: () => runProfile3(i) }, p.label))),
      h("p", { class: "note" }, "三択版の途中保存・結果JSONのほか、5択版の回答表（{\"1\":4, \"2\":1, …}）やスコア（{\"scores\":{…}}）も読み込めます（読み込んだ5択回答は三択に変換します）。"),
      h("div", { class: "row wrap-row" }, fileInput,
        h("label", { class: "btn small", for: "t3-file" }, "JSONを読み込む"),
        h("button", { class: "btn small", id: "t3-save-session", onclick: saveSession, disabled: !s }, "回答をJSONで保存"))),

    h("section", { class: "samples t3-diff", "aria-labelledby": "t3-diff-h" },
      h("h2", { id: "t3-diff-h" }, "5択版との違い"),
      h("ul", { class: "t3-list" },
        h("li", null, "真ん中の選択肢がありません。答えにくいときは「問題を変える」（同じ枠の別の場面）、それも使い切ったら「答えずに進む」。"),
        h("li", null, "W（同じ場面の左右）で領域内の優勢を、X（別の領域の行動文どうし）で傾向ごとの強さ（0〜100の相対値）を測ります。"),
        h("li", null, "X は自分の中での順位なので、「全体的に低い／高い」（S16・S17）は判定しません。S18 は「左右が拮抗した領域が5以上」に読み替えます。"),
        h("li", null, "選択のルール（主軸1＋補強・矛盾、2〜4本）は5択版と同じです。")),
      h("p", { class: "note" }, "判定ロジックの詳細は「ロジック」、設問の一覧は「設問」に。仕様書は docs/three-choice-logic.md です。")),
  ];
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

// ---------------------------------------------------------------- 質問画面
function questionView(s) {
  const c = s.current();
  const p = s.progress();
  const q = c.question;
  const item = ITEM3[q.id];

  const stagePills = h("ol", { class: "stages", "aria-label": "段階" },
    p.stages.map(st => h("li", { class: ["stage", st.stageNo === c.stageNo && "now", st.planned && st.answered === st.total && st.total > 0 && "done"] },
      h("span", { class: "stage-name" }, st.label),
      h("span", { class: "stage-count" },
        !st.planned ? "あとで決定" : st.total === 0 ? "なし" : st.stageNo === c.stageNo ? `${c.stageIndex + 1}/${st.total}` : `${st.answered}/${st.total}`))));
  const bar = h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": p.total, "aria-valuenow": p.answered, "aria-label": "回答の進み具合" },
    h("i", { style: { width: `${Math.round(p.ratio * 100)}%` } }));

  const notice = c.stage === "W追加" ? h("p", { class: "notice" }, "左右が拮抗した領域を、別の場面でもう一度聞いています。")
    : c.stage === "X追加" ? h("p", { class: "notice" }, "強さがはっきりしない傾向を、別の組み合わせでもう一度比べています。")
    : c.swapsUsed > 0 ? h("p", { class: "notice" }, `差し替えた設問です（この枠で${c.swapsUsed}回目）。`) : null;

  const card = (side) => {
    const opt = q[side];
    return h("button", { type: "button", class: ["t3-card", `t3-${side}`, c.answer === side && "picked"], "data-side": side,
      "aria-pressed": c.answer === side ? "true" : "false", onclick: () => answer3(side, "t") },
      h("span", { class: "t3-key", "aria-hidden": "true" }, side === "left" ? "← 左" : "右 →"),
      h("span", { class: "t3-text" }, opt.text));
  };

  const D = c.domain ? DOMAINS[c.domain] : null;
  const aim = h("details", { class: "aim" },
    h("summary", null, "この設問の狙い"),
    h("dl", null,
      h("dt", null, "枠"), h("dd", null, `${c.slot}（${c.stage}）`),
      h("dt", null, "設問"), h("dd", null, q.kind === "W" ? `${q.id}（${SRC_LABEL[item.src]}）` : `${q.id}（ラウンド${item.round}）`),
      q.kind === "W"
        ? [h("dt", null, "測るもの"), h("dd", null, `${c.domain} ${D.name}：${D.a}／${D.b} のどちらを取りやすいか（左＝${q.left.trait}）`)]
        : [h("dt", null, "測るもの"), h("dd", null, `「${q.left.trait}」と「${q.right.trait}」のどちらが自分の中で強いか`)],
      c.shown.length > 1 ? [h("dt", null, "差し替え"), h("dd", null, c.shown.join(" → "))] : null,
      c.reason ? [h("dt", null, "追加の理由"), h("dd", null, c.reason)] : null));

  const enter = enterFrom && !prefersReducedMotion() ? enterFrom : null;   // スワイプの直後なら、反対側から滑り込ませる
  enterFrom = null;
  const coarse = isCoarsePointer();

  return h("div", { class: "q-screen t3-q" },
    h("h1", { class: "visually-hidden" }, "三択診断の質問"),
    h("div", { class: "q-progress" }, stagePills, bar,
      h("p", { class: "q-count" }, h("b", null, `${c.stage} ${c.stageIndex + 1}/${c.stageTotal}`),
        h("span", null, `全体 ${p.answered}/${p.total}問 回答済み${s.config.adaptive && (s.plan.s3 === null || s.plan.s4 === null) ? `（最大${p.max}問）` : ""}`))),
    h("div", { class: ["q-card", "t3-qcard", `t3-kind-${c.kind}`], "data-enter": enter },
      h("div", { class: "t3-grip", "aria-hidden": "true" }, h("i", { class: "t3-grip-bar" }), h("span", null, "スワイプで回答")),
      notice,
      h("p", { class: "t3-kicker" }, c.kind === "W" ? "この場面で" : "別々の場面の行動を比べて"),
      h("p", { class: "q-text t3-stem", id: "t3-q", tabindex: "-1" }, q.kind === "W" ? q.stem : q.prompt),
      q.kind === "W" ? h("p", { class: "t3-ask" }, q.prompt) : null,
      h("div", { class: "t3-pair", role: "group", "aria-labelledby": "t3-q" }, card("left"), card("right")),
      h("div", { class: "t3-swipe-badge", "aria-hidden": "true" }),
      // 四方の手がかり（カードの縁に薄く出す。ドラッグした向きのものだけ濃くなる）
      cue("l", "← 左", true), cue("r", "右 →", true), cue("u", c.canSwap ? "↑ 変える" : "↑ 進む")),
    fbQuestionExtra(c),   // テスト協力モードの「一言」（カードの外。スワイプの対象にならない）
    h("p", { class: "hint t3-hint", id: "t3-swipe-hint" }, coarse
      ? `← 左へスワイプ ／ 右へスワイプ → ／ ↑ ${c.canSwap ? "問題を変える" : "答えずに進む"}`
      : "カードをドラッグ／スワイプでも回答できます"),
    tipSeen() ? null : h("div", { class: "t3-tip", id: "t3-swipe-tip", role: "note" },
      h("span", null, "カードを左右にスワイプ（マウスならドラッグ）して答えられます。上へ＝", c.canSwap ? "問題を変える" : "答えずに進む", "、下へ＝戻る。"),
      h("button", { type: "button", class: "t3-tip-close", id: "t3-swipe-tip-close", onclick: dismissTip }, "閉じる")),
    h("div", { class: "q-tools t3-tools" },
      h("button", { type: "button", class: "btn ghost", id: "t3-back", onclick: back3, disabled: c.index === 0 }, "戻る"),
      h("button", { type: "button", class: "btn", id: "t3-swap", onclick: swap3, disabled: !c.canSwap,
        title: c.canSwap ? "同じ枠の別の設問に差し替えます" : "この枠ではもう差し替えられません" },
        "問題を変える", h("small", { class: "t3-remain" }, `残り${c.swapsLeft}回`)),
      c.canSkip ? h("button", { type: "button", class: "btn ghost", id: "t3-skip", onclick: skip3 }, "答えずに進む") : null),
    c.canSkip ? h("p", { class: "note t3-skipnote" }, c.swapsUsed >= MAX_SWAPS
      ? "この枠の差し替えは使い切りました。どうしても選べなければ「答えずに進む」（集計には入れません）。"
      : "この枠には差し替えられる設問が残っていません。どうしても選べなければ「答えずに進む」（集計には入れません）。") : null,
    aim,
    h("p", { class: "q-foot" }, coarse ? null : h("span", { class: "hint" }, "キーボード：← 左 ／ → 右 ／ Space 問題を変える（使い切ったら答えずに進む）"),
      h("button", { type: "button", class: "linkish", onclick: toStart3 }, "中断して最初の画面へ（回答は保存されています）")));
}

// カードの縁の手がかり（左右は縦書きで細く、上は上辺にまたがる小さなラベル）
function cue(pos, text, chevron = false) {
  return h("span", { class: ["t3-cue", `t3-cue-${pos}`], "aria-hidden": "true" }, chevron ? h("i", { class: "t3-chev" }) : null, h("span", { class: "t3-cue-txt" }, text));
}

// キーボード：← → で回答、Space で問題を変える（使い切ったら答えずに進む）
document.addEventListener("keydown", (e) => {
  if (!root || root.hidden || store3.sub !== "diagnose" || store3.screen !== "question") return;
  const s = store3.session;
  if (!s || s.isDone()) return;
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if (e.key === "ArrowLeft") { e.preventDefault(); answer3("left", "k"); }
  else if (e.key === "ArrowRight") { e.preventDefault(); answer3("right", "k"); }
  else if (e.key === " " || e.code === "Space") {
    if (t && (t.tagName === "BUTTON" || t.tagName === "A" || t.tagName === "SUMMARY")) return;   // フォーカス中のボタンはそのまま押させる
    e.preventDefault();
    const c = s.current();
    if (c.canSwap) swap3("k"); else skip3("k");
  }
});

// ---------------------------------------------------------------- スワイプ（質問カード全体。ボタン・キーボードと同じ操作を呼ぶ）
//   左＝左を選ぶ／右＝右を選ぶ／上＝問題を変える（使い切ったら答えずに進む）／下＝戻る（最初の設問では無効）
const ENTER_MS = 220;                                 // css の t3-in-* と合わせる
const ENTER_FROM = { left: "right", right: "left", up: "bottom", down: "top" };   // 飛ばした向きの反対側から次のカードが入る
const SWIPE_TIP_KEY = "seikaku16:three:swipe-tip";    // three_store.js の保存キー（seikaku16:three:v1）と同じ接頭辞
const SWIPE_IGNORE = "a, input, select, textarea, summary, label, button:not(.t3-card), [data-no-swipe]";   // 選択肢のカードはボタンだが、カードの面そのものなので始点にしてよい（タップはそのままクリック）
let enterFrom = null;     // 次に描く質問カードを滑り込ませる側（スワイプで確定した直後だけ入る）
let tipDone = false;      // localStorage が使えなくても、この読み込みの間は二度出さない
let clipTimer = 0;

// 飛ばす／滑り込む間、カードが画面の横にはみ出してページが横に広がらないようにする（css: html.t3-swiping）
function holdClip() { clearTimeout(clipTimer); document.documentElement.classList.add("t3-swiping"); }
function releaseClip(ms = 0) { clearTimeout(clipTimer); clipTimer = setTimeout(() => document.documentElement.classList.remove("t3-swiping"), ms); }

function tipSeen() {
  if (tipDone) return true;
  try { return localStorage.getItem(SWIPE_TIP_KEY) === "1"; } catch { return false; }
}
function dismissTip() {
  tipDone = true;
  try { localStorage.setItem(SWIPE_TIP_KEY, "1"); } catch { /* 保存できなくても、この読み込みの間は出さない */ }
  const tip = document.getElementById("t3-swipe-tip");
  if (!tip) return;
  if (root) root.style.minHeight = `${root.offsetHeight}px`;   // 消した分だけページが短くなって、スクロール位置が押し戻されないように（次の再描画で外れる）
  tip.remove();
}

// ---------------------------------------------------------------- スワイプできることを見せる（最初の設問で一度だけ、カードが右・左へ軽く動く）
//   最初の設問を開いて何も触らないまま 600ms たつと、右へ 24px →戻る→左へ 24px →戻る（あわせて 1.2 秒）。
//   触った（タップ・ドラッグ・キー）／一度見せた／ヒントを閉じたことがあれば出さない。動きを減らす設定のときも出さない。
const DEMO_KEY = "seikaku16:three:swipe-demo";        // SWIPE_TIP_KEY の兄弟。「見せた、または触った」
const DEMO_DELAY = 600, DEMO_MS = 1200, DEMO_PX = 24;
let demoDone = false;     // localStorage が使えなくても、この読み込みの間は二度見せない
let demoTimer = 0;
let demoStop = null;      // 動いている最中のデモを止める関数

function demoSeen() {
  if (demoDone) return true;
  try { return localStorage.getItem(DEMO_KEY) === "1"; } catch { return false; }
}
function markDemo() {
  demoDone = true;
  try { localStorage.setItem(DEMO_KEY, "1"); } catch { /* 保存できなくても、この読み込みの間は出さない */ }
}
function stopDemo() {
  clearTimeout(demoTimer); demoTimer = 0;
  const stop = demoStop; demoStop = null;
  stop?.();
}
// 触られたら、待っているデモは取りやめ、動いているデモはその場で止める（以後は出さない）
function touched(e) {
  if (!demoTimer && !demoStop) return;
  if (e.type === "pointerdown" && !(root && e.target instanceof Node && root.contains(e.target))) return;
  markDemo(); stopDemo();
}
document.addEventListener("pointerdown", touched, true);
document.addEventListener("keydown", touched, true);

function planDemo(card, s) {
  stopDemo();
  const p = s.progress();
  if (!card || s.current().index !== 0 || p.answered > 0 || tipSeen() || demoSeen() || prefersReducedMotion() || typeof card.animate !== "function") return;
  demoTimer = setTimeout(() => {
    demoTimer = 0;
    if (!card.isConnected || document.hidden || card.getClientRects().length === 0) return;   // 別のタブにいる・隠れているときは見せない（印も付けない）
    const r = card.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return;   // 見えていないときは見せない（印も付けない）
    markDemo();
    runDemo(card);
  }, DEMO_DELAY);
}

function runDemo(card) {
  const badge = card.querySelector(".t3-swipe-badge");
  const half = DEMO_MS / 2;
  const anims = [], timers = [];
  const phase = (dir, text) => {
    card.dataset.demo = dir;
    badge.textContent = text;
    anims.push(badge.animate([{ opacity: 0 }, { opacity: 1, offset: .35 }, { opacity: 1, offset: .65 }, { opacity: 0 }], { duration: half, easing: "ease-in-out" }));
  };
  const ease = "ease-in-out";
  anims.push(card.animate([
    { transform: "translateX(0)", easing: ease },
    { transform: `translateX(${DEMO_PX}px) rotate(1.5deg)`, easing: ease, offset: .25 },
    { transform: "translateX(0)", easing: ease, offset: .5 },
    { transform: `translateX(${-DEMO_PX}px) rotate(-1.5deg)`, easing: ease, offset: .75 },
    { transform: "translateX(0)" },
  ], { duration: DEMO_MS, easing: "linear" }));
  holdClip();
  phase("right", "右");
  timers.push(setTimeout(() => phase("left", "左"), half), setTimeout(() => stopDemo(), DEMO_MS));
  demoStop = () => {
    timers.forEach(clearTimeout);
    anims.forEach(a => { try { a.cancel(); } catch { /* 無視 */ } });
    delete card.dataset.demo;
    badge.textContent = "";
    releaseClip(0);
  };
}

function bindSwipe(card, c) {
  if (!card) return;
  const badge = card.querySelector(".t3-swipe-badge");
  const sides = [...card.querySelectorAll(".t3-card")];
  const label = { left: "左", right: "右", up: c.canSwap ? "問題を変える" : "答えずに進む", down: "戻る" };
  // 確定の直前に「次のカードをどちらから入れるか」を渡す。何も再描画されなくても残らないように必ず戻す
  const go = (dir, fn) => () => { enterFrom = ENTER_FROM[dir]; try { fn(); } finally { enterFrom = null; } };
  detachSwipe = attachSwipe(card, {
    ignore: SWIPE_IGNORE,
    onLeft: go("left", () => answer3("left", "s")),
    onRight: go("right", () => answer3("right", "s")),
    onUp: go("up", c.canSwap ? () => swap3("s") : () => skip3("s")),
    onDown: c.index > 0 ? go("down", () => back3("s")) : undefined,
    onStart: () => { dismissTip(); holdClip(); card.classList.add("t3-dragging"); },
    onEnd: () => releaseClip(0),
    onProgress: ({ dir, progress, ready, dragging }) => {
      card.classList.toggle("t3-dragging", dragging);
      card.classList.toggle("t3-ready", ready);
      if (dir) { card.dataset.swipe = dir; badge.textContent = label[dir]; } else delete card.dataset.swipe;
      card.style.setProperty("--t3-p", progress.toFixed(3));
      for (const b of sides) b.classList.toggle("t3-hot", dir === b.dataset.side && progress >= 0.2);
    },
  });
}

// ---------------------------------------------------------------- 結果
function resultView() {
  const r = store3.result;
  if (!r) return emptyResult();
  return [
    resHeader(r),
    fbResultTop(r),
    h("section", { class: "block", "aria-labelledby": "t3-res-patterns" },
      h("h2", { id: "t3-res-patterns" }, "あなたを表す解釈"),
      h("p", { class: "note" }, "左右（W）と強さ（X）から条件を満たしたパターンを集め、5択版と同じルールで重なりを避けながら2〜4本を選んでいます。"),
      h("div", { class: "pcards" }, byRole(r.select.chosen).map(hit => patternCard(hit, r))),
      r.select.chosen.length === 0 ? h("p", { class: "empty" }, "条件を満たすパターンがありませんでした。") : null),
    fbResultTail(r),   // テスト協力モード：足りない特徴（自由記述）と「振り返りへ」
    r.source?.expected5 ? compareBlock(r) : null,
    h("section", { class: "block", "aria-labelledby": "t3-res-domains" },
      h("h2", { id: "t3-res-domains" }, "8領域の左右と16傾向の強さ"),
      h("p", { class: "legend" },
        h("span", { class: "lg lg-a" }, "A側"), h("span", { class: "lg lg-b" }, "B側"),
        h("span", { class: "lg" }, "上段：W で選んだ数（優勢＝差2以上・取り分60%以上）"),
        h("span", { class: "lg lg-tick" }, `下段：X の強さ level（目盛り ${LO}／${HI}）`)),
      h("div", { class: "domains" }, Object.keys(DOMAINS).map(d => domainRow3(+d, r)))),
    h("section", { class: "block", "aria-labelledby": "t3-res-quality" },
      h("h2", { id: "t3-res-quality" }, "回答の様子"),
      qualityBlock(r)),
    h("section", { class: "block", "aria-labelledby": "t3-res-export" },
      h("h2", { id: "t3-res-export" }, "結果を持ち出す"),
      exportBlock(r)),
  ];
}

function emptyResult() {
  return h("div", { class: "empty-state" },
    h("h1", null, "まだ三択版の結果がありません"),
    h("p", null, "三択で答えると、ここに結果が出ます。5択版のサンプル回答を三択に変換して結果だけ見ることもできます。"),
    h("div", { class: "row wrap-row" },
      h("button", { class: "btn primary", onclick: () => setSub("diagnose") }, "三択で診断する"),
      SAMPLES3.map((s, i) => h("button", { class: "btn", onclick: () => runSample3(i) }, s.label))),
    h("div", { class: "row wrap-row" },
      PROFILE_SAMPLES3.map((p, i) => h("button", { class: "btn small", onclick: () => runProfile3(i) }, p.label))));
}

function resHeader(r) {
  const src = r.source || {};
  const bits = [r.config?.adaptive ? "可変モード" : "固定64問", `${r.records.length}問に回答`];
  if (r.config?.adaptive) bits.push(`W追加 ${r.stages.wExtra.length}問・X追加 ${r.stages.xExtra.length}問`);
  bits.push(`問題を変えた ${r.quality.swapCount}回・答えずに進んだ ${r.quality.skipCount}問`);
  return h("div", { class: "res-head" },
    h("h1", null, "三択版の診断結果"),
    h("p", { class: "res-source" }, h("b", null, src.name || "あなたの回答"), h("span", null, bits.join("／"))),
    src.expected5 ? (() => {
      const c = compareSummary(r);
      return h("p", { class: "t3-cmp-mini" },
        `5択版の選択と共通 ${c.common.length}本（5択版 ${c.exp.length}本中）・主軸は${c.main5 === c.main3 ? "一致" : "不一致"}。`,
        h("button", { type: "button", class: "linkish", id: "t3-goto-compare", onclick: () => document.getElementById("t3-compare")?.scrollIntoView({ block: "start" }) }, "比較を見る"));
    })() : null,
    src.estimated ? h("p", { class: "t3-estimate" }, h("b", null, src.from === "scores" ? "スコアからの推定" : "5択回答からの推定"),
      src.from === "scores"
        ? "16の傾向スコアから、三択の答えを機械的に作って流した結果です（W は左右の差が10以上なら高い側、それ以外は交互。X は高い方）。"
        : "5択版の回答を三択の答えに変換して流した結果です（W は同じ番号の設問どうしで高い方、同点は対決の向き。X は対応する行動文の回答で高い方）。実際に三択で答えた結果ではありません。") : null);
}

// ---------------------------------------------------------------- パターンカード（5択版の結果カードと同じ形）
function patternCard(hit, r) {
  const m = hit.meta;
  const p = PATTERN_BY_ID[m.id];
  const t = p?.text;
  const step = r.select.trace.find(s => s.chosen === m.id);
  const cand = step?.candidates.find(c => c.id === m.id);
  const reasons = cand?.reasons?.length ? `（${cand.reasons.join("、")}）` : "";
  const why = `重要度 ${num(m.importance)} × 充足度 ${hit.sat.toFixed(2)}（余裕 ${signed(hit.margin)}・尺度 ${num(m.scale)}）＝ スコア ${hit.score.toFixed(2)}。` +
    (step ? `選択ステップ${step.k}で採用、有効スコア ${step.chosenEff.toFixed(2)}${reasons}。` : "") +
    ` 条件：${hit.details.map(d => `${d.label} ${signed(d.margin)}`).join("、")}。`;
  return fbCard(h("article", { class: ["pcard", `role-${ROLE_CLASS[hit.role] || "support"}`], "data-id": m.id, "data-role": hit.role },
    h("div", { class: "pcard-top" },
      h("span", { class: "role-badge" }, hit.role),
      h("span", { class: "pkind" }, kindLabel(m)),
      h("span", { class: "pid" }, m.id)),
    h("h3", { class: "headline" }, p?.headline ?? m.headline),
    h("p", { class: "pdomains" }, domainLine(m), t?.weak ? "（弱い版：明確に優勢の本文を、重要度を下げて流用）" : ""),
    t ? [
      h("p", { class: "one" }, t.one),
      h("p", { class: "detail" }, t.detail),
      h("ul", { class: "scenes", "aria-label": "よくある場面" }, t.scenes.map(s => h("li", null, s))),
      t.unique ? h("div", { class: "aside unique" }, h("h4", null, uniqueLabel(m)), h("p", null, t.unique)) : null,
      h("div", { class: "aside caveat" }, h("h4", null, "誤解しやすい点"), h("p", null, t.caveat)),
    ] : h("p", { class: "empty" }, "本文がありません。"),
    h("p", { class: "why" }, h("b", null, "なぜ選ばれたか"), why)), hit);   // テスト協力モードなら評価欄を足す（それ以外はそのまま）
}

// ---------------------------------------------------------------- 5択版との比較
function compareSummary(r) {
  const exp = r.source.expected5;
  const got = byRole(r.select.chosen).map(x => [x.meta.id, x.role]);
  const expIds = new Set(exp.map(x => x[0])), gotIds = new Set(got.map(x => x[0]));
  const common = got.filter(([id]) => expIds.has(id)).map(([id]) => id);
  const main5 = exp.find(x => x[1] === "主軸")?.[0], main3 = got.find(x => x[1] === "主軸")?.[0];
  return { exp, got, expIds, gotIds, common, main5, main3, all: common.length === exp.length && common.length === got.length };
}

function compareBlock(r) {
  const { exp, got, expIds, gotIds, common, main5, main3, all } = compareSummary(r);
  const notJudged = exp.filter(([id]) => id === "S16" || id === "S17").map(([id]) => id);
  const col = (title, list, other, onlyLabel, cls) => h("div", { class: ["t3-cmp-col", cls] },
    h("h3", null, title, h("small", null, `　${list.length}本`)),
    h("ol", { class: "t3-cmp-list" }, list.map(([id, role]) => h("li", { class: other.has(id) ? "same" : "diff", "data-id": id },
      h("span", { class: "t3-cmp-id" }, h("code", null, id), h("span", { class: "mini-badge" }, role),
        h("span", { class: ["flag", other.has(id) ? "flag-ok" : "flag-warn"] }, other.has(id) ? "一致" : onlyLabel)),
      h("span", { class: "t3-cmp-head" }, PATTERN_BY_ID[id]?.headline ?? "")))));
  return h("section", { class: "block t3-compare", "aria-labelledby": "t3-cmp-h", id: "t3-compare" },
    h("h2", { id: "t3-cmp-h" }, "5択版との比較"),
    h("p", { class: "note" }, "同じ回答者の5択版の選択（参照実装 tests/expected_v2.json）と、三択版の選択を並べています。"),
    h("p", { class: ["refcheck", all ? "ok" : "t3-partial"], id: "t3-cmp-summary" },
      `共通 ${common.length}本${common.length ? `（${common.join("・")}）` : ""}／5択版 ${exp.length}本・三択版 ${got.length}本／主軸は${main5 === main3 ? `一致（${main3}）` : `不一致（5択 ${main5 ?? "なし"}・三択 ${main3 ?? "なし"}）`}`),
    h("div", { class: "t3-cmp" },
      col("5択版", exp, gotIds, "5択版のみ", "cmp5"),
      col("三択版", got, expIds, "三択版のみ", "cmp3")),
    notJudged.length ? h("p", { class: "note" }, `${notJudged.join("・")}（全体的に低い／高い）は三択版では判定しないため、三択版には出ません。`) : null);
}

// ---------------------------------------------------------------- 領域ごとの左右と強さ
function bar3(side, v) {
  return h("div", { class: ["sbar", `sbar-${side}`] },
    h("i", { class: "fill", style: { width: `${Math.max(0, Math.min(100, v))}%` } }),
    h("b", { class: "tick", style: { [side === "a" ? "right" : "left"]: `${LO}%` }, "aria-hidden": "true" }),
    h("b", { class: "tick", style: { [side === "a" ? "right" : "left"]: `${HI}%` }, "aria-hidden": "true" }));
}

export function wSummary(st, D) {
  if (!st.n) return "左右：未回答";
  const share = Math.round(Math.max(st.a, st.b) / st.n * 100);
  return st.lead ? `優勢：${st.lead}（${st.a}:${st.b}・取り分${share}%）` : `左右が拮抗（${st.a}:${st.b}）`;
}

function domainRow3(d, r) {
  const D = DOMAINS[d], st = r.states[d];
  const lead = st.lead === D.a ? "a" : st.lead === D.b ? "b" : null;
  const segs = st.n ? [...Array(st.a).fill("wa"), ...Array(st.b).fill("wb")] : ["wn"];
  const ma = r.m[D.a], mb = r.m[D.b];
  return h("div", { class: ["drow", "t3-drow", lead && `lead-${lead}`], "data-domain": d },
    h("div", { class: "drow-head" },
      h("h3", null, h("span", { class: "dnum" }, d), D.name),
      h("span", { class: "t3-tags" },
        st.check ? h("span", { class: "flag flag-warn", title: "左右で優勢な側の強さが、対の傾向より低い（W と X が食い違う）" }, "要確認") : null,
        h("span", { class: "state", title: st.id ? `${st.id}（余裕 ${signed(st.margin)}）` : "" }, st.label))),
    h("div", { class: "t3-w" },
      h("span", { class: "t3-wn t3-wn-a" }, h("span", { class: "tname" }, D.a), h("b", null, st.a)),
      h("span", { class: "t3-wbar", role: "img", "aria-label": `${D.a} ${st.a}、${D.b} ${st.b}` }, segs.map(c => h("i", { class: c }))),
      h("span", { class: "t3-wn t3-wn-b" }, h("b", null, st.b), h("span", { class: "tname" }, D.b))),
    h("p", { class: "t3-wsum" }, wSummary(st, D)),
    h("div", { class: "drow-bars" },
      h("div", { class: "half half-a" },
        h("div", { class: "tline" }, h("span", { class: "tname" }, D.a), h("small", { class: "t3-m" }, `${r.wins[D.a]}/${ma}`), h("span", { class: "tnum" }, num(st.LA))),
        bar3("a", st.LA)),
      h("div", { class: "half half-b" },
        h("div", { class: "tline" }, h("span", { class: "tnum" }, num(st.LB)), h("small", { class: "t3-m" }, `${r.wins[D.b]}/${mb}`), h("span", { class: "tname" }, D.b)),
        bar3("b", st.LB))));
}

// ---------------------------------------------------------------- 回答の様子
function qualityBlock(r) {
  const q = r.quality;
  const checks = Object.keys(DOMAINS).filter(d => r.states[d].check);
  const wRows = r.stages.wExtra.map(x => h("tr", { class: x.picked ? "row-changed" : "" },
    h("td", null, h("code", null, x.key)), h("td", null, x.itemId), h("td", null, `${x.domain} ${DOMAINS[x.domain].name}`),
    h("td", null, x.answer === undefined ? "—" : x.picked ?? "答えずに進む"), h("td", null, x.reason)));
  const xRows = r.stages.xExtra.map(x => {
    const it = ITEM3[x.itemId];
    return h("tr", null, h("td", null, h("code", null, x.key)), h("td", null, `${x.itemId}（${it.left}／${it.right}）`), h("td", null, x.target),
      h("td", null, x.answer === undefined ? "—" : x.picked ?? "答えずに進む"), h("td", null, x.reason));
  });
  return [
    h("div", { class: "qstats" },
      h("div", { class: ["qstat", q.ok ? "ok" : "ng"] }, h("span", null, "左を選んだ割合"), h("b", null, pct(q.leftRate)),
        h("small", null, `${Math.round(LEFT_RATE_LOW * 100)}%超〜${Math.round(LEFT_RATE_HIGH * 100)}%未満ならOK`)),
      h("div", { class: "qstat" }, h("span", null, "問題を変えた回数"), h("b", null, q.swapCount), h("small", null, "差し替え前の設問は集計に入れない")),
      h("div", { class: "qstat" }, h("span", null, "答えずに進んだ数"), h("b", null, q.skipCount), h("small", null, "集計に入れない"))),
    q.ok ? null : h("p", { class: "t3-estimate warn" }, h("b", null, "位置の偏り"), "左（または右）ばかりを選んでいます。A行動とB行動の左右は枠ごとに入れ替えているので、内容ではなく位置で答えた可能性があります。三択版では判定はそのまま行い、この注意だけを出します。"),
    h("h3", null, "W と X の食い違い", h("small", null, checks.length ? `　要確認 ${checks.length}領域` : "　なし")),
    h("p", { class: "note" }, "左右（W）で優勢な側の強さ（X）が、対の傾向より低い領域を「要確認」としています（5択版の一貫性設問の代わり）。"),
    checks.length ? h("ul", { class: "t3-list" }, checks.map(d => {
      const st = r.states[d], D = DOMAINS[d];
      return h("li", null, `${d} ${D.name}：左右では${st.lead}（${st.a}:${st.b}）だが、強さは ${D.a} ${num(st.LA)}・${D.b} ${num(st.LB)}`);
    })) : null,
    r.config?.adaptive ? [
      h("h3", null, "W追加（左右が拮抗した領域）", h("small", null, `　${wRows.length}問`)),
      wRows.length ? table(["枠", "設問", "領域", "回答", "理由"], wRows, { class: "wide t3-extra" }) : h("p", { class: "note" }, "どの領域も左右がはっきりしていたので、W追加はありませんでした。"),
      h("h3", null, "X追加（強さが曖昧な傾向）", h("small", null, `　${xRows.length}問`)),
      xRows.length ? table(["枠", "設問（左／右）", "狙いの傾向", "回答", "理由"], xRows, { class: "wide t3-extra" }) : h("p", { class: "note" }, "強さが曖昧な傾向がなかったので、X追加はありませんでした。"),
    ] : h("p", { class: "note" }, "固定64問のモードなので、追加の質問はありません。"),
  ];
}

// ---------------------------------------------------------------- 持ち出し
export function aiText3(r) {
  const src = r.source || {};
  const lines = ["【16次元診断・三択版の結果（AI統合用）】", `対象：${src.name ?? "あなたの回答"}`];
  if (src.estimated) lines.push(src.from === "scores" ? "※ 16スコアから三択の答えを機械的に作った推定です。" : "※ 5択版の回答から三択の答えを推定したものです（実際に三択で答えた結果ではありません）。");
  lines.push("", "■ 選ばれた解釈パターン（主軸を中心に、矛盾は消さずに1人の人物像としてまとめてください）");
  for (const hit of byRole(r.select.chosen)) {
    const p = PATTERN_BY_ID[hit.meta.id], t = p?.text;
    lines.push("", `［${hit.role}］${hit.meta.id}　${p?.headline ?? hit.meta.headline}`);
    if (t) lines.push(`一言：${t.one}`, `詳細：${t.detail}`, "場面：", ...t.scenes.map(s => `・${s}`), `誤解しやすい点：${t.caveat}`);
  }
  lines.push("", "■ 8領域（左右＝同じ場面で選んだ数、強さ＝別の場面の行動との比較で選ばれた割合。0〜100の相対値）");
  for (const d of Object.keys(DOMAINS)) {
    const D = DOMAINS[d], st = r.states[d];
    lines.push(`${d}. ${D.name}：左右 ${D.a} ${st.a}：${st.b} ${D.b}（${st.lead ? `優勢：${st.lead}` : "拮抗"}）／強さ ${D.a} ${num(st.LA)}・${D.b} ${num(st.LB)}（${st.label}${st.check ? "・要確認" : ""}）`);
  }
  lines.push("", `■ 回答の様子：左を選んだ割合 ${pct(r.quality.leftRate)}、問題を変えた回数 ${r.quality.swapCount}、答えずに進んだ数 ${r.quality.skipCount}${r.quality.ok ? "" : "（位置の偏りあり）"}`);
  lines.push("※ 強さは個人内の相対評価なので、「全体的に高い／低い」（S16・S17）は判定していません。");
  return lines.join("\n");
}

function exportJSON3(r) {
  return {
    type: "seikaku16-three-result", version: 1, createdAt: new Date().toISOString(),
    source: r.source, config: r.config, profile3: r.profile3, levels: r.levels, w: r.w, m: r.m, wins: r.wins,
    domainStates: Object.fromEntries(Object.entries(r.states).map(([d, s]) => [d, { state: s.state, label: s.label, id: s.id, margin: s.margin, lead: s.lead, check: s.check }])),
    quality: r.quality, confidence: r.confidence, stages: r.stages,
    chosen: r.select.chosen.map(hit => ({ id: hit.meta.id, role: hit.role, score: +hit.score.toFixed(4), headline: hit.meta.headline })),
    compare5: r.source?.expected5 ? { expected: r.source.expected5.map(([id, role]) => ({ id, role })) } : null,
    session: store3.session ? store3.session.toJSON() : null,
  };
}

function exportBlock(r) {
  const text = aiText3(r);
  return [
    h("p", { class: "note" }, "選ばれたパターンの本文と8領域の左右・強さを、AIに渡せるプレーンテキストにまとめます。結果JSONは「診断」の「JSONを読み込む」でこの画面に戻せます。"),
    h("div", { class: "row wrap-row" },
      h("button", { class: "btn primary", id: "t3-copy-ai", onclick: async () => toast(await copyText(text) ? "AI統合用テキストをコピーしました" : "コピーできませんでした。下のテキストを選んでコピーしてください") }, "AI統合用テキストをコピー"),
      h("button", { class: "btn", id: "t3-save-json", onclick: () => { download(`seikaku16-three-result-${stamp()}.json`, JSON.stringify(exportJSON3(r), null, 1)); toast("結果JSONを保存しました"); } }, "結果JSONを保存")),
    h("details", { class: "ai-preview" }, h("summary", null, "テキストを表示"), h("pre", { id: "t3-ai-text" }, text)),
  ];
}

