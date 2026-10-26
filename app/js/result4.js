// U55：既定は主軸の具体例・クロス・特殊。U54 は ?rd=axes、短い版は ?rd=compact。
// 24問版（v4）の診断結果（#result）。決定 U42・U44・U46。仕様：docs/diagnosis-v4.md §6
//   三択（v3）の結果は今までどおり result.js（どちらを出すかは main.js が今の診断の版で決める）
//   出し方は2つ（app/js/result_copy_version.js。既定は "v4.1"、URL の ?rc=u44 で前の形）
//
// ■ 持ち主の原稿の形（決定 U46。既定。render → renderCopy）。文は js/result_copy4.js（原稿の写しは js/data/result_copy4.js）
//   上の帯：「←」・小さな「診断結果」（ページの名前。h1 にしない）・「シェア」（文は「喧嘩の答えで診断しました。」＋改行＋タイトル）
//   その下は、この順だけ：
//     1 絵：結果の文の主軸の領域の、選ばれた側の軸の絵（axis_art.js の heroArt4）。飾りなので alt は空。下に傾向の名前を付けない。主軸が無ければ出さない
//     2 タイトル（h1。画面の中の見出しはこれ1つ。.result-title）
//     3 本文（原稿の段落どおり。特別の組 PAIR-7B-8B は2段落）
//     4 補足1文（あるときだけ。本文と同じ大きさ。囲み・見出しを付けない）
//     5 「たとえば、こんな一言から。」と、一言を「」で1つ（答えがそろった領域が無いときは出さない）
//     6 閉じた「回答の内訳を見る」（details）：8つの領域の名前・A と B の名前・3問の答え・A と B を選んだ数（％にしない）、凡例、注記。結果の文は再掲しない。絵は出さない
//     7 操作：［相談する］（小さな2行目「次に喧嘩したら、ここに書くだけ」。決定 U47）［もう一度診断する］［診断結果の一覧］［診断結果の絵の一覧］［ホームへ戻る］。
//       答えがそろった領域が無いときは［回答を見直す］（24問の1問目へ。答えは消さない。four_store.js の review4）と［ホームへ戻る］
//     6 と 7 のあいだ：安全の1行（決定 U47。app/js/safety.js の safetyNote4）。領域3か6が A強（答えた問がすべて A）のときだけ、見出しの無い小さな囲み
//       （原稿の本文・補足・一言の流れを切らないよう、内訳の後ろに置く）。答えがそろった領域が無いときは条件を満たさないので出ない
//     いちばん下（操作のあと）：静かな1行「危ないときは：相談できる窓口 ›」（ui.js の helpFoot。右上はシェアなので、上の帯には付けない）
//   外したもの：見出し『今回の回答で目立つ傾向』、主軸と補足のカード、8つの領域の線と絵、状態の見出し
//   中の ID（B1-1・PAIR-7B-8B・テーマの名前）は画面に出さない
//   U54：既定では補足の詳しい本文と8軸一覧を表示する（result_details.js）。上記の短い表示は ?rd=compact。
//
// ■ 前の形（決定 U44。?rc=u44。renderU44。下のコメントのまま）
//   上：「←」・中央「診断結果」・右に「シェア」（app/js/share.js。文はサービス名と冒頭の見出し、リンクは app/?from=share。結果はリンクに載せない。決定 U45）
//   主軸の絵：主軸の領域の、A の割合で選んだ軸の絵（axis_art.js の heroArt4）。主軸が無ければ出さない
//   見出し『今回の回答で目立つ傾向』と短い注記『今回の回答から見た傾向です。相手や状況によって変わることがあります。』
//     適合率・正確率・信頼度などは出さない
//   主軸（1）と補足（最大2）：強（3問とも・答えた2問とも同じ側）→ 寄り（3問のうち2問）、同じなら答えた数が多い方、さらに同じなら領域の番号順。
//     文は状態の見出しと本文（js/engine4.js の domainText4）
//     主軸の候補が無いとき：状態の出た領域があれば『今回の回答では、片側に強く寄らない傾向』、どの領域も incomplete なら
//     総合の見出しを作らず、分かっている個別の回答（下の8つの領域）と相談への入口
//   組み合わせ（172パターン）は出さない（U44）
//   8つの領域：三択の結果の「8つの軸」と同じ形の横の線（左右の傾向の名前・●の位置＝B を選んだ割合・「向き合う寄り 67%」の1行）＋
//     状態の見出しと本文。U41 の5 で三択から外した説明の文は出さない。絵は A の割合で選ぶ（axis_art.js の axisArt4）。incomplete は番号の丸
//   安全の1行（決定 U47）：8つの領域のあと・操作の前（持ち主の原稿の形と同じ条件・同じ文）。いちばん下に「危ないときは：相談できる窓口 ›」
//   結果を開いたら、履歴に1件足す（summary4.js の recordDiagnosis4。同じ結果は2回足さない）
//   見た目は app/css/diagnose.css（三択の結果と同じ a-dg- の部品と、a-d4- で始まるクラス）
import { h, icon, topBar, badge, sectionHead, rowLink, artPic, go, helpLink, helpFoot } from "./ui.js";
import { store4, restore4, progress4, review4 } from "../../js/ui/four_store.js";
import { DOMAINS } from "../../js/engine.js";
import { DOMAIN_IDS4, domainText4 } from "../../js/engine4.js";
import { copyStatesOf4 } from "../../js/result_copy4.js";
import { ACTION_LEAD4, BREAKDOWN_LABEL4, REVIEW_LABEL4 } from "../../js/data/result_copy4.js";
import { idsOfDomain4 } from "../../js/data/questions4.js";
import { leadOf4, recordDiagnosis4, axisView4, copyOf4 } from "./summary4.js";
import { heroArt4, axisArt4, NAVY, ART_SIZE } from "./axis_art.js";
import { shareResult, shareText4, shareTextCopy4 } from "./share.js";
import { isCopyResult } from "./result_copy_version.js";
import { safetyNote4, CONSULT_ROW_SUB } from "./safety.js";
import { showResultDetails, detailModel, supportingDetails, detailedAxes } from "./result_details.js";
import { showResultStory, resultStory, primaryStory, storyCards } from "./result_story.js";

