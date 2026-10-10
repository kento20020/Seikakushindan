// テスト協力モードの集計（admin.html）の純粋ロジック。DOM に触らない（node でテストできる）。仕様：docs/feedback-spec.md §3
//
// 入口は analyze(text, { includeRetests })。貼り付けテキスト → 読み込み → 各表のモデルを1つのオブジェクトで返す。
//   - 同じ人（code）の再検査は、既定では「集計対象から外す」（同じ人を二重に数えないため）。参加者一覧と再検査の比較には出る。
//   - 「人数」は code（正規化したもの）の種類で数える。同じ人の2回分が混ざっても 1人。

import { decodeAll, FB_TAG } from "../feedback_format.js";
import { QUESTIONS3 } from "../data/questions3.js";
import { ITEM3, SRC_LABEL, ROUND_USE, bankFor } from "../adaptive3.js";
import { THREE_VERSIONS, isVersion, versionFromBank, scenesFor, scenesChanged } from "../three_version.js";
import { DOMAINS, STATE_LABEL, LEFT_RATE_HIGH, LEFT_RATE_LOW } from "../engine3.js";
import { PATTERN_BY_ID } from "../data/patterns.js";

// ---------------------------------------------------------------- 閾値（5人規模の目安。疑う対象を探すためのもので、判定ではない）
export const REVIEW = {
  flagPeople: 2,              // 一言（none/both/scene/words）を付けた人数がこれ以上
  swapPeople: 2,              // 差し替えた人数がこれ以上
  hardNonOkPeople: 2,         // 振り返りで ok 以外（迷った）を選んだ人数がこれ以上
  oneSidedMinN: 4,            // 「全員が同じ側」と言うために必要な W の回答数
  timeRatio: 2,               // 設問の回答時間の中央値が、全設問の中央値のこの倍数を超えたら
  timeMinN: 3,                // 回答時間の比較に必要な標本数
  domainBothMismatchPeople: 2,// 領域で self と act の両方が診断と食い違った人数がこれ以上
  cardMeanBelow: 3,           // パターンの当てはまり度の平均がこれ未満
  cardMinRated: 1,            // 平均を見るのに必要な評価数（カードは人ごとにほぼ別なので 1 から見る）
  sentenceMarkPeople: 2,      // 「違う」を付けた人数がこれ以上の文
};
export const REVIEW_NOTE = "小さい標本（5人規模）の目安です。疑う対象を探すためのもので、設問や文が悪いという判定ではありません。";
/** 違う印の番号の基準（0始まり）。データに 0 があれば 0 始まり、文の数ちょうどの番号があれば 1 始まりと判定する */
export const SENTENCE_INDEX_BASE_DEFAULT = 0;
/** lv（16傾向の level）の比較で許す差（丸め方の違い 66.7→66/67 を差分にしない） */
export const LV_TOLERANCE = 1;

export const FLAG_CODES = ["none", "both", "scene", "words"];
export const HARD_CODES = [...FLAG_CODES, "ok"];
export const FLAG_LABEL = { none: "どちらも違う", both: "どちらも当てはまる", scene: "場面が想像しにくい", words: "言葉が分かりにくい", ok: "特に迷っていない" };
export const FLAG_SHORT = { none: "どちらも違う", both: "どちらも当てはまる", scene: "場面", words: "言葉", ok: "迷っていない" };
export const INP_LABEL = { s: "スワイプ", t: "タップ", k: "キー", x: "不明" };
export const SELF_LABEL = { A: "A寄り", B: "B寄り", both: "両方強い", neither: "両方弱い", depends: "場面による" };
export const ACT_LABEL = { A: "A", B: "B", na: "覚えていない" };
export const TIME_LABEL = { short: "短い", ok: "ちょうどいい", long: "長い" };
export const AXIS_LABEL = { yes: "はい", partly: "一部", no: "いいえ" };
export const MODE_LABEL = { a: "可変", f: "固定64" };

const TI = QUESTIONS3.traitIndex;
const DOMAIN_NOS = Object.keys(DOMAINS).map(Number);

// ---------------------------------------------------------------- 設問の版（v1／v2）
/** 既知の設問バンクの version（app） */
export const KNOWN_APPS = Object.values(THREE_VERSIONS).map(v => v.bankVersion);
/**
 * 送信テキストの版：qv（"v1" | "v2"）があればそれ、無ければ app（設問バンクの version）から。どちらも無い・知らない値なら v1。
 * qv は v2 対応のあとに足した項目なので、それより前の送信（v1）には無い
 */
