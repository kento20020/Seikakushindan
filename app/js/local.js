// 端末の中の記録（app/ の履歴と、結果の「違う」の印・ありそう／なさそう）。仕様：docs/app-screens.md §6.3
// DOM を使わない。どこにも送らない。localStorage が使えないときも画面は動く（記録しないだけ。読むと空）。
// 保存の形（キー seikaku16:app:v1）：{ v: 1, items: [記録…（新しい順）], marks: { 結果の key: 印 } }
//   記録：{ id, kind: "diagnosis" | "consult", at: ISO の日時（UTC）, title, sub, data }
//   診断の記録は data.key（app/js/summary.js の resultKey(result)）が同じなら2回足さない
// テストでは useStorage(差し替えの入れ物) で localStorage の代わりを渡す（getItem・setItem・removeItem があればよい）

export const STORAGE_KEY = "seikaku16:app:v1";
export const KINDS = Object.freeze(["diagnosis", "consult"]);
export const MAX_ITEMS = 200;      // これより古い記録は消える
const MAX_TEXT = 400;              // title・sub の長さの上限（文字）

let injected = null;
/** 入れ物を差し替える（テスト用）。null で既定（globalThis.localStorage）に戻す */
export function useStorage(storage) { injected = storage ?? null; }

function storage() {
  if (injected) return injected;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

const empty = () => ({ v: 1, items: [], marks: {} });
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);

function validItem(x) {
  return isObj(x) && typeof x.id === "string" && KINDS.includes(x.kind) && typeof x.at === "string" && !Number.isNaN(Date.parse(x.at));
}

function read() {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const d = JSON.parse(raw);
    if (!isObj(d)) return empty();
    return {
      v: 1,
      items: Array.isArray(d.items) ? d.items.filter(validItem) : [],
      marks: isObj(d.marks) ? d.marks : {},
    };
  } catch {
    return empty();
  }
}

function write(d) {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(STORAGE_KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

const byNewest = (a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

function toIso(at) {
  if (at == null) return new Date().toISOString();
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const text = (v) => (v == null ? "" : String(v)).trim().slice(0, MAX_TEXT);

let seq = 0;
function newId() {
  seq = (seq + 1) % 1e6;
  return `r${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------- 記録
/** 記録の一覧 { items: [...] }（新しい順）。中身は写しなので、直しても保存には影響しない */
export function loadRecords() {
  const d = read();
  return { items: d.items.slice().sort(byNewest).map(x => ({ ...x })) };
}

/** id の記録（無ければ null） */
export function getRecord(id) {
  return loadRecords().items.find(x => x.id === id) ?? null;
}

/**
 * 記録を1件足す → id。足せなかった（保存できない・形が違う）ときは null
 *   kind: "diagnosis" | "consult"、at: 日時（Date・数・文字列。省略で今）、title・sub: 文、data: JSON にできる値
 *   診断は data.key が同じ記録があれば足さず、その id を返す
 */
export function addRecord({ kind, at, title, sub, data } = {}) {
  if (!KINDS.includes(kind)) return null;
  const d = read();
  const key = kind === "diagnosis" && isObj(data) && typeof data.key === "string" && data.key ? data.key : null;
  if (key) {
    const same = d.items.find(x => x.kind === "diagnosis" && x.data?.key === key);
    if (same) return same.id;
  }
  let payload = null;
  try { payload = data === undefined ? null : JSON.parse(JSON.stringify(data)); } catch { return null; }
  const item = { id: newId(), kind, at: toIso(at), title: text(title), sub: text(sub), data: payload };
  d.items = [item, ...d.items].sort(byNewest).slice(0, MAX_ITEMS);
  return write(d) ? item.id : null;
}

/** 1件消す → 消せたか */
export function removeRecord(id) {
  const d = read();
  const n = d.items.length;
  d.items = d.items.filter(x => x.id !== id);
  return d.items.length !== n && write(d);
}

/** 記録をすべて消す（結果の印は残す）→ 消せたか */
export function clearRecords() {
  const d = read();
  d.items = [];
  return write(d);
}

/** この端末の app/ の記録をすべて消す（記録と結果の印）→ 消せたか */
export function clearAll() {
  try {
    const s = storage();
    if (!s) return false;
    s.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 結果の印（「違う」の印・ありそう／なさそう）
/** 結果ごとの印（key は結果の key。summary.js の resultKey）。無ければ null。中身の形は結果の画面が決める */
export function getMarks(key) {
  const m = read().marks[String(key)];
  return m === undefined ? null : JSON.parse(JSON.stringify(m));
}

/** 印を保存する（marks が null・undefined なら消す）→ 保存できたか */
export function setMarks(key, marks) {
  const d = read();
  const k = String(key);
  if (marks == null) delete d.marks[k];
  else {
    try { d.marks[k] = JSON.parse(JSON.stringify(marks)); } catch { return false; }
  }
  return write(d);
}
