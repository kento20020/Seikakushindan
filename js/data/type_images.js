// 傾向の絵（たたき台）。結果画面の「あなたの傾向の絵」と「8つの軸の絵」は、このファイルだけで決まります。
//   絵の差し替え・追加・文言の直しは、下の TYPE_IMAGES の該当する1件を書き換えるだけ（手順：docs/type-images.md）。
//   - 絵のファイルは img/types/<キー>.jpg（960×960 の JPEG）。置いたら file を "img/types/<キー>.jpg" にして status を "ready" にする
//   - まだ絵がないものは file: null・status: "pending"（画面では「絵は準備中」の枠が出る。ほかの傾向の絵は代わりに出さない）
//   - キー：領域番号＋A/B。A/B は js/data/questions.js の DOMAINS[領域].a／.b（A＝左の傾向、B＝右の傾向）
//   - caption は「やさしく・評価しない」一言（たたき台。直してよい）。alt は画像が見えない人向けの説明
// この下のヘルパー（tendencyKeyFor・domainTendencies3・heroTendency など）は DOM を使わない純粋な関数。判定はしない（engine3.js の結果を読むだけ）。
import { DOMAINS, DOM_OF, domainFlags3 } from "../engine3.js";

/**
 * 16傾向のスロット。キー順は 1A, 1B, 2A, 2B … 8B。
 *   key / domain / side / tendency … 傾向の識別（tendency は DOMAINS の名前と同じ。テストで照合）
 *   motif    … 絵のモチーフ（小さな説明）。未作成なら null
 *   caption  … 絵に添える一言。未作成なら null
 *   alt      … 画像の代替テキスト。未作成なら null
 *   file     … サイトのルートからの相対パス。未作成なら null
 *   status   … "ready"（file があり、画面に出せる）／"pending"（準備中）
 *   note     … 管理用のメモ（画面には出さない）
 */
export const TYPE_IMAGES = {
  "1A": {
    key: "1A", domain: 1, side: "A", tendency: "向き合う",
    motif: "袖から相手へ伸びる橋",
    caption: "ぶつかったら、自分から橋をかけにいく",
    alt: "短い黒髪の人物が、袖から伸びた赤いリボンに手をそっと添えている。リボンは相手のいるほうへ、橋のように伸びていく。",
    file: "img/types/1A.jpg", status: "ready", note: "",
  },
  "1B": {
    key: "1B", domain: 1, side: "B", tendency: "距離を取る",
    motif: null, caption: null, alt: null,
    file: null, status: "pending", note: "",
  },
  "2A": {
    key: "2A", domain: 2, side: "A", tendency: "即応",
    motif: null, caption: null, alt: null,
    file: null, status: "pending", note: "",
  },
  "2B": {
    key: "2B", domain: 2, side: "B", tendency: "熟考",
    motif: "頭から伸び、一周して戻る輪",
    caption: "頭の中で一周させてから、言葉にする",
    alt: "短い黒髪の人物の頭から紺色のリボンが立ち上がり、大きな輪を描いて、一周して戻ってくる。",
    file: "img/types/2B.jpg", status: "ready", note: "",
  },
  "3A": {
    key: "3A", domain: 3, side: "A", tendency: "追う",
    motif: "確かめようと伸びる赤い腕",
    caption: "不安になると、確かめる手が先に伸びる",
    alt: "白い服の人物の袖から、赤く染まった腕が伸びている。何かを確かめるように、手のひらを前へ差し出している。",
    file: "img/types/3A.jpg", status: "ready", note: "",
  },
  "3B": {
    key: "3B", domain: 3, side: "B", tendency: "待つ",
    motif: null, caption: null, alt: null,
    file: null, status: "pending", note: "",
  },
  "4A": {
    key: "4A", domain: 4, side: "A", tendency: "表に出す",
    motif: null, caption: null, alt: null,
    file: null, status: "pending", note: "",
  },
  "4B": {
    key: "4B", domain: 4, side: "B", tendency: "内に置く",
    motif: "胸の折り返しに隠れた赤",
    caption: "気持ちは、胸の内側にしまっておく",
    alt: "白い服の胸もとに折り返しがあり、その内側に赤い色がのぞいている。人物は横を向いている。",
    file: "img/types/4B.jpg", status: "ready", note: "前作（前のバッチで作った1枚）",
  },
  "5A": {
    key: "5A", domain: 5, side: "A", tendency: "理由・具体",
    motif: "説明がそろうと埋まるパズル",
    caption: "理由がそろうと、最後のピースがはまる",
    alt: "紺色の襟の欠けたところへ、人物が赤いパズルのピースをはめようとしている。",
    file: "img/types/5A.jpg", status: "ready", note: "",
  },
  "5B": {
    key: "5B", domain: 5, side: "B", tendency: "気持ち・共感",
    motif: null, caption: null, alt: null,
    file: null, status: "pending", note: "",
  },
  "6A": {
    key: "6A", domain: 6, side: "A", tendency: "主導する",
    motif: null, caption: null, alt: null,
    file: null, status: "pending", note: "",
  },
  "6B": {
    key: "6B", domain: 6, side: "B", tendency: "調整する",
    motif: "流れを受け止め、向きを整える手",
    caption: "流れを受け止めて、向きをそっと整える",
    alt: "宙を流れてきた赤いリボンを、人物が開いた手のひらで受け止めている。",
    file: "img/types/6B.jpg", status: "ready", note: "",
  },
  "7A": {
    key: "7A", domain: 7, side: "A", tendency: "広げる",
    motif: "一つの服から枝分かれする帯",
    caption: "ひとつの話から、いくつもの話へ枝分かれする",
    alt: "ひとつの白い服から、紺色と赤の帯が何本にも枝分かれして、風になびいている。",
    file: "img/types/7A.jpg", status: "ready", note: "",
  },
  "7B": {
    key: "7B", domain: 7, side: "B", tendency: "切り分ける",
    motif: null, caption: null, alt: null,
    file: null, status: "pending", note: "",
  },
  "8A": {
    key: "8A", domain: 8, side: "A", tendency: "解決する",
    motif: null, caption: null, alt: null,
    file: null, status: "pending", note: "",
  },
  "8B": {
    key: "8B", domain: 8, side: "B", tendency: "関係を戻す",
    motif: "隙間を残しながら結び直す糸",
    caption: "すき間は残しても、また結び直す",
    alt: "前の開いた白い服の胸もとで、赤い糸がゆるく蝶結びになっている。結び目のまわりには、すき間が残っている。",
    file: "img/types/8B.jpg", status: "ready", note: "",
  },
};

