// 案D の読み取りの検証ケース（docs/ui-design-thinking.md §6.3 の10件）。
// 読み取りと足りない問のテスト（tests/consult_read.test.mjs）と、Clef の比べる道具（tools/clef_eval.mjs）の両方で使う。
// 1件：{ id, name, text（書いた文）, truth（正解の判定の入力。書かれていない項目は既定値）, context（文以外から決まるもの。深夜かどうかは端末の時計）,
//        read（規則で必ず読めてほしい項目と値。§6.3 の「読み取れたこと」） }
// 正解の入力は 2026-10-17 の試作（docs/ui-design-thinking.md §6.3）と同じ。P3 の経過は「さっき」なので lt3h。
import { normalizeInput } from "../../js/consult/judge.js";

const BASE = { goal: "reconcile", cause: "unknown", ongoing: false, intent: "none", partnerLast: "none", selfTemp: "cooling" };

export const READ_CASES = [
  {
    id: "P1", name: "P1 美咲",
    text: "23時くらいにLINEで言い合いになって、最後に私が「もういいよ」って送ったら既読ついたまま2時間返ってこない。もう一回送ったほうがいい？",
    truth: { ...BASE, lastSender: "self", elapsed: "lt3h", lateNight: true, selfLast: "attack" },
    context: { lateNight: true },
    read: { lastSender: "self", elapsed: "lt3h", ongoing: false, selfLast: "attack" },
  },
  {
    id: "P2", name: "P2 結衣",
    text: "会って喧嘩したあと、帰ってから彼から「もういい」ってLINEきた。めっちゃ腹立つ。すぐ電話したい",
    truth: { ...BASE, lastSender: "partner", partnerLast: "attack", elapsed: "lt3h", selfTemp: "high", goal: "understood" },
    context: {},
    read: { lastSender: "partner", partnerLast: "attack", selfTemp: "high" },
  },
  {
    id: "P3", name: "P3 彩花",
    text: "3日くらい冷戦状態だったんだけど、さっき彼から「明日のごはんどうする？」って普通に来た。なんて返せばいいかわからない",
    truth: { ...BASE, lastSender: "partner", partnerLast: "casual", elapsed: "lt3h", selfTemp: "calm" },
    context: {},
    read: { lastSender: "partner", partnerLast: "casual", elapsed: "lt3h" },
  },
  {
    id: "P4", name: "P4 真由",
    text: "喧嘩して、まだ怒ってる。彼から長文で言い訳みたいなLINE来てるけど返したくない",
    truth: { ...BASE, lastSender: "partner", partnerLast: "explain", elapsed: "3h_12h", selfTemp: "high", goal: "space" },
    context: {},
    read: { lastSender: "partner", partnerLast: "explain", selfTemp: "high" },
  },
  {
    id: "P5", name: "P5 ひかり",
    text: "初めて大きい喧嘩して、私が言いすぎた。謝りたいけどどこまで謝ればいいかわからない",
    truth: { ...BASE, intent: "apologize", cause: "self", lateNight: true },
    context: { lateNight: true },
    read: { intent: "apologize", cause: "self" },
  },
  {
    id: "P6", name: "P6 さき",
    text: "毎月同じこと（連絡の頻度）で喧嘩になる。週末に会うからちゃんと話したい",
    truth: { ...BASE, intent: "tell", repeat: true, selfTemp: "calm", goal: "settle" },
    context: {},
    read: { intent: "tell", repeat: true },
  },
  {
    id: "short1", name: "短い1",
    text: "喧嘩した",
    truth: { ...BASE, lastSender: "self", elapsed: "3h_12h" },
    context: {},
    read: {},
  },
  {
    id: "short2", name: "短い2",
    text: "既読無視されてる",
    truth: { ...BASE, lastSender: "self", elapsed: "12h_2d" },
    context: {},
    read: { lastSender: "self", ongoing: false },
  },
  {
    id: "tricky1", name: "紛らわしい1",
    text: "別れたいわけじゃないけど、彼に距離置きたいって言われた",
    truth: { ...BASE, lastSender: "partner", partnerLast: "space", elapsed: "lt3h" },
    context: {},
    read: { lastSender: "partner", partnerLast: "space" },
  },
  {
    id: "tricky2", name: "紛らわしい2",
    text: "昨日彼からごめんって来たけど、まだモヤモヤしてて返せてない",
    truth: { ...BASE, lastSender: "partner", partnerLast: "apology", elapsed: "12h_2d", selfTemp: "cooling" },
    context: {},
    read: { lastSender: "partner", partnerLast: "apology", elapsed: "12h_2d" },
  },
];

/** 正解の入力から問に答える：patch がすべて正解と同じ選択肢（なければいちばん多く合うもの）。runQuestions の answer に渡す */
export function answerFromTruth(truth) {
  const t = normalizeInput(truth);
  return (q) => {
    let best = null, bestScore = -1;
    for (const o of q.options) {
      const keys = Object.keys(o.patch), ok = keys.filter(k => t[k] === o.patch[k]).length;
      const score = (ok === keys.length ? 1000 : 0) + ok;
      if (score > bestScore) { best = o; bestScore = score; }
    }
    return best;
  };
}
