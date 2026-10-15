// 相談（試作）画面の入力のまとめ。DOM なし（node でテストできる）。画面は js/ui/consult.js。
// 画面の状態（state）を、buildContext に渡す引数に直す。保存は localStorage の "consult-form-v1"（使えない環境でもそのまま動く）。
import { domainsFromChoices } from "../consult/from_diagnosis.js";
import { SELF_HARM_RE } from "../consult/texts.js";

export const STORAGE_KEY = "consult-form-v1";
/** 相談文の上限（js/consult/prompt.js の CONSULT_TEXT_MAX と同じ） */
export const TEXT_MAX = 600;
/** 自由記述（相手の呼び方・落ち着くまでの時間）の上限（js/consult/context.js・person_layer.js と同じ） */
export const SHORT_TEXT_MAX = 20;

/** あなたのタイプの選び方 */
export const SELF_TYPES = [
  ["three", "この端末の三択の結果を使う"],
  ["ishihara", "サンプル：石原"],
  ["bekku", "サンプル：別宮"],
  ["none", "診断なし"],
];
/** サンプルの種類 → SAMPLES3 の key */
export const SAMPLE_KEY = { ishihara: "石原", bekku: "別宮" };

/**
 * 単一選択の項目。[値, 表示, 補足?]。値は judge の入力（docs/consult-scoring.md §1）と同じ
 * 「state のキー」→ { label, input（judge の入力のキー or couple/ほかの行き先）, options }
 */
export const GROUPS = {
  lastSender: { label: "最後に送ったのは", options: [["self", "自分"], ["partner", "相手"], ["none", "どちらも送っていない（対面で終わった）"]] },
  elapsed: { label: "いつから", hint: "最後のやりとりから", options: [["lt3h", "3時間以内"], ["3h_12h", "半日以内"], ["12h_2d", "1〜2日"], ["ge3d", "3日以上"]] },
  partnerLast: { label: "相手の最後の一言", options: [["apology", "謝ってきた"], ["casual", "普通の話題"], ["explain", "説明・言い返し"], ["attack", "責める・「もういい」"], ["talk_proposal", "話し合いの提案"], ["space", "距離を置きたい"], ["breakup", "別れ話"], ["none", "なし"]] },
  selfLast: { label: "自分の最後の一言", options: [["hold", "「落ち着いたら話そう」など"], ["apology", "謝った"], ["reconcile", "仲直りしようとした"], ["attack", "責めた・言い返した"], ["explain", "説明した"], ["none", "なし"]] },
  selfTemp: { label: "今の気持ち", options: [["high", "まだ熱い"], ["cooling", "落ち着いてきた"], ["calm", "落ち着いている"]] },
  cause: { label: "原因は", options: [["self", "自分"], ["partner", "相手"], ["both", "両方"], ["unknown", "分からない"]] },
  goal: { label: "今回のゴール", options: [["reconcile", "仲直りしたい"], ["understood", "分かってほしい"], ["settle", "ちゃんと決着をつけたい"], ["space", "少し距離を置きたい"]] },
  severity: { label: "喧嘩の大きさ", options: [["small", "すれ違い程度"], ["large", "信頼や約束に関わる"]] },
  intent: { label: "したいこと", options: [["none", "特になし"], ["apologize", "謝りたい"], ["tell", "伝えたいことがある"], ["request_space", "距離を置きたいと伝えたい"]] },
  medium: { label: "場", options: [["text", "文字"], ["call", "電話"], ["in_person", "対面・同居"]] },
  register: { label: "文体", options: [["casual", "タメ口"], ["polite", "敬語"]] },
  lateNight: { label: "深夜かどうか", options: [["auto", "自動"], ["yes", "深夜"], ["no", "深夜ではない"]] },
  coupleMedium: { label: "話しやすいのは", options: [["", "どちらでも"], ["call", "電話"], ["text", "文字"]] },
};

/** はい／いいえの項目 */
export const TOGGLES = {
  ongoing: "言い合いが今も続いている",
  repeat: "同じ喧嘩の繰り返し",
  afterMakeup: "もう仲直りした",
  talkScheduled: "話し合いの日時が決まっている",
  livingTogether: "一緒に住んでいる",
};

