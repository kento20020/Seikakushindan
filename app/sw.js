// app/sw.js — 新しい画面（app/）の service worker。仕様：docs/app-screens.md §15（PWA。Android）
// 効く範囲は app/ の下（登録は app/js/pwa.js。scope は app/）。今の画面（/#three など）には効かない。
//
// 方針：ネットにつながっていれば、いつも新しいものを使う（network-first）。古い版が残って画面が壊れるのを防ぐため。
//   つながらないときだけ、保存した物を返す。
//   - 同じオリジンの GET（app/ の HTML・CSS・JS、../js/ の共有モジュール、../img/ の絵など）… network-first。取れたら保存する
//   - 画面の移動（navigate）… network-first → 保存した同じページ → 保存した ./（index.html。app/ の入口のときだけ）→ その場で作る「つながっていません」の画面
//   - Google Fonts … fonts.gstatic.com（文字の形）は cache-first、fonts.googleapis.com（CSS）は stale-while-revalidate
//   - それ以外のオリジン・GET 以外は触らない（そのまま通す）
//   - install で最低限の殻（SHELL）を先に保存する。1つ欠けても install は失敗させない
//   - 画面（pwa.js）が「もう読み込んだ物の一覧」を送ってくるので、それも保存する（登録より前に読んだ ../js/ などを、つながらないときにも使えるように）
//   - 中身を変えたら VERSION を1つ上げる（activate で古い保存を消す）
//
// 止め方（不具合のときに、利用者の端末から service worker と保存を消す）
//   このファイルの中身をすべて、下の数行に差し替えて公開する（ファイルの名前と場所は変えない）。
//   ブラウザは開くたびに sw.js の新しい版を確かめるので、次に app/ を開いたときに入れ替わり、
//   自分を登録解除して保存を消し、開いている画面を読み込み直す（そのあとは service worker なしで、ふつうのページとして動く）。
//   pwa.js の register の行は残してよい（止めた版が入るだけ）。止めたままにするなら register の行も消す。
//
//     self.addEventListener("install", () => self.skipWaiting());
//     self.addEventListener("activate", (event) => {
//       event.waitUntil((async () => {
//         for (const key of await caches.keys()) if (key.startsWith("seikaku16-app-")) await caches.delete(key);
//         await self.registration.unregister();
//         for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
//       })());
//     });

const VERSION = "v1";
const PREFIX = "seikaku16-app-";
const CACHE = `${PREFIX}${VERSION}`;              // 同じオリジンの物
const FONT_CACHE = `${PREFIX}fonts-${VERSION}`;   // Google Fonts
const FONT_MAX = 160;                             // 文字の形の保存の上限（日本語は細かく分かれて届くため。古い順に消す）

// 最低限の殻（app/ からの相対パス）。ここに無い物も、開いたときに保存される
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./css/diagnose.css",
  "./css/consult.css",
  "./js/main.js",
  "./js/ui.js",
  "./js/pwa.js",
  "./js/home.js",
  "./js/help.js",              // 窓口のページ（#help。決定 U47）。つながらないときにも開けるように
  "./js/safety.js",
  "../js/consult/texts.js",    // safety.js が読む窓口の一覧（SAFETY_RESOURCES）
  "./img/pwa/icon-192.png",
];

const here = (path) => new URL(path, self.location.href).href;
// 保存してよい同じオリジンの返事（転送のあとの物は、画面の移動に使うと失敗するので保存しない）
const keepable = (res) => res.ok && res.type === "basic" && !res.redirected;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (path) => {
      try {
        const res = await fetch(here(path), { cache: "no-cache" });
        if (keepable(res)) await cache.put(here(path), res);
      } catch { /* 1つ欠けても入る（開いたときに保存される） */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE && key !== FONT_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(req.mode === "navigate" ? navigate(event) : networkFirst(event));
  } else if (url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(event));
  } else if (url.hostname === "fonts.googleapis.com") {
    event.respondWith(staleWhileRevalidate(event));
  }
  // それ以外のオリジンは触らない
});

// 画面（pwa.js）から「もう読み込んだ物の一覧」が届いたら、まだ保存していない同じオリジンの物を保存する
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "warm" || !Array.isArray(data.urls)) return;
  event.waitUntil(warm(data.urls.slice(0, 400)));
});

// ---------------------------------------------------------------- 取り方
/** 同じオリジンの物：ネット → 取れなければ保存した物 */
async function networkFirst(event) {
  const req = event.request;
  try {
    const res = await fetch(req);
    if (keepable(res)) event.waitUntil(put(CACHE, req, res.clone()));
    return res;
  } catch {
    return (await caches.match(req, { ignoreVary: true })) || Response.error();
  }
}

/**
 * 画面の移動：ネット → 保存した同じページ → 保存した ./（index.html）→ 「つながっていません」
 *   ./ の代わりに出すのは app/ の入口（./ と ./index.html）への移動だけ。ほかの場所（絵を直に開いたなど）で出すと、相対パスがずれて崩れるため
 */
