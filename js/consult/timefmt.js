// 判定の時刻の値（recheck・timing）を、カードや文面に書く日本語にする。説明：docs/consult-ai.md
// 渡された now（Date）だけを使う（同じ now なら必ず同じ文字列）。時刻は tzOffset（分。東が正、日本は 540）の現地時刻で読む。
// tzOffset を省くと now の実行環境の時差（-now.getTimezoneOffset()）を使う。

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
/** 夜中（0時〜6時前）。この時間に当たる時刻は、文面とカードでは「明日の朝」に読み替える（R4 の考え方） */
const NIGHT_END_HOUR = 6;

const tzOf = (now, tzOffset) => Number.isFinite(tzOffset) ? tzOffset : -now.getTimezoneOffset();

/** now（Date）の現地時刻の部品。day は 1970-01-01 からの現地の日数（日付が変わったかを比べる） */
export function localParts(now, tzOffset) {
  const t = now.getTime() + tzOf(now, tzOffset) * MIN;
  const d = new Date(t);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate(), hour: d.getUTCHours(),
    minute: d.getUTCMinutes(), weekday: d.getUTCDay(), day: Math.floor(t / DAY) };
}

/** 現地の時刻（0〜23） */
export const localHour = (now, tzOffset) => localParts(now, tzOffset).hour;
/** 現地で 0時〜6時前か（判定の lateNight） */
export const isLateNight = (now, tzOffset) => localHour(now, tzOffset) < NIGHT_END_HOUR;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-10-15T23:00+09:00（木）" の形（プロンプトの3層目に入れる） */
export function localIso(now, tzOffset) {
  const tz = tzOf(now, tzOffset), p = localParts(now, tz);
  const pad = (n) => String(n).padStart(2, "0");
  const sign = tz >= 0 ? "+" : "-", a = Math.abs(tz);
  return `${p.year}-${pad(p.month)}-${pad(p.date)}T${pad(p.hour)}:${pad(p.minute)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}（${WEEKDAYS[p.weekday]}）`;
}

/** now から ms 後の現地時刻の部品と、今日から何日先か */
function after(now, ms, tzOffset) {
  const tz = tzOf(now, tzOffset);
  const p = localParts(new Date(now.getTime() + ms), tz);
  return { ...p, days: p.day - localParts(now, tz).day };
}

/** 5分単位に丸めた「H時M分」（0分なら「H時」）。丸めで時が繰り上がれば日もまたぐ */
function clock5(now, ms, tzOffset) {
  const p0 = after(now, ms, tzOffset);
  const extra = (Math.round(p0.minute / 5) * 5 - p0.minute) * MIN;
  const p = after(now, ms + extra, tzOffset);
  return { ...p, text: p.minute ? `${p.hour}時${p.minute}分` : `${p.hour}時` };
}

/** 30分単位に丸めた「H時」「H時半」 */
function clock30(now, ms, tzOffset) {
  const p0 = after(now, ms, tzOffset);
  const to = p0.minute < 15 ? 0 : p0.minute < 45 ? 30 : 60;
  const p = after(now, ms + (to - p0.minute) * MIN, tzOffset);
  return { ...p, text: p.minute ? `${p.hour}時半` : `${p.hour}時` };
}

const dayPrefix = (days) => days === 0 ? "" : days === 1 ? "明日の" : days === 2 ? "あさっての" : null;
const isNight = (p) => p.hour < NIGHT_END_HOUR;

/** 7日後などの日付「10月22日」 */
function dateText(now, ms, tzOffset) {
  const p = after(now, ms, tzOffset);
  return `${p.month}月${p.date}日`;
}

/**
 * 点検時刻（judge の recheck）を、カードに書く言い方にする。
 *   "+30m" → 「30分後（14時40分ごろ）」（5分単位）／ "+2h"・"+3h" → 「16時ごろ」「16時半ごろ」（30分単位。日付をまたげば「明日の1時ごろ」）
 *   "next_noon" → 「明日の12時」（0時〜6時前なら「今日の12時」）／ "next_morning" → 「明日の朝」／ "+24h" → 「明日の同じ時間ごろ」
 *   "+7d" → 「10月22日」／ それ以外・null → null
 * opts.clampNight が真なら、"+30m"・"+2h"・"+3h" の時刻が夜中（0時〜6時前）に当たるとき「明日の朝」と書く（カードはこちらを使う）
 * @param {string|null} code
 * @param {Date} now
 * @param {{ tzOffset?: number, clampNight?: boolean }} [opts]
 * @returns {string|null}
 */
export function recheckText(code, now, { tzOffset, clampNight = false } = {}) {
  if (!code || !(now instanceof Date)) return null;
  const late = isLateNight(now, tzOffset);
  switch (code) {
    case "+30m": {
      const c = clock5(now, 30 * MIN, tzOffset);
      if (clampNight && isNight(c)) return "明日の朝";
      return `30分後（${dayPrefix(c.days) ?? ""}${c.text}ごろ）`;
    }
    case "+2h": case "+3h": {
      const c = clock30(now, (code === "+2h" ? 2 : 3) * 60 * MIN, tzOffset);
      if (clampNight && isNight(c)) return "明日の朝";
      return `${dayPrefix(c.days) ?? ""}${c.text}ごろ`;
    }
    case "next_noon": return late ? "今日の12時" : "明日の12時";
    case "next_morning": return "明日の朝";
    case "+24h": return "明日の同じ時間ごろ";
    case "+7d": return dateText(now, 7 * DAY, tzOffset);
    default: return null;
  }
}

/**
 * 文面（相手に送る文）に入れる時刻。点検時刻と同じ値を、相手に伝える言い方にする（夜中に当たる時刻は「明日の朝」）。
 *   "+30m" → 「14時40分ごろ」／ "+2h"・"+3h" → 「16時ごろ」／ "next_noon" → 「明日の昼」／ "next_morning" → 「明日の朝」
 *   "+24h" → 今の時間帯で「明日の朝」（5〜10時）「明日の昼」（11〜16時）「明日の夜」（それ以外）／ "+7d" → 「10月22日」
 * @returns {string|null}
 */
export function draftTimeText(code, now, { tzOffset } = {}) {
  if (!code || !(now instanceof Date)) return null;
  const late = isLateNight(now, tzOffset);
  switch (code) {
    case "+30m": case "+2h": case "+3h": {
      const c = code === "+30m" ? clock5(now, 30 * MIN, tzOffset) : clock30(now, (code === "+2h" ? 2 : 3) * 60 * MIN, tzOffset);
      if (isNight(c)) return "明日の朝";
      return `${dayPrefix(c.days) ?? ""}${c.text}ごろ`;
    }
    case "next_noon": return late ? "今日の昼" : "明日の昼";
    case "next_morning": return "明日の朝";
    case "+24h": {
      const h = localHour(now, tzOffset);
      return h >= 5 && h <= 10 ? "明日の朝" : h >= 11 && h <= 16 ? "明日の昼" : "明日の夜";
    }
    case "+7d": return dateText(now, 7 * DAY, tzOffset);
    default: return null;
  }
}

/**
 * 送るタイミング（judge の timing）。"now" → 「今」、"morning" → 「朝になってから」、それ以外 → null
 * @param {string|null} timing
 */
export function timingText(timing) {
  return timing === "now" ? "今" : timing === "morning" ? "朝になってから" : null;
}
