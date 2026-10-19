// 診断結果（#result。画像6）。仕様：docs/app-screens.md §4.4
//   上：「←」・中央「診断結果」・右に枠だけの「シェア」
//   主軸の絵（§12 の1・§13）：題の下に、軸の絵（axis_art.js の heroArt。主軸に合う傾向の軸の、●で選んだパターン）を列の幅いっぱいに。
//     縁はぼかす。下に小さく傾向の名前。出せなければ出さない
//   見出し「あなたを表す解釈」
//   パターンのカード（主軸1＋補強・矛盾・地、合わせて2〜4枚。今の結果と同じ選び方＝store3.result.select.chosen を byRole の順に）
//     主軸は全部を開いて出す。ほかは役割の印・種類の印・見出しと「詳しく」だけ（§12 の3）。領域名・1行（one）・本文などは「詳しく」の中
//     本文（detail）は文ごとに区切り、タップで「違う」の印（もう一度で取り消し）。場面例ごとに「ありそう」「なさそう」
//     印はこの端末の中だけ（app/js/local.js の setMarks(resultKey(r), …)）。どこにも送らない
//   「8つの軸」（§12 の2）：領域ごとに1本の横軸。●＝同じ場面の問で B を選んだ割合、下に「熟考寄り 75%」、右上に強さ「即応 40 ・ 熟考 72」
//     値は summary.js の axisView（r.states を読むだけ）。左に、その軸の●で選んだ軸の絵（axis_art.js の axisArt。まんなかは mid の絵、答えなしは番号の丸）
//     色（§13）：A 側の●と帯はその軸の色、B 側は紺、まんなかの●は墨。文字は墨のまま（「〜寄り」の前に色の点を添える）。「弱め」「両方とも強い」の印
//   下：「もう一度診断する」「診断結果の絵の一覧」（→ #images。§14）「ホームへ戻る」
//   結果を開いたら、履歴に1件足す（recordDiagnosis。同じ結果は2回足さない）
//   値は今の画面 js/ui/three.js の patternCard と同じ（js/ の中身は直さない）。見た目は app/css/diagnose.css（a-dg-）
import { h, icon, topBar, toast, badge, sectionHead, rowLink, artPic } from "./ui.js";
import { store3, restore3 } from "../../js/ui/three_store.js";
import { PATTERN_BY_ID } from "../../js/data/patterns.js";
import { byRole } from "../../js/ui/result.js";
import { ROLE_CLASS, kindLabel, domainLine, uniqueLabel } from "../../js/ui/labels.js";
import { scenesFor } from "../../js/three_version.js";
import { splitSentences, SCENE_LABEL } from "../../js/feedback_collect.js";   // テスト協力モードと同じ文の区切り方・ありそう／なさそう
import { DOMAINS } from "../../js/engine3.js";
import { domainTendencies3 } from "../../js/data/type_images.js";
import { getMarks, setMarks } from "./local.js";
import { mainPattern, resultKey, recordDiagnosis, axisView, jpQuotes } from "./summary.js";
import { heroArt, axisArt, NAVY, ART_SIZE } from "./axis_art.js";

const ROLE_TONE = { "主軸": "ink", "補強": "rose", "矛盾": "slate", "地（形状）": "line" };

