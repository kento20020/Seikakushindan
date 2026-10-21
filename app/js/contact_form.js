// お問い合わせ（#contact）の送り先と、送る前の確かめ。仕様：docs/app-screens.md §17（決定 U39・U40）
// DOM を使わない（Node のテストでも動く）。画面は app/js/contact.js
//
//   送り方は3つ（contactMode）。Google フォームが入っていればフォーム、無ければメール、どちらも無ければ送れない
//   CONTACT_FORM          … 送り先（Google フォーム）。action（送る URL）と、4つの質問の名前（fields。entry.数字）。今は空
//   CONTACT_MAIL          … 送り先のメールアドレス（決定 U40）。利用者のメールのアプリを開いて送ってもらう（mailto）
//   isConfigured(cfg)     … Google フォームの送り先が入っているか
//   contactMode(cfg,mail) … "form"（フォームが入っている。こちらが先）| "mail"（メールのアドレスがある）| "off"（どちらも無い。画面は［送る］を押せない）
//   CONTACT_KINDS         … 種類の選択肢（この順で出す）
//   BODY_MAX              … 内容の長さの上限（字）。countChars で数える
//   countChars(text)      … 字数（前後の空白を除いて数える。絵文字も1字）
//   validate(values)      … 直すところ { kind?, body?, reply? }（欄ごとの文）。無ければ {}
//   deviceLabel(opts)     … 端末の種類の文（「iPhone・ホーム画面のアプリ」など）
//   buildBody(values,cfg) … 送る中身（URLSearchParams。Google フォームの entry.数字＝答え）
//   buildMail(values,mail) … メールの中身 { href（mailto: の URL）, subject（件名）, text（本文） }
//
// 送り先の入れ方（持ち主がフォームを作って、回答者用の URL を AI に渡したあと。§17.5。U40 からはメールで送れるので、フォームは任意）
//   入れると contactMode() が "form" になり、メールよりフォームが先になる
//   1. 回答者用の URL は https://docs.google.com/forms/d/e/<id>/viewform の形。末尾の viewform を formResponse に替えて action に入れる
//        例 action: "https://docs.google.com/forms/d/e/1FAIpQLSexample/formResponse"
//   2. 4つの質問（種類・内容・返事の連絡先・端末）の名前（entry.数字）を fields に入れる。調べ方はどちらか
//        - フォームのページ（viewform）を開き、ページの中身（HTML）の entry.数字 を探す（質問の順に並ぶ）
//        - フォームの編集画面の︙ →「事前入力した URL を取得」→ 4つの欄にそれぞれ別の文を書いて「リンクを取得」→
//          できた URL の entry.数字=文 を、質問の順に読む
//        例 fields: { kind: "entry.1111111111", body: "entry.2222222222", reply: "entry.3333333333", device: "entry.4444444444" }
//   3. この URL と entry の番号は秘密ではない（フォームを開けば誰でも見える）。入れたら tests/app_contact.test.mjs と画面で確かめる
export const CONTACT_FORM = {
  action: "",
  fields: { kind: "", body: "", reply: "", device: "" },
};

// 送り先のメールアドレス（決定 U40。2026-10-20 持ち主「メールアドレス。bokuhagbpt@gmail.com にして」）。
//   持ち主が、このアドレスをページに出すことも選んだ（わざと公開している。秘密ではない）。
//   CONTACT_FORM が入ったら、そちらが先（contactMode）。メールで送る形も、このアドレスを "" にすれば止められる
export const CONTACT_MAIL = "bokuhagbpt@gmail.com";

export const CONTACT_KINDS = Object.freeze(["使い方がわからない", "うまく動かない", "ご意見・ご要望", "その他"]);
export const BODY_MAX = 1000;

const FIELD_KEYS = ["kind", "body", "reply", "device"];
const ENTRY_RE = /^entry\.\d+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// mailto: の宛先に使うアドレスの形（? & # , % などが入ると、件名・本文の区切りや符号と混ざるので、使える文字を絞る）
const MAIL_ADDR_RE = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

const text = (v) => (v == null ? "" : String(v));

/**
 * 送り先が入っているか
 *   action：https://docs.google.com/forms/… で、末尾が /formResponse（? や # は付けない）
 *   fields：4つとも entry.数字 で、重ならない（重なると、片方の答えが消えるため）
 */
export function isConfigured(cfg = CONTACT_FORM) {
  if (!cfg || typeof cfg !== "object") return false;
  const action = text(cfg.action);
  let url;
  try { url = new URL(action); } catch { return false; }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.port) return false;
  if (url.search || url.hash || action.includes("?") || action.includes("#")) return false;
  if (!url.pathname.startsWith("/forms/") || !url.pathname.endsWith("/formResponse")) return false;
  const fields = cfg.fields;
  if (!fields || typeof fields !== "object") return false;
  const names = FIELD_KEYS.map((k) => text(fields[k]));
  if (!names.every((n) => ENTRY_RE.test(n))) return false;
  return new Set(names).size === names.length;
}

