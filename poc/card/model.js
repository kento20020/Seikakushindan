// 次の一手カードの試作（統合1・統合3。docs/ui-design-thinking.md §7.3）のうち、DOM を使わない部分。node でテストできる（tests/poc_card.test.mjs）。
// 一手・文面・理由・その後は本物（js/consult/ の judge・文型）。この試作で足しているのは、AI がまだ無いので仮に決まった文で作る3つ：
//   伝えたいこと（WANTS）・相手はたぶん（GUESS）・道のり（ROAD）。それと、戻る時刻を「明日 8:00」のような時刻にする計算（returnAt）。
// 同じ入力・同じ now なら必ず同じ結果（乱数・時刻の読み出しなし）。
import { finalInput } from "../../js/consult/needed.js";
import { buildContext, refineQuestions, applyPatch } from "../../js/consult/context.js";
import { templateRespond, extractQuote } from "../../js/consult/template_responder.js";
import { isLateNight, localParts } from "../../js/consult/timefmt.js";
import { AVOID_EXAMPLES, SAFETY_RESOURCES, SELF_HARM_RE, PARTNER_THREAT_RE } from "../../js/consult/texts.js";
import { GROUPS, TOGGLES } from "../../js/ui/consult_state.js";

// ---------------------------------------------------------------- 試作の設定（URL）
/** 並び：統合1（前回の案）／統合3（推奨）。?v=1|3、既定は 3 */
export const LAYOUTS = ["1", "3"];
export const DEFAULT_LAYOUT = "3";
export function layoutOf(search = "") {
  const v = new URLSearchParams(search).get("v");
  return LAYOUTS.includes(v) ? v : DEFAULT_LAYOUT;
}
/** ?compare=1 で、幅 900px 以上なら統合1と統合3を左右に並べる */
export const COMPARE_MIN_WIDTH = 900;
export const compareOf = (search = "") => new URLSearchParams(search).get("compare") === "1";
/** 表示：自動（端末の設定）／ライト／ダーク。?theme=light|dark */
export const THEMES = ["auto", "light", "dark"];
export function themeOf(search = "", saved = null) {
  const v = new URLSearchParams(search).get("theme");
  if (THEMES.includes(v)) return v;
  return THEMES.includes(saved) ? saved : "auto";
}

// ---------------------------------------------------------------- 伝えたいこと（AI が無いので決まった文型。［ちがう］で選び直す）
/** 「どうしたい？」の選択肢。patch は判定の入力への差分（選び直すとカードを作り直す） */
export const WANTS = [
  { key: "reconcile", label: "このまま終わりにしたくない" },
  { key: "understood", label: "気持ちを分かってほしい" },
  { key: "apologize", label: "謝りたい" },
  { key: "tell", label: "伝えたいことを話したい" },
  { key: "space", label: "少し時間がほしい" },
  { key: "settle", label: "うやむやにせず決めたい" },
];
const INTENT_OF_WANT = { apologize: "apologize", tell: "tell", space: "request_space" };
const GOAL_OF_WANT = { reconcile: "reconcile", understood: "understood", settle: "settle" };

/**
 * 判定の入力 → 伝えたいことの種類。したいこと（intent）を先に見て、なければゴール（goal）。
 * 距離は「本人が距離を置きたい」（intent request_space）か、ゴールが距離のとき
 */
export function wantKeyOf(input = {}) {
  if (input.intent === "apologize") return "apologize";
  if (input.intent === "tell") return "tell";
  if (input.intent === "request_space" || input.goal === "space") return "space";
  if (input.goal === "understood") return "understood";
  if (input.goal === "settle") return "settle";
  return "reconcile";
}

/**
 * 伝えたいことの1文（「〜、ということ」）。相手から責める言葉が来ていて、相談文に短い「」の引用があれば、
 * 「「もういい」で終わりにしたくない、ということ」のように相手の言葉を入れる（引用は相手の言葉のときだけ使う）
 */
