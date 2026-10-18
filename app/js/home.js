// ホーム（#home。画像1・2）。仕様：docs/app-screens.md §4.1・§12 の4
//   上：「HOME」・見出し・3行の文・大きな絵（仮：傾向の絵。診断の前後で同じ絵）
//   相談の欄（上・カード1枚）→ #consult
//   診断の欄（下）：診断前／途中（1問以上答えた）／診断後（主軸の絵・見出し・1〜2行・主な傾向3つ）で中身を変える
//   同じ絵は1つの画面に2回出さない（診断後のカードの絵＝主軸の絵が、上や相談の絵と同じなら、上・相談の方を次の候補に替える）
//   診断の状態は js/ui/three_store.js（今の画面と同じ保存のキー。どちらで答えても共通）。js/ の中身は直さない
import { h, eyebrow, sectionHead, badge, roundArrow, rowLink, typePic, go } from "./ui.js";
import { store3, restore3, discard3 } from "../../js/ui/three_store.js";
import { TYPE_IMAGES, isReady } from "../../js/data/type_images.js";
import { mainPattern, topTendencies, heroKey, recordDiagnosis } from "./summary.js";

// 仮の絵（img/types/ の8枚から。新しい絵が届いたら差し替える）。上・相談は先頭が基本で、ほかの絵と重なるときだけ次の候補
const PIC = { hero: ["4B", "8B", "1A"], consult: ["2B", "6B", "7A"], diagnose: "5A" };
const entry = (key) => (isReady(TYPE_IMAGES[key]) ? TYPE_IMAGES[key] : null);

/**
 * 上・相談の絵のキー。taken（診断のカードに出す絵のキー）と重ならないように選ぶ（DOM を使わない）
 *   診断前は taken＝診断のカードの絵（5A）なので、上は 4B・相談は 2B。診断後は taken＝主軸の絵
 */
export function homePics(taken = PIC.diagnose, ready = (k) => !!entry(k)) {
  const used = new Set(taken ? [taken] : []);
  const pick = (list) => {
    const k = list.find(x => ready(x) && !used.has(x)) ?? null;
    if (k) used.add(k);
    return k;
  };
  return { hero: pick(PIC.hero), consult: pick(PIC.consult) };
}

/** 診断の状態："done"（結果あり）／"mid"（1問以上答えた途中）／"before" */
export function diagnosisState(s3 = store3) {
  if (s3.result) return "done";
  const s = s3.session;
  try {
    if (s && !s.isDone() && s.progress().answered > 0) return "mid";
  } catch { /* 壊れたセッションは診断前として扱う */ }
  return "before";
}

export function render(root) {
  restore3();
  const state = diagnosisState();
  const r = store3.result;
  if (state === "done") {
    try { recordDiagnosis(r); } catch (err) { console.error(err); }   // 履歴にまだ無ければ足す（同じ結果は足さない）
  }
  let mainKey = null;
  if (state === "done") {
    try { mainKey = heroKey(r); } catch (err) { console.error(err); }
  }
  let diag;
  try {
    diag = state === "done" ? doneSection(r, mainKey) : diagnoseSection(state);
  } catch (err) {
    console.error(err);
    mainKey = null;
    diag = diagnoseSection("before");
  }
  const pics = homePics(state === "done" ? mainKey : PIC.diagnose);
  root.append(h("div", { class: "a-home" }, hero(pics.hero), consultSection(pics.consult), diag));
}

// ---------------------------------------------------------------- 上
function hero(key) {
  return h("section", { class: "a-home-hero", "aria-labelledby": "a-home-title" },
    h("div", { class: "a-home-hero-text" },
      eyebrow("HOME"),
      h("h1", { class: "a-home-title", id: "a-home-title" }, "今日はこちらから"),
      h("p", { class: "a-home-lead" }, "心が少し軽くなる、", h("br"), "あなたのための診断と相談。", h("br"), "いつでも、ここにいます。")),
    heroPic(entry(key)));
}

function heroPic(e) {
  if (!e) return null;
  return h("div", { class: "a-home-pic", "aria-hidden": "true" },
    h("img", { src: `../${e.file}`, alt: "", width: 960, height: 960, decoding: "async", fetchpriority: "high" }));
}

