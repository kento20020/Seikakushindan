// app/ の小道具。画面の担当（ホーム・診断・結果・相談・アカウント・履歴・マイページ）が共通で使う。
// DOM を作るだけで、状態は持たない（トーストの要素だけ1つ持つ）。見た目は app/css/app.css（クラスは a- で始まる）。
//
//   h(tag, attrs, ...children)        要素を作る（今の js/ui/dom.js の h をそのまま使う）
//   icon(name, { size, solid, cls })  線のアイコン（インライン SVG。名前は ICON_NAMES）
//   logo("line" | "google")           ログインのボタンのロゴ
//   topBar({ title, back, right, heading })  上の題「←　——題——　右」
//   tabBar(active)                    下のタブ（"home" | "history" | "mypage"）
//   roundArrow(onClick, label)        丸い矢印ボタン。onClick が無ければ飾り（カード全体が押せるとき）
//   toast(text)                       下に一時的に出るお知らせ（読み上げも）
//   go(hash) / goBack(fallback)       画面を替える／前の画面へ（アプリの中の前が無ければ fallback へ）
//   eyebrow(text) / sectionHead(title, opts) / badge(text, opts) / rowLink(opts) / typePic(entry, opts) / fmtDate(at)
import { h } from "../../js/ui/dom.js";

export { h };

