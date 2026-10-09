// admin.html の小さな DOM 道具。参加者が書いた文字列は必ず textContent（テキストノード）で入れる（innerHTML は使わない）

/** h("div", {class:"x", onclick: fn}, "文字", [子…], node) */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else if (k instanceof Node) el.append(k);
    else el.append(document.createTextNode(String(k)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** クリップボードへ。権限がなければ旧式の選択コピーで */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallthrough */ }
  const ta = h("textarea", { readonly: true, "aria-hidden": "true", style: { position: "fixed", opacity: "0", left: "-9999px" } });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** ファイルとして保存（bom=true で UTF-8 BOM 付き。Excel で開くとき用） */
export function downloadText(filename, text, { bom = false, type = "text/plain" } = {}) {
  const blob = new Blob([bom ? "﻿" : "", text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** localStorage（使えない環境でも落ちない） */
export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};
