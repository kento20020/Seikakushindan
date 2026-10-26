// 相談のチャットの形（app/js/consult_chat.js。決定 U51）のうち、DOM を使わない部分。node でテストできる（tests/app_consult_chat.test.mjs）
//   返事は今の規則と決まった文（読み取り readText・足りない問 nextQuestion・判定 buildPoc・往復 consult_followup.js）。ここは、その間をつなぐ小さな決まりだけ
//
//   CHAT_TEXTS                 チャットの形で新しく足した決まった文（仕様に書いた文だけ）
//   STYLES / STYLE_OPTIONS     返し方（おまかせ・短く・じっくり）と、その1行の説明
//   autoStyle(read, text)      おまかせのときの返し方（"short" | "deep" | "normal"）
//   effectiveStyle(style, read, text)  今の返し方（"short" | "deep" | "normal"）
//   styleLabel(style, eff)     返し方の表示（おまかせは今どれかを添える：「おまかせ（短め）」など）
//   firstSentence(text)        受け止めの最初の1文（返し方が「短く」のとき）
//   joinConsult(prev, add)     相談の文に、あとから書いた文を改行でつなぐ（2000字で切る）
//   hasSide(domains) / selfFromStatus(status)  診断の結果 → 判定に渡す本人の8領域（向きが1つも無ければ null）
//   dxInvite(outcome, status)  終わったあとに診断を案内するか（［仲直りできた］［まだ］で、診断が終わっていない人だけ）
//   prePersist(items) / preFrom(raw)  カードより前のやりとりを、記録に残す形に／記録から戻す形に
//   statusRows(known)          上の帯に出す「いまの状況」の3行（見出し やりとり・時間・気持ち と文。言葉は「いまの状況」の3行と同じ項目の言葉）
import { domainsFromResult4 } from "../../js/consult/from_diagnosis4.js";
import { domainsFromProfile3 } from "../../js/consult/from_diagnosis.js";
import { valueLabel, statusLines } from "./consult_followup.js";

export const MAX_CHARS = 2000;

/** チャットの形で新しく足した文（仕様 U51 に書いた文だけ。今の画面の文は consult.js・consult_followup.js・model.js のものを使う） */
export const CHAT_TEXTS = Object.freeze({
  greet: "いま、何があったか、そのまま書いてください。全部そろっていなくても大丈夫です。足りないところは、あとで少しだけ聞きます。",
  dxOn: "診断の結果も使って考えます。",
  dxOff: "診断の結果は使わずに考えます。",
  dxUsing: "診断の結果も使って考えています。",
  dxNone: "まだ診断していません。",
  dxRedoOn: "診断の結果も使って、考え直しました。",
  dxRedoOff: "診断の結果を使わずに、考え直しました。",
  dxSkip: "この相談では使わない",
  dxUse: "使う",
  offer: "前の相談の続きがあります：",
  deepAsk: "よければ、いちばん引っかかっているところを、もう少し聞かせてください。",
  deepSkip: "このまま次の一手を見る",
  invite: "よければ、性格診断もしてみてください。次の相談から、あなたの傾向も使って考えられます。",
  inviteBtn: "診断する",
  pasting: "相手の返事を貼っています",
  phReply: "相手から来た文を、そのまま貼ってください",
  phTalk: "いまの気持ちや、気になっていることを書いてください",
  privacy: "書いた文は、この端末の中だけで読み取ります。どこにも送りません。",
  settings: "返し方と診断",
  styleHead: "返し方",
  dxHead: "診断",
  styleLead: "返し方：",
  shorter: "もっと短く",
  listen: "話を聞いてほしい",
  more: "くわしく見る",
  editDraft: "文を自分で直す",
  editHead: "送る一文を直す",
  editNote: "自分の言葉に直すと、伝わりやすくなります。",
  nowLabel: "いまの一手",
  nowSafety: "安全を優先",
  continue: "相談を続ける",
  examples: "例文",
  guide: "書き方の例",
  fix: "読み取ったことを直す",
  send: "送る",
});

