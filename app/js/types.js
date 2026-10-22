// 診断結果の一覧（#types。タブなし。題「診断結果の一覧」）。8つの軸 × 3つの型のタイプ図鑑。仕様：docs/app-screens.md §16（決定 U38）
//   持ち主の依頼「診断結果一覧ページも作って」。中身は「8軸×3のタイプ図鑑」、場所は新しい画面（app/）
//   #images（§14。絵の確認用）とは別の、利用者向けの画面。データは app/js/type_catalog.js（DOM なし）
//   上：「←」・題（h1）
//   前置き：24タイプの説明と、型の決まり方（●の割合）。結果があるときは印の見方（「あなたの型」「いちばん上の絵」）
//   目次：8つの軸の小さなボタン（軸の色の点＋番号＋名前）。押すとその節へ移る（scrollIntoView。URL の # は変えない）
//   軸ごとの節：見出し（軸の色の点＋番号＋名前）と小さく「{a} ↔ {b}」。中に3つの型のカード（A寄り・まんなか・B寄り）
//     カード：絵（alt 付き）・型の名前・比率・短い説明（lead）・「この型に近い見出し」
//     あなたの型：「あなたの型」の印（文字とアイコン）＋カードの枠（色だけに頼らない）。いちばん上の絵の型には「いちばん上の絵」の印
//   一覧の最後：小さな注（スマホ・居場所・お金・人づきあいを…＋「危ないときは ›」。決定 U47。型ごとのカードには出さない）
//   下：「診断結果の絵の一覧」（#images）・「ホームへ戻る」
//   診断の結果が無くても見られる（印が無いだけ）。見た目は app/css/app.css（a-ty-）
import { h, topBar, badge, rowLink, artPic, helpLink } from "./ui.js";
import { restore3 } from "../../js/ui/three_store.js";
import { currentResult, currentVersion } from "./diagnosis_version.js";
import { jpQuotes } from "./summary.js";
import { typeCatalog, typeMarks } from "./type_catalog.js";
import { TYPES_SAFETY_NOTE } from "./safety.js";

// 印：[文, badge の色, アイコン]
const MARK = { yours: ["あなたの型", "rose", "check-circle"], hero: ["いちばん上の絵", "ink", null] };
const markBadge = (k) => badge(MARK[k][0], { tone: MARK[k][1], ic: MARK[k][2] });

export function render(root) {
  restore3();
  const r = currentResult() ?? null;   // 今の診断の結果（三択か24問。決定 U42）
  const v4 = currentVersion() === "v4";
  let marks = { yours: {}, ids: [], hero: null };
  if (r) { try { marks = typeMarks(r); } catch (err) { console.error(err); } }
  const axes = groupByAxis(typeCatalog());
  root.append(h("div", { class: "a-ty" },
    topBar({ title: "診断結果の一覧", heading: true, help: true }),
    intro(r, marks, v4),
    toc(axes),
    h("div", { class: "a-ty-axes" }, axes.map((ax) => axisSection(ax, marks))),
    // 一覧の最後に小さな注（決定 U47。型ごとのカードには出さない：特定の型を疑う形にしないため）
    h("div", { class: "a-safety-note a-ty-safety", role: "note" }, h("p", null, TYPES_SAFETY_NOTE, helpLink())),
    h("div", { class: "a-card a-rows-card a-ty-foot" },
      h("div", { class: "a-rows" },
        rowLink({ href: "#images", ic: "sparkle", text: "診断結果の絵の一覧" }),
        rowLink({ href: "#home", ic: "home", text: "ホームへ戻る" })))));
}

/** 軸ごとにまとめる（typeCatalog の並びのまま） */
function groupByAxis(list) {
  const out = [];
  for (const t of list) {
    let ax = out.find((x) => x.domain === t.domain);
    if (!ax) out.push(ax = { domain: t.domain, name: t.axisName, aName: t.aName, bName: t.bName, color: t.color, deep: t.deep, types: [] });
    ax.types.push(t);
  }
  return out;
}

/** 軸の色を要素に渡す（--axis＝絵の色、--axis-deep＝点の色） */
function paint(el, ax) {
  if (ax.color) el.style.setProperty("--axis", ax.color);
  if (ax.deep) el.style.setProperty("--axis-deep", ax.deep);
  return el;
}

