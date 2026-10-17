// Cloudflare の決めるためのモデル Clef（@cf/cloudflare/clef）で、書いた文を読む（案D の読み取り。決定 U17）。説明：docs/consult-reading.md
// ここにはネットワークを呼ばない純粋な関数だけを置く（質問の組・送る本文・返り値の読み方）。呼び出しは中継（Worker）か tools/clef_eval.mjs が行う。
// 書いた文を Cloudflare に送ることになるので、画面で送る前に一言断る（U17）。安全の言葉は Clef に頼らず、規則（extract_rules.js）で毎回見る。
//
// 返り値の形（2026-10-17 に公式の出力スキーマ https://developers.cloudflare.com/workers-ai/models/clef/schema-output.json で確認）：
//   { model, answers: { <質問 ID>: 答え }, usage: { input_tokens, output_tokens } }
//   choice の答え：{ type: "choice", choice: "<いちばん確率の高い選択肢>", probabilities: { <選択肢>: 0..1（合計 1） }, confidence: 0..1 }
//   noul の答え  ：{ type: "noul", noul: 0..1（「はい」の確率） }
// REST（/client/v4/accounts/{id}/ai/run/@cf/cloudflare/clef）では、上の形が { result: …, success, errors, messages } に包まれて返る
// （Cloudflare API の共通の包み方。Clef での実物は未確認）。どちらの形でも読めるようにしてある。

/** モデル名（Workers AI の呼び出し名）と、送る本文の model の値 */
export const CLEF_MODEL_ID = "@cf/cloudflare/clef";
export const CLEF_MODELS = ["clef", "clef-flash"];
/** 確率がこれ以上の答えだけ項目を埋める（仮。tools/clef_eval.mjs のテストで決める） */
export const CLEF_THRESHOLD = 0.8;
/** choice の「文からは分からない」の選択肢 */
export const UNKNOWN = "unknown";

/** すべての質問の前に付ける説明（誰が誰か） */
const ABOUT = "恋人との喧嘩についての相談文です。書いた人を「本人」（文中の「私」「自分」）、恋人を「相手」（文中の「彼」「彼氏」「相手」）と呼びます。";
const UNKNOWN_TEXT = "文からは分からない・書かれていない";

/**
 * 質問の表。id は判定の入力の項目名（英数字だけ）。choice の options は「判定の値 → 説明」で、最後に必ず unknown を付ける。
 * noul は「はい」で true（判定の値）
 */
const QUESTIONS = [
  { id: "lastSender", type: "choice", ask: "最後にメッセージを送った（言った）のはどちらですか。",
    options: { self: "本人", partner: "相手", none: "どちらも送っていない（会って話して、そのまま終わった など）" } },
  { id: "elapsed", type: "choice", ask: "二人の最後のやりとりから、今までにどれくらいたっていますか。",
    options: { lt3h: "3時間以内（さっき など）", "3h_12h": "3時間〜半日", "12h_2d": "半日〜2日（昨日 など）", ge3d: "3日以上" } },
  { id: "partnerLast", type: "choice", ask: "相手から最後に来たメッセージ（言葉）は、どんな種類ですか。",
    options: { apology: "謝ってきた", casual: "普通の話題（ごはん・予定・挨拶 など）", explain: "説明・言い訳・言い返し",
      attack: "責める・「もういい」など突き放す", talk_proposal: "話し合いの提案", space: "距離を置きたい・一人になりたい",
      breakup: "別れ話", none: "相手からは何も来ていない" } },
  { id: "selfLast", type: "choice", ask: "本人が最後に送った（言った）メッセージは、どんな種類ですか。",
    options: { hold: "「落ち着いたら話そう」など、いったん保留にする", apology: "謝った", reconcile: "仲直りしようとした（普段どおりの連絡を含む）",
      attack: "責めた・言い返した・突き放した", explain: "説明した", none: "本人は何も送っていない" } },
  { id: "selfTemp", type: "choice", ask: "本人の今の気持ちの温度はどれですか。",
    options: { high: "まだ怒っている・苛立っている（熱い）", cooling: "少し落ち着いてきた", calm: "落ち着いている" } },
  { id: "intent", type: "choice", ask: "本人がこれからしたいことはどれですか。",
    options: { apologize: "自分から謝りたい", tell: "相手に伝えたいこと・話し合いたいことがある", request_space: "相手に「距離を置きたい」と伝えたい" } },
  { id: "goal", type: "choice", ask: "本人が今回いちばん望んでいることはどれですか。",
    options: { reconcile: "仲直りしたい", understood: "自分の気持ちを分かってほしい", settle: "ちゃんと決着をつけたい", space: "少し距離を置きたい" } },
  { id: "cause", type: "choice", ask: "本人は、今回の喧嘩の原因がどちらにあると思っていますか。",
    options: { self: "自分（本人）", partner: "相手", both: "両方" } },
  { id: "ongoing", type: "noul", ask: "今この瞬間も、二人の言い合い（やりとり）が続いていますか。",
    yes: "今も言い合っている・やりとりの最中", no: "やりとりは止まっている（返事待ち・冷戦・時間がたった など）" },
  { id: "repeat", type: "noul", ask: "同じことが原因の喧嘩を、前にもくり返していますか。",
    yes: "前にも同じことで喧嘩した", no: "初めて、またはくり返しではない" },
  { id: "afterMakeup", type: "noul", ask: "この喧嘩のあと、二人はもう仲直りしていますか。",
    yes: "もう仲直りした（でもモヤモヤが残っている など）", no: "まだ仲直りしていない" },
];