export function render(root) {
  restore3();
  const r = store3.result;
  if (!r) { root.append(emptyView()); return; }
  try { recordDiagnosis(r); } catch (err) { console.error(err); }   // 履歴にまだ無ければ足す（同じ結果は足さない）

  const marks = loadMarks(resultKey(r));
  const hits = byRole(Array.isArray(r.select?.chosen) ? r.select.chosen : []);
  const sample = r.source && r.source.type && r.source.type !== "session";
  root.append(h("div", { class: "a-dg-res" },
    topBar({ title: "診断結果", heading: true, right: shareButton(r) }),
    heroFigure(r),
    h("h2", { class: "a-h1 a-dg-res-title", id: "a-dg-res-title" }, "あなたを表す解釈"),
    sample ? h("p", { class: "a-note a-dg-res-sample" }, "サンプルの回答から作った結果です（試作の確認用）。") : null,
    hits.length
      ? h("div", { class: "a-dg-cards" }, hits.map((hit, i) => patternCard(hit, r, i, marks)))
      : h("p", { class: "a-card a-note" }, "条件を満たす解釈がありませんでした。"),
    axesSection(r),
    h("div", { class: "a-dg-res-foot" },
      h("p", { class: "a-note" }, "「違う」の印と「ありそう／なさそう」は、この端末の中だけに残ります。どこにも送りません。"),
      h("div", { class: "a-card a-rows a-dg-res-rows" },
        rowLink({ href: "#diagnose", ic: "redo", text: "もう一度診断する" }),
        rowLink({ href: "#images", ic: "sparkle", text: "診断結果の絵の一覧" }),
        rowLink({ href: "#home", ic: "home", text: "ホームへ戻る" })))));
}

// ---------------------------------------------------------------- 主軸の絵（§12 の1・§13）
//   axis_art.js の heroArt：主軸に合う傾向（heroTendency。16の傾向すべてに絵がある前提）の軸の、●で選んだパターンの絵。
//   その軸がまんなかなら mid の絵、答えなしなら主軸に合う傾向の側の絵。出せなければ（主軸が無いなど）出さない
function heroFigure(r) {
  let art = null;
  try { art = heroArt(r); } catch (err) { console.error(err); }
  if (!art?.file) return null;
  return h("figure", { class: "a-dg-hero", "data-key": art.key, "data-art": art.id },
    h("div", { class: "a-dg-hero-pic" },
      h("img", { src: art.file, alt: art.alt || "", width: ART_SIZE, height: ART_SIZE, decoding: "async", fetchpriority: "high" })),
    h("figcaption", { class: "a-dg-hero-name" }, h("span", { class: "a-sr" }, "あなたの傾向の絵："), art.tendency));
}

// ---------------------------------------------------------------- 結果が無いとき
function emptyView() {
  const s = store3.session;
  let mid = false;
  try { mid = !!s && !s.isDone() && s.progress().answered > 0; } catch { mid = false; }
  return h("div", { class: "a-dg-res" },
    topBar({ title: "診断結果" }),
    h("div", { class: "a-card a-empty a-dg-empty" },
      h("h1", { class: "a-empty-title" }, "まだ結果がありません"),
      h("p", { class: "a-note" }, mid ? "途中まで答えた診断があります。最後まで答えると、ここに結果が出ます。" : "診断に答えると、ここに結果が出ます。"),
      h("div", { class: "a-empty-actions" },
        mid
          ? h("a", { class: "a-btn a-btn-block", href: "#diagnose/q" }, "続きから答える", icon("arrow-right"))
          : h("a", { class: "a-btn a-btn-block", href: "#diagnose" }, "診断をはじめる", icon("arrow-right")))));
}

// ---------------------------------------------------------------- 印（この端末の中だけ）
//   形：{ v: 1, cards: { パターンID: { ng: [違うと思う文の番号…], sc: ["y" | "n" | "", …（場面例ごと）] } } }
function loadMarks(key) {
  let m = null;
  try { m = getMarks(key); } catch { m = null; }
  const cards = m && typeof m === "object" && m.cards && typeof m.cards === "object" ? m.cards : {};
  const state = { v: 1, cards };
  return {
    of(id) {
      const c = cards[id] && typeof cards[id] === "object" ? cards[id] : (cards[id] = {});
      if (!Array.isArray(c.ng)) c.ng = [];
      if (!Array.isArray(c.sc)) c.sc = [];
      return c;
    },
    save() {
      // 何も印の無いカードは保存しない（画面の側の入れ物はそのまま使い続ける）
      const kept = Object.fromEntries(Object.entries(cards).filter(([, c]) => c?.ng?.length || (c?.sc || []).some(Boolean)));
      try { setMarks(key, Object.keys(kept).length ? { ...state, cards: kept } : null); } catch (err) { console.error(err); }
    },
  };
}