// ---------------------------------------------------------------- 返し方
export const STYLES = Object.freeze(["auto", "short", "deep"]);
export const DEFAULT_STYLE = "auto";
export const STYLE_KEY = "seikaku16:app:consult-style";
export const isStyle = (v) => typeof v === "string" && STYLES.includes(v);
export const STYLE_OPTIONS = Object.freeze([
  { key: "auto", label: "おまかせ", desc: "書いた文に合わせて長さを変えます。" },
  { key: "short", label: "短く", desc: "受け止めは1文、カードは要点だけ（くわしくは押して開く）。" },
  { key: "deep", label: "じっくり", desc: "一手の前に、もう少し話を聞きます。" },
]);
/** おまかせのときに添える、今の返し方の言葉 */
const EFFECT_WORD = Object.freeze({ short: "短め", deep: "じっくり", normal: "ふつう" });

const LISTEN_RE = /聞いてほしい|聞いて欲しい|聞いてもらいたい|話を聞いて|吐き出し/;

/**
 * おまかせのときの返し方。
 *   "short"  … 読み取りの selfTemp が high（まだ熱い）か、ongoing が true（言い合いの最中）
 *   "deep"   … 上に当たらず、文に「聞いてほしい・聞いて欲しい・聞いてもらいたい・話を聞いて・吐き出し」のどれか
 *   "normal" … それ以外（今の画面と同じ長さ）
 */
export function autoStyle(read, text = "") {
  const f = read?.fields || {};
  if (f.selfTemp === "high" || f.ongoing === true) return "short";
  if (LISTEN_RE.test(String(text ?? ""))) return "deep";
  return "normal";
}

/** 今の返し方（選んだ返し方。おまかせなら書いた文から） */
export function effectiveStyle(style, read, text = "") {
  if (style === "short") return "short";
  if (style === "deep") return "deep";
  return autoStyle(read, text);
}

/** 返し方の表示。おまかせのときは今どれになっているかを添える（まだ何も書いていない＝eff が無いときは「おまかせ」だけ） */
export function styleLabel(style, eff) {
  const s = isStyle(style) ? style : DEFAULT_STYLE;
  const o = STYLE_OPTIONS.find((x) => x.key === s);
  if (s !== "auto" || !EFFECT_WORD[eff]) return o.label;
  return `${o.label}（${EFFECT_WORD[eff]}）`;
}

// ---------------------------------------------------------------- 文の切り出し・つなぎ
const END_MARKS = new Set(["。", "！", "？", "!", "?"]);
const OPEN_Q = new Set(["「", "『", "（", "("]), CLOSE_Q = new Set(["」", "』", "）", ")"]);
/** 最初の1文（「。」「！」「？」まで。「」の中の句点では切らない。続く記号はいっしょに。無ければ全部） */
export function firstSentence(text) {
  const chars = Array.from(String(text ?? "").trim());
  let depth = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (OPEN_Q.has(c)) depth++;
    else if (CLOSE_Q.has(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && END_MARKS.has(c)) {
      let j = i + 1;
      while (j < chars.length && END_MARKS.has(chars[j])) j++;
      return chars.slice(0, j).join("");
    }
  }
  return chars.join("");
}

/** 相談の文に、あとから書いた文を改行でつなぐ。前が無ければ書いた文だけ。2000字（文字の数）で切る */
export function joinConsult(prev, add, max = MAX_CHARS) {
  const a = String(prev ?? "").trim(), b = String(add ?? "").trim();
  const t = a && b ? `${a}\n${b}` : a || b;
  const chars = Array.from(t);
  return chars.length > max ? chars.slice(0, max).join("") : t;
}

// ---------------------------------------------------------------- 診断の結果 → 判定の入力（本人の8領域）
const DOMAIN_KEYS = [1, 2, 3, 4, 5, 6, 7, 8];
/** 8領域のうち、向き（A か B）がある領域が1つでもあるか */
export function hasSide(domains) {
  if (!domains || typeof domains !== "object") return false;
  return DOMAIN_KEYS.some((d) => domains[d]?.side === "A" || domains[d]?.side === "B");
}

