// node tests/app_contact.test.mjs
// 新しい画面（app/）の「お問い合わせ」（#contact。docs/app-screens.md §17。決定 U39・U40）の DOM の無い部分（app/js/contact_form.js）
//  - isConfigured：既定（空）は false。Google フォームの formResponse と entry.数字 4つがそろったときだけ true
//  - contactMode：既定は "mail"（フォームが空でアドレスがある）。フォームが入れば "form"。どちらも無ければ "off"
//  - buildMail：件名・本文（CRLF）・mailto: の URL（encodeURIComponent。空白は "+" にしない）
//  - validate：種類・内容（空・1,000字まで・前後の空白）・返事の連絡先（任意。書いたらメールの形）
//  - deviceLabel：端末の種類の文。pwa.js の deviceKind（ios・android・other）
//  - buildBody：entry ごとの中身。内容は前後の空白を除く。返事の連絡先と端末は、あるときだけ
import assert from "node:assert/strict";
import { CONTACT_FORM, CONTACT_MAIL, CONTACT_KINDS, BODY_MAX, isConfigured, contactMode, countChars, validate, deviceLabel, buildBody, buildMail } from "../app/js/contact_form.js";
import { deviceKind } from "../app/js/pwa.js";

let fail = 0, pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n  ")); }
}

const ACTION = "https://docs.google.com/forms/d/e/1FAIpQLSfake0123456789/formResponse";
const FIELDS = { kind: "entry.111", body: "entry.222", reply: "entry.333", device: "entry.444" };
const CFG = { action: ACTION, fields: FIELDS };
const withAction = (action) => ({ action, fields: FIELDS });
const withFields = (over) => ({ action: ACTION, fields: { ...FIELDS, ...over } });

// ---------------------------------------------------------------- 送り先
test("既定（送り先が空）は送れない", () => {
  assert.equal(CONTACT_FORM.action, "");
  assert.deepEqual(Object.keys(CONTACT_FORM.fields), ["kind", "body", "reply", "device"]);
  assert.equal(isConfigured(), false);
  assert.equal(isConfigured(CONTACT_FORM), false);
});

test("formResponse と entry.数字 4つがそろえば送れる", () => {
  assert.equal(isConfigured(CFG), true);
  assert.equal(isConfigured(withAction("https://docs.google.com/forms/u/0/d/e/abc_DEF-1/formResponse")), true);
});

test("送り先の形が違うときは送れない", () => {
  for (const a of [
    "https://docs.google.com/forms/d/e/abc/viewform",            // 回答者用の URL のまま
    "http://docs.google.com/forms/d/e/abc/formResponse",         // https でない
    "https://docs.google.com.example.com/forms/d/e/abc/formResponse",
    "https://example.com/forms/d/e/abc/formResponse",
    "https://docs.google.com/document/d/abc/formResponse",       // forms でない
    "https://docs.google.com/forms/d/e/abc/formResponse?usp=pp_url",
    "https://docs.google.com/forms/d/e/abc/formResponse#x",
    "docs.google.com/forms/d/e/abc/formResponse",
  ]) assert.equal(isConfigured(withAction(a)), false, a);
  assert.equal(isConfigured(withFields({ reply: "" })), false, "1つ空");
  assert.equal(isConfigured(withFields({ body: "entry.abc" })), false, "数字でない");
  assert.equal(isConfigured(withFields({ device: "entry.444_sentinel" })), false);
  assert.equal(isConfigured(withFields({ device: "entry.111" })), false, "重なり");
  assert.equal(isConfigured(null), false);
  assert.equal(isConfigured({ action: ACTION }), false);
});

// ---------------------------------------------------------------- 送り方
test("送り方：既定はメール。フォームが入ればフォームが先。どちらも無ければ送れない", () => {
  assert.equal(CONTACT_MAIL, "bokuhagbpt@gmail.com");
  assert.equal(contactMode(), "mail");
  assert.equal(contactMode(CONTACT_FORM, CONTACT_MAIL), "mail");
  assert.equal(contactMode(CFG), "form");
  assert.equal(contactMode(CFG, ""), "form");
  for (const bad of ["", "  ", "bokuhagbpt", "me@example", "a b@example.com", "me@example.com?cc=x@y.jp", "me@example.com#x", "x@y.jp,z@w.jp", "a%3Fb@example.com", null]) {
    assert.equal(contactMode(CONTACT_FORM, bad), "off", String(bad));
  }
  assert.equal(contactMode(withAction("https://docs.google.com/forms/d/e/abc/viewform"), ""), "off", "形の違うフォーム＋アドレスなし");
});