const SVG_NS = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------- アイコン
// viewBox 24・線の太さ 1.5・塗りなし・色は文字色（currentColor）。solid は塗りの形（今のタブ・印の中）
// 中身は決まった文字列だけ（利用者の文は入れない）
const ICONS = {
  home: {
    line: '<path d="M4.5 10.4 12 4.25l7.5 6.15v8.85a1 1 0 0 1-1 1h-3.75v-5.4a.75.75 0 0 0-.75-.75h-4a.75.75 0 0 0-.75.75v5.4H5.5a1 1 0 0 1-1-1z"/>',
    solid: '<path fill="currentColor" d="M4.5 10.4 12 4.25l7.5 6.15v8.85a1 1 0 0 1-1 1h-3.75v-5.4a.75.75 0 0 0-.75-.75h-4a.75.75 0 0 0-.75.75v5.4H5.5a1 1 0 0 1-1-1z"/>',
  },
  paper: {
    line: '<rect x="5.25" y="3.5" width="13.5" height="17" rx="2"/><path d="M8.75 8.5h6.5M8.75 12h6.5M8.75 15.5h4"/>',
    solid: '<rect x="5.25" y="3.5" width="13.5" height="17" rx="2" fill="currentColor"/><path class="a-ic-cut" stroke="#F8F3EE" d="M8.75 8.5h6.5M8.75 12h6.5M8.75 15.5h4"/>',
  },
  person: {
    line: '<circle cx="12" cy="8.25" r="3.75"/><path d="M4.75 20.25c.9-3.9 3.7-6 7.25-6s6.35 2.1 7.25 6"/>',
    solid: '<circle cx="12" cy="8.25" r="3.75" fill="currentColor"/><path fill="currentColor" d="M4.75 20.25c.9-3.9 3.7-6 7.25-6s6.35 2.1 7.25 6z"/>',
  },
  "arrow-left": { line: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>' },
  "arrow-right": { line: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>' },
  "chevron-right": { line: '<path d="M9.5 6l6 6-6 6"/>' },
  "chevron-down": { line: '<path d="M6 9.5l6 6 6-6"/>' },
  redo: { line: '<path d="M19.25 12a7.25 7.25 0 0 1-12.7 4.8"/><path d="M4.75 12a7.25 7.25 0 0 1 12.7-4.8"/><path d="M17.75 3.75v3.6h-3.6"/><path d="M6.25 20.25v-3.6h3.6"/>' },
  share: { line: '<circle cx="17.5" cy="5.75" r="2.25"/><circle cx="6.5" cy="12" r="2.25"/><circle cx="17.5" cy="18.25" r="2.25"/><path d="M8.5 10.9l7-4M8.5 13.1l7 4"/>' },
  pencil: { line: '<path d="M4.25 19.75l1.05-4.3L15.7 5.05a2 2 0 0 1 2.83 0l.42.42a2 2 0 0 1 0 2.83L8.55 18.7z"/><path d="M14 6.75l3.25 3.25"/>' },
  hand: { line: '<path d="M10 14.5V7.75a1.5 1.5 0 0 1 3 0v4.5"/><path d="M13 11.75a1.5 1.5 0 0 1 3 0v1"/><path d="M16 12.5a1.5 1.5 0 0 1 3 0v3a5.5 5.5 0 0 1-5.5 5.5h-.9a5 5 0 0 1-3.9-1.9l-2.6-3.3a1.4 1.4 0 0 1 2.1-1.85L10 16"/><path d="M11.5 2.75v1.5M7.75 4.25l1 1M15.25 4.25l-1 1"/>' },
  sparkle: { line: '<path d="M11 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z"/><path d="M18.25 14.75c.25 1.5 1 2.25 2.5 2.5-1.5.25-2.25 1-2.5 2.5-.25-1.5-1-2.25-2.5-2.5 1.5-.25 2.25-1 2.5-2.5z"/>' },
  check: { line: '<path d="M5 12.5l4.5 4.5L19 7.5"/>' },
  "check-circle": {
    line: '<circle cx="12" cy="12" r="8.75"/><path d="M8.25 12.25l2.6 2.6 5-5.35"/>',
    solid: '<circle cx="12" cy="12" r="9.25" fill="currentColor" stroke="none"/><path stroke="#fff" stroke-width="1.8" d="M8.25 12.25l2.6 2.6 5-5.35"/>',
  },
  close: { line: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>' },
  trash: { line: '<path d="M4.75 7h14.5"/><path d="M9.75 7V5.25h4.5V7"/><path d="M6.75 7l.8 11.6a1.5 1.5 0 0 0 1.5 1.4h5.9a1.5 1.5 0 0 0 1.5-1.4L17.25 7"/><path d="M10.25 10.75v5.5M13.75 10.75v5.5"/>' },
  copy: { line: '<rect x="8.75" y="8.75" width="11" height="11" rx="2"/><path d="M15.25 8.75V6.25a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2.5"/>' },
  // 吹き出し（中に点が3つ。ホームの相談のカード）
  chat: { line: '<path d="M7.27 16.57A8.25 6.5 0 1 1 12 17.75c-1.3 0-2.53-.2-3.64-.57L5.25 19.75z"/><circle cx="8.4" cy="11.25" r=".95" fill="currentColor" stroke="none"/><circle cx="12" cy="11.25" r=".95" fill="currentColor" stroke="none"/><circle cx="15.6" cy="11.25" r=".95" fill="currentColor" stroke="none"/>' },
};
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/** 線のアイコン。<svg class="a-ic a-ic-名前" aria-hidden="true">。意味はボタンの文字か aria-label で伝える */
export function icon(name, { size = 24, solid = false, cls = null } = {}) {
  const def = ICONS[name];
  if (!def) throw new Error(`知らないアイコンです：${name}`);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", ["a-ic", `a-ic-${name}`, solid && "a-ic-solid", cls].filter(Boolean).join(" "));
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = solid && def.solid ? def.solid : def.line;
  return svg;
}

/** ログインのボタンのロゴ（LINE の緑の吹き出し、Google の G）。飾りなので読み上げない */
export function logo(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `a-logo a-logo-${name}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (name === "line") {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.innerHTML = '<rect width="24" height="24" rx="6.5" fill="#06C755"/>' +
      '<path fill="#fff" d="M12 5.2c-4.3 0-7.8 2.8-7.8 6.3 0 3.1 2.8 5.7 6.5 6.2.25.06.6.17.69.38.08.2.05.5.03.7l-.11.66c-.03.2-.16.77.68.42.84-.35 4.5-2.65 6.15-4.54 1.13-1.24 1.67-2.5 1.67-3.82 0-3.5-3.5-6.3-7.8-6.3z"/>';
  } else if (name === "google") {
    svg.setAttribute("viewBox", "0 0 48 48");
    svg.innerHTML = '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
      '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
      '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
      '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>';
  } else {
    throw new Error(`知らないロゴです：${name}`);
  }
  return svg;
}

// ---------------------------------------------------------------- 画面の行き来
/** 画面を替える。同じ画面なら描き直す（main.js が hashchange で描く） */
export function go(hash) {
  const target = String(hash || "#home").startsWith("#") ? String(hash || "#home") : `#${hash}`;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = target;
}

/** 前の画面へ。アプリの中の前の画面が無い（直接開いた）ときは fallback へ。深さは main.js が history.state.aDepth に入れる */
export function goBack(fallback = "#home") {
  const depth = history.state && typeof history.state.aDepth === "number" ? history.state.aDepth : 0;
  if (depth > 0) history.back();
  else go(fallback);
}

// ---------------------------------------------------------------- 上の題・下のタブ
/**
 * 上の題「←　——題——　右」
 *   title   … 中央の題（短く。「診断」「相談」など）
 *   back    … 省略：前の画面へ（goBack）／"#home" など：その画面へ／関数：それを呼ぶ／false：← を出さない
 *   right   … 右に置く要素（「40 / 64」・シェアのボタンなど）。省略可
 *   heading … true なら題を h1 にする（画面にほかの h1 が無いとき。質問の画面など）
 */
export function topBar({ title = "", back, right = null, heading = false } = {}) {
  const onBack = () => {
    if (typeof back === "function") back();
    else if (typeof back === "string") go(back);
    else goBack();
  };
  const left = back === false
    ? h("span", { class: "a-top-spacer", "aria-hidden": "true" })
    : h("button", { type: "button", class: "a-top-back", "aria-label": "戻る", onclick: onBack }, icon("arrow-left"));
  return h("header", { class: "a-top" },
    left,
    h(heading ? "h1" : "p", { class: "a-top-title" }, h("span", null, title)),
    h("div", { class: "a-top-right" }, right));
}

const TABS = [["home", "ホーム", "home"], ["history", "履歴", "paper"], ["mypage", "マイページ", "person"]];
/** 下のタブ。active は "home" | "history" | "mypage"（今の画面。塗りのアイコンと主の色の文字） */
export function tabBar(active) {
  return h("nav", { class: "a-tabs", "aria-label": "画面の切り替え" },
    h("ul", { class: "a-tabs-list" }, TABS.map(([key, label, ic]) => h("li", null,
      h("a", { class: "a-tab", href: `#${key}`, "aria-current": key === active ? "page" : null },
        icon(ic, { solid: key === active }),
        h("span", { class: "a-tab-label" }, label))))));
}

// ---------------------------------------------------------------- 部品
/**
 * 丸い矢印ボタン（直径 56px）。
 *   onClick が関数 … <button aria-label=label>
 *   onClick が無い … 飾りの <span aria-hidden>（カード全体が a や button のとき。入れ子にしない）
 *   dir: "left" で ← にする
 */
export function roundArrow(onClick, label = "次へ", { dir = "right", cls = null } = {}) {
  const ic = icon(dir === "left" ? "arrow-left" : "arrow-right");
  if (typeof onClick !== "function") return h("span", { class: ["a-round", cls], "aria-hidden": "true" }, ic);
  return h("button", { type: "button", class: ["a-round", cls], "aria-label": label, onclick: onClick }, ic);
}

/** 小さな英字を細い横線ではさむ（「HOME」） */
export function eyebrow(text) {
  return h("p", { class: "a-eyebrow" }, h("span", null, text));
}

/**
 * セクションの見出し「｜相談」と、右の小さな文
 *   opts.id … h2 の id（section の aria-labelledby に使う）
 *   opts.aside … 右の文。opts.href があればリンク（› つき）
 */
export function sectionHead(title, { id = null, aside = null, href = null } = {}) {
  return h("div", { class: "a-section-h" },
    h("h2", { id }, title),
    aside == null ? null
      : href ? h("a", { class: "a-section-aside", href }, aside, icon("chevron-right", { size: 16 }))
      : h("p", { class: "a-section-aside" }, aside));
}

/**
 * 印（丸い小さな地）。tone："rose"（既定）| "quiet" | "ink" | "slate" | "line"。ic：アイコンの名前（"check-circle" は塗りで出す）
 */
export function badge(text, { tone = "rose", ic = null } = {}) {
  return h("span", { class: ["a-badge", tone !== "rose" && `a-badge-${tone}`] },
    ic ? icon(ic, { size: 16, solid: ic === "check-circle" }) : null,
    h("span", null, text));
}

/**
 * 1行のリンク・ボタン（アイコン＋文＋ ›）。href があれば a、無ければ button
 *   rowLink({ href: "#diagnose", ic: "redo", text: "もう一度診断する" })
 */
export function rowLink({ href = null, onClick = null, ic = null, text, chevron = true, attrs = {} }) {
  const kids = [ic ? icon(ic) : null, h("span", { class: "a-row-text" }, text), chevron ? icon("chevron-right", { size: 18 }) : null];
  return href
    ? h("a", { class: "a-row", href, ...attrs }, kids)
    : h("button", { type: "button", class: "a-row", onclick: onClick, ...attrs }, kids);
}

/**
 * 傾向の絵（js/data/type_images.js の TYPE_IMAGES の1件）を枠に入れる。絵が無ければ null
 *   pos  … 見せる位置（object-position。例 "50% 35%"）  zoom … 拡大（例 1.4）
 *   soft … 縁をぼかす（a-pic-soft）  alt … 既定は ""（飾り。仮の絵のため）
 */
export function typePic(entry, { cls = null, alt = "", pos = null, zoom = null, soft = false, eager = false } = {}) {
  if (!entry || typeof entry.file !== "string" || !entry.file) return null;
  const style = {};
  if (pos) style["--pos"] = pos;
  if (zoom) style["--zoom"] = String(zoom);
  const box = h("div", { class: ["a-pic", soft && "a-pic-soft", cls] },
    h("img", { src: `../${entry.file}`, alt, width: 960, height: 960, loading: eager ? "eager" : "lazy", decoding: "async" }));
  for (const [k, v] of Object.entries(style)) box.style.setProperty(k, v);
  return box;
}

/** 日時の表示「10月18日 21:05」（年が違えば「2025年10月18日 21:05」）。端末の時刻で出す */
export function fmtDate(at, now = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${pad(d.getMinutes())}`;
  return d.getFullYear() === now.getFullYear() ? day : `${d.getFullYear()}年${day}`;
}

// ---------------------------------------------------------------- トースト
let toastEl = null;
let toastTimer = 0;
/** 下に一時的に出るお知らせ（role="status" で読み上げる）。ms ミリ秒で消える */
export function toast(text, { ms = 2600 } = {}) {
  const fresh = !toastEl || !toastEl.isConnected;
  if (fresh) {
    toastEl = h("div", { class: "a-toast", role: "status", "aria-live": "polite" });
    document.body.append(toastEl);
  }
  const show = () => {
    toastEl.textContent = text;
    toastEl.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-show"), ms);
  };
  // 作ったばかりの読み上げの場所は、次の描画で文を入れる（入れてから作ると読み上げられないことがある）
  if (fresh) requestAnimationFrame(show); else show();
}