/** 危ないサイン。safety は安全ゲートの窓口の選び方（context.js の safety 引数） */
export const DANGER_ITEMS = [
  { id: "violence", label: "暴力・物を壊す" },
  { id: "threat", label: "脅し" },
  { id: "monitoring", label: "スマホの確認や位置情報の強要" },
  { id: "money", label: "お金の支配" },
  { id: "isolation", label: "友達付き合いを制限される" },
  { id: "diePartner", label: "「別れるなら死ぬ」と言われた", safety: "partnerThreat" },
  { id: "selfHarm", label: "自分を傷つけたい気持ちがある", safety: "selfHarm" },
];

/** 相手の領域 → 答え。値は "A" | "B" | null（分からない） */
const DOMAINS = [1, 2, 3, 4, 5, 6, 7, 8];

export function defaultState() {
  return {
    v: 1,
    // あなたのタイプ。null＝まだ選んでいない（三択の結果があればそれ、なければ診断なし）
    selfType: null,
    selfOpen: true,
    /** { 領域: { from: "A"|"B", to: "A"|"B" } } 「これは違う」で直した領域（直す前の向きも持つ。診断が変わったら無効） */
    corrections: {},
    mainConfirmed: false,
    partner: Object.fromEntries(DOMAINS.map(d => [d, null])),
    text: "",
    lastSender: "none", elapsed: "lt3h", ongoing: false,
    partnerLast: "none", selfLast: "none", selfTemp: "cooling", cause: "unknown", goal: "reconcile",
    severity: "small", repeat: false, afterMakeup: false, intent: "none", talkScheduled: false,
    medium: "text", register: "casual", partnerCall: "", lateNight: "auto",
    calmDownTime: "", coupleMedium: "", livingTogether: false,
    danger: Object.fromEntries(DANGER_ITEMS.map(x => [x.id, false])),
    moreOpen: false,
  };
}

const oneOf = (group, v, fallback) => GROUPS[group].options.some(o => o[0] === v) ? v : fallback;
const bool = (v, fallback) => typeof v === "boolean" ? v : fallback;
const short = (v) => typeof v === "string" ? [...v].slice(0, SHORT_TEXT_MAX).join("") : "";

/** 保存されていた値（信用しない）を、画面の状態に直す。足りない・おかしい項目は既定値 */
export function sanitizeState(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
  const s = { ...d, v: 1 };
  s.selfType = SELF_TYPES.some(t => t[0] === raw.selfType) ? raw.selfType : null;
  s.selfOpen = bool(raw.selfOpen, d.selfOpen);
  s.mainConfirmed = bool(raw.mainConfirmed, false);
  s.corrections = {};
  for (const k of DOMAINS) {
    const c = raw.corrections?.[k];
    if ((c?.from === "A" || c?.from === "B") && (c?.to === "A" || c?.to === "B") && c.from !== c.to) s.corrections[k] = { from: c.from, to: c.to };
  }
  for (const k of DOMAINS) { const v = raw.partner?.[k]; s.partner[k] = v === "A" || v === "B" ? v : null; }
  s.text = typeof raw.text === "string" ? [...raw.text].slice(0, TEXT_MAX).join("") : "";
  for (const g of Object.keys(GROUPS)) s[g] = oneOf(g, raw[g], d[g]);
  for (const k of Object.keys(TOGGLES)) s[k] = bool(raw[k], d[k]);
  s.partnerCall = short(raw.partnerCall);
  s.calmDownTime = short(raw.calmDownTime);
  for (const x of DANGER_ITEMS) s.danger[x.id] = raw.danger?.[x.id] === true;
  s.moreOpen = bool(raw.moreOpen, false);
  return s;
}

