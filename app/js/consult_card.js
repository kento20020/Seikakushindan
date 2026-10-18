// 相談の「次の一手カード」の部品（app/ の見た目）。流れは app/js/consult.js、仕様は docs/app-screens.md §4.6。
// 中身は poc/card/model.js の buildPoc の結果（判定・文型は js/consult/ の本物）。並びは統合3（C6・U16、U23〜U25）：
//   伝えたいのは（小さな1行）→ 結論 → 送るのを朝に回す行 → 戻る時刻（待つ一手）→ 理由の1行目［なぜ？］→ 文面（右上に小さな［コピー］）／待つ間に
//   → 足さない方がいい一言 →（線）→ このあと → 道のり → 確かさ［もっと合わせる］
// 「預ける」は無し（U25）。端末の外には何も送らない（タイマーは端末の中に時刻を残すだけ）。
//
//   liveCard(m, opts)        画面で使うカード（［ちがう］［なぜ？］［コピー］［タイマー］［それでも今送りたい］［もっと合わせる］が動く）
//   safetyCardView(card)     安全のカード（窓口の番号・すること）
//   safetyLine(resources)    窓口の1行（安全の確認の画面と、続けるときのカードの一番上）
//   snapshotOf(m)            履歴に残す形（JSON。カードを描き直すのに要るものだけ）
//   savedView(record)        履歴の詳細で「そのときのカード」と、そのあとのやりとり（続き）を読むだけの形で出す
//   bubbleView(item)         続き（往復）の吹き出し（自分＝右、アプリ＝左）。docs/app-screens.md §11
//   pastCardView(c, at)      たたんだ前のカード（押すと読むだけのカード）
//   threadReadView(items)    やりとりを読むだけの形で（履歴の詳細）
import { h, icon, toast, fmtDate } from "./ui.js";
import { checkDraft, LEVELS } from "../../js/consult/draft_check.js";
import { doNowLabel } from "../../js/consult/texts.js";
import * as M from "../../poc/card/model.js";

const SVG_NS = "http://www.w3.org/2000/svg";
let uidN = 0;
const uid = (p) => `a-cs-${p}-${++uidN}`;

/** ui.js に無い線のアイコン（時計）。同じ線の太さ・viewBox */
function clockIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "a-ic a-ic-clock");
  for (const [k, v] of Object.entries({ width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(k, v);
  svg.innerHTML = '<circle cx="12" cy="13" r="7.75"/><path d="M12 9.25V13l2.5 1.75"/><path d="M9.5 2.75h5"/>';
  return svg;
}

// ---------------------------------------------------------------- タイマー（端末の中に「いつまで」と「いつ押したか」だけ残す。使えなくても動く）
const TIMER_KEY = "seikaku16:app:consult-timer";
const timerStore = {
  get() { try { const v = localStorage.getItem(TIMER_KEY); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(v) { try { localStorage.setItem(TIMER_KEY, JSON.stringify(v)); } catch { /* 使えない */ } },
  del() { try { localStorage.removeItem(TIMER_KEY); } catch { /* 使えない */ } },
};

// ---------------------------------------------------------------- 小さな道具
/** 開け閉めのボタン（パネルの id を aria-controls に）。開いたら中の最初の押せる物へ焦点 */
export function toggler(label, panel, cls = "a-link a-link-tap", { chevron = false } = {}) {
  const b = h("button", { type: "button", class: cls, "aria-expanded": "false", "aria-controls": panel.id }, h("span", null, label), chevron ? icon("chevron-down", { size: 16 }) : null);
  b.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    b.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) panel.querySelector("button, textarea, a")?.focus({ preventScroll: true });
  });
  return b;
}

function selectText(el) {
  try {
    if (el.select) { el.focus(); el.select(); return; }
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  } catch { /* 選べない */ }
}
/** 文をコピーする。使えない端末では文を選んで知らせる */
export async function copyText(text, el) {
  const v = String(text || "").trim();
  if (!v) return false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
    await navigator.clipboard.writeText(v);
    toast("コピーしました");
    return true;
  } catch {
    selectText(el);
    toast("文を選びました。そのままコピーできます");
    return false;
  }
}