export function wantText(input = {}, consultText = "") {
  const key = wantKeyOf(input);
  const quote = input.partnerLast === "attack" && input.lastSender === "partner" ? extractQuote(consultText) : null;
  switch (key) {
    case "apologize":
      return input.cause === "self" || input.cause === "both" ? "言いすぎた分を、ちゃんと謝りたい、ということ" : "謝るところは、ちゃんと謝りたい、ということ";
    case "tell": return "伝えたいことを1つに絞って話したい、ということ";
    case "space": return "少し時間がほしい、ということ";
    case "understood": return quote ? `「${quote}」で終わりにしたくない、ということ` : "気持ちを分かってほしい、ということ";
    case "settle": return "うやむやにせず決めたい、ということ";
    default: return quote ? `「${quote}」で終わりにしたくない、ということ` : "このまま終わりにしたくない、ということ";
  }
}

/**
 * 伝えたいことを選び直したときの、判定の入力への差分（今と同じなら空）。
 * ゴールの種類（仲直り・分かってほしい・決着）を選んだら、したいこと（謝る・伝える・距離）は外す（そちらが先に読まれるため）
 */
export function wantPatch(key, input = {}) {
  if (key === wantKeyOf(input)) return {};
  if (INTENT_OF_WANT[key]) return { intent: INTENT_OF_WANT[key] };
  const p = { goal: GOAL_OF_WANT[key] ?? "reconcile" };
  if (["apologize", "tell", "request_space"].includes(input.intent)) p.intent = "none";
  return p;
}

// ---------------------------------------------------------------- 相手はたぶん（AI が無いので、一手ごとの仮の文。数字は出さない・決めつけない）
/** 「相手はたぶん、〜」の〜。一手（action）ごと。画面には「仮の文」の印を付ける */
export const GUESS = {
  wait_until: "気持ちがまとまってから、短く返してくる",
  pause_with_time: "すぐには返事がないか、短く「わかった」とだけ返ってくる",
  self_calm: "もう終わったことだと思って、普段どおりに過ごしている",
  acknowledge: "受け取ってもらえたと分かって、少し言い方がやわらぐ",
  ask_feeling: "すぐには答えにくくて、少し時間をおいてから返してくる",
  short_feeling: "同じように気まずく思っていて、短く返してくる",
  apology_partial: "すぐには許せなくても、謝ってくれたことは受け取る",
  apology_full: "返事に時間がかかっても、謝ってくれたことにほっとする",
  accept_apology: "受け取ってもらえて、ほっとする",
  restore_routine: "いつもの調子で返してきて、そのまま普段に戻る",
  propose_call: "電話か文字か、話しやすいほうを選んで返してくる",
  propose_talk_plan: "話す日が決まると、それまでは落ち着いて待てる",
  prepare_points: "1つに絞った話なら、構えずに聞いてくれる",
  accept_space: "引き止められなかったことで、少し落ち着いて考えられる",
  request_space: "少しさみしく感じても、連絡する時刻があるので待てる",
};
export const guessText = (action) => GUESS[action] ?? null;

// ---------------------------------------------------------------- 道のり（伝わるまでの4段。いまの段を示す）
export const ROAD = ["落ち着く", "話す場をつくる", "伝える", "分かってもらう"];
/**
 * 局面 → いまの段（0〜3）。理由：
 *   言い合いの最中・相手から責める言葉や反論・返事待ち・距離の話 → まずお互いが落ち着く段（0）
 *   止まっている・普段の連絡・話し合いの提案・謝られた・くり返しの話 → 話す場（きっかけ）をつくる段（1）
 *   謝りたい・伝えたいことがある → 中身を伝える段（2）
 *   仲直りしたあとの一回きりのモヤモヤ → 伝えた後、分かってもらえたかの段（3）
 */
const ROAD_BY_PHASE = {
  "heated": 0, "partner_msg.b": 0, "partner_msg.c": 0, "waiting_partner": 0, "space.partner": 0, "space.self": 0,
  "cold_war.short": 1, "cold_war.long": 1, "cold_war.ignored": 1, "partner_msg.a": 1, "partner_msg.d": 1, "got_apology": 1, "after_makeup.repeat": 1,
  "want_apologize": 2, "before_talk": 2,
  "after_makeup.once": 3,
};
/** 一手が「いったん止める」（戻る時刻つきの保留）なら、局面によらず落ち着く段 */
export function roadStep(result) {
  if (!result || result.gate) return null;
  if (result.action === "pause_with_time") return 0;
  return ROAD_BY_PHASE[result.phase] ?? 1;
}

