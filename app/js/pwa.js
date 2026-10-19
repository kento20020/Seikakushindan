// アプリとして使う（PWA。Android・iPhone）。仕様：docs/app-screens.md §15（iPhone は §15.10。決定 U35・U37）
//   initPwa()          … main.js が起動時に1回呼ぶ。service worker（app/sw.js）を登録し、インストールの案内に要るできごとを受け取る
//   installState(env)  … 今の状態を返す（DOM なし。テストできる形）
//   isIos(env)         … iPhone・iPad・iPod か（DOM なし。iPad の Safari は Mac の UA なので、指で触れる点の数で見分ける）
//   currentInstallState() / currentPlatform() / promptInstall() … マイページ（mypage.js）の「アプリとして使う」が使う
//   deviceKind(env) / currentDevice() / currentStandalone() … 端末の種類（"ios" | "android" | "other"）とホーム画面のアプリか。
//     マイページの「ホーム画面で使うのをやめるには」の並びと、お問い合わせ（contact.js）の端末の種類が使う（決定 U39）
//   PWA_EVENT          … 状態が変わったら window に出すできごと（detail.reason："prompt" | "installed" | "dismissed"）
// 対応していない・失敗しても、画面はふつうに動く（console.error は出さない）
export const PWA_EVENT = "a-pwa-change";

// アプリの中のブラウザ（LINE・Instagram・Facebook・TikTok・カカオトーク、Android の WebView）。ここからはホーム画面に追加できない
const IN_APP_RE = /\sLine\/|FBAN|FBAV|FB_IAB|Instagram|BytedanceWebview|musical_ly|KAKAOTALK|;\s?wv\)/;
const IOS_RE = /iPhone|iPad|iPod/;
// iPhone・iPad の Safari 以外のブラウザ（Chrome・Firefox・Edge・Opera）。iOS 16.4 から、どれも共有ボタンからホーム画面に追加できる
const IOS_OTHER_RE = /CriOS|FxiOS|EdgiOS|OPiOS/;

/**
 * iPhone・iPad・iPod か（DOM なし）
 *   ua に iPhone・iPad・iPod を含む、または Macintosh で touch（指で触れる点の数）が 2 以上（iPad の Safari は Mac の UA を名のる）
 */
export function isIos({ ua = "", touch = 0 } = {}) {
  const s = String(ua || "");
  return IOS_RE.test(s) || (/Macintosh/.test(s) && touch > 1);
}

/**
 * インストールの状態（上から順に当てはめる）
 *   "installed" … ホーム画面のアプリとして開いている（standalone）。iPhone のホーム画面のアプリもここ
 *   "added"     … この画面から追加し終わった（このタブはブラウザのまま）
 *   "prompt"    … ボタンで追加できる（Chrome の beforeinstallprompt を受け取った）
 *   "line"      … LINE などアプリの中のブラウザ（iPhone でも）
 *   "ios-other" … iPhone・iPad の Safari 以外のブラウザ（UA に CriOS・FxiOS・EdgiOS・OPiOS）。共有ボタンから追加（iOS 16.4 から）
 *   "ios"       … iPhone・iPad の Safari（共有ボタンから追加）。iPad の Safari は Mac の UA なので、isIos と同じく touch で見分ける
 *   "menu"      … それ以外（Chrome のメニューから）
 */
export function installState({ standalone = false, added = false, hasPrompt = false, ua = "", touch = 0 } = {}) {
  if (standalone) return "installed";
  if (added) return "added";
  if (hasPrompt) return "prompt";
  const s = String(ua || "");
  if (IN_APP_RE.test(s)) return "line";
  if (isIos({ ua: s, touch })) return IOS_OTHER_RE.test(s) ? "ios-other" : "ios";
  return "menu";
}

let deferred = null;   // beforeinstallprompt のできごと（prompt() は1回だけ使える）
let added = false;
let started = false;

function isStandalone() {
  try {
    return window.matchMedia("(display-mode: standalone)").matches
      || window.matchMedia("(display-mode: fullscreen)").matches
      || window.navigator.standalone === true;
  } catch { return false; }
}