// ---------------------------------------------------------------- 安全
/** 窓口の1行（「すぐに話したいとき」＋番号。番号は押すと電話になる） */
export function safetyLine(resources, lead = "危ないと感じたら") {
  return h("p", { class: "a-cs-safety-line" },
    h("span", { class: "a-cs-safety-lead" }, lead),
    resources.map(r => h("a", { class: "a-cs-tel-inline", href: M.telHref(r.contact) }, h("span", null, r.name), " ", h("span", { class: "a-nowrap" }, r.contact))));
}

/** 安全のカード（headline・intro・窓口・すること・結び） */
export function safetyCardView(card, { fresh = false, headingTag = "h2" } = {}) {
  const s = card.safety;
  return h("article", { class: ["a-card", "a-cs-card", "is-safety", fresh && "is-enter"], "aria-labelledby": "a-cs-safety-head" },
    h(headingTag, { class: "a-cs-headline", id: "a-cs-safety-head", tabindex: "-1", "data-focus": true }, card.headline),
    h("p", { class: "a-cs-reason" }, s.intro),
    h("ul", { class: "a-cs-res" }, s.resources.map(r => h("li", null,
      h("span", { class: "a-cs-res-name" }, r.name),
      h("a", { class: "a-cs-tel", href: M.telHref(r.contact) }, r.contact),
      h("span", { class: "a-cs-small" }, r.note)))),
    h("ul", { class: "a-cs-steps" }, s.steps.map(t => h("li", null, t))),
    h("p", { class: "a-cs-small" }, s.closing));
}

// ---------------------------------------------------------------- 文面（送る吹き出し。［コピー］は右上の小さなボタン：U24）
function copyButton(getText, getEl) {
  let resetT = null;
  const slot = h("span", { class: "a-cs-copy-ic" }, icon("copy", { size: 16 }));
  const word = h("span", null, "コピー");
  const btn = h("button", { type: "button", class: "a-cs-copy" }, h("span", { class: "a-cs-copy-pill" }, slot, word));
  const setDone = (on) => {
    word.textContent = on ? "コピー済み" : "コピー";
    slot.replaceChildren(icon(on ? "check" : "copy", { size: 16 }));
    btn.classList.toggle("is-done", on);
  };
  btn.addEventListener("click", async () => {
    if (await copyText(getText(), getEl())) {
      setDone(true);
      clearTimeout(resetT);
      resetT = setTimeout(() => setDone(false), 2000);
    }
  });
  return { btn, reset: () => { clearTimeout(resetT); setDone(false); } };
}

/** 文面のまとまり：上の行（見出し＋［コピー］）・吹き出し・「別の言い方」（あれば） */
function draftUnit(drafts, label) {
  let i = 0;
  const bubble = h("p", { class: "a-cs-bubble" }, drafts[0].text);
  const copy = copyButton(() => bubble.textContent, () => bubble);
  let alt = null;
  if (drafts[1]) {
    alt = h("button", { type: "button", class: "a-cs-inline", "aria-pressed": "false" }, "別の言い方");
    alt.addEventListener("click", () => {
      i = 1 - i;
      bubble.textContent = drafts[i].text;
      alt.textContent = i ? "最初の言い方" : "別の言い方";
      alt.setAttribute("aria-pressed", String(!!i));
      copy.reset();
    });
  }
  return [
    h("div", { class: "a-cs-send-top" }, label ? h("span", { class: "a-cs-label" }, label) : h("span"), copy.btn),
    bubble,
    alt ? h("div", { class: "a-cs-send-foot" }, alt) : null,
  ];
}

/** 足さない方がいい一言（文面のすぐ下） */
function avoidLine(avoid) {
  if (!avoid?.length) return null;
  return h("p", { class: "a-cs-dont" }, h("span", { class: "a-cs-stop" }, "足さない方がいい一言："), avoid.map(M.avoidPhrase).join(""));
}