export const RESULT_TITLE4 = "今回の回答で目立つ傾向";
export const RESULT_NOTE4 = "今回の回答から見た傾向です。相手や状況によって変わることがあります。";

export function render(root) {
  return isCopyResult() ? renderCopy(root) : renderU44(root);
}

// ================================================================ 持ち主の原稿の形（決定 U46）
/** 内訳の凡例・注記・答えがそろっていない領域の文 */
export const BREAKDOWN_LEGEND4 = "普段＝普段の自分についての問　場面＝場面の問";
export const BREAKDOWN_HOLD4 = "答えがそろっていないため、判断を置いています";
const PICK_LABEL = { U: "普段", P: "場面", N: "場面" };

function renderCopy(root) {
  restore4();
  const r = store4.result;
  if (!r) { root.append(emptyView()); return; }
  try { recordDiagnosis4(r); } catch (err) { console.error(err); }
  const copy = copyOf4(r);
  const story = showResultStory() ? resultStory(r, copy) : null;
  const details = !story && showResultDetails() ? detailModel(r, copy) : null;
  const none = copy.kind === "none";
  root.append(h("div", { class: "a-dg-res a-d4-res a-d4-copy", "data-dv": "v4", "data-kind": copy.kind },
    topBar({ title: "診断結果", right: shareButtonCopy(copy) }),
    copyHero(r),
    h("h1", { class: "result-title", id: "a-d4-title" }, copy.title),
    story?.main ? h("p", { class: "a-story-main-label" }, badge("主軸", { tone: "ink" }), "あなたの動きの中心") : null,
    h("div", { class: "a-d4-copy-body", id: "result-main-copy" },
      (story ? story.intro : copy.paragraphs).map((p) => h("p", null, p)),
      !story && !details && copy.bridge ? h("p", { class: "a-d4-copy-bridge" }, copy.bridge) : null),
    story ? primaryStory(story) : details ? supportingDetails(details) : null,
    story ? storyCards(story) : null,
    copy.action
      ? h("div", { class: "a-d4-copy-action" },
        h("p", { class: "a-d4-copy-lead" }, ACTION_LEAD4),
        h("blockquote", { class: "a-d4-copy-quote" }, h("p", null, `「${copy.action}」`)))
      : null,
    story ? null : details ? detailedAxes(details) : breakdown(r),
    safetyBox(r),
    h("div", { class: "a-dg-res-foot" },
      h("div", { class: "a-card a-rows a-dg-res-rows" }, none
        ? [
          rowLink({ ic: "redo", text: REVIEW_LABEL4, onClick: reviewAnswers, attrs: { id: "a-d4-review" } }),
          rowLink({ href: "#home", ic: "home", text: "ホームへ戻る" }),
        ]
        : [
          rowLink({ href: "#consult", ic: "chat", text: "相談する", sub: CONSULT_ROW_SUB }),
          rowLink({ href: "#diagnose", ic: "redo", text: "もう一度診断する" }),
          rowLink({ href: "#types", ic: "grid", text: "診断結果の一覧" }),
          rowLink({ href: "#images", ic: "sparkle", text: "診断結果の絵の一覧" }),
          rowLink({ href: "#home", ic: "home", text: "ホームへ戻る" }),
        ])),
    helpFoot()));
}