/**
 * 送り方（画面を出すときに1回決める）
 *   "form" … Google フォームの送り先が入っている（isConfigured）。メールのアドレスがあっても、こちらが先
 *   "mail" … フォームは無いが、メールのアドレスがある（mailto: の宛先に使える形）
 *   "off"  … どちらも無い。画面は［送る］を押せないようにし、何も送らない・開かない
 */
export function contactMode(cfg = CONTACT_FORM, mail = CONTACT_MAIL) {
  if (isConfigured(cfg)) return "form";
  if (MAIL_ADDR_RE.test(text(mail))) return "mail";
  return "off";
}

/** 字数。前後の空白を除いて、文字（コードポイント）で数える（絵文字も1字） */
export function countChars(value) {
  return [...text(value).trim()].length;
}

/**
 * 送る前の確かめ。直すところを欄ごとに返す（無ければ {}）
 *   kind  … CONTACT_KINDS のどれか
 *   body  … 前後の空白を除いて1字以上、BODY_MAX 字まで
 *   reply … 書かなくてよい。書いたときはメールアドレスの形（前後の空白は除く）。メールで送るときは、画面が reply を渡さない（欄が無い）
 */
export function validate({ kind, body, reply } = {}) {
  const errors = {};
  if (!CONTACT_KINDS.includes(kind)) errors.kind = "種類を選んでください";
  const n = countChars(body);
  if (n === 0) errors.body = "内容を書いてください";
  else if (n > BODY_MAX) errors.body = "1,000字までにしてください";
  const mail = text(reply).trim();
  if (mail && !EMAIL_RE.test(mail)) errors.reply = "メールアドレスの形を確かめてください";
  return errors;
}

/**
 * 端末の種類の文。不具合を直すときの手がかり（機種・版・UA は送らない）
 *   platform … "ios"（app/js/pwa.js の currentPlatform・currentDevice。iPhone・iPad）| "android"（currentDevice）| それ以外
 *   standalone … ホーム画面のアプリとして開いているか
 *   例 "iPhone・ホーム画面のアプリ"、"Android・ブラウザ"、"そのほか・ブラウザ"
 */
export function deviceLabel({ platform, standalone } = {}) {
  const os = platform === "ios" ? "iPhone" : platform === "android" ? "Android" : "そのほか";
  return `${os}・${standalone ? "ホーム画面のアプリ" : "ブラウザ"}`;
}

/**
 * 送る中身（URLSearchParams。fetch の body に渡すと application/x-www-form-urlencoded で送られる）
 *   種類・内容（前後の空白を除く）はいつも。返事の連絡先は書いたときだけ。端末は文を渡したときだけ（チェックを外したら "" を渡す）
 */
export function buildBody({ kind, body, reply, device } = {}, cfg = CONTACT_FORM) {
  const f = cfg?.fields || {};
  const params = new URLSearchParams();
  params.set(text(f.kind), text(kind));
  params.set(text(f.body), text(body).trim());
  const mail = text(reply).trim();
  if (mail) params.set(text(f.reply), mail);
  const dev = text(device).trim();
  if (dev) params.set(text(f.device), dev);
  return params;
}

/**
 * メールの中身。画面は href を開く（利用者のメールのアプリが、宛先・件名・本文の入った形で開く）
 *   subject … 「喧嘩の答え（試作）のお問い合わせ：種類」（サービス名は決定 U43）
 *   text    … 「種類：…」「端末：…」（端末は文を渡したときだけ）、空の行、内容（前後の空白を除く）。改行は CRLF（RFC 6068）
 *   href    … mailto:アドレス?subject=…&body=…。encodeURIComponent で符号化する
 *             （URLSearchParams は空白を "+" にし、メールのアプリによっては "+" のまま出るため使わない）
 *   返事の連絡先は入れない（メールで送るので、利用者のアドレスが運営者に届く）
 *   長さ：日本語 1,000字の内容で href は約 9,000〜10,000字になる。パソコンのメールのアプリには、長い mailto: を
 *   途中で切る物があるので、画面は宛先と文をコピーできるようにしておく（docs/app-screens.md §17.3）
 */
export function buildMail({ kind, body, device } = {}, mail = CONTACT_MAIL) {
  const crlf = (v) => v.replace(/\r\n|\r|\n/g, "\r\n");
  const subject = `喧嘩の答え（試作）のお問い合わせ：${text(kind)}`;
  const lines = [`種類：${text(kind)}`];
  const dev = text(device).trim();
  if (dev) lines.push(`端末：${dev}`);
  lines.push("", crlf(text(body).trim()));
  const out = lines.join("\r\n");
  const href = `mailto:${text(mail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(out)}`;
  return { href, subject, text: out };
}