// ---------------------------------------------------------------- 前置き
// 24問の診断（v4。決定 U42・U44）では、軸ごとの3問のうち A を選んだ割合で型を選ぶ（答えが2問より少ない軸は印を付けない）
const HOW_V4 = "24問の診断では、軸ごとの3問のうち左の傾向（A）を選んだ割合で型が決まります。半分より多ければ A寄り、少なければ B寄り、ちょうど半分ならまんなかです。「判断できない」が多く、答えが2問より少ない軸には印を付けません。どの型にも、よい・わるいはありません。";
function intro(r, marks, v4 = false) {
  const has = marks.ids.length > 0;
  return h("div", { class: "a-ty-intro" },
    h("p", { class: "a-lead" }, "8つの軸それぞれに、A寄り・まんなか・B寄りの3つの型があります（24タイプ）。診断の結果では、軸ごとにどれか1つになります。"),
    h("p", { class: "a-note a-ty-how" }, v4 ? HOW_V4 : "型は、結果の「8つの軸」の●で決まります。左の傾向（A）を選んだ割合が半分より多ければ A寄り、少なければ B寄り、ちょうど半分ならまんなかです。どの型にも、よい・わるいはありません。"),
    r && has
      ? h("div", { class: "a-ty-legend" },
        h("p", { class: "a-ty-legend-text" }, "あなたの型には印が付いています。"),
        h("ul", { class: "a-ty-legend-list" },
          h("li", null, markBadge("yours"), h("span", null, "あなたの結果で、その軸の型")),
          marks.hero ? h("li", null, markBadge("hero"), h("span", null, "結果の画面とホームのいちばん上に出ている絵")) : null))
      : h("p", { class: "a-note a-ty-legend-none" }, "診断のあとは、あなたの型に印が付きます。"));
}

// ---------------------------------------------------------------- 目次（軸へ移る）
//   a の #… はハッシュの画面の切り替えとぶつかるので、ボタンで scrollIntoView する（URL は変えない）
function toc(axes) {
  return h("nav", { class: "a-ty-toc", "aria-label": "軸へ移る" },
    h("ul", { class: "a-ty-toc-list" }, axes.map((ax) => h("li", null,
      paint(h("button", { type: "button", class: "a-ty-toc-btn", "data-to": ax.domain, onclick: () => jump(ax.domain) },
        h("i", { class: "a-ty-dot", "aria-hidden": "true" }),
        h("span", { class: "a-ty-toc-num" }, String(ax.domain)),
        h("span", { class: "a-ty-toc-name" }, ax.name)), ax)))));
}

function jump(d) {
  const sec = document.getElementById(`a-ty-axis-${d}`);
  if (!sec) return;
  let reduce = false;
  try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { reduce = false; }
  sec.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  // 読み上げ・キーボードでも移った先が分かるように、節の見出しへ焦点を移す（スクロールはしない）
  sec.querySelector(".a-ty-axis-name")?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- 軸ごとの節
function axisSection(ax, marks) {
  const hid = `a-ty-axis-${ax.domain}-h`;
  return paint(h("section", { class: "a-ty-axis", id: `a-ty-axis-${ax.domain}`, "data-domain": ax.domain, "aria-labelledby": hid },
    h("div", { class: "a-ty-axis-head" },
      h("h2", { class: "a-ty-axis-name", id: hid, tabindex: "-1" },
        h("i", { class: "a-ty-dot", "aria-hidden": "true" }),
        h("span", { class: "a-ty-axis-num" }, String(ax.domain)),
        h("span", null, ax.name)),
      h("p", { class: "a-ty-axis-ends" },
        h("span", { class: "a-nowrap" }, ax.aName),
        h("span", { class: "a-ty-axis-arrow", "aria-hidden": "true" }, " ↔ "),
        h("span", { class: "a-sr" }, "と"),
        h("span", { class: "a-nowrap" }, ax.bName))),
    h("ul", { class: "a-ty-grid" }, ax.types.map((t) => typeCard(t, marks)))), ax);
}

// ---------------------------------------------------------------- 1つの型のカード
function typeCard(t, marks) {
  const yours = marks.yours[t.domain] === t.id;
  const hero = marks.hero === t.id;
  const uid = `a-ty-${t.id}`;
  const pic = artPic(t.art, { cls: "a-ty-pic", alt: t.art.alt || `${t.axisName}の${t.title}の絵` })
    ?? h("div", { class: "a-ty-pic a-ty-pic-none" }, h("span", null, "準備中"));
  return h("li", { class: ["a-card", "a-ty-card", yours && "is-yours"], "data-type": t.id, "data-side": t.side, "data-yours": yours ? "true" : null, "data-hero": hero ? "true" : null },
    pic,
    h("div", { class: "a-ty-body" },
      yours || hero ? h("p", { class: "a-ty-marks" }, yours ? markBadge("yours") : null, hero ? markBadge("hero") : null) : null,
      h("h3", { class: "a-ty-name", id: `${uid}-h` },
        t.side === "mid" ? t.label : [h("span", { class: "a-ty-side" }, `${t.sideLabel}：`), h("span", { class: "a-nowrap" }, t.label)]),
      h("p", { class: "a-ty-ratio" }, h("span", { class: "a-sr" }, `${t.aName}と${t.bName}の割合 `), t.ratio),
      h("p", { class: "a-ty-lead" }, t.lead)),
    t.near.length ? h("div", { class: "a-ty-near" },
      h("p", { class: "a-ty-near-h", id: `${uid}-near` }, "この型に近い見出し"),
      h("ul", { class: "a-ty-near-list", "aria-labelledby": `${uid}-near` },
        t.near.map((n) => h("li", { "data-id": n.id }, jpQuotes(n.headline))))) : null);
}