/**
 * 安全の1行（決定 U47）：領域3（不安時の確認行動）か領域6（話し合いの主導）が A強のときだけ。見出しの無い小さな囲み（.a-safety-note）。
 *   両方のときは2つの文を続けて1つの囲みに。最後に共通の1文と「危ないときは ›」（#help）
 */
function safetyBox(r) {
  let note = null;
  try { note = safetyNote4(r); } catch (err) { console.error(err); }
  if (!note) return null;
  return h("div", { class: "a-safety-note a-d4-safety", role: "note", "data-domains": note.domains.join(" ") },
    h("p", null, note.texts.join("")),
    h("p", null, note.tail, helpLink()));
}

/** 回答を見直す：答えを消さずに24問の1問目へ */
function reviewAnswers() {
  if (review4()) go("#diagnose/q");
}

/** 絵（飾り。alt は空。下に傾向の名前を付けない） */
function copyHero(r) {
  let art = null;
  try { art = heroArt4(r); } catch (err) { console.error(err); }
  if (!art?.file) return null;
  return h("figure", { class: "a-dg-hero a-d4-copy-hero", "data-key": art.key, "data-art": art.id },
    h("div", { class: "a-dg-hero-pic" },
      h("img", { src: art.file, alt: "", width: ART_SIZE, height: ART_SIZE, decoding: "async", fetchpriority: "high" })));
}

const pickText = (D, pick) => (pick === "A" ? D.a : pick === "B" ? D.b : pick === "unknown" ? "判断できない" : "未回答");

/** 回答の内訳（閉じた状態）。8つの領域の答えと、A・B を選んだ数（％にしない）。結果の文は再掲しない */
function breakdown(r) {
  const states = copyStatesOf4(r);
  return h("details", { class: "a-d4-bd", id: "a-d4-bd" },
    h("summary", { class: "a-d4-bd-sum" }, h("span", null, BREAKDOWN_LABEL4), icon("chevron-right", { size: 18 })),
    h("div", { class: "a-d4-bd-body" },
      h("p", { class: "a-d4-bd-legend" }, BREAKDOWN_LEGEND4),
      h("ul", { class: "a-d4-bd-list" }, DOMAIN_IDS4.map((d) => breakdownRow(r, d, states[d]))),
      h("p", { class: "a-note a-d4-bd-note" }, RESULT_NOTE4)));
}

function breakdownRow(r, d, state) {
  const D = DOMAINS[d];
  const dom = r.domains[d];
  const ids = idsOfDomain4(d);
  return h("li", { class: "a-d4-bd-dom", "data-domain": d },
    h("p", { class: "a-d4-bd-name" }, `${d} ${D.name}`),
    h("p", { class: "a-d4-bd-ab" }, h("span", { class: "a-nowrap" }, `A：${D.a}`), "　", h("span", { class: "a-nowrap" }, `B：${D.b}`)),
    h("dl", { class: "a-d4-bd-picks" }, ["U", "P", "N"].map((k) => h("div", { class: "a-d4-bd-pick", "data-q": ids[k] },
      h("dt", null, PICK_LABEL[k]),
      h("dd", null, pickText(D, dom.picks?.[k]))))),
    h("p", { class: "a-d4-bd-count" }, `選んだ数：${D.a} ${dom.a}・${D.b} ${dom.b}`),
    state === "incomplete" ? h("p", { class: "a-d4-bd-hold" }, BREAKDOWN_HOLD4) : null);
}

// シェア（決定 U45・U46。中身は share.js）：文「喧嘩の答えで診断しました。」＋改行＋タイトル、リンクは app/?from=share
function shareButtonCopy(copy) {
  return h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm a-dg-share", id: "a-dg-share", onclick: () => shareResult({ text: shareTextCopy4(copy) }) },
    icon("share", { size: 20 }), h("span", null, "シェア"));
}

