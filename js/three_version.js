// 三択版の「版」の一覧（v1／v2）と、どの版で動かすかの決め方。仕様：docs/three-choice-logic.md の「v2（3choice-2026-10-10）」
//
//   v1（3choice-2026-10-08）… 最初の版。設問 js/data/questions3.js、ロジックは §1〜5 のまま
//   v2（3choice-2026-10-10）… 5人テストの結果で直した版。設問 js/data/questions3_v2.js、
//                              W追加の優先順位（拮抗 → 向きが逆 → 優勢（弱））・X追加に向きが逆の領域の両傾向・追加の上限を半分・
//                              確度低の領域を含むパターン ×0.8・矛盾枠の向きの条件・場面例の差し替え（js/data/scenes_v2.js）・練習カード
//
// 決め方（resolveVersion）：URL の ?qv=v1|v2 ＞ 保存中のセッションの版（途中再開は始めた版のまま）＞ DEFAULT_THREE_VERSION。
// ライブラリとしての既定（createSession3() に version を渡さないとき）は互換のため v1（LIB_DEFAULT_VERSION）。画面は常に解決した版を渡す。
import { QUESTIONS3 } from "./data/questions3.js";
import { QUESTIONS3_V2 } from "./data/questions3_v2.js";
import * as SCENES_MOD from "./data/scenes_v2.js";

/** v2 で差し替える場面例 { パターンID: [場面1, 場面2] }（差し替えたパターンだけ）。ファイルが空のスタブでも動く */
export const SCENES_V2 = SCENES_MOD.SCENES_V2 && typeof SCENES_MOD.SCENES_V2 === "object" ? SCENES_MOD.SCENES_V2 : {};
export const SCENES_V2_NOTES = SCENES_MOD.SCENES_V2_NOTES ?? null;

export const THREE_VERSIONS = {
  v1: {
    id: "v1",
    bank: QUESTIONS3,
    bankVersion: QUESTIONS3.version,           // "3choice-2026-10-08"
    label: "v1（最初の版）",
    date: "2026-10-08",
    logic: {
      id: "v1",
      wExtra: ["tie"],          // W追加：左右が拮抗した領域だけ
      xExtraConflict: false,    // X追加：level 40〜60 か回答数3未満の傾向だけ
      lowConf: false,           // 確度低の扱いなし
      lowConfFactor: 1,
      contraAlign: false,       // 矛盾枠は条件どおり
    },
    caps: { wExtra: 16, xExtra: 16, wPerDomain: 2, xPerTrait: 2 },
    scenes: null,
    practice: false,
  },
  v2: {
    id: "v2",
    bank: QUESTIONS3_V2,
    bankVersion: QUESTIONS3_V2.version,        // "3choice-2026-10-10"
    label: "v2（5人テストの結果で修正）",
    date: "2026-10-10",
    logic: {
      id: "v2",
      wExtra: ["tie", "conflict", "weak"],   // W追加：拮抗 ＞ W と X の向きが逆 ＞ 優勢（弱）の順
      xExtraConflict: true,                   // X追加：v1 と同じ＋向きが逆の領域の両傾向
      lowConf: true,                          // 確度低の領域を含むパターン（形状 S16〜S20 を除く）のスコア ×0.8
      lowConfFactor: 0.8,
      contraAlign: true,                      // 矛盾枠（クロス・特殊）は、優勢:t の領域で level(t) ＞ level(反対側) のときだけ
    },
    caps: { wExtra: 8, xExtra: 8, wPerDomain: 2, xPerTrait: 2 },
    scenes: SCENES_V2,
    practice: true,
  },
};

export const VERSION_IDS = Object.keys(THREE_VERSIONS);

// v1 に戻すときはここを "v1" に（画面の既定の版。URL の ?qv=v2 でいつでも v2 も開ける）
export const DEFAULT_THREE_VERSION = "v2";

/** ライブラリとしての既定（createSession3() などに版を渡さないとき）。既存のテスト・保存データとの互換のため v1 */
export const LIB_DEFAULT_VERSION = "v1";

export const isVersion = (v) => typeof v === "string" && Object.prototype.hasOwnProperty.call(THREE_VERSIONS, v);
/** 版の定義。知らない値は v1 */
export const versionOf = (v) => THREE_VERSIONS[isVersion(v) ? v : LIB_DEFAULT_VERSION];

/** URL の検索文字列（"?qv=v1" など）から版。無い・知らない値なら null */
export function versionFromSearch(search) {
  try {
    const v = new URLSearchParams(String(search ?? "")).get("qv");
    const k = v == null ? "" : v.trim().toLowerCase();
    return isVersion(k) ? k : null;
  } catch { return null; }
}

/**
 * どの版で動かすか：URL の ?qv= ＞ 保存中のセッションの版 ＞ 既定（DEFAULT_THREE_VERSION）
 *   search … location.search（"?qv=v1" など）、saved … 保存中のセッションの版（"v1" | "v2" | なし）
 */
export function resolveVersion({ search = "", saved = null, fallback = DEFAULT_THREE_VERSION } = {}) {
  return versionFromSearch(search) ?? (isVersion(saved) ? saved : null) ?? (isVersion(fallback) ? fallback : LIB_DEFAULT_VERSION);
}

/** 設問バンクの version 文字列（送信テキストの app）→ 版。知らない文字列なら null */
export function versionFromBank(app) {
  for (const v of Object.values(THREE_VERSIONS)) if (v.bankVersion === app) return v.id;
  return null;
}

/** パターンの場面例（版ごと）。v2 は scenes_v2.js に差し替えがあればそれを、弱い版（B?-1w／3w）は元の本文の id でも探す */
export function scenesFor(id, versionId, fallback = []) {
  const map = versionOf(versionId).scenes;
  if (map) {
    const weak = /^(B\d-[13])w$/.exec(String(id));
    const s = map[id] ?? (weak ? map[weak[1]] : undefined);
    if (Array.isArray(s) && s.length) return s.slice();
  }
  return Array.isArray(fallback) ? fallback.slice() : [];
}
/** 版で場面例が差し替わっているか */
export function scenesChanged(id, versionId) {
  const map = versionOf(versionId).scenes;
  if (!map) return false;
  const weak = /^(B\d-[13])w$/.exec(String(id));
  const s = map[id] ?? (weak ? map[weak[1]] : undefined);
  return Array.isArray(s) && s.length > 0;
}

/** 練習カード（v2。1問目の前に出し、採点しない・時間を測らない） */
export const PRACTICE_CARD = {
  stem: "練習：休日の朝、より近いのは？",
  left: "早起きして出かける",
  right: "ゆっくり寝ている",
  note: "カードを左右にスワイプするか、タップで選んでください。この1問は結果に入りません。",
};