// ---------------------------------------------------------------- 送る一手／待つ一手
/** 待つ一手：今は相手に何も送らない行動（文面の代わりに「待つ間に／やること」と預ける箱を出す） */
export const WAIT_ACTIONS = new Set(["wait_until", "self_calm", "prepare_points"]);
/** 戻る時刻を大きく出す一手（wait_until は戻る時刻、self_calm は読み返す日） */
export const TIMED_ACTIONS = new Set(["wait_until", "self_calm"]);
export const timeLabel = (action) => action === "self_calm" ? "読み返す日" : "戻る時刻";
export function cardMode(result) {
  if (!result || result.gate) return "safety";
  return WAIT_ACTIONS.has(result.action) ? "wait" : "send";
}
/** 避けたい言葉のうち、言葉ではなく振る舞いのもの（「」を付けない） */
const AVOID_BEHAVIORS = new Set([AVOID_EXAMPLES.long, AVOID_EXAMPLES.multi]);
export const avoidPhrase = (t) => AVOID_BEHAVIORS.has(t) ? t : `「${t}」`;

// ---------------------------------------------------------------- 戻る時刻（タイマー用の時刻。judge の recheck から）
const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** 「明日の朝」の目安の時刻（judge は朝の何時かを決めていない。タイマーのための試作の仮の値） */
export const MORNING_HOUR = 8;
const NOON_HOUR = 12, NIGHT_END_HOUR = 6;
const tzOf = (now, tz) => Number.isFinite(tz) ? tz : -now.getTimezoneOffset();
/** 現地の dayOffset 日後の hour:minute */
function atLocal(now, tz, dayOffset, hour, minute = 0) {
  const p = localParts(now, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.date + dayOffset, hour, minute) - tz * MIN);
}
/** step 分単位に丸める（現地の時差が step 分の倍数なら、現地の時刻でも同じ丸め） */
const roundMin = (ms, step) => Math.round(ms / (step * MIN)) * step * MIN;
const pad2 = (n) => String(n).padStart(2, "0");

/**
 * 判定の点検時刻（recheck）→ 戻る時刻。cardTimes（timefmt.js）と同じ考え方で、夜中（0〜6時前）に当たる時刻は朝に読み替える。
 *   "+30m"（5分単位）・"+2h"・"+3h"（30分単位）・"+24h"・"+7d"（5分単位）は now から、"next_noon" は12時、"next_morning" は MORNING_HOUR 時
 * @returns {{ at: Date, day: string, clock: string, text: string, approx: boolean } | null}
 *   day：今日／明日／あさって／10月24日（夜中に「明日の朝」と言うときは空。見出しの「明日の朝」と食い違わないように）
 *   approx：朝の時刻は目安（MORNING_HOUR）
 */
export function returnAt(code, now, tzOffset) {
  if (!code || !(now instanceof Date)) return null;
  const tz = tzOf(now, tzOffset);
  const late = localParts(now, tz).hour < NIGHT_END_HOUR;
  const t = now.getTime();
  let at = null, morning = false;
  switch (code) {
    case "+30m": at = new Date(roundMin(t + 30 * MIN, 5)); break;
    case "+2h": case "+3h": at = new Date(roundMin(t + (code === "+2h" ? 2 : 3) * HOUR, 30)); break;
    case "+24h": at = new Date(roundMin(t + DAY, 5)); break;
    case "+7d": at = new Date(roundMin(t + 7 * DAY, 5)); break;
    case "next_noon": at = atLocal(now, tz, late ? 0 : 1, NOON_HOUR); break;
    case "next_morning": morning = true; break;
    default: return null;
  }
  if (at && ["+30m", "+2h", "+3h"].includes(code) && localParts(at, tz).hour < NIGHT_END_HOUR) morning = true;
  if (morning) at = atLocal(now, tz, late ? 0 : 1, MORNING_HOUR);
  const p = localParts(at, tz), days = p.day - localParts(now, tz).day;
  const day = morning && late ? "" : days === 0 ? "今日" : days === 1 ? "明日" : days === 2 ? "あさって" : `${p.month}月${p.date}日`;
  const clock = `${p.hour}:${pad2(p.minute)}`;
  return { at, day, clock, text: day ? `${day} ${clock}` : clock, approx: morning };
}

