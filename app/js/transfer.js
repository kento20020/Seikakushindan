// 診断の引き継ぎ（iPhone の Safari ↔ ホーム画面のアプリ）。仕様：docs/app-screens.md §15.3・§15.10（決定 U37）
// iPhone では、ホーム画面のアプリと Safari（ほかのブラウザも）で保存（localStorage）が別なので、診断を1行の文字列（引き継ぎのコード）にして
// クリップボードで移す。DOM を使わない（Node のテストでも動く）。どこにも送らない（コードは端末のクリップボードと画面の欄を通るだけ）。
//
//   makeTransferCode({ compress })  … 今の診断・診断の記録・その印をコードにする → Promise<string | null>（移す物が無ければ null）
//   readTransferCode(text)          … 貼り付けた文字列を読む → Promise<{ ok: false } | { ok: true, data }>。例外を外に出さない
//   applyTransfer(data)             … 読めた中身（data）をこの端末に入れる → { ok, session, done, records, marks }
//   hasTransferable()               … 移せる物（結果・途中の回答・診断の記録）があるか（マイページのボタンを出すか）
//
// 入れる物：三択の診断（js/ui/three_store.js の保存 seikaku16:three:v1 のうち session と source だけ。1問以上答えたときだけ）、
//   24問の診断（js/ui/four_store.js の保存 seikaku16:four:v1。1問以上答えたときだけ。four。決定 U42）と、そのときだけ今の診断の版（active："v3" | "v4"）、
//   app/js/local.js の記録のうち kind が "diagnosis" のもの、その結果の key の印（marks：「違う」の印・ありそう／なさそう）
// 入れない物：相談の記録と下書き（seikaku16:app:consult-draft など。自由に書いた文なので移さない）、
//   テスト協力の記録（fb・fbMode）、5択版の保存（seikaku16:v1）
//
// コードの形：{ t: "seikaku16-move", v: 1, session?, source?, four?, active?, records: [...], marks: {...} } → JSON → UTF-8 →
//   four・active は U42 で足した（前の版のコードにも、前の版のアプリにも、そのまま通じる。前の版は four を読まないだけ）
//   縮める（CompressionStream の "deflate"＝zlib の形。iOS 16.4 から）→ base64url → 頭に "S16Z-"
//   縮められない環境では縮めずに base64url → 頭に "S16-"（どちらも読める）
//   "deflate-raw" ではなく "deflate" にしたのは、zlib の形には中身の確かめの数（Adler-32）が付いていて、
//   1文字でも変わったコードを「読めない」にできるため（deflate-raw だと、変わったまま読めてしまうことがある）
//   大きさ：ふつうの診断1回（80問）で、縮めて約4,100字（縮めないと約25,000字）
//
// 入れ方（applyTransfer）：診断は置き換える（three_store の adopt3、24問は four_store の adopt4。入っている版だけ）。
//   今の診断の版は active（無ければ、24問があれば v4、三択だけなら v3）にする。記録は結果の key（data.key）が同じものを足さない（at は元のまま）。
//   印はこの端末にまだ無い key だけ入れる（ある印は上書きしない）
import { store3, restore3, adopt3 } from "../../js/ui/three_store.js";
import { store4, restore4, adopt4, sanitizeSession4, progress4 } from "../../js/ui/four_store.js";
import { Session3 } from "../../js/adaptive3.js";
import { currentVersion, currentResult, setActiveVersion, isDiagnosisVersion } from "./diagnosis_version.js";
import { loadRecords, addRecord, getMarks, setMarks, validItem, MAX_ITEMS } from "./local.js";
import { resultKey } from "./summary.js";

export const CODE_TYPE = "seikaku16-move";
export const PREFIX = "S16-";       // 縮めていない
export const PREFIX_Z = "S16Z-";    // deflate（zlib の形）で縮めた
export const MAX_CODE = 200000;     // コード（空白を除いたあと）の長さの上限（字）
const MAX_INPUT = 1000000;          // 貼り付けた文字列そのものの上限（空白を除く前）
const MAX_JSON = 400000;            // 中身の JSON の上限（バイト。縮めた物を戻すときもここで止める）
const MAX_MARKS = 400;              // 印の key の数の上限
const MAX_KEY = 200;                // 印の key の長さの上限