// ---------------------------------------------------------------- パターンのカード
function patternCard(hit, r, i, marks) {
  const m = hit.meta;
  const p = PATTERN_BY_ID[m.id];
  const t = p?.text;
  const main = hit.role === "主軸";
  const uid = `a-dg-pc${i}`;
  const tags = h("div", { class: "a-dg-pc-tags" },
    badge(hit.role, { tone: ROLE_TONE[hit.role] || "rose" }),
    badge(kindLabel(m), { tone: "quiet" }));
  const title = h("h3", { class: "a-dg-pc-title", id: `${uid}-h` }, jpQuotes(p?.headline ?? m.headline));   // 半角の "X" は「X」で出す
  // 見出しの下に続く中身：領域名・区切り線・1行（one）・本文・場面例・補足
  const inner = [
    h("p", { class: "a-dg-pc-domain" }, domainParts(m)),
    h("hr", { class: "a-divider" }),
    t?.one ? h("p", { class: "a-dg-pc-one" }, t.one) : null,
    ...(t ? bodyParts(m, t, r, uid, marks) : [h("p", { class: "a-note" }, "本文がありません。")]),
  ];
  const article = h("article", { class: ["a-dg-pc", `a-dg-pc-${ROLE_CLASS[hit.role] || "support"}`], "data-id": m.id, "data-role": hit.role, "aria-labelledby": `${uid}-h` }, tags, title);
  if (main) {
    article.append(...inner.filter(Boolean));
    return article;
  }
  // 主軸以外：最初は印と見出しだけ。「詳しく」で、領域名から下を全部開く（§12 の3）
  const more = h("div", { class: "a-dg-pc-more", id: `${uid}-more`, hidden: true }, inner);
  const label = h("span", null, "詳しく");
  const toggle = h("button", { type: "button", class: "a-dg-pc-toggle", "aria-expanded": "false", "aria-controls": `${uid}-more`,
    onclick: () => {
      const open = more.hidden;
      more.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      label.textContent = open ? "閉じる" : "詳しく";
    } }, label, icon("chevron-down", { size: 18 }));
  article.append(more, toggle);
  return article;
}

/** 「2 反応速度 × 4 感情表出」の領域名ごとに、途中で折り返さない */
const domainParts = (m) => domainLine(m).split(" × ").flatMap((x, i) => [i ? " × " : null, h("span", { class: "a-nowrap" }, x)]);