/** 現地の「H:MM」 */
export function clockOf(date, tzOffset) {
  const p = localParts(date, tzOf(date, tzOffset));
  return `${p.hour}:${pad2(p.minute)}`;
}
/** 残り時間の言い方（「あと8時間20分」「あと35分」）。過ぎたら「時刻になりました」 */
export function remainingText(at, now) {
  const ms = at.getTime() - now.getTime();
  if (ms <= 0) return "時刻になりました";
  const mins = Math.ceil(ms / MIN), h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return `あと${m}分`;
  if (h >= 48) return `あと${Math.round(h / 24)}日`;
  return m ? `あと${h}時間${m}分` : `あと${h}時間`;
}
/** start から at までの進み具合（0〜1） */
export function progressOf(start, at, now) {
  const span = at.getTime() - start.getTime();
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / span));
}

// ---------------------------------------------------------------- 読み取りのチップ
/** チップの順 */
export const CHIP_ORDER = ["lastSender", "partnerLast", "selfLast", "elapsed", "ongoing", "selfTemp", "intent", "goal", "cause", "repeat", "afterMakeup"];
const optLabel = (g, v) => GROUPS[g]?.options.find(o => o[0] === v)?.[1] ?? null;
/** はい／いいえの項目の選択肢 */
const BOOL_OPTIONS = {
  ongoing: [[true, "今も言い合っている"], [false, "いまは止まっている"]],
  repeat: [[false, "初めて"], [true, "前にもあった（くり返し）"]],
  afterMakeup: [[false, "まだ仲直りしていない"], [true, "もう仲直りした"]],
};
/** 項目の名前（直すときの問い） */
export const FIELD_NAMES = {
  lastSender: "最後に送ったのは", partnerLast: "相手の最後の一言", selfLast: "自分の最後の一言", elapsed: "最後のやりとりから",
  ongoing: "言い合いは", selfTemp: "いまの気持ち", intent: "したいこと", goal: "今回のゴール", cause: "原因は",
  repeat: TOGGLES.repeat, afterMakeup: TOGGLES.afterMakeup,
};
/** 項目 → 直すときの選択肢 [値, 表示] */
export function fieldOptions(key) {
  if (BOOL_OPTIONS[key]) return BOOL_OPTIONS[key];
  return GROUPS[key]?.options.map(([v, l]) => [v, l]) ?? [];
}
/** 項目と値 → チップの文（読み取った内容を、本人の言葉に近い形で） */
export function chipText(key, v) {
  switch (key) {
    case "lastSender": return { self: "最後に送ったのは自分", partner: "相手から連絡が来た", none: "どちらも送っていない" }[v] ?? null;
    case "partnerLast": return v === "none" ? "相手からはまだ何も来ていない" : `相手の言葉：${optLabel(key, v)}`;
    case "selfLast": return v === "none" ? null : `自分の最後の一言：${optLabel(key, v)}`;
    case "elapsed": return `最後のやりとりから：${optLabel(key, v)}`;
    case "ongoing": return v ? "いま言い合いの最中" : "言い合いは止まっている";
    case "selfTemp": return `いまの気持ち：${optLabel(key, v)}`;
    case "intent": return v === "none" ? null : `したいこと：${optLabel(key, v)}`;
    case "goal": return `ゴール：${optLabel(key, v)}`;
    case "cause": return v === "unknown" ? null : `原因：${optLabel(key, v)}`;
    case "repeat": return v ? "前にも同じことで喧嘩した" : "初めての喧嘩";
    case "afterMakeup": return v ? "もう仲直りした" : null;
    default: return null;
  }
}
/**
 * 読み取り（readText の結果）と本人の直し → チップの並び。
 * weak：Clef が迷った項目、または規則と Clef が食い違った項目（確認の画面で目立たせる）。食い違った項目は値が無いので「はっきりしない」と出す
 * @returns {{ key: string, value: any, text: string, evidence: string|null, weak: boolean, edited: boolean }[]}
 */
export function readChips(read, known = {}, edits = {}) {
  const out = [];
  const low = new Set([...(read?.lowConfidence || []), ...(read?.conflicts || [])]);
  for (const key of CHIP_ORDER) {
    const has = Object.hasOwn(known, key) && known[key] !== undefined;
    if (!has) {
      if ((read?.conflicts || []).includes(key) && !Object.hasOwn(edits, key)) {
        out.push({ key, value: undefined, text: `${FIELD_NAMES[key]}：はっきりしない`, evidence: null, weak: true, edited: false });
      }
      continue;
    }
    const text = chipText(key, known[key]);
    if (!text) continue;
    const edited = Object.hasOwn(edits, key);
    out.push({ key, value: known[key], text, evidence: edited ? null : read?.evidence?.[key] ?? null, weak: !edited && low.has(key), edited });
  }
  return out;
}