// ---------------------------------------------------------------- 送る前の確かめ
test("種類・内容・返事の連絡先の確かめ", () => {
  assert.deepEqual(CONTACT_KINDS, ["使い方がわからない", "うまく動かない", "ご意見・ご要望", "その他"]);
  assert.equal(BODY_MAX, 1000);
  assert.deepEqual(validate({ kind: "その他", body: "画面が白くなります", reply: "" }), {});
  assert.deepEqual(validate({}), { kind: "種類を選んでください", body: "内容を書いてください" });
  assert.deepEqual(validate({ kind: "ほか", body: " \n　\t", reply: "" }), { kind: "種類を選んでください", body: "内容を書いてください" });
  assert.deepEqual(validate({ kind: "うまく動かない", body: "あ".repeat(1000) }), {}, "1,000字ちょうどはよい");
  assert.deepEqual(validate({ kind: "うまく動かない", body: "あ".repeat(1001) }), { body: "1,000字までにしてください" });
  assert.deepEqual(validate({ kind: "うまく動かない", body: `  ${"あ".repeat(1000)}\n\n` }), {}, "前後の空白は数えない");
  assert.deepEqual(validate({ kind: "うまく動かない", body: "😀".repeat(1000) }), {}, "絵文字も1字");
  assert.equal(countChars(" 😀あ\n"), 2);
  assert.deepEqual(validate({ kind: "ご意見・ご要望", body: "x", reply: " me@example.com " }), {});
  for (const bad of ["me@example", "me example@x.jp", "@example.com", "me@@x.jp"]) {
    assert.deepEqual(validate({ kind: "その他", body: "x", reply: bad }), { reply: "メールアドレスの形を確かめてください" }, bad);
  }
});

// ---------------------------------------------------------------- 端末の種類
test("端末の種類の文（deviceKind と組み合わせて）", () => {
  assert.equal(deviceLabel({ platform: "ios", standalone: true }), "iPhone・ホーム画面のアプリ");
  assert.equal(deviceLabel({ platform: "ios", standalone: false }), "iPhone・ブラウザ");
  assert.equal(deviceLabel({ platform: "android", standalone: false }), "Android・ブラウザ");
  assert.equal(deviceLabel({ platform: "android", standalone: true }), "Android・ホーム画面のアプリ");
  assert.equal(deviceLabel({ platform: "other", standalone: false }), "そのほか・ブラウザ");
  assert.equal(deviceLabel(), "そのほか・ブラウザ");
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
  const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const pc = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  assert.equal(deviceKind({ ua: iphone }), "ios");
  assert.equal(deviceKind({ ua: ipad, touch: 5 }), "ios");
  assert.equal(deviceKind({ ua: ipad, touch: 0 }), "other", "Mac");
  assert.equal(deviceKind({ ua: android }), "android");
  assert.equal(deviceKind({ ua: pc }), "other");
  assert.equal(deviceKind(), "other");
});

// ---------------------------------------------------------------- 送る中身
test("送る中身：entry ごと。内容は前後の空白を除き、返事の連絡先と端末はあるときだけ", () => {
  const all = buildBody({ kind: "うまく動かない", body: "\n  結果が出ません。\n2行目  \n", reply: " me@example.com ", device: "iPhone・ホーム画面のアプリ" }, CFG);
  assert.ok(all instanceof URLSearchParams);
  assert.deepEqual([...all.entries()], [
    ["entry.111", "うまく動かない"],
    ["entry.222", "結果が出ません。\n2行目"],
    ["entry.333", "me@example.com"],
    ["entry.444", "iPhone・ホーム画面のアプリ"],
  ]);
  const min = buildBody({ kind: "その他", body: "x", reply: "  ", device: "" }, CFG);
  assert.deepEqual([...min.keys()], ["entry.111", "entry.222"]);
  assert.equal(buildBody({ kind: "その他", body: "x" }, CFG).has("entry.444"), false, "端末を渡さない（チェックを外した）");
  assert.match(all.toString(), /^entry\.111=%E3%81%86/, "UTF-8 でフォームの形に");
});

// ---------------------------------------------------------------- メールの中身
test("メールの中身：件名・本文（CRLF）・mailto: の URL", () => {
  const m = buildMail({ kind: "うまく動かない", body: "\n  結果が 出ません。\n2行目  \n", device: "iPhone・ホーム画面のアプリ" });
  assert.equal(m.subject, "恋コンパス（試作）のお問い合わせ：うまく動かない");
  assert.equal(m.text, "種類：うまく動かない\r\n端末：iPhone・ホーム画面のアプリ\r\n\r\n結果が 出ません。\r\n2行目");
  assert.ok(m.href.startsWith("mailto:bokuhagbpt@gmail.com?subject="), m.href.slice(0, 60));
  assert.ok(m.href.includes("%0D%0A") && !/%0A/.test(m.href.replace(/%0D%0A/g, "")), "改行は %0D%0A だけ");
  assert.ok(!m.href.includes("+") && m.href.includes("%20"), "空白は %20（+ にしない）");
  const q = m.href.slice(m.href.indexOf("?") + 1).split("&");
  assert.deepEqual(q.map((kv) => kv.split("=")[0]), ["subject", "body"]);
  assert.equal(decodeURIComponent(q[0].slice("subject=".length)), m.subject);
  assert.equal(decodeURIComponent(q[1].slice("body=".length)), m.text);
  // 端末の文が空なら「端末：」の行を出さない。内容は前後の空白を除く
  const n = buildMail({ kind: "その他", body: "  x  ", device: "" });
  assert.equal(n.text, "種類：その他\r\n\r\nx");
  assert.equal(buildMail({ kind: "その他", body: "x" }).text, "種類：その他\r\n\r\nx", "端末を渡さない");
  // 1,000字の日本語でも href は約 9,000〜10,000字（docs/app-screens.md §17）
  const long = buildMail({ kind: "ご意見・ご要望", body: "あ".repeat(BODY_MAX), device: "Android・ブラウザ" }).href.length;
  assert.ok(long > 9000 && long < 10000, String(long));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
