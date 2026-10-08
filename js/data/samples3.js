// 三択版のサンプル。回答データは samples.js をそのまま使い（コピーしない）、5択回答を三択の回答に変換して流す
// （adaptive3.js の fromLikertAnswers / fromScores）。画面では「5択回答からの推定」と明記する。
//
// EXPECTED5：5択版の選択（tests/expected_v2.json の id と役割）。三択版の選択と並べて一致／不一致を見るための比較用。
//            ブラウザから tests/ を取りに行かなくて済むように小さな定数として埋め込む（tests/adaptive3.test.mjs で一致を確認）。
import { SAMPLES, PROFILE_SAMPLES } from "./samples.js";

export const EXPECTED5 = {
  "石原": [["S03", "主軸"], ["X34-1", "補強"], ["X78-4", "補強"], ["S08", "矛盾"]],
  "別宮": [["S13", "矛盾"], ["X78-3", "主軸"], ["S17", "地（形状）"], ["X12-3", "補強"]],
  "P1": [["X24-2", "主軸"], ["X34-2", "補強"], ["X23-1", "補強"], ["X45-4", "矛盾"]],
  "P2": [["S18", "地（形状）"], ["B4-4", "主軸"], ["B6-7", "補強"], ["B2-7", "補強"]],
  "P3": [["S20", "地（形状）"], ["S02", "主軸"], ["X24-4", "補強"], ["X45-4", "矛盾"]],
  "P4": [["S01", "主軸"], ["X45-1", "補強"], ["X48-1", "補強"], ["X12-1", "補強"]],
  "P5": [["S18", "地（形状）"], ["B1-7", "主軸"], ["B2-7", "補強"], ["B4-7", "補強"]],
};

/** 「石原（実回答・表現A）」→「石原」、「P1 連絡は…」→「P1」 */
export const sampleKey = (name) => name.split(/[（ ]/)[0];

/** 実回答（80問シート）のサンプル：三択の回答に変換して流す */
export const SAMPLES3 = SAMPLES.map((s, i) => ({
  index: i, key: sampleKey(s.name), label: `${sampleKey(s.name)}（5択回答からの推定）`, name: s.name,
  answers: s.answers, wording: s.wording, expected5: EXPECTED5[sampleKey(s.name)] || null,
}));

/** 16スコアだけの合成プロファイル P1〜P5：スコアから三択の回答を作って流す */
export const PROFILE_SAMPLES3 = PROFILE_SAMPLES.map((p, i) => ({
  index: i, key: sampleKey(p.name), label: p.name, name: p.name,
  scores: p.scores, duel: p.duel, expected5: EXPECTED5[sampleKey(p.name)] || null,
}));
