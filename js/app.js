// 16次元診断：画面の入口。ハッシュでタブを切り替える（#diagnose #result #logic #questions #design）。
// ビルドなし・ES モジュールのみ。パスはすべて相対（GitHub Pages のサブパスで動かすため）。
import { onChange, restore } from "./ui/store.js";
import { renderDiagnose } from "./ui/diagnose.js";
import { renderResult } from "./ui/result.js";
import { renderLogic } from "./ui/logic.js";
import { renderQuestions } from "./ui/questions.js";
import { renderDesign } from "./ui/design.js";

const VIEWS = {
  diagnose: renderDiagnose,
  result: renderResult,
  logic: renderLogic,
  questions: renderQuestions,
  design: renderDesign,
};
const TITLES = { diagnose: "診断", result: "結果", logic: "ロジック", questions: "設問", design: "設計" };
let currentTab = null;

function tabFromHash() {
  const t = location.hash.replace(/^#/, "");
  return Object.hasOwn(VIEWS, t) ? t : "diagnose";
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
  const tab = tabFromHash();
  const changed = tab !== currentTab;
  currentTab = tab;
  for (const sec of document.querySelectorAll(".view")) sec.hidden = sec.dataset.view !== tab;
  for (const a of document.querySelectorAll(".tabs a")) {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  document.title = tab === "diagnose" ? "16次元診断" : `${TITLES[tab]}｜16次元診断`;
  render();
  if (changed) window.scrollTo(0, 0);
}

restore();
onChange(render);
window.addEventListener("hashchange", route);
route();
