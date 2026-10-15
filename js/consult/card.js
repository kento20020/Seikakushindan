// 「次の一手カード」の形と点検。方針：docs/consult-answer-guide.md §2.2・§2.13、説明：docs/consult-ai.md
// 決まった文型の回答（template_responder.js）も AI の回答（ai_responder.js）も、同じ形・同じ点検を通す。
import { checkDraft } from "./draft_check.js";
import { PARTNER_STEMS, CONFIDENCE_INSERT, DRAFT_LABELS, doNowLabel } from "./texts.js";

/**
 * 次の一手カード。
 * @typedef {Object} ConsultCard
 * @property {"card"|"safety"} kind      安全ゲートのときだけ "safety"
 * @property {string} headline            おすすめ（行動＋いつ。20〜35字、上限 40）
 * @property {string[]} addonLines        付け足しの一行（0〜2、各40字以内。例「そのあと『電話していい？』と聞く形で1回だけ」）
 * @property {string|null} timingLine     送るのを朝に回すときの一行（40字以内）
 * @property {string[]} reasons           理由（状況 → 相手 → 自分、1〜3つ、各50字以内）。safety は []
 * @property {{label: string, text: string}[]} drafts  文面（0〜2。2つ目は label「別の言い方」で同じ中身）
 * @property {string[]} variantLines      相手のタイプで変わるところ（0〜2、各60字以内）
 * @property {string|null} doNow          待つ間に／やること（50字以内）
 * @property {string[]} avoid             避けたい言葉の例（0〜3、各12字以内）
 * @property {string|null} ifReply        その後：返事が来たら（「条件 → すること」、50字以内）
 * @property {string|null} ifNoReply      その後：来なければ（点検時刻つき、50字以内）
 * @property {string|null} confidenceLine 確かさ（40字以内）。safety は null
 * @property {null|{intro: string, resources: {name: string, contact: string, note: string}[], steps: string[], closing: string}} safety
 */

const str = { type: "string" };
const strOrNull = { type: ["string", "null"] };
const strArr = { type: "array", items: str };

/**
 * Claude API の structured outputs（output_config.format = { type: "json_schema", schema }）にそのまま渡せるスキーマ。
 * どの object も additionalProperties: false・全項目 required。null を許す項目は型の配列。
 * minLength・maxLength・minimum・maximum・maxItems は使えないので入れない（長さと数は validateCard で見る）
 */
export const CARD_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["kind", "headline", "addonLines", "timingLine", "reasons", "drafts", "variantLines", "doNow", "avoid", "ifReply", "ifNoReply", "confidenceLine", "safety"],
  properties: {
    kind: { type: "string", enum: ["card", "safety"] },
    headline: str,
    addonLines: strArr,
    timingLine: strOrNull,
    reasons: strArr,
    drafts: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["label", "text"], properties: { label: str, text: str } },
    },
    variantLines: strArr,
    doNow: strOrNull,
    avoid: strArr,
    ifReply: strOrNull,
    ifNoReply: strOrNull,
    confidenceLine: strOrNull,
    safety: {
      anyOf: [
        { type: "null" },
        {
          type: "object", additionalProperties: false, required: ["intro", "resources", "steps", "closing"],
          properties: {
            intro: str,
            resources: {
              type: "array",
              items: { type: "object", additionalProperties: false, required: ["name", "contact", "note"], properties: { name: str, contact: str, note: str } },
            },
            steps: strArr,
            closing: str,
          },
        },
      ],
    },
  },
});