/** 今の端末での状態 */
export function currentInstallState() {
  if (typeof window === "undefined") return "menu";
  return installState({
    standalone: isStandalone(),
    added,
    hasPrompt: !!deferred,
    ua: navigator.userAgent,
    touch: navigator.maxTouchPoints || 0,
  });
}

/** 今の端末："ios"（iPhone・iPad。ホーム画面のアプリと Safari で保存が別）| "other"（Android・PC など） */
export function currentPlatform() {
  try {
    if (typeof navigator === "undefined") return "other";
    return isIos({ ua: navigator.userAgent, touch: navigator.maxTouchPoints || 0 }) ? "ios" : "other";
  } catch { return "other"; }
}

/**
 * 端末の種類（DOM なし）："ios"（iPhone・iPad。isIos と同じ見分け方）| "android"（UA に Android）| "other"（パソコンなど）
 *   currentPlatform は "ios" | "other" の2つだけなので、Android とパソコンを分けたいときはこちら（U39）
 */
export function deviceKind({ ua = "", touch = 0 } = {}) {
  const s = String(ua || "");
  if (isIos({ ua: s, touch })) return "ios";
  return /Android/i.test(s) ? "android" : "other";
}

/** 今の端末の deviceKind。iPhone かどうかは currentPlatform と同じ */
export function currentDevice() {
  try {
    if (typeof navigator === "undefined") return "other";
    return deviceKind({ ua: navigator.userAgent, touch: navigator.maxTouchPoints || 0 });
  } catch { return "other"; }
}

/** ホーム画面のアプリとして開いているか（standalone・fullscreen・iPhone の navigator.standalone） */
export function currentStandalone() {
  return typeof window !== "undefined" && isStandalone();
}

function notify(reason) {
  try { window.dispatchEvent(new CustomEvent(PWA_EVENT, { detail: { reason, state: currentInstallState() } })); } catch { /* 無視 */ }
}

/** 追加の確かめを出す。返り値："accepted" | "dismissed" | "unavailable" */
export async function promptInstall() {
  const ev = deferred;
  if (!ev) { notify("dismissed"); return "unavailable"; }
  deferred = null;   // 同じできごとは2回使えない
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    const outcome = choice?.outcome === "accepted" ? "accepted" : "dismissed";
    if (outcome === "dismissed") notify("dismissed");
    return outcome;   // accepted のときは appinstalled が来て知らせる
  } catch (err) {
    console.warn("ホーム画面への追加を出せませんでした", err);
    notify("dismissed");
    return "unavailable";
  }
}

/** 起動時に1回。service worker の登録と、インストールのできごと */
export function initPwa() {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();   // ブラウザの小さな案内は出さず、マイページのボタンから出す
    deferred = e;
    notify("prompt");
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    added = true;
    notify("installed");
  });

  if (!("serviceWorker" in navigator)) return;
  // 読み込んだ物の記録（warm で使う）があふれないように広げる（既定は 250 件）
  try { performance.setResourceTimingBufferSize?.(1000); } catch { /* 無視 */ }
  // 読み込みが済んでから登録する（最初の表示を遅くしないため）
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

async function register() {
  try {
    // 場所はこのファイルから見て決める（app/sw.js。効く範囲は app/ の下）。公開先（/Seikakushindan/app/）でも手元（/app/）でも同じ
    await navigator.serviceWorker.register(new URL("../sw.js", import.meta.url), { scope: new URL("../", import.meta.url).pathname });
    const reg = await navigator.serviceWorker.ready;
    warm(reg);
    navigator.serviceWorker.addEventListener("controllerchange", () => warm(reg), { once: true });
  } catch (err) {
    console.warn("service worker を登録できませんでした（画面はふつうに動きます）", err);
  }
}

/** 登録より前に読み込んだ物（../js/ のモジュールなど）を、service worker に知らせて保存してもらう（つながらないときにも開けるように） */
function warm(reg) {
  try {
    const urls = [location.href.split("#")[0]];
    for (const e of performance.getEntriesByType("resource")) {
      if (e.name.startsWith(location.origin + "/")) urls.push(e.name.split("#")[0]);
    }
    (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: "warm", urls: [...new Set(urls)] });
  } catch { /* 保存できなくても画面は動く */ }
}