/** 絵を画面に出せる（status が ready で file がある）か */
export const isReady = (entry) => !!entry && entry.status === "ready" && typeof entry.file === "string" && entry.file !== "";

// ---------------------------------------------------------------- キー
/**
 * 領域と、側（"A"／"B"／傾向名）から傾向のキー（"1A"…"8B"）を返す。分からなければ null
 *   tendencyKeyFor(1, "A") → "1A"、tendencyKeyFor(1, "距離を取る") → "1B"
 */
export function tendencyKeyFor(domain, sideOrTendencyName) {
  const d = Number(domain);
  const D = Number.isInteger(d) && Object.hasOwn(DOMAINS, d) ? DOMAINS[d] : null;
  if (!D) return null;
  const s = String(sideOrTendencyName ?? "").trim();
  const side = /^[AaBb]$/.test(s) ? s.toUpperCase() : s === D.a ? "A" : s === D.b ? "B" : null;
  return side ? `${d}${side}` : null;
}

// ---------------------------------------------------------------- 領域ごとの、あなたの傾向
/**
 * 領域ごとに、あなたの優勢な傾向のキー。{ 領域番号: { domain, key, tendency, tie, weak } }
 *   key / tendency … 左右（W）で優勢なほう。拮抗していれば null
 *   tie            … 拮抗（key が null）
 *   weak           … 優勢だが強さが弱い（優勢（弱））か、強さの向きが逆（W と X が食い違う）。engine3.js の domainFlags3 の weak || conflict
 */
export function domainTendencies3(profile3) {
  const out = {};
  for (const d of Object.keys(DOMAINS)) {
    const f = domainFlags3(profile3, d);
    out[d] = { domain: +d, key: f.lead ? tendencyKeyFor(d, f.lead) : null, tendency: f.lead ?? null, tie: !f.lead, weak: !!(f.weak || f.conflict) };
  }
  return out;
}

// ---------------------------------------------------------------- 選ばれたパターンから
const hitsOf = (selected) => (Array.isArray(selected) ? selected : selected?.chosen ?? []).filter(x => x && x.meta);
const isShape = (m) => m.kind === "special" && m.group === "D";   // 形状（全体の形）は、特定の傾向も領域も指さない
const SIDE_A = new Set(["1", "2", "1w"]), SIDE_B = new Set(["3", "4", "3w"]);