/** 読み取り＋直し（null は「分からない」＝外す）＋答え → 判定の入力の一部 */
export function knownFrom(fields = {}, edits = {}, patches = [], context = {}) {
  const k = { ...fields, ...context };
  for (const [f, v] of Object.entries(edits)) { if (v === null) delete k[f]; else k[f] = v; }
  return patches.reduce((acc, p) => ({ ...acc, ...p }), k);
}

// ---------------------------------------------------------------- 安全
/** 書いた文に安全の兆し（規則の言葉）があるか（U22：あるときだけ安全の確認を出す） */
export const hasSafetySign = (read) => !!(read?.safety?.selfHarm || read?.safety?.partnerThreat);
/** 続けるときにカードの一番上に置く窓口（1行。自分を傷つける言葉なら、よりそいホットラインを先に） */
export function safetyLineResources(safety = {}) {
  const R = SAFETY_RESOURCES;
  if (safety.selfHarm) return [R.yorisoi_self, R.dv_navi];
  if (safety.partnerThreat) return [R.dv_navi, R.yorisoi_partner];
  return [R.dv_navi, R.dv_plus];
}
/** 電話の番号 → tel: の宛先（「#8008」の # は %23） */
export const telHref = (contact) => `tel:${String(contact).replace(/[^0-9#+]/g, "").replace("#", "%23")}`;

/** 安全のカード（judge の安全ゲート → 文型の安全のカード） */
export function buildSafetyCard({ text = "", now = new Date(), tzOffset, safety } = {}) {
  const s = safety ?? { selfHarm: SELF_HARM_RE.test(text), partnerThreat: PARTNER_THREAT_RE.test(text) };
  const ctx = buildContext({ input: { danger: true }, consultText: text, now, tzOffset, safety: s });
  return { ctx, card: templateRespond(ctx) };
}

// ---------------------------------------------------------------- 送る前チェックの当たりの言い方
export const HIT_LABELS = {
  interrogate: "問い詰めに聞こえやすい", generalize: "決めつけに聞こえやすい", character: "人柄を責める言い方",
  past: "前のことを持ち出している", ultimatum: "突き放す言葉", read_receipt: "既読のことを言っている", sarcasm: "皮肉に聞こえやすい",
  but_apology: "「でも」が付いた謝り方", long: "長すぎる", missing_time: "戻る時刻が入っていない", third_party: "ほかの人の意見を持ち出している",
  asks_reply: "返事を求めている", mentions_diagnosis: "診断やタイプの話", forbidden: "勝ち負けの言葉",
};

// ---------------------------------------------------------------- カードの中身（統合1・統合3 で共通。並べ方だけが違う）
/**
 * 判定 → 文型のカード → 試作で足す欄。
 * @param {{ known: object, extra?: object, text?: string, now: Date, tzOffset?: number, safetyContinue?: boolean, safety?: object }} a
 *   known：判定の入力の一部（読み取り＋直し＋答え）。extra：カードで足した差分（［ちがう］［もっと合わせる］）
 */
export function buildPoc({ known = {}, extra = {}, text = "", now, tzOffset, safetyContinue = false, safety } = {}) {
  const tz = tzOf(now, tzOffset);
  const base = finalInput({ lateNight: isLateNight(now, tz), ...known });
  const input = applyPatch(base, extra);
  const ctx = buildContext({ input, consultText: text, now, tzOffset: tz, safety });
  const card = templateRespond(ctx);
  const r = ctx.result;
  const mode = cardMode(r);
  return {
    ctx, card, result: r, mode,
    want: safetyContinue || mode === "safety" ? null : { key: wantKeyOf(ctx.input), text: wantText(ctx.input, text) },
    guess: guessText(r.action),
    road: safetyContinue ? null : roadStep(r),
    // 戻る時刻（大きな数字とタイマー）は、時刻まで待つ一手だけ（伝えることを書き出す一手には「戻る」時がない）
    ret: TIMED_ACTIONS.has(r.action) ? returnAt(r.recheck, now, tz) : null,
    refine: refineQuestions(ctx),
    safetyLine: safetyContinue ? safetyLineResources(ctx.safety) : null,
  };
}
