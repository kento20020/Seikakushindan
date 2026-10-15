// 相談（試作）の「次の一手カード」の表示。カードの形は js/consult/card.js、並び順は docs/consult-answer-guide.md §2.2。
// 文字はすべて textContent で入れる（dom.js の h）。AI の返したカードでも、タグとして解釈されない。
import { h, copyText, toast } from "./dom.js";
import { SECTION_LABELS } from "../consult/card.js";
import { doNowLabel } from "../consult/texts.js";
import { checkDraft } from "../consult/draft_check.js";

/** 送る前チェックで当たったものの言い方（draft_check.js の hits[].id） */
export const HIT_REASON = {
  interrogate: "問い詰めに聞こえやすい形",
  generalize: "決めつけに聞こえやすい言葉",
  character: "人柄への批判に聞こえやすい形",
  past: "前のことを持ち出す形",
  ultimatum: "最後通告に聞こえやすい言葉",
  read_receipt: "既読を責める形",
  sarcasm: "皮肉に聞こえやすい言葉",
  but_apology: "「でも」がつく謝り方",
  third_party: "ほかの人の名前を出す形",
  asks_reply: "返事を求める形",
  mentions_diagnosis: "診断やタイプの話が入っている",
  forbidden: "勝ち負けや確率の言葉",
  long: "", missing_time: "",   // hit.text がそのまま説明
};
const LEVEL_CLASS = { "届きやすい": "ok", "ふつう": "mid", "届きにくい": "low" };
const LEVEL_MARK = { "届きやすい": "✓", "ふつう": "○", "届きにくい": "△" };
const LEVEL_NOTE = {
  "届きやすい": "言い方の面で、引っかかりそうな点は見つかりませんでした",
  "ふつう": "気になる点が少しあります。直せるなら直してから",
  "届きにくい": "相手に強く聞こえそうな点があります。言い換えるのがおすすめです",
};

/** 「条件 → すること」を条件とすることに分ける（矢印がなければ全体を1つに） */
export function splitArrow(text) {
  const i = String(text ?? "").indexOf("→");
  if (i < 0) return { cond: null, act: String(text ?? "").trim() };
  return { cond: text.slice(0, i).trim(), act: text.slice(i + 1).trim() };
}

/** 電話番号らしい連絡先なら tel: の href（# は %23 にする）。そうでなければ null */
export function telHref(contact) {
  const s = String(contact ?? "").replace(/[＃]/g, "#").replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[-\s]/g, "");
  return /^#?\d{3,12}$/.test(s) ? `tel:${s.replace("#", "%23")}` : null;
}

const section = (cls, title, ...body) => h("section", { class: ["cs-sec", cls] }, title ? h("h3", { class: "cs-sec-title" }, title) : null, body);

