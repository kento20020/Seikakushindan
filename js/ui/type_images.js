// 三択版の結果画面に出す「傾向の絵」。絵・文言・どの傾向に絵があるかは js/data/type_images.js だけで決まる（ここには持たない）。
//   typeHero(r)  … 結果の上に出す1枚（主軸の傾向の絵。準備中なら、あなたのほかの傾向の絵）。出せなければ null
//   typeTiles(r) … 「8つの軸の絵」：領域ごとに、あなたの優勢な傾向の絵（準備中・拮抗の枠つき）
// 結果の本番（resultView）だけで使う。テスト協力モードのブラインド比較（feedback.js）には絵を出さない（どちらが自分の結果かが分かってしまうため）。
import { h } from "./dom.js";
import { DOMAINS } from "../engine.js";
import { TYPE_IMAGES, isReady, domainTendencies3, heroTendency, referencedDomains } from "../data/type_images.js";

const SIZE = 960;   // 絵は 960×960。width／height 属性に入れて、読み込み前に場所を確保する（レイアウトがずれない）
const WEAK_TITLE = "優勢ですが、強さがやや弱いか、強さの向きが逆の軸です";
const NOTE = {
  "代わり": "主軸の傾向の絵は準備中のため、あなたのほかの傾向の絵を表示しています",
  "主軸なし": "主軸の絵はまだないため、あなたのほかの傾向の絵を表示しています",
};

/** 絵を出す img。サイトのルートからの相対パスのまま（GitHub Pages のサブパスでも動く） */
function pic(entry) {
  return h("img", { src: entry.file, alt: entry.alt || "", width: SIZE, height: SIZE, loading: "lazy", decoding: "async" });
}

/** 絵の描画で何かが起きても、結果画面そのものは壊さない */
function safely(fn) {
  try { return fn(); } catch (err) { console.error(err); return null; }
}

// ---------------------------------------------------------------- 結果の上の1枚
export function typeHero(r) {
  return safely(() => {
    const pick = heroTendency(r.profile3, r.select.chosen);
    const e = pick && TYPE_IMAGES[pick.key];
    if (!isReady(e)) return null;
    const D = DOMAINS[e.domain];
    return h("section", { class: "ti-hero", "aria-labelledby": "ti-hero-name", "data-key": e.key, "data-reason": pick.reason },
      h("figure", { class: "ti-fig" }, pic(e)),
      h("div", { class: "ti-hero-text" },
        h("p", { class: "ti-eyebrow" }, pick.reason === "主軸" ? "あなたの主軸の傾向" : "あなたの傾向のひとつ", h("span", { class: "ti-domain" }, `領域${e.domain} ${D.name}`)),
        h("h2", { class: "ti-name", id: "ti-hero-name" }, e.tendency),
        e.motif ? h("p", { class: "ti-motif" }, `絵のモチーフ：${e.motif}`) : null,
        e.caption ? h("p", { class: "ti-caption" }, e.caption) : null,
        NOTE[pick.reason] ? h("p", { class: "ti-sub-note" }, NOTE[pick.reason]) : null));
  });
}

// ---------------------------------------------------------------- 8つの軸の絵
function tile(t, referenced) {
  const D = DOMAINS[t.domain];
  const e = t.key ? TYPE_IMAGES[t.key] : null;
  const ready = isReady(e);
  const state = t.tie ? "tie" : ready ? "ready" : "pending";
  const thumb = h("div", { class: "ti-thumb" },
    ready ? pic(e)
      : h("div", { class: "ti-ph" }, h("span", { class: "ti-ph-text" }, t.tie ? "場面によって変わる" : "絵は準備中")));
  return h("li", { class: ["ti-tile", referenced && "is-ref", t.weak && "is-weak"], "data-domain": t.domain, "data-key": t.key, "data-state": state,
    "data-ref": referenced ? "1" : null, "data-weak": t.weak ? "1" : null },
    thumb,
    h("p", { class: "ti-dname" }, h("span", { class: "dnum" }, t.domain), D.name),
    h("p", { class: "ti-tname" }, t.tie ? "左右が拮抗" : t.tendency,
      t.weak ? h("span", { class: "ti-weak", title: WEAK_TITLE }, "弱め") : null));
}

export function typeTiles(r) {
  return safely(() => {
    const leads = domainTendencies3(r.profile3);
    const refs = referencedDomains(r.select.chosen);
    return h("section", { class: "block ti-tiles", "aria-labelledby": "ti-tiles-h" },
      h("h2", { id: "ti-tiles-h" }, "8つの軸の絵"),
      h("p", { class: "note" }, "領域ごとに、あなたが優勢なほうの傾向の絵です。枠が濃い軸は、上の解釈でとりあげている軸。「弱め」は、優勢だけれど強さがやや弱い軸です。絵は少しずつ増やしています。"),
      h("ul", { class: "ti-grid" }, Object.keys(DOMAINS).map(d => tile(leads[d], !!refs[d]))));
  });
}
