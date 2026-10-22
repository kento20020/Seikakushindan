// 相談の外の安全と人目の守り（決定 U47）。DOM を使わない（Node のテストで読む）。仕様：docs/app-screens.md §23
//   窓口のページ（#help。app/js/help.js）・24問の結果の安全の1行・#types の下の注・履歴の一覧に相談で書いた文の冒頭を出すかの設定・小さな文の足し、の定数と関数
//   窓口の名前・番号・注は相談の画面と同じ js/consult/texts.js の SAFETY_RESOURCES から読む（ここに番号を書き写さない）。
//   ただし app/sw.js の「つながっていません」の画面はモジュールを読めないので、番号を文字で持つ（同じであることを tests/app_safety.test.mjs で確かめる）
//   どこにも何も送らない。何も保存しない（「履歴の冒頭」の設定は app/js/local.js）
import { SAFETY_RESOURCES } from "../../js/consult/texts.js";

// ---------------------------------------------------------------- 窓口のページ（#help）
export const HELP_HASH = "#help";
export const HELP_TITLE = "危ないときは";
/** いますぐの電話（110・119）。文は「いま危ないと感じたら、110番（警察）か119番（救急）に電話してください。」 */
export const EMERGENCY = Object.freeze([
  Object.freeze({ number: "110", label: "警察" }),
  Object.freeze({ number: "119", label: "救急" }),
]);
export const EMERGENCY_TEXT = "いま危ないと感じたら、110番（警察）か119番（救急）に電話してください。";
/** 窓口の並び（SAFETY_RESOURCES のキー）。よりそいホットラインは1回だけ（yorisoi_partner は出さない） */
export const HELP_ORDER = Object.freeze(["dv_plus", "dv_navi", "yorisoi_self"]);
export const HELP_LIST_TITLE = "相談できる窓口";
export const HELP_WHEN_TITLE = "こんなときは、窓口に相談できます";
export const HELP_WHEN = Object.freeze([
  "叩かれる・物を壊される・怒鳴られて怖い",
  "スマホ・居場所・お金・人づきあいを、確かめられたり決められたりし続ける",
  "「別れるなら死ぬ」などと言われる",
  "自分を傷つけたい気持ちがある",
]);
export const HELP_NOTES = Object.freeze([
  "この画面は、どこにも何も送りません。履歴にも残しません。",
  "番号と受付時間は2026年10月時点の資料によるものです（試作。公開の前に、各窓口の公式サイトで確かめ直します）。",
]);

/** いますぐの電話の文を、文字と電話のリンクに分ける [{ text } | { text: "110番", tel: "tel:110" }]。つなぐと EMERGENCY_TEXT */
export function emergencyParts() {
  const [police, rescue] = EMERGENCY;
  return [
    { text: "いま危ないと感じたら、" },
    { text: `${police.number}番`, tel: telHref(police.number) },
    { text: `（${police.label}）か` },
    { text: `${rescue.number}番`, tel: telHref(rescue.number) },
    { text: `（${rescue.label}）に電話してください。` },
  ];
}

/** 電話のリンク：数字・#・+ だけ残し（ハイフン・空白を外す）、# は %23 に（"#8008" → "tel:%238008"、"0120-279-889" → "tel:0120279889"）。
 *  相談の画面（poc/card/model.js の telHref）と同じ作り方 */
export function telHref(contact) {
  return `tel:${String(contact ?? "").replace(/[^0-9#+]/g, "").replace(/#/g, "%23")}`;
}

/** 窓口の一覧 [{ key, name, contact, note, tel }]（HELP_ORDER の順。SAFETY_RESOURCES に無いキーは飛ばす） */
export function helpResources() {
  return HELP_ORDER.filter((k) => SAFETY_RESOURCES[k]).map((k) => {
    const r = SAFETY_RESOURCES[k];
    return { key: k, name: r.name, contact: r.contact, note: r.note, tel: telHref(r.contact) };
  });
}