// ================================================================ 前の形（決定 U44。?rc=u44）
function renderU44(root) {
  restore4();
  const r = store4.result;
  if (!r) { root.append(emptyView()); return; }
  try { recordDiagnosis4(r); } catch (err) { console.error(err); }

  const lead = leadOf4(r);
  root.append(h("div", { class: "a-dg-res a-d4-res", "data-dv": "v4", "data-lead": r.lead },
    topBar({ title: "診断結果", heading: true, right: shareButton(lead) }),
    heroFigure(r),
    h("h2", { class: "a-h1 a-dg-res-title", id: "a-dg-res-title" }, RESULT_TITLE4),
    h("p", { class: "a-note a-d4-res-note" }, RESULT_NOTE4),
    leadCards(r, lead),
    domainsSection(r),
    safetyBox(r),
    h("div", { class: "a-dg-res-foot" },
      h("div", { class: "a-card a-rows a-dg-res-rows" },
        rowLink({ href: "#consult", ic: "chat", text: "相談する", sub: CONSULT_ROW_SUB }),
        rowLink({ href: "#diagnose", ic: "redo", text: "もう一度診断する" }),
        rowLink({ href: "#types", ic: "grid", text: "診断結果の一覧" }),
        rowLink({ href: "#images", ic: "sparkle", text: "診断結果の絵の一覧" }),
        rowLink({ href: "#home", ic: "home", text: "ホームへ戻る" }))),
    helpFoot()));
}

// ---------------------------------------------------------------- 主軸の絵
function heroFigure(r) {
  let art = null;
  try { art = heroArt4(r); } catch (err) { console.error(err); }
  if (!art?.file) return null;
  return h("figure", { class: "a-dg-hero", "data-key": art.key, "data-art": art.id },
    h("div", { class: "a-dg-hero-pic" },
      h("img", { src: art.file, alt: art.alt || "", width: ART_SIZE, height: ART_SIZE, decoding: "async", fetchpriority: "high" })),
    h("figcaption", { class: "a-dg-hero-name" }, h("span", { class: "a-sr" }, "主軸の領域の絵："), art.tendency));
}

// ---------------------------------------------------------------- 結果が無いとき
function emptyView() {
  const s = store4.session;
  const mid = !!s && !s.completed && progress4(s).answered > 0;
  return h("div", { class: "a-dg-res" },
    topBar({ title: "診断結果", help: true }),
    h("div", { class: "a-card a-empty a-dg-empty" },
      h("h1", { class: "a-empty-title" }, "まだ結果がありません"),
      h("p", { class: "a-note" }, mid ? "途中まで答えた診断があります。最後まで答えると、ここに結果が出ます。" : "診断に答えると、ここに結果が出ます。"),
      h("div", { class: "a-empty-actions" },
        mid
          ? h("a", { class: "a-btn a-btn-block", href: "#diagnose/q" }, "続きから答える", icon("arrow-right"))
          : h("a", { class: "a-btn a-btn-block", href: "#diagnose" }, "診断をはじめる", icon("arrow-right")))));
}

// ---------------------------------------------------------------- 主軸・補足
const domainLabel = (d) => `${d} ${DOMAINS[d]?.name ?? ""}`;

function leadCards(r, lead) {
  if (lead.kind === "primary") {
    const ids = [r.primaryDomainId, ...(r.supportingDomainIds || [])];
    return h("div", { class: "a-dg-cards a-d4-cards" }, ids.map((d, i) => domainCard(r, d, i === 0)));
  }
  if (lead.kind === "none") {
    return h("div", { class: "a-dg-cards a-d4-cards" },
      h("article", { class: "a-dg-pc a-dg-pc-shape a-d4-none", "data-lead": "none" },
        h("p", { class: "a-d4-none-text" }, lead.body),
        h("p", { class: "a-note a-d4-none-sub" }, "今の気持ちや出来事を書いて、相談することもできます。"),
        h("a", { class: "a-btn a-btn-block a-d4-none-btn", href: "#consult" }, "相談する", icon("arrow-right"))));
  }
  return h("div", { class: "a-dg-cards a-d4-cards" },
    h("article", { class: "a-dg-pc a-dg-pc-main a-d4-overall", "data-lead": lead.kind, "aria-labelledby": "a-d4-lead-h" },
      h("h3", { class: "a-dg-pc-title", id: "a-d4-lead-h" }, lead.title),
      lead.body ? h("p", { class: "a-dg-pc-domain" }, lead.body) : null));
}

function domainCard(r, d, main) {
  const dom = r.domains[d];
  const t = domainText4(dom);
  const uid = `a-d4-pc${d}`;
  return h("article", { class: ["a-dg-pc", main ? "a-dg-pc-main" : "a-dg-pc-support"], "data-domain": d, "data-state": dom.state, "data-role": main ? "主軸" : "補足", "aria-labelledby": `${uid}-h` },
    h("div", { class: "a-dg-pc-tags" },
      badge(main ? "主軸" : "補足", { tone: main ? "ink" : "rose" }),
      badge(domainLabel(d), { tone: "quiet" })),
    h("h3", { class: "a-dg-pc-title", id: `${uid}-h` }, t.title),
    h("hr", { class: "a-divider" }),
    h("p", { class: "a-dg-pc-detail a-d4-pc-body" }, t.body));
}