async function navigate(event) {
  const req = event.request;
  try {
    const res = await fetch(req);
    if (keepable(res)) event.waitUntil(put(CACHE, req, res.clone()));
    return res;
  } catch {
    const path = new URL(req.url).pathname;
    const entry = path === new URL(here("./")).pathname || path === new URL(here("./index.html")).pathname;
    const hit = await caches.match(req, { ignoreSearch: true, ignoreVary: true })
      || (entry && (await caches.match(here("./"), { ignoreVary: true }) || await caches.match(here("./index.html"), { ignoreVary: true })));
    return hit || offlinePage();
  }
}

/** Google Fonts の文字の形：保存した物 → 無ければネット（URL ごとに中身が変わらないため） */
async function cacheFirst(event) {
  const req = event.request;
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === "opaque") event.waitUntil(put(FONT_CACHE, req, res.clone(), FONT_MAX));
    return res;
  } catch {
    return Response.error();   // 文字は手元の明朝・serif で出る
  }
}

/** Google Fonts の CSS：保存した物をすぐ返し、裏でネットから新しくする。保存が無ければネット */
async function staleWhileRevalidate(event) {
  const req = event.request;
  const hit = await caches.match(req);
  const fresh = fetch(req).then((res) => {
    if (res.ok || res.type === "opaque") event.waitUntil(put(FONT_CACHE, req, res.clone(), FONT_MAX));
    return res;
  });
  if (hit) {
    event.waitUntil(fresh.catch(() => null));
    return hit;
  }
  return fresh.catch(() => Response.error());
}

async function put(name, req, res, max = 0) {
  try {
    const cache = await caches.open(name);
    await cache.put(req, res);
    if (max > 0) {
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(old);
    }
  } catch { /* 保存できなくても画面は動く（容量が足りないときなど） */ }
}

async function warm(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(urls.map(async (raw) => {
    let url;
    try { url = new URL(String(raw), self.location.href); } catch { return; }
    if (url.origin !== self.location.origin || url.pathname.endsWith("/sw.js")) return;
    url.hash = "";
    try {
      if (await cache.match(url.href, { ignoreVary: true })) return;
      const res = await fetch(url.href);
      if (keepable(res)) await cache.put(url.href, res);
    } catch { /* 取れない物は飛ばす */ }
  }));
}

// ---------------------------------------------------------------- つながっていません
//   危ないときの番号（決定 U47）：110・119 と、窓口のページ（#help）と同じ3つの窓口。service worker はモジュールを読めないので文字で持つ。
//   番号は js/consult/texts.js の SAFETY_RESOURCES と同じであること（tests/app_safety.test.mjs で突き合わせる）。電話はネットが無くてもかけられるので tel: のリンクにする
function offlinePage() {
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#ECE6DE">
<title>つながっていません｜喧嘩の答え</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&amp;display=swap">
<style>
  html, body { margin: 0; background: #ECE6DE; color: #2A2733; }
  body { min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px 20px; box-sizing: border-box;
    font-family: "Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif; font-weight: 500; letter-spacing: 0.04em; }
  main { width: 100%; max-width: 440px; background: #F8F3EE; border-radius: 20px; padding: 32px 24px; box-sizing: border-box;
    box-shadow: 0 1px 2px rgb(42 39 51 / 0.06), 0 8px 24px -12px rgb(42 39 51 / 0.12); text-align: center; }
  h1 { margin: 0 0 12px; font-size: 21px; line-height: 1.6; letter-spacing: 0.08em; }
  p { margin: 0; font-size: 15px; line-height: 1.9; color: #4A4652; }
  button { margin-top: 24px; min-height: 52px; width: 100%; border: 0; border-radius: 999px; background: #A15E58; color: #fff;
    font: inherit; font-size: 16px; letter-spacing: 0.1em; cursor: pointer; }
  button:focus-visible { outline: 3px solid #8C5049; outline-offset: 3px; }
  .help { margin-top: 28px; padding-top: 20px; border-top: 1px solid #E2D8CF; text-align: left; }
  .help h2 { margin: 0 0 8px; font-size: 15px; line-height: 1.7; letter-spacing: 0.08em; }
  .help p, .help li { font-size: 14px; line-height: 1.8; color: #4A4652; }
  .help ul { margin: 8px 0 0; padding: 0 0 0 1.2em; }
  .help a { color: #8C5049; letter-spacing: 0.04em; white-space: nowrap; text-underline-offset: 0.2em; }
  .help a:focus-visible { outline: 3px solid #8C5049; outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <h1>インターネットに<br>つながっていません</h1>
  <p>この画面はまだ端末に保存されていないため、開けませんでした。つながってから、もう一度読み込んでください。</p>
  <button type="button" onclick="location.reload()">再読み込みする</button>
  <section class="help" aria-labelledby="help-h">
    <h2 id="help-h">危ないときは</h2>
    <p>いま危ないと感じたら、<a href="tel:110">110番</a>（警察）か<a href="tel:119">119番</a>（救急）に電話してください。</p>
    <ul>
      <li>DV相談＋：<a href="tel:0120279889">0120-279-889</a>（24時間）</li>
      <li>DV相談ナビ：<a href="tel:%238008">#8008</a></li>
      <li>よりそいホットライン：<a href="tel:0120279338">0120-279-338</a>（24時間）</li>
    </ul>
  </section>
</main>
</body>
</html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
