// ホーム（#home。画像1・2）。仕様：docs/app-screens.md §4.1・§12.1（決定 U32。U31 の4を置き換え）
//   上：「HOME」・見出し・3行の文・大きな絵（軸の絵。§13）。診断後は axis_art.js の heroArt（結果の一番上と同じ絵）＝「あなた」の絵。
//     診断前・途中は軸の絵 4-b（感情表出の B寄り）
//   相談の欄（上・カード1枚）→ #consult。人物の絵は出さない（画像2の形：薄いくすんだ赤の丸に吹き出しのアイコン・題・2行の文・丸い →）
//   診断の欄（下）：診断前／途中（1問以上答えた）は小さな絵（軸の絵 5-a）つきのカード。診断後は文だけのカード（主軸の見出し・1〜2行・主な傾向3つ）
//   同じ絵は1つの画面に2回出さない（絵が出るのは、上と、診断前・途中のカードだけ。この2つを重ねない）
//   診断の状態は js/ui/three_store.js（今の画面と同じ保存のキー。どちらで答えても共通）。js/ の中身は直さない
import { h, eyebrow, sectionHead, badge, roundArrow, rowLink, artPic, icon, go } from "./ui.js";
import { store3, restore3, discard3 } from "../../js/ui/three_store.js";
import { mainPattern, topTendencies, recordDiagnosis } from "./summary.js";
import { heroArt, artOf, ART_SIZE, AXIS_ART, NAVY } from "./axis_art.js";

// 診断前・途中の絵（軸の絵から2枚。同じ絵にしない。§13.3）
//   上＝4-b（感情表出の B寄り。胸もとに小さなピンクがのぞく、静かな絵。前の仮の絵 4B と同じ見え方）。候補の先頭が基本で、診断のカードの絵と重なるときだけ次
//   診断のカード＝5-a（納得の条件の A寄り。パズルのピースを合わせる絵＝「自分を知る」）
const PIC = { hero: [[4, "b"], [8, "b"], [2, "b"]], diagnose: [5, "a"] };
const has = (art) => !!art?.file;

/**
 * ホームの絵 { hero, diagnose }（axis_art.js の artOf・heroArt の形か null。DOM を使わない）
 *   state … diagnosisState() の値（"done" | "mid" | "before"）
 *   main  … 診断後の「あなた」の絵（heroArt(r)）。"done" のときだけ使う
 *   診断後：上＝heroArt の絵（無ければ診断前と同じ絵）、診断のカード＝絵なし（diagnose は null）
 *   診断前・途中：上＝4-b、診断のカード＝5-a。上は診断のカードの絵と重ならない候補を選ぶ
 */
export function homePics(state = "before", main = null) {
  const fallback = PIC.hero.map(([d, s]) => artOf(d, s)).filter(has);
  if (state === "done") return { hero: has(main) ? main : (fallback[0] ?? null), diagnose: null };
  const diagnose = artOf(...PIC.diagnose);
  return { hero: fallback.find(a => a.id !== diagnose?.id) ?? null, diagnose: has(diagnose) ? diagnose : null };
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
  let main = null;
  if (state === "done") {
    try { recordDiagnosis(r); } catch (err) { console.error(err); }   // 履歴にまだ無ければ足す（同じ結果は足さない）
    try { main = heroArt(r); } catch (err) { console.error(err); }
  }
  // 診断の欄と、上・診断のカードの絵を同じ状態で作る（診断後のカードが作れなければ、診断前として出す）
  const build = (s) => {
    const pics = homePics(s, main);
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
function hero(art) {
  return h("section", { class: "a-home-hero", "aria-labelledby": "a-home-title" },
    h("div", { class: "a-home-hero-text" },
      eyebrow("HOME"),
      h("h1", { class: "a-home-title", id: "a-home-title" }, "今日はこちらから"),
      h("p", { class: "a-home-lead" }, "心が少し軽くなる、", h("br"), "あなたのための診断と相談。", h("br"), "いつでも、ここにいます。")),
    heroPic(art));
}

// 切り取りは app.css の .a-home-pic（絵ごとに人物とリボンの位置が違うので、data-key＝絵の id「2-b」で見せる位置を変える）
//   飾り（aria-hidden）。結果の一番上と同じ絵で、意味は結果の画面の alt と題で伝える
function heroPic(art) {
  if (!has(art)) return null;
  return h("div", { class: "a-home-pic", "data-key": art.id, "aria-hidden": "true" },
    h("img", { src: art.file, alt: "", width: ART_SIZE, height: ART_SIZE, decoding: "async", fetchpriority: "high" }));
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
function diagnoseSection(state, pic = artOf(...PIC.diagnose)) {
  const mid = state === "mid";
  const answered = mid ? store3.session.progress().answered : 0;
  const inner = [
    artPic(pic, { pos: "55% 0%" }),   // 5-a：頭とパズルのピースが入るように（縦長の枠なので左右だけ少し切る）
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
              h("span", { class: ["a-dot", t.side === "A" ? "a-dot-a" : "a-dot-b"], "aria-hidden": "true", style: { background: dotColor(t) } }),
              h("span", { class: "a-trend-name" }, t.name),
              h("span", { class: "a-trend-domain" }, t.domainName))))
            : h("p", { class: "a-note" }, "はっきり片方に寄った軸はありませんでした"),
          roundArrow())),
      h("div", { class: "a-rows" },
        rowLink({ href: "#diagnose", ic: "redo", text: "もう一度診断する" }))));
}

// 「主な傾向」の点の色（決定 U33 の続き）：A 側はその軸の点の色、B 側は紺（8つの軸の表示と同じ）
function dotColor(t) {
  return t.side === "A" ? (AXIS_ART[t.domain]?.deep || NAVY) : NAVY;
}