/**
 * 選ばれたパターンが触れている領域と、その本数 { 領域番号: 本数 }。形状（S16〜S20）は全領域に触れるので数えない
 *   結果画面の「8つの軸の絵」の強調と、heroTendency の代わりの絵の順番に使う
 */
export function referencedDomains(selected) {
  const out = {};
  for (const { meta } of hitsOf(selected)) {
    if (isShape(meta)) continue;
    for (const d of meta.domains || []) out[d] = (out[d] || 0) + 1;
  }
  return out;
}

/**
 * 1本のパターンが語っている傾向のキー（語られる順。重複なし）
 *   基本 B{d}-{状態}：状態 1・2・1w → A側、3・4・3w → B側、それ以外（5・6・7）は、その領域のあなたの優勢側（leads から。拮抗なら無し）
 *   クロス・特殊：meta の cond に出てくる傾向（クロスは traits、特殊は「優勢:」「高:」「中:」の傾向）
 *   形状：なし
 * leads は domainTendencies3 の結果（基本の5・6・7のときだけ使う）
 */
export function patternTendencyKeys(meta, leads = {}) {
  const c = meta?.cond;
  if (!c) return [];
  if (c.type === "basic") {
    if (SIDE_A.has(String(c.s))) return [tendencyKeyFor(c.d, "A")].filter(Boolean);
    if (SIDE_B.has(String(c.s))) return [tendencyKeyFor(c.d, "B")].filter(Boolean);
    const k = leads?.[c.d]?.key;
    return k ? [k] : [];
  }
  const names = c.type === "cross" ? c.traits
    : c.type === "specialA" || c.type === "specialB" || c.type === "specialC" ? c.clauses.map(s => String(s).split(":")[1])
    : [];
  const keys = [];
  for (const t of names) {
    const k = tendencyKeyFor(DOM_OF[t], t);
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

/**
 * 結果画面の最初に出す絵。{ key, reason } か null（出さない）。reason は次の3つ
 *   "主軸"    … 主軸のパターンが語る傾向の絵
 *   "代わり"  … 主軸のパターンが語る傾向はあるが、どれも絵が準備中。あなたのほかの傾向の絵
 *   "主軸なし" … 主軸のパターンが特定の傾向を語らない（左右が拮抗する基本パターン・形状）。あなたのほかの傾向の絵
 * selected … 結果画面がもっている選ばれたパターン（select3 の chosen。{ meta, role } の配列）。{ chosen } でも可
 *   1. 主軸のパターンが語る傾向（patternTendencyKeys。パターン自身の順）のうち、あなたが優勢なものを先頭から順に見て、
 *      最初に絵があるもの（isReady）を出す（reason "主軸"）。優勢なものが1つもなければ、語られる傾向すべてを同じ順に見る
 *   2. 語られる傾向があるのに、どれも絵が準備中なら、あなたの優勢な傾向のうち絵があるものから1つ（reason "代わり"）。
 *      語られる傾向が1つもないなら、同じ選び方で reason "主軸なし"。順番は
 *      「弱め」でないものが先 → 選ばれたパターンが触れている本数が多い領域が先 → 領域番号が小さい方が先
 *   主軸のパターンが無い、または代わりの絵もなければ null（準備中の傾向の絵を、ほかの傾向の絵で置き換えて「主軸」とは言わない）
 * images は差し替え用（テスト）。省略すると TYPE_IMAGES
 */
export function heroTendency(profile3, selected, images = TYPE_IMAGES) {
  const hits = hitsOf(selected);
  const main = hits.find(x => x.role === "主軸");
  if (!main) return null;
  const leads = domainTendencies3(profile3);
  const keys = patternTendencyKeys(main.meta, leads);
  const led = keys.filter(k => leads[parseInt(k, 10)]?.key === k);
  const first = (led.length ? led : keys).find(k => isReady(images[k]));
  if (first) return { key: first, reason: "主軸" };

  const refs = referencedDomains(hits);
  const pool = Object.values(leads).filter(t => t.key && isReady(images[t.key]));
  pool.sort((x, y) => (x.weak - y.weak) || ((refs[y.domain] || 0) - (refs[x.domain] || 0)) || x.domain - y.domain);
  return pool.length ? { key: pool[0].key, reason: keys.length ? "代わり" : "主軸なし" } : null;
}