export function payloadQv(p) {
  if (isVersion(p?.qv)) return p.qv;
  return versionFromBank(p?.app) ?? "v1";
}
/** 版 qv の設問が v1 と同じ文か（W：場面・A・B、X：左右の傾向と行動文） */
export function itemSameAsV1(id, qv) {
  if (qv === "v1") return true;
  const a = bankFor("v1").ITEM3[id], b = bankFor(qv).ITEM3[id];
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  return a.kind === "W" ? a.stem === b.stem && a.a === b.a && a.b === b.b
    : a.left === b.left && a.right === b.right && a.leftText === b.leftText && a.rightText === b.rightText;
}
/** 設問表の行のキー：v1 と同じ文なら id のまま（版をまたいで合算）、違えば id_版（別の行） */
export const itemRowKey = (id, qv = "v1") => itemSameAsV1(id, qv) ? id : `${id}_${qv}`;

// ---------------------------------------------------------------- 小さな道具
export const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const mean = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
export const pct = (m, n) => n ? Math.round(m / n * 100) : null;
export const normCode = (code) => String(code ?? "").normalize("NFKC").trim().toLowerCase();
export const tsLabel = (ts) => { const m = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d)/.exec(String(ts ?? "")); return m ? `${m[1]} ${m[2]}` : String(ts ?? ""); };
export function fmtDur(sec) {
  if (!Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m ? `${m}分${String(s).padStart(2, "0")}秒` : `${s}秒`;
}
const uniq = (arr) => [...new Set(arr)];
const splitFlags = (f) => String(f ?? "").split("+").map(x => x.trim()).filter(Boolean);

/** 詳細説明を「。」で区切った文（「。」は各文の末尾に残す）。参加者側（js/feedback_collect.js の splitSentences）と同じ分け方。「違う」の番号はこの配列の添字 */
export function splitSentences(detail) {
  return String(detail ?? "").split("。").map(x => x.trim()).filter(Boolean).map(x => x + "。");
}

// ---------------------------------------------------------------- 1. 読み込み
/** 機械用の行の開始位置ごとに切る。途中で切れた1件が次の人の分を飲み込まないようにするため */
export function splitSegments(text) {
  const re = new RegExp(FB_TAG + "\\|", "g");
  const starts = []; let m;
  while ((m = re.exec(text))) starts.push(m.index);
  return starts.map((st, i) => ({ start: st, text: text.slice(st, i + 1 < starts.length ? starts[i + 1] : text.length) }));
}

/** 受信メモ用：機械用の行の手前にある直近の行（誰からの分かを探す手掛かり）と、要約行の「コード:」 */
function hintsBefore(text, start) {
  const lines = text.slice(0, start).split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(-3);
  const joined = lines.join(" ");
  const m = /コード[:：]\s*([^\s／/]+)/.exec(joined);
  return { context: lines.map(s => s.length > 48 ? s.slice(0, 48) + "…" : s), hintCode: m ? m[1] : null };
}

const errKind = (reason) => /CRC/.test(reason) ? "crc" : /END/.test(reason) ? "truncated" : /JSON/.test(reason) ? "json" : /版/.test(reason) ? "version" : "format";

function normRec(e) {
  if (!Array.isArray(e) || e.length < 9) return null;
  const [key, itemId, ans, lt, rt, pk, sw, ds, inp, flags, shown] = e;
  if (!["L", "R", "K"].includes(ans)) return null;
  return {
    key: String(key), itemId: String(itemId), ans, lt: +lt, rt: +rt, pk: +pk, sw: +sw || 0, ds: Number.isFinite(+ds) ? +ds : 0,
    inp: ["s", "t", "k"].includes(inp) ? inp : "x", flags: splitFlags(flags),
    shown: Array.isArray(shown) ? shown.filter(Array.isArray).map(([id, f]) => ({ itemId: String(id), flags: splitFlags(f) })) : [],
  };
}

const mainAxisOf = (res) => {
  const ch = Array.isArray(res?.chosen) ? res.chosen : [];
  const main = ch.find(c => c?.[1] === "主軸");
  if (!main) return null;
  return { id: main[0], headline: PATTERN_BY_ID[main[0]]?.headline || "", extra: ch.length - 1 };
};

function buildSession(item, order) {
  const p = item.payload;
  const rec = [], bad = [];
  (Array.isArray(p.rec) ? p.rec : []).forEach((e, i) => { const r = normRec(e); if (r) rec.push(r); else bad.push(i); });
  const L = rec.filter(r => r.ans === "L").length, R = rec.filter(r => r.ans === "R").length;
  const inp = { s: 0, t: 0, k: 0, x: 0 };
  for (const r of rec) inp[r.inp]++;
  const leftRate = L + R ? L / (L + R) : null;
  const s = {
    id: `${normCode(p.code)}|${p.ts}`, code: String(p.code), codeKey: normCode(p.code), ts: String(p.ts), tsMs: Date.parse(p.ts), tsLabel: tsLabel(p.ts),
    mode: p.mode, dur: Number.isFinite(+p.dur) ? +p.dur : null, back: +p.back || 0, ua: p.ua, app: p.app, qv: payloadQv(p), crc: item.crc, order,
    payload: p, rec, badRec: bad.length,
    res: p.res && typeof p.res === "object" ? p.res : null, fb: p.fb && typeof p.fb === "object" ? p.fb : {},
    n: rec.length, answered: L + R, left: L, right: R, skips: rec.filter(r => r.ans === "K").length,
    swaps: rec.reduce((n, r) => n + r.sw, 0), leftRate, leftWarn: leftRate != null && (leftRate >= LEFT_RATE_HIGH || leftRate <= LEFT_RATE_LOW),
    inp, main: mainAxisOf(p.res),
    retestIndex: 0, retestTotal: 1, isRetest: false,
  };
  return s;
}

/**
 * 貼り付けテキスト → { sessions(重複を除き ts 順), errors, duplicates, markers, groups, warnings }
 *   errors    : [{n, line, kind, reason, excerpt, context, hintCode}]  形式エラー・CRCエラー・途中で切れたもの
 *   duplicates: [{code, ts, same}] 同じ code＋ts（same=内容も同じ。違えば後に貼られた方を採用）
 *   groups    : 同じ code が2セッション以上 → [{code, sessions}]（再検査）
 */
export function parseInput(text) {
  text = String(text ?? "");
  const segs = splitSegments(text);
  const errors = [], byId = new Map(), duplicates = [];
  segs.forEach((seg, i) => {
    // メールの折り返しで「|END」の途中に改行が入っても拾えるように
    const body = seg.text.replace(/\|[\r\n]*E[\r\n]*N[\r\n]*D/, "|END");
    const { items, errors: errs } = decodeAll(body);
    const line = text.slice(0, seg.start).split("\n").length;
    const hints = hintsBefore(text, seg.start);
    const fail = (reason, excerpt) => errors.push({ n: i + 1, line, kind: errKind(reason), reason, excerpt: excerpt || body.slice(FB_TAG.length + 10, FB_TAG.length + 70).replace(/[\r\n]/g, ""), ...hints });
    for (const e of errs) fail(e.reason, e.excerpt);
    for (const it of items) {
      const p = it.payload;
      if (typeof p.code !== "string" || !p.code.trim() || typeof p.ts !== "string" || !Number.isFinite(Date.parse(p.ts)) || !Array.isArray(p.rec)) {
        const miss = [typeof p.code !== "string" || !p.code.trim() ? "code" : null, typeof p.ts !== "string" || !Number.isFinite(Date.parse(p.ts)) ? "ts" : null, !Array.isArray(p.rec) ? "rec" : null].filter(Boolean);
        fail(`必須項目が足りない・読めない: ${miss.join("・")}`, JSON.stringify(p).slice(0, 60));
        continue;
      }
      const s = buildSession(it, i);
      if (byId.has(s.id)) duplicates.push({ code: s.code, ts: s.ts, same: byId.get(s.id).crc === s.crc });
      byId.set(s.id, s);     // 同じ内容なら変わらず、違えば後に貼られた方を採用
    }
  });
  const sessions = [...byId.values()].sort((a, b) => a.tsMs - b.tsMs || a.order - b.order);
  const groups = new Map();
  for (const s of sessions) { if (!groups.has(s.codeKey)) groups.set(s.codeKey, []); groups.get(s.codeKey).push(s); }
  const retests = [];
  for (const list of groups.values()) {
    list.forEach((s, i) => { s.retestIndex = i; s.retestTotal = list.length; s.isRetest = i > 0; });
    if (list.length > 1) retests.push({ code: list[0].code, sessions: list });
  }
  const warnings = [];
  const apps = uniq(sessions.map(s => s.app).filter(Boolean));
  const mismatched = sessions.filter(s => !KNOWN_APPS.includes(s.app));
  if (mismatched.length) warnings.push(`設問版が既知の版（${KNOWN_APPS.join("、")}）と違うものが ${mismatched.length} 件あります（${uniq(mismatched.map(s => s.app ?? "なし")).join("、")}）。v1 として読みますが、設問の文や再採点がずれる可能性があります。`);
  for (const s of sessions) {
    if (s.badRec) warnings.push(`${s.code}（${s.tsLabel}）：回答の行 ${s.badRec} 件が読めず除きました。`);
    const I3 = bankFor(s.qv).ITEM3;
    const unknown = uniq(s.rec.flatMap(r => [r.itemId, ...r.shown.map(x => x.itemId)]).filter(id => !I3[id]));
    if (unknown.length) warnings.push(`${s.code}（${s.tsLabel}）：今の設問バンクにない id があります（${unknown.slice(0, 5).join("、")}${unknown.length > 5 ? "…" : ""}）。`);
    if (!s.res) warnings.push(`${s.code}（${s.tsLabel}）：結果（res）がありません。`);
  }
  const versions = Object.fromEntries(Object.keys(THREE_VERSIONS).map(v => [v, sessions.filter(s => s.qv === v).length]));
  return { sessions, errors, duplicates, markers: segs.length, groups: retests, warnings, apps, versions };
}

// ---------------------------------------------------------------- 2. 参加者一覧
export const peopleCount = (sessions) => new Set(sessions.map(s => s.codeKey)).size;

// ---------------------------------------------------------------- 3. 領域ごとの照合
/** 診断の状態 → 優勢の側／拮抗の種類。判定なしは null */
export const STATE_CLASS = { "1": "A", "2": "A", "1w": "A", "3": "B", "4": "B", "3w": "B", "5": "both", "6": "neither", "7": "depends" };
export const diagClass = (state) => STATE_CLASS[state] ?? null;
export const isTieClass = (c) => c === "both" || c === "neither" || c === "depends";

/** self と診断：A/B は優勢の側どうし、both/neither/depends は状態 5/6/7 と。返り値 match | mismatch | none */
export function compareSelf(cls, self) {
  if (!cls || !self || !(self in SELF_LABEL)) return "none";
  return cls === self ? "match" : "mismatch";
}
/** act と診断：A/B を優勢の側と比べる。na は除外（na）、診断が拮抗（5/6/7）のときは比べない（tie） */
export function compareAct(cls, act) {
  if (!act) return "none";
  if (act === "na") return "na";
  if (act !== "A" && act !== "B") return "none";
  if (!cls) return "none";
  if (isTieClass(cls)) return "tie";
  return cls === act ? "match" : "mismatch";
}

const rate = (m, n) => ({ m, n, pct: pct(m, n) });

export function domainMatrix(sessions) {
  const rows = sessions.map(s => {
    const cells = DOMAIN_NOS.map(d => {
      const state = s.res?.states?.[d] ?? s.res?.states?.[String(d)] ?? null;
      const w = Array.isArray(s.res?.w?.[d - 1]) ? s.res.w[d - 1] : null;
      const cls = diagClass(state);
      const self = s.fb?.self?.[d] ?? null, act = s.fb?.act?.[d] ?? null;
      return { d, state, label: state ? STATE_LABEL[state] : (s.res ? "判定なし" : "—"), cls, a: w?.[0] ?? null, b: w?.[1] ?? null, self, act, selfRes: compareSelf(cls, self), actRes: compareAct(cls, act) };
    });
    const sm = cells.filter(c => c.selfRes === "match").length, sn = cells.filter(c => c.selfRes === "match" || c.selfRes === "mismatch").length;
    const am = cells.filter(c => c.actRes === "match").length, an = cells.filter(c => c.actRes === "match" || c.actRes === "mismatch").length;
    return { session: s, cells, self: rate(sm, sn), act: rate(am, an) };
  });
  const perDomain = DOMAIN_NOS.map((d, i) => {
    const cs = rows.map(r => r.cells[i]);
    const sm = cs.filter(c => c.selfRes === "match").length, sn = cs.filter(c => c.selfRes === "match" || c.selfRes === "mismatch").length;
    const am = cs.filter(c => c.actRes === "match").length, an = cs.filter(c => c.actRes === "match" || c.actRes === "mismatch").length;
    const both = peopleCount(rows.filter(r => r.cells[i].selfRes === "mismatch" && r.cells[i].actRes === "mismatch").map(r => r.session));
    return { d, name: DOMAINS[d].name, self: rate(sm, sn), act: rate(am, an), bothMismatchPeople: both };
  });
  const sum = (f) => perDomain.reduce((n, x) => n + f(x), 0);
  const overall = { self: rate(sum(x => x.self.m), sum(x => x.self.n)), act: rate(sum(x => x.act.m), sum(x => x.act.n)) };
  return { rows, perDomain, overall };
}

// ---------------------------------------------------------------- 4. ブラインド比較
export function blindSummary(sessions) {
  const rows = [];
  for (const s of sessions) {
    const b = s.fb?.blind;
    if (!b || !b.pick) continue;
    rows.push({ session: s, pick: b.pick, decoy: b.decoy ?? "", order: b.order ?? "" });
  }
  const own = rows.filter(r => r.pick === "own").length;
  const byOrder = {};
  for (const r of rows) { const o = r.order || "不明"; (byOrder[o] ||= { own: 0, n: 0 }); byOrder[o].n++; if (r.pick === "own") byOrder[o].own++; }
  return { rows, own, total: rows.length, noAnswer: sessions.length - rows.length, pct: pct(own, rows.length), byOrder };
}

// ---------------------------------------------------------------- 5. カード評価
function normCard(c) {
  if (!Array.isArray(c) || !c[0]) return null;
  const sc = Array.isArray(c[3]) ? c[3] : [];
  return { id: String(c[0]), rating: Number.isFinite(+c[1]) ? +c[1] : 0, bad: Array.isArray(c[2]) ? c[2].map(Number).filter(Number.isInteger) : [], scenes: [sc[0] || "", sc[1] || ""], axis: c[4] || "" };
}

/** 違う印の番号の基準（0 or 1）を、データから判定する */
export function detectSentenceBase(sessions) {
  let zero = false, overflow = false;
  for (const s of sessions) for (const raw of s.fb?.cards || []) {
    const c = normCard(raw); if (!c) continue;
    const n = splitSentences(PATTERN_BY_ID[c.id]?.text?.detail).length;
    for (const i of c.bad) { if (i === 0) zero = true; if (n && i >= n) overflow = true; }
  }
  return zero ? 0 : overflow ? 1 : SENTENCE_INDEX_BASE_DEFAULT;
}

export function cardSummary(sessions) {
  const base = detectSentenceBase(sessions);
  const byId = new Map();
  const roleOf = (s, id) => (Array.isArray(s.res?.chosen) ? s.res.chosen.find(c => c?.[0] === id)?.[1] : null) || "";
  for (const s of sessions) for (const raw of s.fb?.cards || []) {
    const c = normCard(raw); if (!c) continue;
    if (!byId.has(c.id)) {
      const pat = PATTERN_BY_ID[c.id];
      byId.set(c.id, { id: c.id, known: !!pat, headline: pat?.headline || "（今のパターン表にない id）", one: pat?.text?.one || "", sentences: splitSentences(pat?.text?.detail).map(t => ({ text: t, marks: 0, by: [] })),
        scenes: (pat?.text?.scenes || ["", ""]).map((t, k) => ({ text: t, y: 0, n: 0, blank: 0, label: `場面${k + 1}`, qv: null })), vscenes: {}, n: 0, ratings: [], roles: [], axis: { yes: 0, partly: 0, no: 0, blank: 0 }, people: [] });
    }
    const x = byId.get(c.id);
    // 場面例が版で差し替わっていれば（v2 の scenes_v2.js）、その版の文として別に数える
    const sceneList = scenesChanged(c.id, s.qv)
      ? (x.vscenes[s.qv] ||= scenesFor(c.id, s.qv).map((t, k) => ({ text: t, y: 0, n: 0, blank: 0, label: `場面${k + 1}（${s.qv}）`, qv: s.qv })))
      : x.scenes;
    x.n++; x.people.push(s.code); if (c.rating > 0) x.ratings.push(c.rating);
    const role = roleOf(s, c.id); if (role) x.roles.push(role);
    for (const i of uniq(c.bad)) { const sent = x.sentences[i - base]; if (sent) { sent.marks++; sent.by.push(s.code); } }
    c.scenes.forEach((v, k) => { const sc = sceneList[k]; if (!sc) return; if (v === "y") sc.y++; else if (v === "n") sc.n++; else sc.blank++; });
    if (role === "主軸" || c.axis) { if (c.axis in AXIS_LABEL) x.axis[c.axis]++; else x.axis.blank++; }
  }
  const cards = [...byId.values()].map(x => {
    const extra = Object.values(x.vscenes).flat();
    const scenes = extra.length ? [...x.scenes.map(sc => ({ ...sc, label: `${sc.label}（v1）` })), ...extra] : x.scenes;
    const out = { ...x, scenes, nRated: x.ratings.length, mean: mean(x.ratings), roles: uniq(x.roles) };
    delete out.vscenes;
    return out;
  });
  cards.sort((a, b) => (a.mean ?? 99) - (b.mean ?? 99) || b.n - a.n || a.id.localeCompare(b.id));
  const texts = [];
  for (const s of sessions) for (const k of ["missing", "free"]) { const t = String(s.fb?.[k] ?? "").trim(); if (t) texts.push({ code: s.code, kind: k, text: t }); }
  const all = cards.flatMap(c => c.ratings);
  return { cards, texts, base, ratingMean: mean(all), ratingN: all.length };
}

// ---------------------------------------------------------------- 6. 設問ごとの表
/** 設問の表示用の情報。qv（版）の設問バンクから（省略時 v1） */
export function itemInfo(id, qv = "v1") {
  const q = bankFor(qv).ITEM3[id];
  if (!q) return { id, key: id, qv, variant: null, known: false, kind: id.startsWith("X") ? "X" : "W", domain: null, round: null, src: "", srcLabel: "不明", stem: "（今の設問バンクにない id）", first: { trait: null, label: "1" }, second: { trait: null, label: "2" }, textFirst: "", textSecond: "" };
  if (q.kind === "W") {
    const D = DOMAINS[q.domain];
    return { id, key: itemRowKey(id, qv), qv, variant: null, known: true, kind: "W", domain: q.domain, domainName: D.name, round: null, src: q.src, srcLabel: SRC_LABEL[q.src] || q.src, stem: q.stem,
      first: { trait: D.a, label: "A" }, second: { trait: D.b, label: "B" }, textFirst: q.a, textSecond: q.b, source: q.source || null };
  }
  return { id, key: itemRowKey(id, qv), qv, variant: null, known: true, kind: "X", domain: null, round: q.round, src: "x", srcLabel: ROUND_USE[q.round] || "", stem: "", first: { trait: q.left, label: "左" }, second: { trait: q.right, label: "右" }, textFirst: q.leftText, textSecond: q.rightText };
}

const itemOrder = (id) => {
  const m = /^([WX])(\d+)-(\d+)$/.exec(id);
  if (m) return [m[1] === "W" ? 0 : 1, +m[2], +m[3], ""];
  const q = /^(?:Q|D)(\d+)([a-z]?)/.exec(id);
  return [0, 100 + (q ? +q[1] : 0), 0, id];   // 対決由来の W は W の最後に
};
export const compareItemIds = (a, b) => { const x = itemOrder(a), y = itemOrder(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return String(x[3]).localeCompare(String(y[3])); };
/** 設問表の行の並び（id 順、同じ id なら版の順） */
export const compareItemRows = (a, b) => compareItemIds(a.id, b.id) || String(a.key ?? a.id).localeCompare(String(b.key ?? b.id));

/** 全設問の回答時間（秒）の中央値。枠の時間は最後に表示した設問の分（差し替えのたびに測り直す）。0 は未計測として除く */
export function overallMedianTime(sessions) {
  return median(sessions.flatMap(s => s.rec.filter(r => r.ds > 0).map(r => r.ds / 10)));
}

export function itemTable(sessions, { includeUnseen = false } = {}) {
  const acc = new Map();
  // 行は設問 id ごと。版で文が違う設問（v2 で書き換えた W・組を入れ替えた X）は版ごとに別の行（key = id_版）
  const get = (id, qv = "v1") => {
    const key = itemRowKey(id, qv);
    if (!acc.has(key)) acc.set(key, { ...itemInfo(id, qv), shown: 0, answered: 0, pickFirst: 0, pickSecond: 0, pickOther: 0, swappedAway: 0, skips: 0, times: [],
      flags: { none: 0, both: 0, scene: 0, words: 0 }, flagPeople: new Set(), swapPeople: new Set(), hard: { none: 0, both: 0, scene: 0, words: 0, ok: 0 }, hardNonOkPeople: new Set(), people: new Set() });
    return acc.get(key);
  };
  const addFlags = (x, flags, who) => { for (const f of flags) if (f in x.flags) { x.flags[f]++; x.flagPeople.add(who); } };
  for (const s of sessions) {
    for (const r of s.rec) {
      const x = get(r.itemId, s.qv);
      x.shown++; x.people.add(s.codeKey);
      addFlags(x, r.flags, s.codeKey);
      if (r.ans === "K") x.skips++;
      else {
        x.answered++;
        const t = TI[r.pk];
        if (t != null && t === x.first.trait) x.pickFirst++; else if (t != null && t === x.second.trait) x.pickSecond++; else x.pickOther++;
      }
      if (r.ds > 0) x.times.push(r.ds / 10);
      for (const sh of r.shown) {
        const y = get(sh.itemId, s.qv);
        y.shown++; y.swappedAway++; y.swapPeople.add(s.codeKey); y.people.add(s.codeKey);
        addFlags(y, sh.flags, s.codeKey);
      }
    }
    for (const h of Array.isArray(s.fb?.hard) ? s.fb.hard : []) {
      if (!Array.isArray(h) || !h[0]) continue;
      const x = get(String(h[0]), s.qv), reason = h[1];
      if (reason in x.hard) { x.hard[reason]++; if (reason !== "ok") x.hardNonOkPeople.add(s.codeKey); }
    }
  }
  const versions = uniq(sessions.map(s => s.qv || "v1"));
  if (includeUnseen) for (const v of (versions.length ? versions : ["v1"])) for (const id of Object.keys(bankFor(v).ITEM3)) get(id, v);
  const overall = overallMedianTime(sessions);
  const items = [...acc.values()].map(x => {
    const out = { ...x, timeN: x.times.length, timeMean: mean(x.times), timeMax: x.times.length ? Math.max(...x.times) : null, timeMedian: median(x.times),
      flagTotal: FLAG_CODES.reduce((n, c) => n + x.flags[c], 0), hardTotal: HARD_CODES.reduce((n, c) => n + x.hard[c], 0),
      flagPeople: x.flagPeople.size, swapPeople: x.swapPeople.size, hardNonOkPeople: x.hardNonOkPeople.size, shownPeople: x.people.size, overallMedian: overall };
    delete out.times; delete out.people;
    // 複数の版が混ざっていて、版で文が違う設問には版の印（v1／v2）
    if (versions.length > 1 && (out.qv !== "v1" || versions.some(v => v !== "v1" && !itemSameAsV1(out.id, v)))) out.variant = out.qv;
    out.reasons = itemReasons(out, overall);
    return out;
  });
  items.sort(compareItemRows);
  const keysOf = (kind) => new Set((versions.length ? versions : ["v1"]).flatMap(v => Object.values(bankFor(v).ITEM3).filter(q => q.kind === kind).map(q => itemRowKey(q.id, v)))).size;
  return { items, overallMedian: overall, shownIds: items.filter(i => i.shown > 0).length, totalW: keysOf("W"), totalX: keysOf("X"), versions };
}

// ---------------------------------------------------------------- 7. 見直し候補（自動）
function itemReasons(x, overall) {
  const out = [];
  const flagBreak = FLAG_CODES.filter(c => x.flags[c]).map(c => `${FLAG_SHORT[c]}${x.flags[c]}`).join("・");
  if (x.flagPeople >= REVIEW.flagPeople) out.push({ code: "flag", text: `一言 ${x.flagPeople}人（${flagBreak}）` });
  if (x.swapPeople >= REVIEW.swapPeople) out.push({ code: "swap", text: `差し替え ${x.swapPeople}人` });
  if (x.hardNonOkPeople >= REVIEW.hardNonOkPeople) out.push({ code: "hard", text: `振り返りで迷った ${x.hardNonOkPeople}人（${FLAG_CODES.filter(c => x.hard[c]).map(c => `${FLAG_SHORT[c]}${x.hard[c]}`).join("・")}）` });
  if (x.kind === "W" && x.pickFirst + x.pickSecond >= REVIEW.oneSidedMinN && (x.pickFirst === 0 || x.pickSecond === 0)) {
    const side = x.pickFirst ? "A" : "B";
    out.push({ code: "oneside", text: `全員が同じ側（${side}側 ${x.pickFirst + x.pickSecond}/${x.pickFirst + x.pickSecond}）` });
  }
  if (overall && x.timeN >= REVIEW.timeMinN && x.timeMedian > overall * REVIEW.timeRatio) {
    out.push({ code: "time", text: `回答時間の中央値 ${x.timeMedian.toFixed(1)}秒（全体 ${overall.toFixed(1)}秒の ${(x.timeMedian / overall).toFixed(1)}倍、n=${x.timeN}）` });
  }
  return out;
}

/** 設問・領域・パターン・文の見直し候補を1つの一覧に */
export function reviewCandidates({ items, domain, cards }) {
  const out = [];
  for (const x of items.items) if (x.reasons.length) out.push({ type: "item", ref: x.key ?? x.id, title: itemTitle(x), reasons: x.reasons.map(r => r.text), item: x });
  for (const p of domain.perDomain) {
    if (p.bothMismatchPeople >= REVIEW.domainBothMismatchPeople) {
      out.push({ type: "domain", ref: String(p.d), title: `領域${p.d} ${p.name}`, reasons: [`self と act の両方が診断と食い違った人 ${p.bothMismatchPeople}人`] });
    }
  }
  for (const c of cards.cards) {
    if (c.mean != null && c.nRated >= REVIEW.cardMinRated && c.mean < REVIEW.cardMeanBelow) {
      out.push({ type: "pattern", ref: c.id, title: `${c.id}「${c.headline}」`, reasons: [`当てはまり度の平均 ${c.mean.toFixed(1)}（n=${c.nRated}）`] });
    }
    c.sentences.forEach((s, i) => {
      if (s.marks >= REVIEW.sentenceMarkPeople) out.push({ type: "sentence", ref: `${c.id}#${i + 1}`, title: `${c.id}「${c.headline}」 ${i + 1}文目`, quote: s.text, reasons: [`「違う」の印 ${s.marks}人（${s.by.join("、")}）`] });
    });
  }
  const order = { item: 0, domain: 1, pattern: 2, sentence: 3 };
  out.sort((a, b) => order[a.type] - order[b.type] || (a.type === "item" ? compareItemRows(a.item, b.item) : a.ref.localeCompare(b.ref)));
  return out;
}
export const TYPE_LABEL = { item: "設問", domain: "領域", pattern: "パターン", sentence: "文" };

/** 設問の1行表示用（W：場面の文、X：2つの行動文） */
/** 設問 id（版で文が違う行には版を添える） */
export const itemIdLabel = (x) => x.variant ? `${x.id}（${x.variant}）` : x.id;
export function itemTitle(x) {
  if (x.kind === "W") return `${itemIdLabel(x)}「${x.stem}」`;
  return `${itemIdLabel(x)}（${x.first.trait} vs ${x.second.trait}）`;
}
export function itemPlain(x) {
  if (!x.known) return x.stem;
  if (x.kind === "W") return `「${x.stem}」 A:${x.textFirst} ／ B:${x.textSecond}`;
  return `左（${x.first.trait}）:${x.textFirst} ／ 右（${x.second.trait}）:${x.textSecond}`;
}

// ---------------------------------------------------------------- 再検査の比較
export function retestComparisons(groups) {
  const out = [];
  for (const g of groups) {
    const first = g.sessions[0];
    for (const later of g.sessions.slice(1)) {
      const st = (s, d) => s.res?.states?.[d] ?? null;
      let same = 0, sameSide = 0, total = 0;
      const diffDomains = [];
      for (const d of DOMAIN_NOS) {
        const a = st(first, d), b = st(later, d);
        if (a == null || b == null) continue;
        total++;
        if (a === b) same++; else diffDomains.push({ d, a, b });
        if (diagClass(a) === diagClass(b)) sameSide++;
      }
      const ids = (s) => (s.res?.chosen || []).map(c => c[0]);
      const A = new Set(ids(first)), B = new Set(ids(later));
      const inter = [...A].filter(x => B.has(x)).length, union = new Set([...A, ...B]).size;
      const lvA = first.res?.lv, lvB = later.res?.lv;
      const lvDiff = Array.isArray(lvA) && Array.isArray(lvB) && lvA.length === lvB.length ? mean(lvA.map((v, i) => Math.abs(v - lvB[i]))) : null;
      const pickMap = (s) => new Map(s.rec.filter(r => r.ans !== "K").map(r => [r.itemId, r.pk]));
      const pa = pickMap(first), pb = pickMap(later);
      let common = 0, agree = 0;
      for (const [id, pk] of pa) if (pb.has(id)) { common++; if (pb.get(id) === pk) agree++; }
      out.push({
        code: g.code, first, later, gapDays: Math.round((later.tsMs - first.tsMs) / 86400000 * 10) / 10,
        states: { same, total, sameSide, diffDomains }, mainSame: first.main && later.main ? first.main.id === later.main.id : null,
        chosen: { inter, union, jaccard: union ? inter / union : null, first: [...A], later: [...B] }, lvDiff, items: { common, agree },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 振り返り（体感・スワイプ）
export function reflectionSummary(sessions) {
  const time = { short: 0, ok: 0, long: 0 };
  const swipe = []; let swipeNone = 0;
  for (const s of sessions) {
    const t = s.fb?.time; if (t in time) time[t]++;
    const w = s.fb?.swipe;
    if (w === 0) swipeNone++; else if (Number.isFinite(+w) && +w > 0) swipe.push(+w);
  }
  return { time, swipeMean: mean(swipe), swipeN: swipe.length, swipeNone };
}

// ---------------------------------------------------------------- まとめ
export function usedSessions(parsed, { includeRetests = false } = {}) {
  return includeRetests ? parsed.sessions : parsed.sessions.filter(s => !s.isRetest);
}

/** 貼り付けテキストから全部を計算する（再採点は rescore.js 側で、画面が呼ぶ） */
export function analyze(text, { includeRetests = false } = {}) {
  const parsed = parseInput(text);
  return analyzeParsed(parsed, { includeRetests });
}
export function analyzeParsed(parsed, { includeRetests = false } = {}) {
  const used = usedSessions(parsed, { includeRetests });
  const domain = domainMatrix(used);
  const blind = blindSummary(used);
  const cards = cardSummary(used);
  const items = itemTable(used);
  const review = reviewCandidates({ items, domain, cards });
  const retests = retestComparisons(parsed.groups);
  const reflection = reflectionSummary(used);
  return { appVersion: QUESTIONS3.version, apps: KNOWN_APPS, versions: parsed.versions || {}, options: { includeRetests }, parsed, sessions: parsed.sessions, used, people: peopleCount(used), domain, blind, cards, items, review, retests, reflection };
}
