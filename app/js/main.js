// app/ の入口。ハッシュで画面を切り替える。仕様：docs/app-screens.md §6.1
//
// 画面の約束（各画面のモジュール）
//   export function render(root, route) { ... }   root は空の <main>。中身を足して返す
//     片付けの関数を返してよい（画面を替えるときに呼ぶ。document や window に付けたものを外す）。Promise を返してもよい
//   route = { key, name, parts, params, hash }
//     key    … 画面の名前（"home" "diagnose" "diagnose/q" "result" "consult" "account" "history" "mypage" "images"）
//     name   … ハッシュの1つ目（"diagnose" など）。parts … "/" で分けた全部、params … 2つ目から（"#history/abc" → ["abc"]）
//   画面を替えたら、先頭へスクロールし、焦点を見出しへ移す（root の [data-focus]、無ければ最初の h1）
//   下のタブはホーム・履歴・マイページだけ（main.js が出す）。ほかの画面は ui.js の topBar で「← 題」を出す
//   知らないハッシュはホーム
import { tabBar } from "./ui.js";

const SITE = "16次元診断";
const ROUTES = {
  home: { load: () => import("./home.js"), tab: "home", title: "ホーム" },
  diagnose: { load: () => import("./diagnose.js"), title: "診断" },
  "diagnose/q": { load: () => import("./diagnose.js"), title: "診断" },
  result: { load: () => import("./result.js"), title: "診断結果" },
  consult: { load: () => import("./consult.js"), title: "相談" },
  account: { load: () => import("./account.js"), title: "アカウント" },
  history: { load: () => import("./history.js"), tab: "history", title: "履歴" },
  mypage: { load: () => import("./mypage.js"), tab: "mypage", title: "マイページ" },
  images: { load: () => import("./images.js"), title: "診断結果の絵" },   // 診断結果の絵の一覧（§14）
};

/** "#history/abc" → { key: "history", name: "history", parts: ["history","abc"], params: ["abc"], hash } */
export function parseRoute(hash) {
  let raw = String(hash || "").replace(/^#/, "");
  try { raw = decodeURIComponent(raw); } catch { /* そのまま */ }
  const parts = raw.split("/").filter(Boolean);
  const name = parts[0] || "home";
  let key = name;
  if (name === "diagnose" && parts[1] === "q") key = "diagnose/q";
  if (!Object.hasOwn(ROUTES, key)) return { key: "home", name: "home", parts: ["home"], params: [], hash: "#home" };
  return { key, name, parts, params: parts.slice(key === "diagnose/q" ? 2 : 1), hash: `#${raw}` };
}

const root = document.getElementById("a-main");
const tabSlot = document.getElementById("a-tabbar");
let cleanup = null;
let seq = 0;

// ---------------------------------------------------------------- 戻る（アプリの中の深さを history.state.aDepth に入れる。ui.js の goBack が読む）
let depth = 0;
function trackDepth() {
  const st = history.state;
  if (st && typeof st.aDepth === "number") { depth = st.aDepth; return; }
  depth = depth + 1;
  try { history.replaceState({ ...(st && typeof st === "object" ? st : {}), aDepth: depth }, ""); } catch { /* 無視 */ }
}

function errorView(err) {
  const box = document.createElement("div");
  box.className = "a-error";
  box.setAttribute("role", "alert");
  const h1 = document.createElement("h1");
  h1.className = "a-h1";
  h1.textContent = "画面を表示できませんでした";
  const p = document.createElement("p");
  p.textContent = `読み込みなおすと直ることがあります。（${err?.message || err}）`;
  box.append(h1, p);
  return box;
}

function focusHeading() {
  const target = root.querySelector("[data-focus]") || root.querySelector("h1");
  if (!target) { root.focus({ preventScroll: true }); return; }
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

async function show() {
  const my = ++seq;
  const route = parseRoute(location.hash);
  const def = ROUTES[route.key];
  let mod = null, loadErr = null;
  try { mod = await def.load(); } catch (err) { loadErr = err; console.error(err); }
  if (my !== seq) return;   // 読み込む間に別の画面へ移った

  try { cleanup?.(); } catch (err) { console.error(err); }
  cleanup = null;
  root.replaceChildren();
  document.body.dataset.route = route.key;
  document.body.classList.toggle("a-has-tabs", !!def.tab);
  tabSlot.replaceChildren(...(def.tab ? [tabBar(def.tab)] : []));
  document.title = route.key === "home" ? `${SITE}（試作）` : `${def.title}｜${SITE}（試作）`;

  if (loadErr || typeof mod?.render !== "function") {
    root.append(errorView(loadErr || new Error("画面の render がありません")));
  } else {
    try {
      let out = mod.render(root, route);
      if (out && typeof out.then === "function") out = await out;
      if (my !== seq) { if (typeof out === "function") out(); return; }
      cleanup = typeof out === "function" ? out : null;
    } catch (err) {
      console.error(err);
      root.replaceChildren(errorView(err));
    }
  }
  window.scrollTo(0, 0);
  focusHeading();
}

try {
  if (!(history.state && typeof history.state.aDepth === "number")) history.replaceState({ ...(history.state || {}), aDepth: 0 }, "");
  else depth = history.state.aDepth;
} catch { /* 無視 */ }
window.addEventListener("hashchange", () => { trackDepth(); show(); });
show();
