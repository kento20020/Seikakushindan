// 送る前チェック：自分で書いた文面の「届きやすさ」を3段階で返す。決定：docs/decisions.md D3・D4(a)
// 見るのは自分の文面の性質だけ（避ける言葉、長さ、戻る時刻の有無、返事の要求、診断への言及、禁止語）。
// 相手を測る数字・確率は出さない。正規表現は誤検出を避けて控えめにしてある（consult-answer-guide.md §2.13 #5〜#8・#11・#16）。

/** 避ける言葉の判定 ID（consult-mode.md §3.5）のうち、avoid で絞るもの。multi（連投）は1通では判定できない。third_party はいつも見る（EXTRA） */
const AVOID_PATTERNS = {
  interrogate: /なんで.{0,8}(?:の|んだ)[？?]|どうして/g,
  generalize: /いつも|絶対|普通は/g,
  character: /(?:あなた|お前|君)って.{0,10}(?:人|性格)/g,
  past: /前も|前にも|あのときも/g,
  ultimatum: /もういい|別れる|別れよう|別れたい|勝手にして/g,
  read_receipt: /既読/g,
  sarcasm: /さすがだね|はいはい/g,
  but_apology: /ごめん.{0,3}でも|ならごめん/g,
};
/** 長文の目安（consult-mode.md §3.5。仮） */
export const LONG_CHARS = 200;
/** いつも見る追加の検査 */
const EXTRA_PATTERNS = {
  // 第三者の引用：どの局面の避ける言葉にもないが、AI 出力の点検（consult-answer-guide.md §2.13 #16）ではどこでも止める
  third_party: /(?:友達|友だち|親|みんな)(?:も|が).{0,12}(?:言って|おかしい)/g,
  // 「言い返して」は返事の要求ではないので除く
  asks_reply: /(?<!言い)返して|返事(?:して|ちょうだい|ください)|教えて|答えて|連絡して/g,
  mentions_diagnosis: /診断|タイプ|(?:向き合う|距離を取る|即応|熟考|追う|待つ|表に出す|内に置く|主導する|調整する|広げる|切り分ける|解決する|関係を戻す)派/g,
  forbidden: /勝率|論破|主導権|確率/g,
};
const TIME_RE = /明日|今夜|今日|朝|昼|夜|[0-9０-９]+時|[月火水木金土日]曜|週末/;
/** 戻る時刻が要る行動 */
const NEEDS_TIME = new Set(["pause_with_time", "request_space"]);
/** 返事を求めてよい行動 */
const MAY_ASK_REPLY = new Set(["ask_feeling", "propose_call", "propose_talk_plan", "accept_space"]);
/** 1つでもあれば「届きにくい」 */
const HARD = new Set(["ultimatum", "sarcasm", "character", "interrogate", "read_receipt", "but_apology", "mentions_diagnosis", "forbidden"]);

export const LEVELS = ["届きやすい", "ふつう", "届きにくい"];

function matches(re, text) {
  const seen = new Set(), out = [];
  for (const m of text.matchAll(re)) if (!seen.has(m[0])) { seen.add(m[0]); out.push(m[0]); }
  return out;
}

/**
 * checkDraft(text, { action, avoid }) → { level, hits: [{ id, text }] }
 *   action … 一手の行動 ID（戻る時刻・返事の要求の検査に使う）
 *   avoid  … 局面の避ける言葉の ID（judge の avoid）。渡したときは、避ける言葉はその ID だけを見る。
 *            長さ（long）・第三者の引用（third_party）と追加の検査（missing_time・asks_reply・mentions_diagnosis・forbidden）はいつも見る
 * hits の text は文面の中の当たった部分（long・missing_time は説明）。数字の点数は返さない
 */
export function checkDraft(text, { action = null, avoid = null } = {}) {
  const s = String(text ?? "");
  const want = Array.isArray(avoid) ? new Set(avoid) : null;
  const hits = [];
  for (const [id, re] of Object.entries(AVOID_PATTERNS)) {
    if (want && !want.has(id)) continue;
    for (const t of matches(re, s)) hits.push({ id, text: t });
  }
  if ([...s].length > LONG_CHARS) hits.push({ id: "long", text: "長すぎる（目安を超えている）" });
  if (NEEDS_TIME.has(action) && !TIME_RE.test(s)) hits.push({ id: "missing_time", text: "戻る時刻がない" });
  for (const [id, re] of Object.entries(EXTRA_PATTERNS)) {
    if (id === "asks_reply" && MAY_ASK_REPLY.has(action)) continue;
    for (const t of matches(re, s)) hits.push({ id, text: t });
  }
  const level = hits.some(h => HARD.has(h.id)) ? "届きにくい" : hits.length ? "ふつう" : "届きやすい";
  return { level, hits };
}
