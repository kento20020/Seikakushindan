// 16次元診断：画面の入口。ハッシュでタブを切り替える（#diagnose #result #logic #questions #design #three）。
// 既定は三択診断（#three）。ハッシュが無い・空・知らない値のときは #three に置き換える。
// 5択版（#diagnose #result #logic #questions #design）はコードを残してあり、ハッシュで直接開くか ?five=1 を付けると上部ナビも出る。
// ビルドなし・ES モジュールのみ。パスはすべて相対（GitHub Pages のサブパスで動かすため）。
import { onChange, restore } from "./ui/store.js";
import { renderDiagnose } from "./ui/diagnose.js";
import { renderResult } from "./ui/result.js";
import { renderLogic } from "./ui/logic.js";
import { renderQuestions } from "./ui/questions.js";
import { renderDesign } from "./ui/design.js";
import { renderThree } from "./ui/three.js";

const VIEWS = {
  diagnose: renderDiagnose,
  result: renderResult,
  logic: renderLogic,
  questions: renderQuestions,
  design: renderDesign,
  three: renderThree,
};
const TITLES = { diagnose: "診断", result: "結果", logic: "ロジック", questions: "設問", design: "設計", three: "三択診断" };
const DEFAULT_TAB = "three";
const FIVE_TABS = new Set(["diagnose", "result", "logic", "questions", "design"]);   // 5択版のタブ
let currentTab = null;

/** 知らないハッシュ（空・#foo など）は null。呼び出し側で既定のタブへ置き換える */
function tabFromHash() {
  const t = location.hash.replace(/^#/, "");
  return Object.hasOwn(VIEWS, t) ? t : null;
}

/** 上部ナビ（5択版のタブ＋三択診断）を出すか：5択版の画面を開いているか、URL に ?five=1 があるとき */
function showTopNav(tab) {
  if (FIVE_TABS.has(tab)) return true;
  try { return new URLSearchParams(location.search).get("five") === "1"; } catch { return false; }
}

function render() {
  const el = document.getElementById(`view-${currentTab}`);
  try { VIEWS[currentTab](el); }
  catch (err) {
    console.error(err);
    el.replaceChildren(Object.assign(document.createElement("p"), { className: "error", textContent: `表示中にエラーが起きました：${err.message}` }));
  }
}

function route() {
  let tab = tabFromHash();
  if (!tab) {   // 履歴を増やさず #three に置き換える（戻るボタンで空のハッシュに戻って跳ね返されない）
    tab = DEFAULT_TAB;
    history.replaceState(history.state, "", `${location.pathname}${location.search}#${tab}`);
  }
  const changed = tab !== currentTab;
  currentTab = tab;
  const topNav = showTopNav(tab);
  const nav = document.querySelector(".tabs");
  if (nav) nav.hidden = !topNav;   // 三択だけのときは、タブが1つだけの行は出さない（三択ビューに自前のサブタブがある）
  document.querySelector(".brand")?.setAttribute("href", topNav ? "#diagnose" : `#${DEFAULT_TAB}`);
  for (const sec of document.querySelectorAll(".view")) sec.hidden = sec.dataset.view !== tab;
  for (const a of document.querySelectorAll(".tabs a")) {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  document.title = tab === "diagnose" ? "16次元診断" : `${TITLES[tab]}｜16次元診断`;
  render();
  if (changed) window.scrollTo(0, 0);
}

// 「本文へ」のスキップリンクは #main をハッシュにせず、本文へフォーカスだけ移す（知らないハッシュ扱いで #three に飛ばないように）
document.querySelector(".skip")?.addEventListener("click", (e) => { e.preventDefault(); document.getElementById("main")?.focus(); });

restore();
onChange(render);
window.addEventListener("hashchange", route);
route();