function bodyParts(m, t, r, uid, marks) {
  const id = m.id;
  const cm = marks.of(id);
  // 1. 本文を文ごとに。タップで「違う」の印（取り消し線と「違う」の字。色だけに頼らない）
  const sents = splitSentences(t.detail);
  const toggleSent = (i, sp) => {
    const on = !cm.ng.includes(i);
    cm.ng = on ? [...cm.ng, i].sort((a, b) => a - b) : cm.ng.filter(x => x !== i);
    sp.setAttribute("aria-pressed", on ? "true" : "false");
    marks.save();
  };
  const detail = h("p", { class: "a-dg-pc-detail" }, sents.map((txt, i) => {
    const sp = h("span", { class: "a-dg-sent", role: "button", tabindex: "0", "data-i": i, "aria-pressed": cm.ng.includes(i) ? "true" : "false",
      "aria-describedby": `${uid}-tip`,
      onclick: () => toggleSent(i, sp),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSent(i, sp); } } }, txt);
    return sp;
  }));
  const tip = h("p", { class: "a-box a-dg-tip", id: `${uid}-tip` }, icon("hand"), h("span", null, "違うと思う文があればタップ（もう一度タップで取り消し）"));

  // 2. 場面例ごとに「ありそう」「なさそう」（押した方が塗られる。もう一度で取り消し）
  const scenes = scenesFor(id, r.version, t.scenes);
  const sceneList = scenes.length ? [
    h("hr", { class: "a-divider" }),
    h("p", { class: "a-dg-pc-sub", id: `${uid}-sc` }, "場面例は、自分にありそうかどうかを選んでください"),
    h("ul", { class: "a-dg-scenes", "aria-labelledby": `${uid}-sc` }, scenes.map((s, i) => {
      const btns = ["y", "n"].map(v => h("button", { type: "button", class: ["a-dg-yn", `a-dg-yn-${v}`], "data-v": v, "aria-pressed": cm.sc[i] === v ? "true" : "false",
        onclick: () => {
          cm.sc[i] = cm.sc[i] === v ? "" : v;
          for (let k = 0; k < cm.sc.length; k++) if (cm.sc[k] == null) cm.sc[k] = "";
          for (const b of btns) b.setAttribute("aria-pressed", b.dataset.v === cm.sc[i] ? "true" : "false");
          marks.save();
        } }, icon("check", { size: 16 }), h("span", null, SCENE_LABEL[v])));
      return h("li", { class: "a-dg-scene" },
        h("p", { class: "a-dg-scene-text", id: `${uid}-s${i}` }, s),
        h("div", { class: "a-dg-yn-row", role: "group", "aria-labelledby": `${uid}-s${i}` }, btns));
    })),
  ] : [];

  // 3. 補足（今の結果の「掛け合わせで初めて言えること」「誤解しやすい点」）。閉じておく
  const extra = t.unique || t.caveat ? h("details", { class: "a-dg-extra" },
    h("summary", null, h("span", null, "補足を読む"), icon("chevron-down", { size: 18 })),
    t.unique ? h("div", { class: "a-dg-extra-item" }, h("h4", null, uniqueLabel(m)), h("p", null, t.unique)) : null,
    t.caveat ? h("div", { class: "a-dg-extra-item" }, h("h4", null, "誤解しやすい点"), h("p", null, t.caveat)) : null) : null;

  return [detail, tip, ...sceneList, extra];
}

// ---------------------------------------------------------------- 8つの軸（§12 の2）
const AXES_NOTE = "●は、同じ場面で左右どちらを選んだかの割合です。右上の数字は、別々の場面を比べた答えから出した強さ（0〜100。あなたの中での比べ）です。「弱め」は、優勢だけれど強さがやや弱い軸です。";
// 左の小さな丸の絵の切り取り（人物の顔と、手もとのリボンが入るように）
const AXIS_PIC = { pos: "52% 40%", zoom: 1.35 };
const SIDE_CLASS = { A: "is-a", B: "is-b", mid: "is-mid" };

function axesSection(r) {
  let leads;
  try { leads = domainTendencies3(r.profile3); } catch (err) { console.error(err); return null; }
  return h("section", { class: "a-dg-axes", "aria-labelledby": "a-dg-axes-h" },
    sectionHead("8つの軸", { id: "a-dg-axes-h" }),
    h("p", { class: "a-note a-dg-axes-note" }, AXES_NOTE),
    h("ul", { class: "a-card a-dg-axis-list" }, Object.keys(DOMAINS).map(d => axisRow(+d, leads[d], r))));
}

/**
 * 1本の横軸
 *   左に軸の絵（●で選んだパターン。まんなかは mid の絵。答えなし・絵が無いときは番号の丸）／題「2 反応速度」＋印（弱め・両方とも強い）／右上に強さ「即応 40 ・ 熟考 72」
 *   両はしの傾向名 → 横軸と● → 「熟考寄り 75%」（●の下あたり。両はしでは列からはみ出さない）
 *   「弱め」は今までどおり左右（W）で優勢な傾向（domainTendencies3）から。絵・●・「〜寄り」は多く選んだ側から
 *   色：--axis（絵の色。A 側の帯）・--axis-deep（点の色。A 側の●）を行に置く。B 側は紺（NAVY）。CSS は diagnose.css の .a-dg-axis
 */
