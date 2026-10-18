// ホーム（#home。画像1・2）。仕様：docs/app-screens.md §4.1・§12.1（決定 U32。U31 の4を置き換え）
//   上：「HOME」・見出し・3行の文・大きな絵。診断後は主軸に合う傾向の絵（summary.js の heroKey）＝「あなた」の絵。診断前・途中は仮の絵（4B）
//   相談の欄（上・カード1枚）→ #consult。人物の絵は出さない（画像2の形：薄いくすんだ赤の丸に吹き出しのアイコン・題・2行の文・丸い →）
//   診断の欄（下）：診断前／途中（1問以上答えた）は小さな絵つきのカード。診断後は文だけのカード（主軸の見出し・1〜2行・主な傾向3つ）
//   同じ絵は1つの画面に2回出さない（絵が出るのは、上と、診断前・途中のカードだけ。この2つを重ねない）
//   診断の状態は js/ui/three_store.js（今の画面と同じ保存のキー。どちらで答えても共通）。js/ の中身は直さない
import { h, eyebrow, sectionHead, badge, roundArrow, rowLink, typePic, icon, go } from "./ui.js";
import { store3, restore3, discard3 } from "../../js/ui/three_store.js";
import { TYPE_IMAGES, isReady } from "../../js/data/type_images.js";
import { mainPattern, topTendencies, heroKey, recordDiagnosis } from "./summary.js";

// 仮の絵（img/types/ の8枚から。新しい絵が届いたら差し替える）。上は先頭が基本で、診断のカードの絵と重なるときだけ次の候補
const PIC = { hero: ["4B", "8B", "1A"], diagnose: "5A" };
const entry = (key) => (isReady(TYPE_IMAGES[key]) ? TYPE_IMAGES[key] : null);

/**
 * ホームの絵のキー { hero, diagnose }（DOM を使わない）
 *   state   … diagnosisState() の値（"done" | "mid" | "before"）
 *   mainKey … 診断後の主軸の絵のキー（heroKey(r)）。"done" のときだけ使う
 *   診断後：上＝主軸の絵（無ければ仮の絵）、診断のカード＝絵なし（diagnose は null）
 *   診断前・途中：上＝仮の絵（4B）、診断のカード＝5A。上は診断のカードの絵と重ならない候補を選ぶ
 */
export function homePics(state = "before", mainKey = null, ready = (k) => !!entry(k)) {
  if (state === "done") {
    const hero = mainKey && ready(mainKey) ? mainKey : (PIC.hero.find(k => ready(k)) ?? null);
    return { hero, diagnose: null };
  }
  const diagnose = ready(PIC.diagnose) ? PIC.diagnose : null;
  return { hero: PIC.hero.find(k => ready(k) && k !== diagnose) ?? null, diagnose };
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
  let mainKey = null;
  if (state === "done") {
    try { recordDiagnosis(r); } catch (err) { console.error(err); }   // 履歴にまだ無ければ足す（同じ結果は足さない）
    try { mainKey = heroKey(r); } catch (err) { console.error(err); }
  }
  // 診断の欄と、上・診断のカードの絵を同じ状態で作る（診断後のカードが作れなければ、診断前として出す）
  const build = (s) => {
    const pics = homePics(s, mainKey);
    return { pics, diag: s === "done" ? doneSection(r) : diagnoseSection(s, pics.diagnose) };
  };
  let view;
  try {
    view = build(state);
  } catch (err) {
    console.error(err);
    view = build("before");
  }
  root.append(h("div", { class: "a-home" }, hero(view.pics.hero), consultSection(), view.diag));
}

// ---------------------------------------------------------------- 上
function hero(key) {
  return h("section", { class: "a-home-hero", "aria-labelledby": "a-home-title" },
    h("div", { class: "a-home-hero-text" },
      eyebrow("HOME"),
      h("h1", { class: "a-home-title", id: "a-home-title" }, "今日はこちらから"),
      h("p", { class: "a-home-lead" }, "心が少し軽くなる、", h("br"), "あなたのための診断と相談。", h("br"), "いつでも、ここにいます。")),
    heroPic(key));
}

// 切り取りは app.css の .a-home-pic（絵ごとに人物の位置が違うので、data-key で見せる位置を変える）
function heroPic(key) {
  const e = entry(key);
  if (!e) return null;
  return h("div", { class: "a-home-pic", "data-key": key, "aria-hidden": "true" },
    h("img", { src: `../${e.file}`, alt: "", width: 960, height: 960, decoding: "async", fetchpriority: "high" }));
}

// ---------------------------------------------------------------- 相談の欄（上・1つだけ。画像2の相談カードの形。人物の絵は出さない）
function consultSection() {
  return h("section", { class: "a-home-sec", "aria-labelledby": "a-home-consult" },
    sectionHead("相談", { id: "a-home-consult", aside: "今の気持ちを整理する" }),
    h("a", { class: "a-card a-card-link a-feature a-feature-v", href: "#consult" },
      h("span", { class: "a-feature-mark", "aria-hidden": "true" }, icon("chat")),
      h("span", { class: "a-feature-foot" },
        h("span", { class: "a-feature-body" },
          h("span", { class: "a-feature-title" }, "なんでも相談する"),
          h("span", { class: "a-feature-text" }, "今の気持ちを自由に書いて", h("br"), "アドバイスをもらえます。")),
        roundArrow())));
}

// ---------------------------------------------------------------- 診断の欄（診断前・途中）
function diagnoseSection(state, picKey = PIC.diagnose) {
  const mid = state === "mid";
  const answered = mid ? store3.session.progress().answered : 0;
  const inner = [
    typePic(entry(picKey), { pos: "50% 42%", zoom: 1.45 }),
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

// ---------------------------------------------------------------- 診断の欄（診断後。画像2・§12.1）
//   文だけのカード（主軸の絵はページの一番上に出すので、ここには出さない）
function doneSection(r) {
  const main = mainPattern(r);
  const top = topTendencies(r, 3);
  return h("section", { class: "a-home-sec", "aria-labelledby": "a-home-diag" },
    sectionHead("診断結果", { id: "a-home-diag", aside: "もっとあなたを見る", href: "#result" }),
    h("div", { class: "a-card a-card-split a-diag-done" },
      h("a", { class: "a-card-main a-card-link", href: "#result" },
        h("p", { class: "a-kicker" }, "あなたの主軸"),
        h("h3", { class: "a-diag-headline" }, main?.headline || "あなたの診断結果"),
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