/** 「返事が来たら → …」を「返事が来たら、…」に（条件を太く） */
function condLine(text) {
  const i = text.indexOf(" → ");
  if (i < 0) return h("p", { class: "a-cs-cond" }, text);
  return h("p", { class: "a-cs-cond" }, h("b", null, text.slice(0, i)), "、", text.slice(i + 3));
}

function guessP(guess) {
  if (!guess) return null;
  return h("p", { class: "a-cs-guess" }, h("b", null, "相手はたぶん"), "、", guess, " ",
    h("span", { class: "a-cs-tag", title: "AI がつながるまでの、決まった仮の文です" }, "仮の文"));
}

function afterBlock({ guess, addonLines = [], ifReply, ifNoReply }) {
  return h("section", { class: "a-cs-sec", "aria-label": "このあと" },
    h("p", { class: "a-cs-label", "aria-hidden": "true" }, "このあと"),
    guessP(guess),
    addonLines.map(t => h("p", { class: "a-cs-cond" }, t)),
    ifReply ? condLine(ifReply) : null,
    ifNoReply ? condLine(ifNoReply) : null);
}

/** 道のり：①落ち着く → ②話す場をつくる → ③伝える → ④分かってもらう。いまの段を示す */
function roadView(step) {
  const marks = ["①", "②", "③", "④"];
  return h("section", { class: "a-cs-sec" },
    h("ol", { class: "a-cs-road", "aria-label": "仲直りまでの道のり" }, M.ROAD.map((name, i) =>
      h("li", { "aria-current": i === step ? "step" : null }, `${marks[i]}${name}`, i === step ? h("span", { class: "a-cs-here" }, "いまはここ") : null))));
}

// ---------------------------------------------------------------- 画面で使うカード
/**
 * @param {object} m  M.buildPoc の結果
 * @param {{ now: Date, fresh?: boolean, timers: Set<Function>, onWant: (patch) => void, onRefine: (patch) => void }} o
 */
export function liveCard(m, o) {
  if (m.mode === "safety") return safetyCardView(m.card, { fresh: o.fresh });
  const headId = uid("head");
  const art = h("article", { class: ["a-card", "a-cs-card", o.fresh && "is-enter"], "aria-labelledby": headId });
  const decide = h("div", { class: "a-cs-decide" },
    m.safetyLine ? safetyLine(m.safetyLine) : null,
    m.want ? wantLine(m, o.onWant) : null,
    h("h2", { class: "a-cs-headline", id: headId, tabindex: "-1", "data-focus": true }, m.headline),
    m.timingLine ? h("p", { class: "a-cs-timing" }, m.timingLine) : null,
    m.ret ? timeBlock(m, o.now, o.timers) : null,
    reasonFirst(m.reasons),
    m.mode === "send" ? sendBlock(m) : waitBlock(m));
  const later = h("div", { class: "a-cs-later" },
    afterBlock({ guess: m.guess, addonLines: m.card.addonLines, ifReply: m.card.ifReply, ifNoReply: m.card.ifNoReply }),
    m.road != null ? roadView(m.road) : null,
    confBlock(m, o.onRefine));
  art.append(decide, h("hr", { class: "a-cs-rule" }), later);
  return art;
}

/** 伝えたいのは：…［ちがう］（選び直すとカードを作り直す） */
function wantLine(m, onWant) {
  const id = uid("want");
  const chooser = h("div", { class: "a-cs-choose", id, hidden: true, role: "group", "aria-label": "どうしたい？" },
    h("p", { class: "a-cs-edit-q" }, "どうしたい？"),
    h("div", { class: "a-cs-chip-row" }, M.WANTS.map(w => {
      const on = w.key === m.want.key;
      return h("button", { type: "button", class: "a-cs-chip", "aria-pressed": String(on), onclick: () => {
        const p = M.wantPatch(w.key, m.ctx.input);
        if (!Object.keys(p).length) { chooser.hidden = true; return; }
        onWant(p);
      } }, on ? icon("check", { size: 16 }) : null, w.label);
    })));
  return h("div", { class: "a-cs-want-wrap" },
    h("p", { class: "a-cs-want" }, h("span", null, h("b", null, "伝えたいのは"), "：", m.want.text), " ", toggler("ちがう", chooser, "a-cs-inline")),
    chooser);
}