const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const fail = () => ({ ok: false });

// ---------------------------------------------------------------- 集める
function cleanSource(src) {
  return isObj(src) && typeof src.type === "string" ? { ...src } : { type: "session", name: "あなたの回答" };
}

const isDiagRecord = (x) => validItem(x) && x.kind === "diagnosis" && isObj(x.data) && typeof x.data.key === "string" && !!x.data.key;

/** 今の端末から移す物を集める（DOM なし）。無ければ null */
function collect() {
  restore3();
  let session = null, source = null;
  try {
    const s = store3.session;
    if (s && (s.isDone() || s.progress().answered > 0)) {
      session = JSON.parse(JSON.stringify(s.toJSON()));
      source = cleanSource(store3.source);
    }
  } catch { session = null; source = null; }
  // 24問の診断（1問以上答えたとき）
  restore4();
  let four = null;
  try {
    if (store4.session && progress4(store4.session).answered > 0) four = JSON.parse(JSON.stringify(store4.session));
  } catch { four = null; }
  const records = loadRecords().items.filter(isDiagRecord)
    .map(({ id, kind, at, title, sub, data }) => ({ id, kind, at, title: title ?? "", sub: sub ?? "", data }));
  if (!session && !four && !records.length) return null;
  const keys = new Set(records.map(x => x.data.key));
  if (session && store3.result) { try { keys.add(resultKey(store3.result)); } catch { /* 印なしで続ける */ } }
  const marks = {};
  for (const k of keys) {
    const m = getMarks(k);
    if (isObj(m)) marks[k] = m;
  }
  // 今の診断の版は、24問の診断を入れるときだけ書く（三択だけのコードは前の版と同じ形のまま）
  let active = null;
  if (four) { try { active = currentVersion({ url: null }); } catch { active = null; } }
  return { t: CODE_TYPE, v: 1, ...(session ? { session, source } : {}), ...(four ? { four } : {}), ...(four && isDiagnosisVersion(active) ? { active } : {}), records, marks };
}

/** 移せる物（結果・途中の回答・診断の記録）があるか */
export function hasTransferable() {
  try { return collect() !== null; } catch { return false; }
}

// ---------------------------------------------------------------- 文字にする・戻す
function toB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null;
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ZIP = "deflate";   // zlib の形（確かめの数つき）

/** 縮める。使えない環境では null */
async function deflate(bytes) {
  try {
    if (typeof CompressionStream !== "function") return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(ZIP));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

/** 縮めた物を戻す。max バイトを超えたら止めて null（壊れている・確かめの数が合わない・使えない環境でも null） */
async function inflate(bytes, max) {
  if (typeof DecompressionStream !== "function") return null;
  let reader = null;
  try {
    reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(ZIP)).getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > max) { reader.cancel().catch(() => {}); return null; }
      parts.push(value);
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.byteLength; }
    return out;
  } catch {
    try { reader?.cancel().catch(() => {}); } catch { /* 無視 */ }
    return null;
  }
}

// ---------------------------------------------------------------- 作る
/**
 * 引き継ぎのコード → Promise<string | null>（移す物が無ければ null）
 *   compress: false で縮めない（テスト用。縮められない環境でも自動で縮めない形になる）
 */
export async function makeTransferCode({ compress = true } = {}) {
  const data = collect();
  if (!data) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (compress) {
    const z = await deflate(bytes);
    if (z) return PREFIX_Z + toB64url(z);
  }
  return PREFIX + toB64url(bytes);
}