/** 欄ごとの上限（guide §2.2）。文字数は Unicode の文字（コードポイント）で数える。対面（spoken）の文面は短めが目安だが、上限は行動ごとの値と同じ */
export const LIMITS = Object.freeze({
  headline: 40, reason: 50, reasons: 3, drafts: 2, draftLabel: 20, draftNewlines: 2,
  draft: 80, draftLong: 120, draftPause: 60,
  variantLine: 60, variantLines: 2, doNow: 50, avoidItem: 12, avoid: 3, after: 50, confidenceLine: 40,
  addonLine: 40, addonLines: 2, timingLine: 40, total: 450, safetySteps: 2,
});
/** 文面が長めでよい行動（60〜120字。文面は1つだけ） */
const LONG_DRAFT = new Set(["apology_full", "accept_space", "request_space"]);
/** 聞く形が本体の行動（「？」は1つまで） */
const ASK_ACTIONS = new Set(["ask_feeling", "propose_call", "propose_talk_plan", "accept_space"]);
/** 戻る時刻が要る行動 */
const NEEDS_TIME = new Set(["pause_with_time", "request_space"]);
/** 文面のない一手（付け足しに送る行動がなければ文面は0） */
const NO_DRAFT = new Set(["wait_until", "self_calm", "prepare_points"]);
const SENDABLE = new Set(["pause_with_time", "acknowledge", "ask_feeling", "short_feeling", "apology_partial", "apology_full",
  "accept_apology", "restore_routine", "propose_call", "propose_talk_plan", "accept_space", "request_space"]);