/**
 * 今の診断（app/js/diagnosis_version.js の currentStatus() の結果）→ 判定に渡す本人の8領域（from_diagnosis.js の形）。
 *   終わった診断（state "done"）だけ。24問（v4）は domainsFromResult4、三択（v3）は domainsFromProfile3（結果の profile3）。
 *   向きが1つも無ければ（全部まんなか・答えが足りないなど）null
 */
export function selfFromStatus(status) {
  try {
    if (!status || status.state !== "done" || !status.result || typeof status.result !== "object") return null;
    const r = status.result;
    const d = status.version === "v4" || r.diagnosisVersion === "v4" ? domainsFromResult4(r)
      : r.profile3 ? domainsFromProfile3(r.profile3) : null;
    return hasSide(d) ? d : null;
  } catch { return null; }
}

/** 終わったあとに診断を案内するか：［仲直りできた］か［まだ］を選んだときだけ、診断が終わっていない人に（［こじれた］・答えずに終えたときは出さない） */
export function dxInvite(outcome, status) {
  if (outcome !== "made_up" && outcome !== "not_yet") return false;
  return status?.state !== "done";
}

// ---------------------------------------------------------------- カードより前のやりとり（記録の data.chat.pre）
const PRE_WHO = new Set(["me", "app"]);
/**
 * 記録に残す形：自分・アプリの吹き出しだけ { who, text, at, label? }（fu.thread の吹き出しと同じ形）。
 * 安全の確認の吹き出し・答え・安全のカード（sf の印）は残さない（危ないときのカードは履歴に残さない：今の決まり）
 */
export function prePersist(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((x) => x && PRE_WHO.has(x.who) && !x.sf && typeof x.text === "string").map((x) => {
    const o = { who: x.who, text: x.text, at: typeof x.at === "string" ? x.at : null };
    if (typeof x.label === "string" && x.label) o.label = x.label;
    return o;
  });
}
/** 記録から戻す形（形の違う項目は外す） */
export function preFrom(raw) {
  return prePersist(raw);
}

// ---------------------------------------------------------------- 上の帯の「いまの状況」の3行
/** 分からない項目の文 */
export const STATUS_NONE = "分からない";
const isKnown = (v) => v !== undefined && v !== null;
/** 状況の項目の言葉。分からない（値が無い・選択肢に無い・言葉が「分からない」）なら null */
const labelOf = (key, v) => {
  if (!isKnown(v)) return null;
  const t = valueLabel(key, v);
  return t && t !== STATUS_NONE ? t : null;
};
/**
 * 上の帯に出す「いまの状況」の3行 [{ key, label, text }]（見出しの言葉は label。文は折り返して全部出す）：
 *   やりとり（exchange）… 「いまの状況」の1行目（consult_followup.js の statusLines の1行目そのまま。分からないときの文・もう仲直りした・相手の言葉の補足も同じ）
 *   時間（time）       … 「最後のやりとりから 3時間以内」。分からなければ「分からない」
 *   気持ち（feel）     … いまの気持ち → したいこと（「特になし」ならゴール）の言葉を「・」でつなぐ。どれも分からなければ「分からない」
 */
export function statusRows(known) {
  const k = known && typeof known === "object" ? known : {};
  const elapsed = labelOf("elapsed", k.elapsed);
  const want = (k.intent !== "none" ? labelOf("intent", k.intent) : null) ?? labelOf("goal", k.goal);
  const feel = [labelOf("selfTemp", k.selfTemp), want].filter(Boolean);
  return [
    { key: "exchange", label: "やりとり", text: statusLines(k)[0] },
    { key: "time", label: "時間", text: elapsed ? `最後のやりとりから ${elapsed}` : STATUS_NONE },
    { key: "feel", label: "気持ち", text: feel.length ? feel.join("・") : STATUS_NONE },
  ];
}