/**
 * Clef に送る質問の組（本文の questions）。{ <id>: { type: "choice", instructions, criteria: {選択肢: 説明} } | { type: "noul", instructions, criteria: { true, false } } }
 * choice には必ず unknown（文からは分からない）を入れる
 */
export function clefQuestions() {
  const out = {};
  for (const q of QUESTIONS) {
    if (q.type === "choice") out[q.id] = { type: "choice", instructions: ABOUT + q.ask, criteria: { ...q.options, [UNKNOWN]: UNKNOWN_TEXT } };
    else out[q.id] = { type: "noul", instructions: ABOUT + q.ask, criteria: { true: q.yes, false: q.no } };
  }
  return out;
}

/** Clef に送る本文（REST の POST の本文、Workers の env.AI.run の第2引数）。model は "clef" か "clef-flash" */
export function clefRequest(text, { model = "clef" } = {}) {
  if (!CLEF_MODELS.includes(model)) throw new Error("model は clef か clef-flash");
  return { model, state: String(text ?? ""), questions: clefQuestions() };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 返り値から answers を取り出す（{ answers } でも REST の { result: { answers } } でも） */
function answersOf(result) {
  if (!result || typeof result !== "object") return null;
  if (result.answers && typeof result.answers === "object") return result.answers;
  if (result.result && typeof result.result === "object" && result.result.answers && typeof result.result.answers === "object") return result.result.answers;
  return null;
}

/**
 * Clef の返り値 → 判定の入力の一部。
 * choice：選ばれた選択肢の確率（probabilities[choice]。無ければ confidence）が threshold 以上で、unknown でなければ埋める。
 * noul：「はい」の確率が threshold 以上なら true、1 − threshold 以下なら false、その間は埋めない。
 * @param {object} result  Clef の返り値（{ answers } か、REST の { result: { answers } }）
 * @param {{ threshold?: number }} [opts]
 * @returns {{ fields: object, confidence: { [key: string]: number }, low: string[], unknown: string[] }}
 *   confidence：答えのあった項目ごとの確からしさ（choice は選ばれた選択肢の確率、noul は はい／いいえ の高いほう）。埋めなかった項目も入る
 *   low：値は出たが確率が threshold 未満で埋めなかった項目（確認の画面で目立たせる）。unknown：「文からは分からない」が選ばれた項目
 */
export function parseClefAnswers(result, { threshold = CLEF_THRESHOLD } = {}) {
  const fields = {}, confidence = {}, low = [], unknown = [];
  const answers = answersOf(result);
  if (!answers) return { fields, confidence, low, unknown };
  for (const q of QUESTIONS) {
    const ans = answers[q.id];
    if (ans == null) continue;
    if (q.type === "choice") {
      // 形の違いに強く：文字列だけ（未確認の形）、choice が無く probabilities だけ、でも読む
      const probs = ans && typeof ans === "object" && ans.probabilities && typeof ans.probabilities === "object" ? ans.probabilities : null;
      let choice = typeof ans === "string" ? ans : typeof ans?.choice === "string" ? ans.choice : null;
      if (choice == null && probs) {
        let bestP = -1;
        for (const [k, p] of Object.entries(probs)) if (num(p) != null && p > bestP) { bestP = p; choice = k; }
      }
      if (choice == null) continue;
      const p = num(probs?.[choice]) ?? num(ans?.confidence);
      if (p == null) continue;
      confidence[q.id] = p;
      if (choice === UNKNOWN) { unknown.push(q.id); continue; }
      if (!(choice in q.options)) continue;   // 知らない選択肢は使わない
      if (p >= threshold) fields[q.id] = choice; else low.push(q.id);
    } else {
      // noul：{ noul: p } が公式の形。数だけ・{ probability } も読む（未確認の形）
      const p = num(ans) ?? num(ans?.noul) ?? num(ans?.probability);
      if (p == null || p < 0 || p > 1) continue;
      confidence[q.id] = Math.max(p, 1 - p);
      if (p >= threshold) fields[q.id] = true;
      else if (p <= 1 - threshold) fields[q.id] = false;
      else low.push(q.id);
    }
  }
  return { fields, confidence, low, unknown };
}

/** テスト・道具用：質問の表（id・type・選択肢） */
export const CLEF_QUESTION_TABLE = QUESTIONS.map(q => ({ id: q.id, type: q.type, options: q.type === "choice" ? [...Object.keys(q.options), UNKNOWN] : [true, false] }));