/** 理由の1行目（無料で全員に。U23）。2行目からは［なぜ？］で開く */
function reasonFirst(rs) {
  const p = h("p", { class: "a-cs-reason" }, rs[0] ?? "");
  if (rs.length < 2) return p;
  const panel = h("ul", { class: "a-cs-why", id: uid("why"), hidden: true }, rs.slice(1).map(t => h("li", null, t)));
  p.append(" ", toggler("なぜ？", panel, "a-cs-inline is-strong"));
  return h("div", { class: "a-cs-reason-wrap" }, p, panel);
}

/** 戻る時刻（大きな数字）＋細い進み具合の線＋［タイマー］。時刻まで待つ一手だけ */
function timeBlock(m, now, timers) {
  const r = m.ret;
  const fill = h("i"), dot = h("b");
  const remain = h("span", { class: "a-cs-remain", "aria-live": "polite" });
  const btnLabel = h("span", null, "タイマー");
  const btn = h("button", { type: "button", class: "a-cs-timer", "aria-pressed": "false" }, clockIcon(), btnLabel);
  const key = r.at.toISOString();
  const update = () => {
    const t = timerStore.get();
    const on = t?.at === key;
    btn.setAttribute("aria-pressed", String(on));
    btnLabel.textContent = on ? "タイマーを止める" : "タイマー";
    const n = new Date();
    const p = on ? M.progressOf(new Date(t.start), r.at, n) : 0;
    fill.style.width = `${(p * 100).toFixed(1)}%`;
    dot.style.left = `${(p * 100).toFixed(1)}%`;
    remain.textContent = on ? M.remainingText(r.at, n) : "";
  };
  btn.addEventListener("click", () => {
    const t = timerStore.get();
    if (t?.at === key) timerStore.del();
    else timerStore.set({ at: key, start: new Date().toISOString() });
    update();
  });
  update();
  timers?.add(update);
  return h("div", { class: "a-cs-time" },
    h("div", { class: "a-cs-time-row" },
      h("p", { class: "a-cs-time-main" }, h("span", { class: "a-cs-label" }, M.timeLabel(m.result.action)), h("span", { class: "a-cs-big" }, r.text)),
      btn),
    h("div", { class: "a-cs-track", "aria-hidden": "true" }, fill, dot),
    h("p", { class: "a-cs-time-foot" }, h("span", null, `いま ${M.clockOf(now)}${r.approx ? `（朝は${M.MORNING_HOUR}時を目安にしています）` : ""}`), remain));
}

function sendBlock(m) {
  const d = m.card.drafts;
  if (!d.length) return avoidLine(m.card.avoid);
  return h("div", { class: "a-cs-send" }, draftUnit(d, d[0].label), avoidLine(m.card.avoid));
}

/** 待つ一手：待つ間に →［それでも今送りたい］と「期限が来たら、この1通」（押すと、そのすぐ下に開く） */
function waitBlock(m) {
  const a = m.result.action;
  const urge = urgePanel();
  const links = h("div", { class: "a-cs-links" }, h("div", null, toggler("それでも今送りたい", urge, "a-link a-link-tap a-cs-toggle", { chevron: true })), urge);
  if (m.card.drafts.length) {
    const later = h("div", { class: "a-cs-later-draft", id: uid("laterdraft"), hidden: true }, draftUnit(m.card.drafts, null));
    links.append(h("div", null, toggler(m.card.drafts[0].label, later, "a-link a-link-tap a-cs-toggle", { chevron: true })), later);
  }
  return h("div", { class: "a-cs-send is-wait" },
    m.doNow ? h("p", { class: "a-cs-donow" }, h("span", { class: "a-cs-label" }, doNowLabel(a)), m.doNow) : null,
    links,
    avoidLine(m.card.avoid));
}

