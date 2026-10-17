// 三択版の設問バンク v3（3choice-2026-10-16）。v2（questions3_v2.js）のうち W1-1・W3-3・W3-4 の3問だけを、テスター6人の結果で差し替えたもの。
// ロジック（追加質問の条件・上限・確度低 ×0.8・矛盾枠の条件・場面例・練習カード）、X（比較）の設問・行動文・組み合わせ、
// 対決由来の差し替え候補（extraPairSources）は v2 と同じ。v2 のオブジェクトは書き換えず、深いコピーから作る。
// 変更点は changesFromV2（v2 → v3 の3問）と changesFromV1（v1 → v3 の全体）に一覧。仕様は docs/three-choice-logic.md の「v3（3choice-2026-10-16）」。
// v2 に戻すときは js/three_version.js の DEFAULT_THREE_VERSION を "v2" にするか、URL に ?qv=v2 を付ける（v1 は ?qv=v1）。
import { QUESTIONS3_V2 } from "./questions3_v2.js";

/** v3 で差し替える W（id → 場面・A行動・B行動と理由）。id・区分（kind）・並び順は v2 と同じ */
const V3_W = {
  "W1-1": {
    stem: "言い合いになって、空気が悪くなった直後",
    a: "まずは、このまま話を続ける",
    b: "まずは、いったん一人になって頭を冷やす",
    why: "6人中4人が「どちらも当てはまる」などで迷った（v1・v2とも）。B側に「落ち着いてから話す」が入っていて、向き合う派にも当てはまっていた（解釈 B1-2「話したい。でも、今じゃない」そのもの）。v2 の「返事が止まった」「寝る前」は領域3（追う）と時間帯の要素が混ざっていた。領域1の定義「空気が悪くなった瞬間の初動」に合わせて、両方の行動に「まずは」を付けて順番（最初の動き）を固定し、B から「話す」を外した",
    v1Note: "v3 で再び差し替え（v2 でも迷いが続いたため、「まずは」で最初の動きに固定し、B から「話す」を外した）",
  },
  "W3-3": {
    stem: "喧嘩が一応おさまったあと、相手がまだ怒っていないか気になるとき",
    a: "「もう怒ってない？」と聞いて確かめる",
    b: "聞かずに、相手の様子から判断する",
    why: "v1・v2 とも6人全員が B。「追う」寄りの3人（W3-1・W3-2・W3-5・W3-6 では A）も B を選んだ。既読のまま返事がない場面で「もう一通送る」は、追う派でも「一度確かめたらあとは待つ」人（解釈 B3-2）が選ばない2通目の確認だった。不安を場面に書き込み（「気になるとき」）、A を1回目の軽い確認にした",
    v1Note: "v3 で再び差し替え（v2 でも全員 B。不安を場面に書き込み、A を1回目の軽い確認にした）",
  },
  "W3-4": {
    stem: "相手からの連絡がいつもより少なくて、少し不安になったとき",
    a: "「元気？」と自分から一言送ってみる",
    b: "不安でも、相手から連絡が来るまで待つ",
    why: "v1・v2 とも6人全員が B。「返信ペースが変わった」だけでは不安にならない人が多く、B「いつも通りのペースで返して様子を見る」が無難に見えた。人の違いが出ていた W3-5・W3-6 と同じく、不安を場面に書き込み、A を1回目の軽い連絡、B を「不安でも待つ」にした",
    v1Note: "v3 で再び差し替え（v2 でも全員 B。不安を場面に書き込み、A を1回目の軽い連絡、B を「不安でも待つ」にした）",
  },
};

const text = (x) => ({ stem: x.stem, a: x.a, b: x.b });

function buildV3() {
  const q = JSON.parse(JSON.stringify(QUESTIONS3_V2));
  q.version = "3choice-2026-10-16";
  const before = {};
  for (const list of Object.values(q.pairs)) for (const p of list) {
    const nw = V3_W[p.id];
    if (!nw) continue;
    before[p.id] = text(p);
    Object.assign(p, text(nw));
  }
  for (const id of Object.keys(V3_W)) if (!before[id]) throw new Error(`v3：v2 の設問に ${id} がありません`);
  q.notes.version = "v3（2026-10-16）。v2（questions3_v2.js・3choice-2026-10-10）の W1-1・W3-3・W3-4 を差し替えたもの。ロジック・X は v2 と同じ。v1 は questions3.js（3choice-2026-10-08）";

  // v1 → v3 の差分一覧：v2 の一覧をもとに、v3 で差し替えた3問は after を v3 の文にし、理由の末尾に一言足す
  const fromV1 = q.changesFromV1;
  delete q.changesFromV1;
  for (const c of fromV1.w) {
    const nw = V3_W[c.id];
    if (!nw) continue;
    c.after = text(nw);
    c.why = `${c.why}。${nw.v1Note}`;
  }
  fromV1.note = "5人テスト（2026-10-09〜10）の結果による修正（v2）に、テスター6人の結果による W1-1・W3-3・W3-4 の再差し替え（v3）を重ねたもの。行動文（statements）は v1 と同じ。対決由来の差し替え候補（extraPairSources）も同じ。";

  q.changesFromV2 = {
    w: Object.keys(V3_W).map(id => ({ id, why: V3_W[id].why, before: before[id], after: text(V3_W[id]) })),
    x: [],
    note: "テスター6人（v1 5人・v2 1人、2026-10-09〜12）の結果による再差し替え。W1-1・W3-3・W3-4 の場面・A行動・B行動だけを変えた。id・区分・並び順、X の設問・行動文・組み合わせ、対決由来の差し替え候補（extraPairSources）、ロジックは v2 と同じ。",
  };
  q.changesFromV1 = fromV1;
  return q;
}

export const QUESTIONS3_V3 = buildV3();
