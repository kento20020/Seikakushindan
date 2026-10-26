// app/ の入口。ハッシュで画面を切り替える。仕様：docs/app-screens.md §6.1
//
// 画面の約束（各画面のモジュール）
//   export function render(root, route) { ... }   root は空の <main>。中身を足して返す
//     片付けの関数を返してよい（画面を替えるときに呼ぶ。document や window に付けたものを外す）。Promise を返してもよい
//   route = { key, name, parts, params, hash }
//     key    … 画面の名前（"home" "diagnose" "diagnose/q" "result" "consult" "account" "history" "mypage" "images" "types" "contact" "help"）
//     name   … ハッシュの1つ目（"diagnose" など）。parts … "/" で分けた全部、params … 2つ目から（"#history/abc" → ["abc"]）
//   画面を替えたら、先頭へスクロールし、焦点を見出しへ移す（root の [data-focus]、無ければ最初の h1）
//   下のタブはホーム・履歴・マイページだけ（main.js が出す）。ほかの画面は ui.js の topBar で「← 題」を出す
//   知らないハッシュはホーム
//   起動時に pwa.js の initPwa()（service worker の登録とインストールの案内。§15）
//   共有のリンク（?from=share。決定 U45。app/js/share.js）：起動したときに読み、このタブの印（sessionStorage）を付けて、URL から from だけを外す
//     （受け取った人がさらにコピーしたり、ホーム画面に追加したりしたときに印が残らないように。ほかのクエリ〔?dv= など〕・ハッシュ・history.state は残す）。
//     印があって診断がまだ終わっていなければ、ホームの並びを変える（home.js）
//   診断の版（決定 U42。app/js/diagnosis_version.js）：#diagnose は新しく始める版（?dv= ＞ 既定 v4）、#diagnose/q・#result は今の診断の版で、
//     v4 なら diagnose4.js・result4.js、v3 なら今までの diagnose.js・result.js を読む
//   相談の形（決定 U51・U55。app/js/consult_version.js）：#consult は ?cv= ＞ 既定 talk で、talk ならふつうのチャットの形 consult_talk.js、
//     chat ならボタンつきのチャットの形 consult_chat.js、card なら段階ごとの consult.js を読む
import { tabBar } from "./ui.js";
import { initPwa } from "./pwa.js";
import { currentVersion, newDiagnosisVersion } from "./diagnosis_version.js";
import { consultVersion } from "./consult_version.js";
import { readFromShare, markFromShare } from "./share.js";

const SITE = "喧嘩の答え";   // サービス名（決定 U43）。タブの題は「喧嘩の答え（試作）」・「画面の題｜喧嘩の答え（試作）」
const ROUTES = {
  home: { load: () => import("./home.js"), tab: "home", title: "ホーム" },
  diagnose: { load: () => (newDiagnosisVersion() === "v4" ? import("./diagnose4.js") : import("./diagnose.js")), title: "診断" },
  "diagnose/q": { load: () => (currentVersion() === "v4" ? import("./diagnose4.js") : import("./diagnose.js")), title: "診断" },
  result: { load: () => (currentVersion() === "v4" ? import("./result4.js") : import("./result.js")), title: "診断結果" },
  consult: { load: () => { const v = consultVersion(); return v === "card" ? import("./consult.js") : v === "chat" ? import("./consult_chat.js") : import("./consult_talk.js"); }, title: "相談" },
  account: { load: () => import("./account.js"), title: "アカウント" },
  history: { load: () => import("./history.js"), tab: "history", title: "履歴" },
  mypage: { load: () => import("./mypage.js"), tab: "mypage", title: "マイページ" },
  images: { load: () => import("./images.js"), title: "診断結果の絵" },   // 診断結果の絵の一覧（§14）
  types: { load: () => import("./types.js"), title: "診断結果の一覧" },   // 診断結果の一覧（8軸×3のタイプ図鑑。§16）
  contact: { load: () => import("./contact.js"), title: "お問い合わせ" },   // お問い合わせ（今はメールのアプリで送る。Google フォームを入れればフォームへ。§17）
  help: { load: () => import("./help.js"), title: "危ないときは" },   // 窓口のページ（110・119 と相談できる窓口。履歴に残さない。§23。決定 U47）
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
  const p = document.createElement("p");
  // つながっていないとき（アプリとして開いて、まだ端末に保存していない画面へ移ったときなど）は、そう伝える
  if (navigator.onLine === false) {
    h1.textContent = "インターネットにつながっていません";
    p.textContent = "この画面はまだ端末に保存されていないため、開けませんでした。つながってから、もう一度開いてください。";
  } else {
    h1.textContent = "画面を表示できませんでした";
    p.textContent = `読み込みなおすと直ることがあります。（${err?.message || err}）`;
  }
  // ホーム画面のアプリにはブラウザの「戻る」が無いので、ホームへのリンクを置く
  const home = document.createElement("p");
  home.className = "a-error-home";
  const a = document.createElement("a");
  a.className = "a-link a-link-tap";
  a.href = "#home";
  a.textContent = "ホームへ戻る";
  home.append(a);
  box.append(h1, p, home);
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

// 共有のリンクから来た（?from=share）：印を付けて、URL から from を外す（下の aDepth より前に）
try {
  const got = readFromShare(location.href);
  if (got.shared) {
    markFromShare();
    history.replaceState(history.state, "", got.href);
  }
} catch { /* 無視（印が付かなくても、いつものホームで動く） */ }

try {
  if (!(history.state && typeof history.state.aDepth === "number")) history.replaceState({ ...(history.state || {}), aDepth: 0 }, "");
  else depth = history.state.aDepth;
} catch { /* 無視 */ }
window.addEventListener("hashchange", () => { trackDepth(); show(); });
show();
initPwa();