/** それでも今送りたい：送りたい文の欄 → 送る前チェック（届きやすさ3段階・数字なし）と避けたい言葉の印 */
function urgePanel() {
  const id = uid("urge");
  const ta = h("textarea", { class: "a-textarea a-cs-urge-input", rows: "3", "aria-label": "送りたい文", placeholder: "送りたい文を書いてください" });
  const level = h("p", { class: "a-cs-level" });
  const hits = h("ul", { class: "a-cs-hits" });
  const result = h("div", { class: "a-cs-check", "aria-live": "polite" }, level, hits);
  const run = () => {
    const v = ta.value.trim();
    hits.replaceChildren();
    if (!v) { level.replaceChildren("書くと、相手に届きやすいかをここに出します。"); level.className = "a-cs-level is-empty"; return; }
    // 一手に逆らって送る文なので、局面の避ける言葉に限らず全部を見る
    const r = checkDraft(v, { action: null, avoid: null });
    level.className = `a-cs-level${r.level === LEVELS[2] ? " is-stop" : ""}`;
    level.replaceChildren("届きやすさ：", h("b", null, r.level));
    for (const x of r.hits) {
      hits.append(h("li", null, x.id === "long" || x.id === "missing_time"
        ? M.HIT_LABELS[x.id]
        : h("span", null, h("mark", null, `「${x.text}」`), M.HIT_LABELS[x.id] ?? "")));
    }
  };
  ta.addEventListener("input", run);
  const panel = h("div", { class: "a-cs-urge", id, hidden: true },
    ta, result,
    h("button", { type: "button", class: "a-btn a-btn-outline a-btn-sm a-cs-copy-all", onclick: () => copyText(ta.value, ta) }, icon("copy", { size: 18 }), "この文をコピー"));
  run();
  return panel;
}

/** 確かさ＋相手のタイプで変わるところ＋［もっと合わせる］ */
function confBlock(m, onRefine) {
  const out = h("section", { class: "a-cs-sec a-cs-conf" });
  const line = h("div", { class: "a-cs-conf-line" }, h("p", { class: "a-cs-small" }, `確かさ：${m.card.confidenceLine ?? ""}`));
  out.append(line);
  if (m.variantLines.length) out.append(h("ul", { class: "a-cs-variants" }, m.variantLines.map(t => h("li", null, t.replace(" → ", "、")))));
  if (m.refine.length) {
    const panel = h("div", { class: "a-cs-refine", id: uid("refine"), hidden: true },
      m.refine.map(q => h("div", { class: "a-cs-refine-q", role: "group", "aria-label": q.text },
        h("p", { class: "a-cs-edit-q" }, q.text),
        h("div", { class: "a-cs-chip-row" }, q.options.map(op => h("button", { type: "button", class: "a-cs-chip", onclick: () => onRefine(op.patch) }, op.label))))));
    line.append(toggler("もっと合わせる", panel, "a-cs-pill-btn"));
    out.append(panel);
  }
  return out;
}

// ---------------------------------------------------------------- 履歴に残す形と、読むだけのカード
/** カードを描き直すのに要るものだけ（JSON にできる値） */
export function snapshotOf(m) {
  const a = m.result?.action ?? null;
  return {
    v: 1,
    mode: m.mode,
    action: a,
    headline: m.headline,
    timingLine: m.timingLine ?? null,
    reasons: m.reasons.slice(),
    drafts: m.card.drafts.map(d => ({ label: d.label, text: d.text })),
    avoid: m.card.avoid.slice(),
    doNow: m.doNow ?? null,
    doNowLabel: a ? doNowLabel(a) : null,
    want: m.want ? m.want.text : null,
    guess: m.guess ?? null,
    addonLines: m.card.addonLines.slice(),
    ifReply: m.card.ifReply ?? null,
    ifNoReply: m.card.ifNoReply ?? null,
    road: m.road ?? null,
    ret: m.ret ? { at: m.ret.at.toISOString(), label: M.timeLabel(a), approx: !!m.ret.approx } : null,
    confidenceLine: m.card.confidenceLine ?? null,
    variantLines: m.variantLines.slice(),
    safetyLine: m.safetyLine ? m.safetyLine.map(r => ({ name: r.name, contact: r.contact })) : null,
  };
}