/** つながらないときの画面（app/sw.js）に文字で入れておく番号（110・119 と窓口の番号。テストで sw.js と突き合わせる） */
export function offlineNumbers() {
  return [...EMERGENCY.map((e) => e.number), ...helpResources().map((r) => r.contact)];
}

// どの画面にも「危ないときは」（上の帯の右・画面のいちばん下の1行・文の後ろの小さなリンク）は app/js/ui.js（topBar の help・helpFoot・helpLink）

// ---------------------------------------------------------------- 24問の結果の安全の1行（v4。既定の形 v4.1 と ?rc=u44 の両方）
//   条件：領域3（不安時の確認行動）か領域6（話し合いの主導）が strongA（js/engine4.js。答えた問がすべて A。3問とも、または2問答えて2問とも）
//   見出しは付けない小さな囲み。答えがそろった領域が無いときは条件を満たさないので出ない
export const SAFETY_DOMAINS4 = Object.freeze([3, 6]);
export const SAFETY_NOTE4 = Object.freeze({
  3: "不安なときに相手の様子を確かめたくなるのは、自然なことです。ただ、相手のスマホを見る・居場所を何度も確かめる、といったことが相手の気持ちと関係なく続くなら、それは性格の傾向ではなく、相手を縛る行動になっているかもしれません。",
  6: "話し合いを先に進められるのは、よいところでもあります。ただ、お金・予定・人づきあいを相手の気持ちと関係なく決めることが続くなら、それは性格の傾向ではなく、相手を縛る行動になっているかもしれません。",
});
export const SAFETY_NOTE_TAIL4 = "逆に、あなたがそうされていて怖いときも、相談できる窓口があります。";

/** 安全の1行を出す領域：[3] | [6] | [3, 6] | []（computeResult4 の結果。形が違えば []） */
export function safetyDomains4(result) {
  const doms = result && typeof result === "object" ? result.domains : null;
  if (!doms || typeof doms !== "object") return [];
  return SAFETY_DOMAINS4.filter((d) => doms[d]?.state === "strongA");
}

/** 安全の囲みの文 { domains, texts: [領域の文…], tail }。出さないときは null */
export function safetyNote4(result) {
  const domains = safetyDomains4(result);
  if (!domains.length) return null;
  return { domains, texts: domains.map((d) => SAFETY_NOTE4[d]), tail: SAFETY_NOTE_TAIL4 };
}

// ---------------------------------------------------------------- #types のいちばん下の注（型ごとのカードには出さない）
export const TYPES_SAFETY_NOTE = "スマホ・居場所・お金・人づきあいを、相手の気持ちと関係なく確かめたり決めたりすることが続くなら、それは型ではなく、相手を縛る行動かもしれません。そうされていて怖いときも、相談できる窓口があります。";

// ---------------------------------------------------------------- 小さな文の足し
/** マイページの「アプリとして使う」の節の最初の方 */
export const APP_PRIVACY_LINE = "端末を見られたくないときは、追加しないでください。ホーム画面に「喧嘩の答え」のアイコンと名前が残ります。";
/** お問い合わせ（#contact）の前置きの上 */
export const CONTACT_SAFETY_LINE = "いま危ないときは、お問い合わせではなく窓口へ。メールの返事には時間がかかります。";
/** 結果の画面の操作の［相談する］の小さな2行目 */
export const CONSULT_ROW_SUB = "次に喧嘩したら、ここに書くだけ";

// ---------------------------------------------------------------- 履歴の一覧に、相談で書いた文の冒頭を出すか（初めは出さない）
//   設定の読み書き（historySnippetOn・setHistorySnippet。キー seikaku16:app:history-snippet）は app/js/local.js。ここはマイページの文だけ
export const HISTORY_SNIPPET_LABEL = "履歴の一覧に、相談で書いた文の冒頭を出す";
export const HISTORY_SNIPPET_NOTE = "横に人がいるときに見られないよう、はじめは出していません。";