// ---------------------------------------------------------------- 読む
/** 中身の形を確かめ、使う物だけの写しを返す。だめなら null */
function check(o) {
  if (!isObj(o) || o.t !== CODE_TYPE || o.v !== 1) return null;
  let session = null, source = null;
  if (o.session != null) {
    if (!isObj(o.session)) return null;
    const s = Session3.fromJSON(o.session);   // 形が違えば投げる（呼ぶ側で ok: false）
    if (s.isDone()) s.result();               // 結果まで作れること
    session = o.session;
    source = cleanSource(o.source);
  }
  let four = null;
  if (o.four != null) {
    four = sanitizeSession4(o.four);   // 24問の保存の形でなければ、コードごと読めない
    if (!four) return null;
  }
  const active = isDiagnosisVersion(o.active) ? o.active : null;
  const records = o.records == null ? [] : o.records;
  if (!Array.isArray(records) || records.length > MAX_ITEMS || !records.every(isDiagRecord)) return null;
  const marks = o.marks == null ? {} : o.marks;
  if (!isObj(marks)) return null;
  const entries = Object.entries(marks);
  if (entries.length > MAX_MARKS || !entries.every(([k, m]) => k && k.length <= MAX_KEY && isObj(m))) return null;
  if (!session && !four && !records.length) return null;
  return {
    ...(session ? { session, source } : {}),
    ...(four ? { four } : {}),
    ...(active ? { active } : {}),
    records: records.map(({ id, kind, at, title, sub, data }) => ({
      id, kind, at,
      title: typeof title === "string" ? title : "",
      sub: typeof sub === "string" ? sub : "",
      data,
    })),
    marks: Object.fromEntries(entries),
  };
}

/**
 * 貼り付けた文字列を読む → Promise<{ ok: false } | { ok: true, data }>
 *   前後の空白・改行・途中の空白（全角も）を取り除いてから読む。頭の文字・base64url・縮めた物・JSON・中身の形・大きさを確かめる
 *   data = { session?, source?, records: [...], marks: {...} }（applyTransfer に渡す）
 */
export async function readTransferCode(text) {
  try {
    if (typeof text !== "string" || !text || text.length > MAX_INPUT) return fail();
    const code = text.replace(/\s+/g, "");
    let body, zipped;
    if (code.startsWith(PREFIX_Z)) { zipped = true; body = code.slice(PREFIX_Z.length); }
    else if (code.startsWith(PREFIX)) { zipped = false; body = code.slice(PREFIX.length); }
    else return fail();
    if (!body || body.length > MAX_CODE) return fail();
    let bytes = fromB64url(body);
    if (!bytes) return fail();
    if (zipped) {
      bytes = await inflate(bytes, MAX_JSON);
      if (!bytes) return fail();
    } else if (bytes.length > MAX_JSON) return fail();
    const data = check(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    return data ? { ok: true, data } : fail();
  } catch {
    return fail();
  }
}

// ---------------------------------------------------------------- 入れる
/**
 * 読めた中身をこの端末に入れる → { ok, session: 診断を置き換えたか, done: 結果まであるか, records: 足した記録の数, marks: 入れた印の数 }
 *   診断（session）があれば置き換える。記録は結果の key が同じものを足さない。印はこの端末にまだ無い key だけ
 */
export function applyTransfer(data) {
  const out = { ok: false, session: false, done: false, records: 0, marks: 0 };
  if (!isObj(data)) return out;
  restore3();   // 先に読んでおく（あとで restore3 が古い保存で上書きしないように）
  restore4();
  if (data.session) {
    try { adopt3(data.session, data.source); } catch { return out; }
    out.session = true;
  }
  if (data.four) {
    try { adopt4(data.four); } catch { return out; }
    out.session = true;
  }
  if (out.session) {
    // 今の診断の版：コードの active（その版が入っていれば）＞ 24問があれば v4 ＞ 三択
    const want = isDiagnosisVersion(data.active) && ((data.active === "v4" && data.four) || (data.active === "v3" && data.session)) ? data.active : data.four ? "v4" : "v3";
    setActiveVersion(want);
  }
  out.done = !!currentResult({ url: null });
  const have = new Set(loadRecords().items.filter(x => x.kind === "diagnosis").map(x => x.data?.key).filter(Boolean));
  for (const r of Array.isArray(data.records) ? data.records : []) {
    const key = r?.data?.key;
    if (!key || have.has(key)) continue;
    if (addRecord({ kind: "diagnosis", at: r.at, title: r.title, sub: r.sub, data: r.data })) { have.add(key); out.records++; }
  }
  for (const [k, m] of Object.entries(isObj(data.marks) ? data.marks : {})) {
    if (getMarks(k) != null) continue;
    if (setMarks(k, m)) out.marks++;
  }
  out.ok = true;
  return out;
}