const isStrArr = (x) => Array.isArray(x) && x.every(t => typeof t === "string");
function validSnap(c) {
  return c && typeof c === "object" && (c.mode === "send" || c.mode === "wait") && typeof c.headline === "string" && isStrArr(c.reasons)
    && Array.isArray(c.drafts) && c.drafts.every(d => d && typeof d.text === "string") && isStrArr(c.avoid ?? []);
}

/**
 * 履歴の詳細（#history/<id>）で出す「そのときのカード」。読むだけ（選び直し・タイマー・送る前チェックは無し。［コピー］だけ残す）
 * 続き（往復）のある記録（data.v 2）は、最初のカードのあとに「そのあとのやりとり」を吹き出しで（読むだけ。docs/app-screens.md §11.5）
 * 記録の形が違えば null（履歴の画面が、書いた文の冒頭と一手だけを出す）
 */
export function savedView(record) {
  const d = record?.data;
  const thread = d?.v === 2 && Array.isArray(d?.fu?.thread) ? d.fu.thread.filter(x => x && typeof x === "object") : null;
  const first = thread?.[0]?.who === "card" && validSnap(thread[0].card) ? thread[0] : null;
  const c = first ? first.card : d?.card;
  if (!validSnap(c)) return null;
  const blocks = [];
  if (typeof d.text === "string" && d.text) {
    blocks.push(h("section", { class: "a-detail-block" }, h("h2", null, "書いたこと"), h("p", { class: "a-detail-text" }, d.text)));
  }
  if (typeof d.accept === "string" && d.accept) {
    blocks.push(h("section", { class: "a-detail-block" }, h("h2", null, "受け止めと状況の整理"), h("p", { class: "a-cs-saved-accept" }, d.accept)));
  }
  blocks.push(h("section", { class: "a-detail-block" }, h("h2", null, "次の一手"), savedCard(c, first?.at ?? record.at)));
  const rest = first ? thread.slice(1) : [];
  if (rest.length) {
    blocks.push(h("section", { class: "a-detail-block" }, h("h2", null, "そのあとのやりとり"), threadReadView(rest)));
  }
  const out = OUTCOME_LABEL[d?.fu?.outcome];
  if (out) blocks.push(h("section", { class: "a-detail-block" }, h("h2", null, "どうなった"), h("p", { class: "a-cs-saved-accept" }, out)));
  return h("div", { class: "a-cs a-cs-saved" }, blocks);
}
const OUTCOME_LABEL = { made_up: "仲直りできた", not_yet: "まだ", worse: "こじれた" };

// ---------------------------------------------------------------- 続き（往復）の部品（docs/app-screens.md §11.2）
/**
 * 吹き出し1つ（自分＝右、アプリ＝左）。item：{ who: "me" | "app", text, label?, quote?, check? }
 *   label：小さな見出し（「相手から来た返事」「答え合わせ」）。quote：文を「」で囲む（貼った相手の返事）。check："near" | "different"
 */
export function bubbleView(item) {
  const me = item?.who === "me";
  const text = String(item?.text ?? "");
  return h("div", { class: ["a-cs-msg-bubble", item?.check && "is-check"] },
    h("span", { class: "a-sr" }, me ? "あなた：" : "アプリ："),
    item?.label ? h("span", { class: "a-cs-msg-label" }, String(item.label)) : null,
    h("span", { class: "a-cs-msg-text" }, item?.quote ? `「${text}」` : text));
}

/**
 * たたんだカード（見出しだけ。押すと読むだけのカードが開く）。一手が変わって新しいカードが出たら、前のカードはこの形にする
 * @param {object} c  snapshotOf の写し
 */
export function pastCardView(c, at, { open = false, label = "前の一手" } = {}) {
  if (!validSnap(c)) return null;
  const id = uid("past");
  const panel = h("div", { class: "a-cs-past-body", id, hidden: !open }, savedCard(c, at));
  const more = h("span", { class: "a-cs-past-more" }, open ? "閉じる" : "開く");
  const btn = h("button", { type: "button", class: "a-cs-past-btn", "aria-expanded": String(open), "aria-controls": id },
    h("span", { class: "a-cs-past-text" }, h("span", { class: "a-cs-label" }, label), h("span", { class: "a-cs-past-title" }, c.headline)),
    h("span", { class: "a-cs-past-side" }, more, icon("chevron-down", { size: 16 })));
  btn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute("aria-expanded", String(!panel.hidden));
    more.textContent = panel.hidden ? "開く" : "閉じる";
  });
  return h("div", { class: "a-cs-past" }, btn, panel);
}

