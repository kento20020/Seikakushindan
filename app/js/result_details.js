// 旧版のように補足と8つの軸まで読める結果。キャッチコピーは増やさない。
import { h, icon, artPic } from "./ui.js";
import { resultDetails } from "../../js/result_details.js";
import { artOf } from "./axis_art.js";

/** ?rd=compact で U46・U49 の短い表示に戻せる。採点や結果の文の版とは独立。 */
export function showResultDetails(search = globalThis.location?.search || "") {
  return new URLSearchParams(search).get("rd") !== "compact";
}

export const detailModel = resultDetails;

/** 補足の本文。領域の名前は小さなラベルだけにし、原稿のタイトルや一行要約は重ねない。 */
export function supportingDetails(model) {
  if (!model.supports.length) return null;
  return h("div", { class: "a-result-supports" }, model.supports.map(s =>
    h("div", { class: "a-result-support", id: s.anchor },
      h("p", { class: "a-result-domain-label" }, s.name),
      h("p", { class: "a-result-explanation" }, s.body))));
}

/** 8軸の一覧は旧版同様に見せ、各軸の詳しい説明と回答を開ける。 */
export function detailedAxes(model) {
  return h("section", { class: "a-result-axes", "aria-label": "8つの軸" },
    h("p", { class: "a-result-domain-label" }, "8つの軸"),
    h("p", { class: "a-note" }, "それぞれの軸を開くと、詳しい説明と回答を読めます。"),
    h("ul", { class: "a-card a-result-axis-list" }, model.rows.map(axisRow)));
}

function axisRow(row) {
  const { domain: d, counts } = row;
  const n = counts ? counts.a + counts.b : 0;
  const side = row.state === "incomplete" ? null : ["1", "2", "1w"].includes(row.state) ? "a"
    : ["3", "4", "3w"].includes(row.state) ? "b" : "mid";
  const art = side ? artOf(d, side) : null;
  const line = counts ? `選んだ数：${row.aName} ${counts.a}・${row.bName} ${counts.b}` : "回答の記録がありません";
  const pic = artPic(art, { cls: "a-dg-axis-pic", pos: "52% 40%", zoom: 1.35 })
    || h("span", { class: "a-dg-axis-num", "aria-hidden": "true" }, String(d));
  const track = n ? h("div", { class: "a-result-axis-track", "aria-hidden": "true" },
    h("span", { class: "a-result-axis-dot", style: { left: `${counts.b / n * 100}%` } })) : null;
  return h("li", { class: "a-result-axis" },
    h("details", { id: `result-axis-${d}` },
      h("summary", { class: "a-result-axis-summary" },
        pic,
        h("span", { class: "a-result-axis-name" }, `${d} ${row.name}`),
        icon("chevron-down", { size: 18 })),
      h("div", { class: "a-result-axis-detail" },
        row.body ? h("p", { class: "a-result-explanation" }, row.body) : null,
        row.ref ? h("a", { class: "a-link a-result-reference", href: `#${row.ref}`, onclick: e => {
          // ハッシュルーターへ渡さず、同じ結果の中で説明済みの位置へ移動する。
          e.preventDefault();
          const target = document.getElementById(row.ref);
          if (!target) return;
          if (target.tagName === "DETAILS") target.open = true;
          target.setAttribute("tabindex", "-1");
          target.focus({ preventScroll: true });
          target.scrollIntoView({ block: "start" });
        } }, "この傾向の説明へ戻る") : null,
        h("p", { class: "a-result-evidence" }, row.text),
        row.answers.length ? h("dl", { class: "a-result-answers" }, row.answers.map(a =>
          h("div", null, h("dt", null, a.label),
            h("dd", null, a.scene ? h("p", { class: "a-result-scene" }, a.scene) : null, h("p", null, a.text))))) : null)),
    h("div", { class: "a-result-axis-values" },
      h("div", { class: "a-dg-axis-ends" }, h("span", null, row.aName), h("span", null, row.bName)),
      track,
      h("p", { class: "a-d4-bd-count" }, line)));
}