// ---------------------------------------------------------------- 8つの領域（三択の「8つの軸」と同じ形の横の線。U44）
const AXIS_PIC = { pos: "52% 40%", zoom: 1.35 };
const SIDE_CLASS = { A: "is-a", B: "is-b", mid: "is-mid" };

function domainsSection(r) {
  return h("section", { class: "a-dg-axes a-d4-doms", "aria-labelledby": "a-d4-doms-h" },
    sectionHead("8つの領域", { id: "a-d4-doms-h" }),
    h("ul", { class: "a-card a-dg-axis-list" }, DOMAIN_IDS4.map((d) => domainRow(r, d))));
}

/**
 * 1本の横軸と、その領域の文
 *   左に軸の絵（A の割合で選ぶ。incomplete は番号の丸）／題「1 衝突への向き合い方」／その下に状態の見出し
 *   両はしの傾向名 → 横軸と● → 「向き合う寄り 67%」（三択と同じ部品 a-dg-axis-ends・a-dg-track・a-dg-axis-share）→ 状態の本文
 *   横軸の部分は読み上げを1文にまとめる（role="img"）。見出しと本文はふつうの文として読む
 */
function domainRow(r, d) {
  const D = DOMAINS[d];
  const dom = r.domains[d];
  const v = axisView4(r, d);
  const t = domainText4(dom);
  const art = axisArt4(d, dom);
  const pic = artPic(art, { cls: "a-dg-axis-pic", ...AXIS_PIC }) ?? h("span", { class: "a-dg-axis-num", "aria-hidden": "true" }, String(d));
  const x = v.pos == null ? 50 : v.pos * 100;
  const hid = `a-d4-dom${d}-h`;
  const track = h("div", { class: "a-dg-track" },
    h("span", { class: "a-dg-track-mid" }),
    v.pos == null ? null : h("span", { class: "a-dg-track-fill" }),
    v.pos == null ? null : h("span", { class: "a-dg-track-dot" }));
  const row = h("li", {
    class: ["a-dg-axis", "a-d4-dom", SIDE_CLASS[v.side] || "is-none", dom.state === "incomplete" && "is-incomplete"],
    "data-domain": d, "data-state": dom.state, "data-side": v.side ?? "none", "data-share": dom.share ?? "none",
    "data-art": art?.file ? art.id : null,
  },
  h("div", { class: "a-dg-axis-head" },
    pic,
    h("div", { class: "a-d4-dom-titles" },
      h("p", { class: "a-dg-axis-name" }, h("span", { class: "a-nowrap" }, `${d} ${D.name}`)),
      h("h3", { class: "a-d4-dom-title", id: hid }, t.title))),
  h("div", { class: "a-dg-axis-view a-d4-dom-view", role: "img", "aria-label": v.label },
    h("div", { class: "a-dg-axis-ends" },
      h("span", { class: ["a-dg-end", "a-dg-end-a", v.side === "A" && "is-lead"] }, D.a),
      h("span", { class: ["a-dg-end", "a-dg-end-b", v.side === "B" && "is-lead"] }, D.b)),
    track,
    h("p", { class: "a-dg-axis-share" }, h("span", null,
      v.pos == null ? null : h("i", { class: "a-dg-share-dot", "aria-hidden": "true" }),
      v.text))),
  h("p", { class: "a-d4-dom-body" }, t.body));
  row.style.setProperty("--axis", art?.color ?? NAVY);
  row.style.setProperty("--axis-deep", art?.deep ?? NAVY);
  row.style.setProperty("--x", `${x}%`);
  row.style.setProperty("--from", `${Math.min(x, 50)}%`);
  row.style.setProperty("--len", `${Math.abs(x - 50)}%`);
  return row;
}

// ---------------------------------------------------------------- シェア（決定 U45。中身は share.js）
//   文「喧嘩の答えで診断しました。」＋「今回の回答で目立つ傾向：{見出し}」（片側に強く寄らないときは「{見出し}でした。」）、リンクは app/?from=share
function shareButton(lead) {
  return h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm a-dg-share", id: "a-dg-share", onclick: () => shareResult({ text: shareText4(lead) }) },
    icon("share", { size: 20 }), h("span", null, "シェア"));
}