/** 文面の時刻の表現（draft_check.js と同じ） */
export const TIME_RE = /明日|今夜|今日|朝|昼|夜|[0-9０-９]+時|[月火水木金土日]曜|週末/;
/** カードに出してはいけない語（guide §2.3・§2.8・§2.11・§2.13 #8。DV は安全ゲートの窓口の名前だけ可） */
export const FORBIDDEN_WORDS = [
  "モラハラ", "メンヘラ", "毒", "束縛", "ナルシ", "回避型", "不安型", "勝率", "論破", "主導権", "確率", "通す",
  "絶対", "必ず", "すべき", "いつも", "普通は", "性格", "相性が悪い", "診断どおり", "数値",
  "フラッディング", "ストーンウォーリング", "要求–撤退", "リフレーミング", "アサーティブ",
  "我慢して", "放っておけば", "気にしない", "相手に任せましょう", "考えすぎ",
];
const FORBIDDEN_RE = new RegExp(FORBIDDEN_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
/** 「〜な人」の決めつけ（「この人」は可） */
const LABEL_PERSON_RE = /[^のこそあど\s]な人/;
/** 判定の内部の名前（局面・行動・指定・避ける言葉の ID、補正 ID） */
const INTERNAL_ID_RE = /[a-z]+(?:_[a-z]+)+|(?<![A-Za-z0-9])(?:P[1-8][AB](?:_silent)?|S[1-8][AB]|AO\d{1,2}|C1h|C[123]|L1b|L[123]|R3d|R[1-8]|G[1-4]|E1|V1|RR|BRK|HG|CAP)(?![A-Za-z0-9])/;
/** 点数の表現（「80点」「5点差」「点数」）。「1点だけ」のような数え方は可 */
const SCORE_RE = /[0-9０-９]{2,}\s*点|[0-9０-９]+\s*点(?:差|中)|点数/;
const ENGLISH_RE = /[A-Za-z]{2,}/g;
const ENGLISH_OK = new Set(["LINE", "SNS"]);
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const EXCLAIM_RE = /[!！]/;
const LAUGH_RE = /（笑）|\(笑\)|笑$|笑[。、\s]|ｗｗ|ww/;
const THIRD_PARTY_RE = /(?:友達|友だち|親|みんな)(?:も|が)/;
/** 文体の簡易判定：敬語の文面に入る形／タメ口の文面に入らない形 */
const POLITE_RE = /です|ます|ません|ましょう|ください|ございます/;
const POLITE_END_RE = /(?:です|ます)(?=[。、？?\s]|$)/;

const len = (s) => [...String(s ?? "")].length;
const typeOf = (v) => v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;

/** 小さなスキーマ検査（CARD_JSON_SCHEMA が使う機能だけ：type・enum・properties・required・additionalProperties・items・anyOf） */
function schemaErrors(v, s, path, errs) {
  if (s.anyOf) {
    if (!s.anyOf.some(sub => { const e = []; schemaErrors(v, sub, path, e); return !e.length; })) errs.push(`${path}：形が合わない`);
    return;
  }
  const types = Array.isArray(s.type) ? s.type : [s.type];
  const t = typeOf(v);
  if (!types.some(x => x === t || (x === "number" && t === "integer"))) { errs.push(`${path}：型が ${types.join("|")} ではない`); return; }
  if (s.enum && !s.enum.includes(v)) errs.push(`${path}：${JSON.stringify(v)} は使えない値`);
  if (t === "object" && s.properties) {
    for (const k of s.required || []) if (!(k in v)) errs.push(`${path}.${k}：ない`);
    if (s.additionalProperties === false) for (const k of Object.keys(v)) if (!(k in s.properties)) errs.push(`${path}.${k}：余分な項目`);
    for (const [k, sub] of Object.entries(s.properties)) if (k in v) schemaErrors(v[k], sub, `${path}.${k}`, errs);
  }
  if (t === "array" && s.items) v.forEach((x, i) => schemaErrors(x, s.items, `${path}[${i}]`, errs));
}

/**
 * カードの文（欄の名前つき）。避けたい言葉の例（avoid）は、わざと避ける言葉を含むので別に返す
 * @returns {{ field: string, text: string }[]}
 */
export function cardTexts(card) {
  const out = [];
  const add = (field, t) => { if (typeof t === "string" && t) out.push({ field, text: t }); };
  add("headline", card.headline);
  (card.addonLines || []).forEach((t, i) => add(`addonLines[${i}]`, t));
  add("timingLine", card.timingLine);
  (card.reasons || []).forEach((t, i) => add(`reasons[${i}]`, t));
  (card.drafts || []).forEach((d, i) => { add(`drafts[${i}].label`, d?.label); add(`drafts[${i}].text`, d?.text); });
  (card.variantLines || []).forEach((t, i) => add(`variantLines[${i}]`, t));
  add("doNow", card.doNow);
  add("ifReply", card.ifReply);
  add("ifNoReply", card.ifNoReply);
  add("confidenceLine", card.confidenceLine);
  if (card.safety) {
    add("safety.intro", card.safety.intro);
    (card.safety.resources || []).forEach((r, i) => add(`safety.resources[${i}].note`, r?.note));
    (card.safety.steps || []).forEach((t, i) => add(`safety.steps[${i}]`, t));
    add("safety.closing", card.safety.closing);
  }
  return out;
}

/** カード全体の文字数（見出し・理由・文面・2通り・やること・避けたい言葉・その後・確かさ・付け足し・タイミング。欄の名前と文面の label は数えない） */
export function cardLength(card) {
  return cardTexts(card).filter(x => !/\.label$/.test(x.field)).reduce((n, x) => n + len(x.text), 0)
    + (card.avoid || []).reduce((n, t) => n + len(t), 0);
}

/** 一手と指定から、文面の上限の字数 */
function draftMax(action) {
  if (LONG_DRAFT.has(action)) return LIMITS.draftLong;
  if (action === "pause_with_time") return LIMITS.draftPause;
  return LIMITS.draft;
}

/**
 * カードの点検（guide §2.13 のうち、1枚のカードで見られるもの）。ctx（context.js の buildContext の返り値）を渡すと、
 * 判定の値（一手・避ける言葉・確かさ・相手の領域）と照らし合わせる。
 * @param {ConsultCard} card
 * @param {object} [ctx]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateCard(card, ctx) {
  const errors = [];
  if (card === null || typeof card !== "object" || Array.isArray(card)) return { ok: false, errors: ["カードが object ではない"] };
  schemaErrors(card, CARD_JSON_SCHEMA, "card", errors);
  if (errors.length) return { ok: false, errors };

  const r = ctx?.result;
  const action = r?.action ?? null;
  if (r) {
    const wantSafety = action === "safety";
    if (wantSafety !== (card.kind === "safety")) errors.push(`kind が ${card.kind}（一手は ${wantSafety ? "安全ゲート" : "通常"}）`);
  }

  if (card.kind === "safety") checkSafety(card, errors);
  else checkCard(card, ctx, action, errors);

  // 文の決まり（避けたい言葉の例は除く）
  const texts = cardTexts(card);
  for (const { field, text } of texts) {
    const isDraft = /^drafts\[\d+\]\.text$/.test(field);
    const forb = [...new Set(text.match(FORBIDDEN_RE) || [])];
    if (forb.length) errors.push(`${field}：使わない語「${forb.join("」「")}」`);
    if (/DV/.test(text)) errors.push(`${field}：「DV」は窓口の名前にだけ使う`);
    if (!isDraft && LABEL_PERSON_RE.test(text)) errors.push(`${field}：「〜な人」と決めつけている`);
    const id = text.match(INTERNAL_ID_RE);
    if (id) errors.push(`${field}：内部の名前「${id[0]}」が出ている`);
    if (SCORE_RE.test(text)) errors.push(`${field}：点数を書いている`);
    const en = (text.match(ENGLISH_RE) || []).filter(w => !ENGLISH_OK.has(w));
    if (en.length) errors.push(`${field}：英語「${en.join(" ")}」`);
    if (EMOJI_RE.test(text)) errors.push(`${field}：絵文字`);
    if (EXCLAIM_RE.test(text)) errors.push(`${field}：感嘆符`);
    if (LAUGH_RE.test(text)) errors.push(`${field}：「笑」`);
    if (THIRD_PARTY_RE.test(text)) errors.push(`${field}：第三者の引用`);
  }
  for (const [i, t] of (card.avoid || []).entries()) {
    if (EMOJI_RE.test(t) || EXCLAIM_RE.test(t) || INTERNAL_ID_RE.test(t)) errors.push(`avoid[${i}]：絵文字・感嘆符・内部の名前`);
  }
  if (card.safety) {
    for (const [i, x] of card.safety.resources.entries()) {
      if (!x.name || !x.contact) errors.push(`safety.resources[${i}]：名前か連絡先がない`);
      if (/モラハラ|メンヘラ/.test(x.name + x.note)) errors.push(`safety.resources[${i}]：使わない語`);
    }
  }
  if (ctx) checkTypeMentions(texts.filter(x => !/^variantLines|^drafts/.test(x.field)), ctx, errors);
  return { ok: errors.length === 0, errors };
}

function checkSafety(card, errors) {
  const s = card.safety;
  if (!s) { errors.push("safety：安全ゲートなのに窓口がない"); return; }
  if (!s.resources.length) errors.push("safety.resources：窓口がない");
  if (!s.resources.some(x => /#8008/.test(x.contact))) errors.push("safety.resources：#8008（DV相談ナビ）がない");
  if (s.steps.length > LIMITS.safetySteps) errors.push(`safety.steps：${s.steps.length} 個（${LIMITS.safetySteps} まで）`);
  if (!s.intro || !s.closing) errors.push("safety：intro か closing がない");
  if (card.drafts.length) errors.push("safety：文面を出している");
  if (card.avoid.length) errors.push("safety：避けたい言葉を出している");
  if (card.reasons.length) errors.push("safety：理由（仲直りの助言）を出している");
  if (card.variantLines.length || card.addonLines.length) errors.push("safety：2通り・付け足しを出している");
  if (card.ifReply != null || card.ifNoReply != null) errors.push("safety：その後の欄を出している");
  if (card.confidenceLine != null) errors.push("safety：確かさを出している");
  if (card.doNow != null || card.timingLine != null) errors.push("safety：やること・タイミングを出している");
}

function checkCard(card, ctx, action, errors) {
  const lim = (field, t, n) => { if (t != null && len(t) > n) errors.push(`${field}：${len(t)} 字（${n} 字まで）`); };
  if (card.safety !== null) errors.push("safety：通常のカードなのに窓口の欄がある");
  if (!card.headline.trim()) errors.push("headline：空");
  lim("headline", card.headline, LIMITS.headline);
  if (!card.reasons.length) errors.push("reasons：理由がない");
  if (card.reasons.length > LIMITS.reasons) errors.push(`reasons：${card.reasons.length} 個（${LIMITS.reasons} まで）`);
  card.reasons.forEach((t, i) => lim(`reasons[${i}]`, t, LIMITS.reason));
  if (card.addonLines.length > LIMITS.addonLines) errors.push(`addonLines：${card.addonLines.length} 個`);
  card.addonLines.forEach((t, i) => lim(`addonLines[${i}]`, t, LIMITS.addonLine));
  lim("timingLine", card.timingLine, LIMITS.timingLine);
  if (card.variantLines.length > LIMITS.variantLines) errors.push(`variantLines：${card.variantLines.length} 個`);
  card.variantLines.forEach((t, i) => lim(`variantLines[${i}]`, t, LIMITS.variantLine));
  lim("doNow", card.doNow, LIMITS.doNow);
  if (card.avoid.length > LIMITS.avoid) errors.push(`avoid：${card.avoid.length} 個`);
  card.avoid.forEach((t, i) => lim(`avoid[${i}]`, t, LIMITS.avoidItem));
  lim("ifReply", card.ifReply, LIMITS.after);
  lim("ifNoReply", card.ifNoReply, LIMITS.after);
  if (!card.confidenceLine || !card.confidenceLine.trim()) errors.push("confidenceLine：空");
  lim("confidenceLine", card.confidenceLine, LIMITS.confidenceLine);
  const total = cardLength(card);
  if (total > LIMITS.total) errors.push(`カード全体：${total} 字（${LIMITS.total} 字まで）`);

  // 文面
  const d = card.drafts;
  if (d.length > LIMITS.drafts) errors.push(`drafts：${d.length} 個（${LIMITS.drafts} まで）`);
  if (d.length === 2 && d[1].label !== DRAFT_LABELS.alt) errors.push(`drafts[1]：2つ目は「${DRAFT_LABELS.alt}」だけ`);
  if (action && LONG_DRAFT.has(action) && d.length > 1) errors.push(`drafts：${action} の文面は1つだけ`);
  const addons = ctx?.result?.addons ?? [];
  if (action && NO_DRAFT.has(action) && !addons.some(a => SENDABLE.has(a)) && d.length) errors.push("drafts：送る行動がないのに文面がある");
  if (action && SENDABLE.has(action) && !d.length) errors.push("drafts：送る一手なのに文面がない");
  const avoid = ctx?.result?.avoid ?? null;
  d.forEach((x, i) => {
    const f = `drafts[${i}]`;
    if (!x.label.trim() || !x.text.trim()) errors.push(`${f}：label か text が空`);
    lim(`${f}.label`, x.label, LIMITS.draftLabel);
    lim(`${f}.text`, x.text, draftMax(action));
    if ((x.text.match(/\n/g) || []).length > LIMITS.draftNewlines) errors.push(`${f}：改行が多い`);
    const chk = checkDraft(x.text, { action, avoid });
    if (chk.level === "届きにくい") errors.push(`${f}：送る前チェックで「届きにくい」（${chk.hits.map(h => h.id + ":" + h.text).join("、")}）`);
    if (NEEDS_TIME.has(action) && !TIME_RE.test(x.text)) errors.push(`${f}：戻る時刻がない`);
    if (ASK_ACTIONS.has(action) && (x.text.match(/[？?]/g) || []).length > 1) errors.push(`${f}：質問が2つ以上`);
    if (ctx?.register === "casual" && POLITE_END_RE.test(x.text)) errors.push(`${f}：タメ口のはずが敬語`);
    if (ctx?.register === "polite" && !POLITE_RE.test(x.text)) errors.push(`${f}：敬語のはずがタメ口`);
  });

  // 確かさの言い方（#13）
  const conf = ctx?.result?.confidence;
  const want = { sure: /はっきり/, est: /仮|見立て/, provisional: /仮/, situational: /状況/ }[conf];
  if (want && card.confidenceLine && !want.test(card.confidenceLine)) errors.push(`confidenceLine：確かさ（${conf}）と言い方が合わない`);
}

/**
 * 相手のタイプへの言及（#9）：相手のその領域が分からないのに「相手は〜寄り」と書いていない、
 * 確かさが sure でないのに「（診断結果）」と書いていない。相手のことが何も分かっていないのに「相手は〜寄り／派／タイプ」と書いていない
 */
function checkTypeMentions(texts, ctx, errors) {
  const partner = ctx?.input?.partner || {};
  const self = ctx?.input?.self || {};
  const known = (v) => v && v.side && v.conf && v.conf !== "none";
  const anyPartner = Object.values(partner).some(known);
  const anySure = [...Object.values(partner), ...Object.values(self)].some(v => known(v) && v.conf === "sure");
  for (const { field, text } of texts) {
    for (const [d, sides] of Object.entries(PARTNER_STEMS)) {
      for (const [side, stem] of Object.entries(sides)) {
        const m = text.match(new RegExp(`相手は[^。、]{0,10}${stem}(${Object.values(CONFIDENCE_INSERT).map(x => x.replace(/[()（）]/g, "\\$&")).join("|")})?`));
        if (!m) continue;
        const v = partner[d];
        if (!known(v) || v.side !== side) errors.push(`${field}：相手の領域${d}は分かっていないのに「${stem}」と書いている`);
        else if (m[1] === CONFIDENCE_INSERT.sure && v.conf !== "sure") errors.push(`${field}：見立て・確度低なのに「（診断結果）」と書いている`);
      }
    }
    if (!anyPartner && /相手は[^。]{0,20}(?:寄り|派|タイプ)/.test(text)) errors.push(`${field}：相手のタイプが分からないのにタイプを書いている`);
    if (text.includes("（診断結果）") && !anySure) errors.push(`${field}：確かな診断結果がないのに「（診断結果）」と書いている`);
  }
}

/** 画面の欄の名前（renderCardText と画面で共通） */
export const SECTION_LABELS = Object.freeze({
  reasons: "理由", variants: "相手のタイプで変わるところ", avoid: "避けたい言葉", after: "その後", confidence: "確かさ",
  resources: "相談できる窓口", steps: "今できること",
});

/**
 * カードを素の文字列にする（開発者用の表示・コピー・レポート用）。opts.action を渡すと「待つ間に／やること」を選ぶ
 * @param {ConsultCard} card
 * @param {{ action?: string }} [opts]
 */
export function renderCardText(card, { action } = {}) {
  const L = [];
  L.push(`■ ${card.headline}`);
  if (card.kind === "safety" && card.safety) {
    const s = card.safety;
    L.push("", s.intro, "", `【${SECTION_LABELS.resources}】`);
    for (const x of s.resources) L.push(`・${x.name} ${x.contact}（${x.note}）`);
    if (s.steps.length) { L.push("", `【${SECTION_LABELS.steps}】`); for (const t of s.steps) L.push(`・${t}`); }
    L.push("", s.closing);
    return L.join("\n");
  }
  if (card.timingLine) L.push(card.timingLine);
  for (const t of card.addonLines) L.push(`＋ ${t}`);
  L.push("", `【${SECTION_LABELS.reasons}】`);
  for (const t of card.reasons) L.push(`・${t}`);
  for (const d of card.drafts) L.push("", `【${d.label}】`, `「${d.text}」`);
  if (card.variantLines.length) { L.push("", `【${SECTION_LABELS.variants}】`); for (const t of card.variantLines) L.push(`・${t}`); }
  if (card.doNow) L.push("", `【${doNowLabel(action)}】`, card.doNow);
  if (card.avoid.length) L.push("", `【${SECTION_LABELS.avoid}】`, card.avoid.map(t => `「${t}」`).join(""));
  if (card.ifReply || card.ifNoReply) { L.push("", `【${SECTION_LABELS.after}】`); for (const t of [card.ifReply, card.ifNoReply]) if (t) L.push(`・${t}`); }
  L.push("", `【${SECTION_LABELS.confidence}】${card.confidenceLine}`);
  return L.join("\n");
}