/** やりとりを読むだけの形で（履歴の詳細）。カードはたたみ、いちばん新しいカードだけ開いておく */
export function threadReadView(items) {
  const lastCard = items.map(x => x.who).lastIndexOf("card");
  return h("ol", { class: "a-cs-thread is-read", "aria-label": "やりとり" }, items.map((x, i) => {
    if (x.who === "card") {
      const v = pastCardView(x.card, x.at, { open: i === lastCard, label: "新しい一手" });
      return v ? h("li", { class: "a-cs-thread-card" }, v) : null;
    }
    if (x.who !== "me" && x.who !== "app") return null;
    return h("li", { class: ["a-cs-msg", x.who === "me" ? "is-me" : "is-app"] }, bubbleView(x));
  }));
}

function savedCard(c, at) {
  const reasons = c.reasons;
  const decide = h("div", { class: "a-cs-decide" },
    c.safetyLine?.length ? safetyLine(c.safetyLine) : null,
    c.want ? h("p", { class: "a-cs-want" }, h("b", null, "伝えたいのは"), "：", c.want) : null,
    h("h3", { class: "a-cs-headline" }, c.headline),
    c.timingLine ? h("p", { class: "a-cs-timing" }, c.timingLine) : null,
    c.ret ? savedTime(c.ret) : null,
    reasons[0] ? h("p", { class: "a-cs-reason" }, reasons[0]) : null,
    reasons.length > 1 ? h("ul", { class: "a-cs-why" }, reasons.slice(1).map(t => h("li", null, t))) : null,
    c.mode === "send"
      ? (c.drafts.length ? h("div", { class: "a-cs-send" }, draftUnit(c.drafts, c.drafts[0].label || null), avoidLine(c.avoid)) : avoidLine(c.avoid))
      : h("div", { class: "a-cs-send is-wait" },
        c.doNow ? h("p", { class: "a-cs-donow" }, h("span", { class: "a-cs-label" }, c.doNowLabel || "待つ間に"), c.doNow) : null,
        c.drafts.length ? h("div", { class: "a-cs-later-draft" }, draftUnit(c.drafts, c.drafts[0].label || null)) : null,
        avoidLine(c.avoid)));
  const later = h("div", { class: "a-cs-later" },
    afterBlock({ guess: c.guess, addonLines: c.addonLines || [], ifReply: c.ifReply, ifNoReply: c.ifNoReply }),
    Number.isInteger(c.road) ? roadView(c.road) : null,
    h("section", { class: "a-cs-sec a-cs-conf" },
      c.confidenceLine ? h("p", { class: "a-cs-small" }, `確かさ：${c.confidenceLine}`) : null,
      isStrArr(c.variantLines) && c.variantLines.length ? h("ul", { class: "a-cs-variants" }, c.variantLines.map(t => h("li", null, t.replace(" → ", "、")))) : null),
    at ? h("p", { class: "a-note" }, `${fmtDate(at)} に作ったカードです`) : null);
  return h("article", { class: "a-card a-cs-card is-saved" }, decide, h("hr", { class: "a-cs-rule" }), later);
}

/** 履歴では「明日」などの言い方がずれるので、日付つきの時刻で出す */
function savedTime(ret) {
  const at = new Date(ret.at);
  if (Number.isNaN(at.getTime())) return null;
  return h("div", { class: "a-cs-time" },
    h("p", { class: "a-cs-time-main" }, h("span", { class: "a-cs-label" }, ret.label || "戻る時刻"), h("span", { class: "a-cs-big" }, fmtDate(at))),
    ret.approx ? h("p", { class: "a-cs-time-foot" }, `朝は${M.MORNING_HOUR}時を目安にしています`) : null);
}