// ---------------------------------------------------------------- 保存（localStorage。どこで失敗してもそのまま動かす）
function storageOf(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
export function loadState(storage) {
  try {
    const st = storageOf(storage);
    const raw = st?.getItem(STORAGE_KEY);
    return raw ? sanitizeState(JSON.parse(raw)) : defaultState();
  } catch { return defaultState(); }
}
export function saveState(state, storage) {
  try { const st = storageOf(storage); if (!st) return false; st.setItem(STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}
export function clearSaved(storage) {
  try { storageOf(storage)?.removeItem(STORAGE_KEY); return true; } catch { return false; }
}

// ---------------------------------------------------------------- state → buildContext の引数
/** 危ないサインが1つでもあるか、相談文に自分を傷つける言葉があるか（後者は画面が理由を出す） */
export function dangerInfo(state) {
  const checked = DANGER_ITEMS.filter(x => state.danger[x.id]);
  const textSelfHarm = SELF_HARM_RE.test(String(state.text ?? ""));
  return { checked, textSelfHarm, danger: checked.length > 0 || textSelfHarm };
}

/** 本人の領域に「これは違う」を当てるための { 領域: 向き }。直す前の向きが今の診断と同じものだけ有効 */
export function activeCorrections(state, baseDomains) {
  const out = {};
  for (const [k, c] of Object.entries(state.corrections || {})) {
    if (baseDomains?.[k]?.side === c.from) out[k] = c.to;
  }
  return out;
}

/**
 * judge の入力（self・partner を除く）。lateNight が自動のときは入れない（buildContext が now から決める）
 */
export function buildInput(state) {
  const input = {
    danger: dangerInfo(state).danger,
    ongoing: !!state.ongoing,
    lastSender: state.lastSender, elapsed: state.elapsed, partnerLast: state.partnerLast, selfLast: state.selfLast,
    selfTemp: state.selfTemp, cause: state.cause, severity: state.severity, repeat: !!state.repeat, afterMakeup: !!state.afterMakeup,
    intent: state.intent, talkScheduled: !!state.talkScheduled, medium: state.medium, goal: state.goal,
  };
  if (state.lateNight === "yes") input.lateNight = true;
  else if (state.lateNight === "no") input.lateNight = false;
  return input;
}

/**
 * buildContext の引数。
 * @param {object} state
 * @param {{ selfDomains?: object|null, selfMain?: {id: string}|null, now?: Date }} [opts]
 *   selfDomains … 直したあとの本人の8領域（なければ渡さない＝診断なし）
 *   selfMain    … 本人の主軸 { id }（「当たっている」にチェックがあるときだけ confirmed: true）
 */
export function buildArgs(state, { selfDomains = null, selfMain = null, now = new Date() } = {}) {
  const { checked } = dangerInfo(state);
  const safety = {};
  if (checked.some(x => x.safety === "selfHarm") || SELF_HARM_RE.test(String(state.text ?? ""))) safety.selfHarm = true;
  if (checked.some(x => x.safety === "partnerThreat")) safety.partnerThreat = true;
  const couple = {};
  if (state.calmDownTime.trim()) couple.calmDownTime = state.calmDownTime.trim();
  if (state.coupleMedium) couple.medium = state.coupleMedium;
  if (state.livingTogether) couple.livingTogether = true;   // 「していない」とは言い切らない（オフは未回答として扱う）
  const args = {
    input: buildInput(state),
    consultText: state.text,
    partner: domainsFromChoices(state.partner),
    couple,
    register: state.register,
    now,
  };
  if (state.partnerCall.trim()) args.partnerCall = state.partnerCall.trim();
  if (selfDomains) args.self = selfDomains;
  if (selfMain?.id) args.selfMain = { id: selfMain.id, confirmed: !!state.mainConfirmed };
  if (Object.keys(safety).length) args.safety = safety;
  return args;
}

/**
 * 問い（refineQuestions）の答え patch を、画面の状態に映す。映せないキーは無視する。
 * @returns {string[]} 変えた項目の名前（画面のお知らせ用）
 */
export function applyPatchToState(state, patch = {}) {
  const changed = [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === "partner" && v && typeof v === "object") {
      for (const [d, dv] of Object.entries(v)) {
        if (!DOMAINS.includes(Number(d))) continue;
        const side = dv?.side === "A" || dv?.side === "B" ? dv.side : null;
        if (state.partner[d] !== side) { state.partner[d] = side; changed.push(`partner${d}`); }
      }
    } else if (k in GROUPS && k !== "lateNight" && k !== "coupleMedium" && oneOf(k, v, null) != null) {
      if (state[k] !== v) { state[k] = v; changed.push(k); }
    } else if (k in TOGGLES && typeof v === "boolean") {
      if (state[k] !== v) { state[k] = v; changed.push(k); }
    }
  }
  return changed;
}