// ---------------------------------------------------------------- 文面（編集できる箱・コピー・送る前チェック）
function fitHeight(ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight + 2}px`; }

function draftBox(draft, i, { action, avoid }) {
  const original = draft.text;
  const ta = h("textarea", { class: "cs-draft-text", rows: 1, spellcheck: "false", "aria-label": `${draft.label}（編集できます）` });
  ta.value = original;
  const badge = h("span", { class: "cs-badge", role: "status" });
  const note = h("span", { class: "cs-check-note" });
  const hits = h("ul", { class: "cs-hits" });
  const reset = h("button", { type: "button", class: "linkish cs-reset", hidden: true, onclick: () => { ta.value = original; update(); ta.focus(); } }, "もとに戻す");
  const copyBtn = h("button", { type: "button", class: "btn small cs-copy", onclick: async () => {
    const ok = await copyText(ta.value);
    toast(ok ? "コピーしました" : "コピーできませんでした。文面を選んでコピーしてください");
    if (ok) { copyBtn.textContent = "コピーしました"; clearTimeout(copyBtn._t); copyBtn._t = setTimeout(() => { copyBtn.textContent = "コピー"; }, 1600); }
  } }, "コピー");
  const count = h("span", { class: "cs-count" });

  function update() {
    fitHeight(ta);
    const r = checkDraft(ta.value, { action, avoid });
    const cls = LEVEL_CLASS[r.level] ?? "mid";
    badge.className = `cs-badge cs-badge-${cls}`;
    const label = `${LEVEL_MARK[r.level] ?? ""} ${r.level}`;
    if (badge.textContent !== label) badge.textContent = label;
    note.textContent = LEVEL_NOTE[r.level] ?? "";
    hits.replaceChildren(...r.hits.map(x => {
      const reason = HIT_REASON[x.id];
      return h("li", null,
        reason ? h("q", { class: "cs-hit-q" }, x.text) : null,
        h("span", { class: "cs-hit-why" }, reason || x.text));
    }));
    hits.hidden = r.hits.length === 0;
    reset.hidden = ta.value === original;
    count.textContent = `${[...ta.value].length}字`;
    ta.dataset.level = r.level;
  }
  ta.addEventListener("input", update);

  const box = h("div", { class: "cs-draft", "data-draft": i },
    h("h4", { class: "cs-draft-label" }, draft.label),
    ta,
    h("div", { class: "cs-draft-bar" },
      h("div", { class: "cs-check" }, h("span", { class: "cs-check-label" }, "送る前チェック"), badge),
      copyBtn),
    h("div", { class: "cs-draft-foot" }, note, h("span", { class: "cs-draft-meta" }, count, reset)),
    hits);
  box._fit = () => update();   // 画面に載ってから高さを合わせ直すため
  update();
  return box;
}

// ---------------------------------------------------------------- 次の一手カード
/**
 * @param {import("../consult/card.js").ConsultCard} card
 * @param {{ action: string|null, avoid: string[]|null }} result  judge の出力（action・avoid）
 * @returns {HTMLElement}
 */
export function answerCard(card, result) {
  if (card.kind === "safety" && card.safety) return safetyCard(card);
  const action = result?.action ?? null, avoid = result?.avoid ?? null;
  const draftBoxes = card.drafts.map((d, i) => draftBox(d, i, { action, avoid }));
  const art = h("article", { class: "cs-answer", "aria-labelledby": "cs-headline" },
    h("div", { class: "cs-hero" },
      h("p", { class: "cs-eyebrow" }, "次の一手"),
      h("h2", { class: "cs-headline", id: "cs-headline", tabindex: "-1" }, card.headline),
      card.addonLines.length ? h("ul", { class: "cs-addons" }, card.addonLines.map(t => h("li", null, t))) : null,
      card.timingLine ? h("p", { class: "cs-timing" }, card.timingLine) : null),
    card.reasons.length ? section("cs-reasons", SECTION_LABELS.reasons, h("ol", { class: "cs-reason-list" }, card.reasons.map(t => h("li", null, t)))) : null,
    draftBoxes.length ? section("cs-drafts", null, draftBoxes) : null,
    card.variantLines.length ? section("cs-variants", SECTION_LABELS.variants,
      h("ul", { class: "cs-variant-list" }, card.variantLines.map(t => {
        const { cond, act } = splitArrow(t);
        return h("li", null, cond ? h("b", { class: "cs-cond" }, cond) : null, h("span", { class: "cs-act" }, act));
      }))) : null,
    card.doNow ? h("section", { class: "cs-sec cs-donow" }, h("h3", { class: "cs-sec-title" }, doNowLabel(action)), h("p", null, card.doNow)) : null,
    card.avoid.length ? section("cs-avoid", SECTION_LABELS.avoid,
      h("ul", { class: "cs-chips" }, card.avoid.map(t => h("li", { class: "cs-avoid-chip" }, `「${t}」`)))) : null,
    card.ifReply || card.ifNoReply ? section("cs-after", SECTION_LABELS.after,
      h("ul", { class: "cs-after-list" }, [card.ifReply, card.ifNoReply].filter(Boolean).map(t => {
        const { cond, act } = splitArrow(t);
        return h("li", null, cond ? h("b", { class: "cs-cond" }, cond) : null, h("span", { class: "cs-act" }, act));
      }))) : null,
    card.confidenceLine ? h("p", { class: "cs-confidence" }, h("b", null, SECTION_LABELS.confidence), card.confidenceLine) : null);
  art._draftBoxes = draftBoxes;
  return art;
}

/** 文面の高さを、画面に載ったあとで合わせ直す（載る前は scrollHeight が 0 になるため） */
export function fitDrafts(art) { for (const b of art?._draftBoxes ?? []) b._fit?.(); }

// ---------------------------------------------------------------- 安全ゲートのカード（落ち着いた並び。文面・避けたい言葉はない）
function safetyCard(card) {
  const s = card.safety;
  const paras = s.intro.split(/(?=今回は、)/).map(t => t.trim()).filter(Boolean);
  return h("article", { class: ["cs-answer", "cs-safety-card"], "aria-labelledby": "cs-headline" },
    h("div", { class: "cs-hero cs-hero-safety" },
      h("p", { class: "cs-eyebrow" }, "安全のために"),
      h("h2", { class: "cs-headline", id: "cs-headline", tabindex: "-1" }, card.headline),
      paras.map((t, i) => h("p", { class: i ? "cs-safety-note" : "cs-safety-intro" }, t))),
    section("cs-resources", SECTION_LABELS.resources,
      h("ul", { class: "cs-resource-list" }, s.resources.map(r => {
        const href = telHref(r.contact);
        return h("li", { class: "cs-resource" },
          h("div", { class: "cs-resource-main" },
            h("b", { class: "cs-resource-name" }, r.name),
            h("span", { class: "cs-resource-note" }, r.note)),
          href
            ? h("a", { class: "btn cs-tel", href, "aria-label": `${r.name}に電話する ${r.contact}` }, h("span", { class: "cs-tel-label" }, "電話する"), h("span", { class: "cs-tel-num" }, r.contact))
            : h("span", { class: "cs-tel-plain" }, r.contact));
      }))),
    s.steps.length ? section("cs-steps", SECTION_LABELS.steps, h("ol", { class: "cs-reason-list" }, s.steps.map(t => h("li", null, t)))) : null,
    h("p", { class: "cs-safety-closing" }, s.closing));
}