// ---------------------------------------------------------------- 相談の欄（上・1つだけ）
function consultSection(key) {
  return h("section", { class: "a-home-sec", "aria-labelledby": "a-home-consult" },
    sectionHead("相談", { id: "a-home-consult", aside: "今の気持ちを整理する" }),
    h("a", { class: "a-card a-card-link a-feature a-feature-v", href: "#consult" },
      typePic(entry(key), { pos: "50% 40%", zoom: 1.5 }),
      h("span", { class: "a-feature-foot" },
        h("span", { class: "a-feature-body" },
          h("span", { class: "a-feature-title" }, "なんでも相談する"),
          h("span", { class: "a-feature-text" }, "今の気持ちを自由に書いて", h("br"), "アドバイスをもらえます。")),
        roundArrow())));
}

// ---------------------------------------------------------------- 診断の欄（診断前・途中）
function diagnoseSection(state) {
  const mid = state === "mid";
  const answered = mid ? store3.session.progress().answered : 0;
  const inner = [
    typePic(entry(PIC.diagnose), { pos: "50% 42%", zoom: 1.45 }),
    h("span", { class: "a-feature-body" },
      mid ? midBadge(answered) : badge("まだ診断していません", { tone: "quiet" }),
      h("span", { class: "a-feature-title" }, mid ? "続きから答える" : "診断をはじめる"),
      h("span", { class: "a-feature-foot" },
        mid ? h("span") : h("span", { class: "a-feature-meta" }, "8〜10分"),
        roundArrow())),
  ];
  // 途中のときは、カードの下の行に「最初からやり直す」（カードのリンクの中に入れない）
  const card = mid
    ? h("div", { class: "a-card a-card-split" },
      h("a", { class: "a-card-main a-card-link a-feature a-feature-h", href: "#diagnose/q" }, inner),
      h("div", { class: "a-rows" }, rowLink({ ic: "redo", text: "最初からやり直す", onClick: restart })))
    : h("a", { class: "a-card a-card-link a-feature a-feature-h", href: "#diagnose" }, inner);
  return h("section", { class: "a-home-sec", "aria-labelledby": "a-home-diag" },
    sectionHead("診断", { id: "a-home-diag" }),
    card);
}

/** 「途中まで答えています（n問）」。狭いときは（n問）の前で折り返す */
function midBadge(n) {
  const b = badge("途中まで答えています");
  b.lastChild.append(h("span", { class: "a-nowrap" }, `（${n}問）`));
  return b;
}

function restart() {
  if (!window.confirm("途中までの回答を消して、最初からやり直しますか？")) return;
  discard3();
  go("#diagnose");
}

// ---------------------------------------------------------------- 診断の欄（診断後。画像2・§12 の4）
//   カードの上の方に主軸の絵（画像1の診断カードのように、左に絵・右に「あなたの主軸」と見出し。狭い画面では絵を上に）
//   絵が無い（heroKey が null）ときは、今までどおり文だけ
function doneSection(r, mainKey) {
  const main = mainPattern(r);
  const top = topTendencies(r, 3);
  // 切り取り（--pos・--zoom）は app.css の .a-diag-pic（狭い画面で変える）
  const pic = mainKey ? typePic(entry(mainKey), { cls: "a-diag-pic" }) : null;
  return h("section", { class: "a-home-sec", "aria-labelledby": "a-home-diag" },
    sectionHead("診断結果", { id: "a-home-diag", aside: "もっとあなたを見る", href: "#result" }),
    h("div", { class: "a-card a-card-split a-diag-done" },
      h("a", { class: "a-card-main a-card-link", href: "#result" },
        h("div", { class: ["a-diag-top", pic && "has-pic"], "data-key": pic ? mainKey : null },
          pic,
          h("div", { class: "a-diag-top-text" },
            h("p", { class: "a-kicker" }, "あなたの主軸"),
            h("h3", { class: "a-diag-headline" }, main?.headline || "あなたの診断結果"))),
        main?.one ? h("p", { class: "a-diag-one" }, main.one) : null,
        h("hr", { class: "a-divider" }),
        h("div", { class: "a-trends" },
          h("p", { class: "a-trends-label" }, "主な傾向"),
          top.length
            ? h("ul", { class: "a-trends-list" }, top.map(t => h("li", { "data-key": t.key },
              h("span", { class: ["a-dot", t.side === "A" ? "a-dot-a" : "a-dot-b"], "aria-hidden": "true" }),
              h("span", { class: "a-trend-name" }, t.name),
              h("span", { class: "a-trend-domain" }, t.domainName))))
            : h("p", { class: "a-note" }, "はっきり片方に寄った軸はありませんでした"),
          roundArrow())),
      h("div", { class: "a-rows" },
        rowLink({ href: "#diagnose", ic: "redo", text: "もう一度診断する" }))));
}
