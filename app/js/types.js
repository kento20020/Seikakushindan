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
//
// ■ 説明の文（決定 U49。app/js/result_copy_version.js の ?tc=。既定は "copy"）
//   既定（持ち主の原稿の文）：カードの説明は、診断の結果と同じ原稿の文（type_catalog.js の copy）。A寄り＝B{軸}-1、まんなか＝B{軸}-5、B寄り＝B{軸}-3 の
//     題（太字の段落。見出しにしない＝原稿 §7「新しい診断見出しの階層を増やさない」）と本文。A寄り・B寄りには、その側の一言を
//     「たとえば、こんな一言から。」と「」つきで小さく（まんなかには出さない）。「この型に近い見出し」と古い短い説明（lead）は出さない。
//     前置きに「ここでは各軸の基本の説明を読めます。あなたの具体的な動きや、傾向の組み合わせは診断結果で読めます。」
//   前の一覧（?tc=old）：上のとおり（短い説明 lead と「この型に近い見出し」。今までの画面そのまま）
import { h, topBar, badge, rowLink, artPic, helpLink } from "./ui.js";
import { restore3 } from "../../js/ui/three_store.js";
import { currentResult, currentVersion } from "./diagnosis_version.js";
import { jpQuotes } from "./summary.js";
import { typeCatalog, typeMarks } from "./type_catalog.js";
import { TYPES_SAFETY_NOTE } from "./safety.js";
import { isCopyTypes } from "./result_copy_version.js";
import { ACTION_LEAD4 } from "../../js/data/result_copy4.js";

// 印：[文, badge の色, アイコン]
const MARK = { yours: ["あなたの型", "rose", "check-circle"], hero: ["いちばん上の絵", "ink", null] };
const markBadge = (k) => badge(MARK[k][0], { tone: MARK[k][1], ic: MARK[k][2] });

export function render(root) {
  restore3();
  const r = currentResult() ?? null;   // 今の診断の結果（三択か24問。決定 U42）
  const v4 = currentVersion() === "v4";
  const copy = isCopyTypes();   // 原稿の文（決定 U49。既定）か、前の一覧（?tc=old）か
  let marks = { yours: {}, ids: [], hero: null };
  // あなたの型：新しい一覧はカードの文と同じ原稿の状態で、前の一覧は左右の割合で（type_catalog.js の typeMarks）
  if (r) { try { marks = typeMarks(r, { tc: copy ? "copy" : "old" }); } catch (err) { console.error(err); } }
  const axes = groupByAxis(typeCatalog());
  root.append(h("div", { class: "a-ty", "data-tc": copy ? "copy" : null },
    topBar({ title: "診断結果の一覧", heading: true, help: true }),
    copy ? introCopy(r, marks, v4) : intro(r, marks, v4),
    toc(axes),
    h("div", { class: "a-ty-axes" }, axes.map((ax) => axisSection(ax, marks, copy))),
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

// 原稿の文の一覧（決定 U49）の前置き。型の決まり方は、結果の画面の形（?rc3=）にかかわらず言える言い方にする
export const TYPES_LEAD_COPY = "8つの軸それぞれに、A寄り・まんなか・B寄りの3つの型があります（24タイプ）。診断の結果では、軸ごとにどれか1つになります。ここでは各軸の基本の説明を読めます。あなたの具体的な動きや、傾向の組み合わせは診断結果で読めます。";
// あなたの型の印は、カードの文と同じ原稿の状態で決まる（type_catalog.js の typeMarks。状態1・2・1w → A寄り、3・4・3w → B寄り、5・6・7 → まんなか）
//   三択の状態1・2・1w は「左右（同じ場面の問）で A が優勢＝2問以上の差があり、6割以上」、5・6・7 は「どちらも優勢でない」
export const HOW_V3_COPY = "三択の診断では、同じ場面の2つの動き方から近いほうを選んだ数で型が決まります。左の傾向（A）がはっきり多ければ（2問以上の差があり、6割以上）A寄り、右の傾向（B）がはっきり多ければ B寄り、どちらにもはっきり寄らなければまんなかです。どの型にも、よい・わるいはありません。";
//   24問は原稿の状態（js/result_copy4.js の copyStatesOf4）：A が多い → A寄り、B が多い → B寄り、同じ数か、普段の問と2つの場面の問で向きが逆（7dd）→ まんなか
export const HOW_V4_COPY = "24問の診断では、軸ごとの3問の答えで型が決まります。左の傾向（A）を多く選んだ軸は A寄り、右の傾向（B）を多く選んだ軸は B寄り、同じ数のときや、普段の自分についての問と2つの場面の問で向きが逆になったときはまんなかです。「判断できない」が多く、答えが2問より少ない軸には印を付けません。どの型にも、よい・わるいはありません。";
function introCopy(r, marks, v4 = false) {
  const has = marks.ids.length > 0;
  return h("div", { class: "a-ty-intro" },
    h("p", { class: "a-lead" }, TYPES_LEAD_COPY),
    h("p", { class: "a-note a-ty-how" }, v4 ? HOW_V4_COPY : HOW_V3_COPY),
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
function axisSection(ax, marks, copy = false) {
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
    h("ul", { class: "a-ty-grid" }, ax.types.map((t) => (copy ? typeCardCopy(t, marks) : typeCard(t, marks))))), ax);
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

// ---------------------------------------------------------------- 1つの型のカード（原稿の文。決定 U49）
//   絵・印・型の名前（h3。今の見出し）・比率の下に、横いっぱいで原稿の題（太字の段落）と本文。A寄り・B寄りは一言を小さく
function typeCardCopy(t, marks) {
  const yours = marks.yours[t.domain] === t.id;
  const hero = marks.hero === t.id;
  const uid = `a-ty-${t.id}`;
  const pic = artPic(t.art, { cls: "a-ty-pic", alt: t.art.alt || `${t.axisName}の${t.title}の絵` })
    ?? h("div", { class: "a-ty-pic a-ty-pic-none" }, h("span", null, "準備中"));
  const c = t.copy;
  return h("li", { class: ["a-card", "a-ty-card", "a-ty-card-copy", yours && "is-yours"], "data-type": t.id, "data-side": t.side, "data-yours": yours ? "true" : null, "data-hero": hero ? "true" : null },
    pic,
    h("div", { class: "a-ty-body" },
      yours || hero ? h("p", { class: "a-ty-marks" }, yours ? markBadge("yours") : null, hero ? markBadge("hero") : null) : null,
      h("h3", { class: "a-ty-name", id: `${uid}-h` },
        t.side === "mid" ? t.label : [h("span", { class: "a-ty-side" }, `${t.sideLabel}：`), h("span", { class: "a-nowrap" }, t.label)]),
      h("p", { class: "a-ty-ratio" }, h("span", { class: "a-sr" }, `${t.aName}と${t.bName}の割合 `), t.ratio)),
    c ? h("div", { class: "a-ty-copy" },
      h("p", { class: "a-ty-copy-title" }, c.title),
      h("p", { class: "a-ty-copy-body" }, c.body),
      c.action ? h("div", { class: "a-ty-copy-action" },
        h("p", { class: "a-ty-copy-lead" }, ACTION_LEAD4),
        h("p", { class: "a-ty-copy-quote" }, `「${c.action}」`)) : null) : null);
}