function axisRow(d, t, r) {
  const D = DOMAINS[d];
  const v = axisView(r, d);
  const st = r.states?.[d];
  const lead = t?.key ? t.key.slice(-1) : null;
  const art = axisArt(d, v);
  const pic = artPic(art, { cls: "a-dg-axis-pic", ...AXIS_PIC })
    ?? h("span", { class: "a-dg-axis-num", "aria-hidden": "true" }, String(d));
  const marks = [
    lead && t.weak ? "弱め" : null,
    st?.state === "5" ? "両方とも強い" : null,
  ].filter(Boolean);
  const x = v.pos == null ? 50 : v.pos * 100;
  const track = h("div", { class: "a-dg-track" },
    h("span", { class: "a-dg-track-mid" }),
    v.pos == null ? null : h("span", { class: "a-dg-track-fill" }),
    v.pos == null ? null : h("span", { class: "a-dg-track-dot" }));
  // 読み上げは1文にまとめる（role="img" の aria-label。見た目の部品は読ませない）
  const view = h("div", { class: "a-dg-axis-view", role: "img", "aria-label": marks.length ? `${v.label}。${marks.join("。")}` : v.label },
    h("div", { class: "a-dg-axis-head" },
      pic,
      h("div", { class: "a-dg-axis-title" },
        h("p", { class: "a-dg-axis-name" }, h("span", { class: "a-nowrap" }, `${d} ${D.name}`), marks.map(m => badge(m, { tone: "quiet" }))),
        h("p", { class: "a-dg-axis-lv" },
          h("span", { class: "a-nowrap" }, `${D.a} ${v.la ?? "—"}`), h("span", { class: "a-dg-axis-sep" }, "・"), h("span", { class: "a-nowrap" }, `${D.b} ${v.lb ?? "—"}`)))),
    h("div", { class: "a-dg-axis-ends" },
      h("span", { class: ["a-dg-end", "a-dg-end-a", v.side === "A" && "is-lead"] }, D.a),
      h("span", { class: ["a-dg-end", "a-dg-end-b", v.side === "B" && "is-lead"] }, D.b)),
    track,
    h("p", { class: "a-dg-axis-share" }, h("span", null,
      v.pos == null ? null : h("i", { class: "a-dg-share-dot", "aria-hidden": "true" }),
      v.text)));
  const row = h("li", { class: ["a-dg-axis", SIDE_CLASS[v.side] || "is-none"], "data-domain": d, "data-key": t?.key ?? null, "data-side": v.side ?? "none", "data-art": art?.file ? art.id : null }, view);
  row.style.setProperty("--axis", art?.color ?? NAVY);
  row.style.setProperty("--axis-deep", art?.deep ?? NAVY);
  row.style.setProperty("--x", `${x}%`);
  row.style.setProperty("--from", `${Math.min(x, 50)}%`);
  row.style.setProperty("--len", `${Math.abs(x - 50)}%`);
  return row;
}

// ---------------------------------------------------------------- シェア
function shareButton(r) {
  return h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm a-dg-share", id: "a-dg-share", onclick: () => share(r) },
    icon("share", { size: 20 }), h("span", null, "シェア"));
}

async function share(r) {
  const main = mainPattern(r);
  const url = new URL("./", location.href).href;   // app/ の入口（結果ごとのページはまだ無い）
  const data = { title: "16次元診断", text: main?.headline || "16次元診断の結果", url };
  if (typeof navigator.share === "function") {
    try { await navigator.share(data); return; }
    catch (err) { if (err?.name === "AbortError") return; }   // 閉じただけなら何もしない。使えなければコピーへ
  }
  toast(await copyText(url) ? "リンクをコピーしました" : "リンクをコピーできませんでした");
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 下の方法で */ }
  try {
    const ta = h("textarea", { readonly: true, "aria-hidden": "true", style: { position: "fixed", top: "0", left: "0", opacity: "0" } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}
