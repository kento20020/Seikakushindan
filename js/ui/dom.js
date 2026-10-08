// 画面づくりの小さな道具。文字列は textContent で入れる（innerHTML は設計書の Markdown 描画だけで使う）。

/**
 * 要素をつくる。h("p", {class: "x", onclick: fn}, "文字", h("b", null, "太字"))
 *   attrs: class / text / dataset / style(object) / on〜(関数) / hidden(真偽) / その他は setAttribute
 *   children: 文字列・数値・Node・配列（入れ子可）。null/undefined/false は無視
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = Array.isArray(v) ? v.filter(Boolean).join(" ") : v;
      else if (k === "text") el.textContent = v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

/** 中身を入れ替える */
export function mount(el, ...children) { el.replaceChildren(); append(el, children); return el; }

/** 数値の表示（整数ならそのまま、そうでなければ小数 digits 桁） */
export function num(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(digits);
}
export const pct = (v) => v == null ? "—" : `${Math.round(v * 100)}%`;
export const signed = (v, digits = 1) => v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "±") + num(Math.abs(v), digits);

/** 表（ヘッダー配列と行配列）。横に長い表は .table-wrap の中だけでスクロールさせる */
export function table(headers, rows, attrs = {}) {
  return h("div", { class: "table-wrap" },
    h("table", attrs,
      h("thead", null, h("tr", null, headers.map(x => h("th", { scope: "col" }, x)))),
      h("tbody", null, rows)));
}

/** 一時的なお知らせ（コピー完了など） */
export function toast(message) {
  let el = document.getElementById("toast");
  if (!el) { el = h("div", { id: "toast", class: "toast", role: "status", "aria-live": "polite" }); document.body.append(el); }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

/** ファイルとして保存させる */
export function download(filename, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** クリップボードへコピー。使えない環境では選択状態のテキストエリアで代用 */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = h("textarea", { style: { position: "fixed", opacity: "0", left: "0", top: "0" } });
    ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove(); return ok;
  }
}
