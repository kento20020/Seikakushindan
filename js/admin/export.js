// 出力：参加者 CSV、設問 CSV、「Claude に貼る用」Markdown 要約。仕様：docs/feedback-spec.md §3 の9
import { DOMAINS, STATE_LABEL } from "../engine3.js";
import { QUESTIONS3 } from "../data/questions3.js";
import {
  FLAG_CODES, HARD_CODES, FLAG_SHORT, INP_LABEL, TIME_LABEL, MODE_LABEL, TYPE_LABEL, REVIEW, REVIEW_NOTE,
  domainMatrix, itemPlain, itemTitle, tsLabel, fmtDur,
} from "./aggregate.js";

const DOMAIN_NOS = Object.keys(DOMAINS).map(Number);

// ---------------------------------------------------------------- CSV
/** セルを CSV 用に。Excel で開いたときに式として実行されないよう、= + - @ で始まる文字列には ' を付ける */
export function csvCell(v) {
  if (v == null) return "";
  let s;
  if (typeof v === "number") s = Number.isFinite(v) ? String(v) : "";
  else if (typeof v === "boolean") s = v ? "TRUE" : "FALSE";
  else { s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; }
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCsv = (rows) => rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
export const CSV_BOM = "﻿";
const round1 = (v) => v == null ? null : Math.round(v * 10) / 10;
const ratio = (v) => v == null ? null : Math.round(v * 1000) / 1000;
const RES_MARK = { match: "一致", mismatch: "不一致", tie: "拮抗(比較外)", na: "除外", none: "" };

/** 参加者×項目の CSV（行＝重複を除いた全セッション。再検査も含め、集計対象かどうかを列で示す） */
export function participantCsvRows(model) {
  const usedIds = new Set(model.used.map(s => s.id));
  const dm = domainMatrix(model.sessions);
  const head = ["参加者コード", "開始日時", "検査回", "集計対象", "モード", "設問版", "回答数", "所要秒", "戻る", "差し替え", "スキップ", "左を選んだ割合", "左率の警告", "スワイプ", "タップ", "キー", "入力不明", "端末", "主軸ID", "主軸の見出し", "採用パターン"];
  for (const d of DOMAIN_NOS) head.push(`領域${d}_状態`, `領域${d}_状態名`, `領域${d}_W_A`, `領域${d}_W_B`, `領域${d}_self`, `領域${d}_act`, `領域${d}_self照合`, `領域${d}_act照合`);
  head.push("self一致数", "self比較数", "act一致数", "act比較数", "ブラインド選択", "ブラインド比較対象", "ブラインド順",
    "カード平均当てはまり度", "カード評価数", "違う印の数", "場面ありそう", "場面なさそう", "主軸yes", "主軸partly", "主軸no",
    "所要時間の体感", "スワイプ評価", "迷った設問", "足りない特徴", "ひとこと");
  const rows = [head];
  model.sessions.forEach((s, si) => {
    const r = dm.rows[si];
    const fbCards = (Array.isArray(s.fb?.cards) ? s.fb.cards : []).filter(Array.isArray);
    const ratings = fbCards.map(c => +c[1]).filter(v => v > 0);
    const row = [s.code, s.tsLabel, s.retestIndex + 1, usedIds.has(s.id) ? "○" : "×", MODE_LABEL[s.mode] ?? s.mode, s.app, s.n, s.dur, s.back, s.swaps, s.skips, ratio(s.leftRate), s.leftWarn ? "警告" : "",
      s.inp.s, s.inp.t, s.inp.k, s.inp.x, s.ua === "m" ? "スマホ" : s.ua === "d" ? "PC" : s.ua, s.main?.id, s.main?.headline, (s.res?.chosen || []).map(c => `${c[0]}(${c[1]})`).join(" ")];
    for (const c of r.cells) row.push(c.state, c.state ? STATE_LABEL[c.state] : "", c.a, c.b, c.self, c.act, RES_MARK[c.selfRes], RES_MARK[c.actRes]);
    const b = s.fb?.blind;
    row.push(r.self.m, r.self.n, r.act.m, r.act.n, b?.pick, b?.decoy, b?.order,
      round1(ratings.length ? ratings.reduce((x, y) => x + y, 0) / ratings.length : null), ratings.length,
      fbCards.reduce((n, c) => n + (Array.isArray(c[2]) ? c[2].length : 0), 0),
      fbCards.reduce((n, c) => n + (Array.isArray(c[3]) ? c[3].filter(x => x === "y").length : 0), 0),
      fbCards.reduce((n, c) => n + (Array.isArray(c[3]) ? c[3].filter(x => x === "n").length : 0), 0),
      fbCards.filter(c => c[4] === "yes").length, fbCards.filter(c => c[4] === "partly").length, fbCards.filter(c => c[4] === "no").length,
      TIME_LABEL[s.fb?.time] ?? s.fb?.time, s.fb?.swipe, (Array.isArray(s.fb?.hard) ? s.fb.hard : []).map(h => `${h[0]}:${h[1]}`).join(" "), s.fb?.missing, s.fb?.free);
    rows.push(row);
  });
  return rows;
}

/** 設問ごとの CSV（集計対象のセッションから。出題された設問のみ） */
export function itemCsvRows(model) {
  const head = ["設問ID", "種別", "領域", "ラウンド", "出所", "場面文", "A行動／左の行動", "B行動／右の行動", "A側／左の傾向", "B側／右の傾向", "表示回数", "表示人数", "回答数", "A側／左を選択", "B側／右を選択", "差し替えられた回数", "差し替えた人数", "スキップ", "平均秒", "中央値秒", "最大秒", "時間の標本数"];
  for (const c of FLAG_CODES) head.push(`一言_${c}`);
  head.push("一言を付けた人数");
  for (const c of HARD_CODES) head.push(`振り返り_${c}`);
  head.push("振り返りで迷った人数", "見直し理由");
  const rows = [head];
  for (const x of model.items.items) {
    if (!x.shown) continue;
    const row = [x.id, x.kind, x.domain, x.round, x.srcLabel, x.stem, x.textFirst, x.textSecond, x.first.trait, x.second.trait, x.shown, x.shownPeople, x.answered, x.pickFirst, x.pickSecond, x.swappedAway, x.swapPeople, x.skips,
      round1(x.timeMean), round1(x.timeMedian), round1(x.timeMax), x.timeN];
    for (const c of FLAG_CODES) row.push(x.flags[c]);
    row.push(x.flagPeople);
    for (const c of HARD_CODES) row.push(x.hard[c]);
    row.push(x.hardNonOkPeople, x.reasons.map(r => r.text).join(" ／ "));
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------- Markdown
const md = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const q = (v) => `「${String(v ?? "").replace(/\r?\n/g, " ")}」`;
const table = (head, rows) => rows.length ? [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map(r => `| ${r.map(md).join(" | ")} |`)].join("\n") : "";
const pctText = (r) => r.n ? `${r.m}/${r.n}（${r.pct}%）` : "—";
const flagsText = (counts, codes, short = FLAG_SHORT) => codes.filter(c => counts[c]).map(c => `${short[c]}×${counts[c]}`).join("、") || "—";
const sec = (s) => s == null ? "—" : `${s.toFixed(1)}`;

/** Claude に貼る用の要約（スプレッドシートや図ではなく、引用つきの表と箇条書き） */
export function buildMarkdown(model, { rescore = null } = {}) {
  const out = [];
  const { parsed, used } = model;
  const excluded = model.sessions.length - used.length;
  out.push(`# 16次元診断（三択版）テスト協力 集計`);
  out.push(`- 設問版: ${QUESTIONS3.version}／集計対象: ${model.people}人・${used.length}セッション${excluded ? `（再検査 ${excluded}件は集計から除外。参加者一覧と再検査の比較には載せた）` : ""}`);
  out.push(`- 読み込み: 機械用の行 ${parsed.markers}件のうち有効 ${model.sessions.length}件、エラー ${parsed.errors.length}件、重複 ${parsed.duplicates.length}件、再検査の組 ${model.retests.length}`);
  out.push("");
  out.push(`## 読み方`);
  out.push(`- 各領域に A側・B側がある（${DOMAIN_NOS.map(d => `${d} ${DOMAINS[d].name}: A=${DOMAINS[d].a}／B=${DOMAINS[d].b}`).join("、")}）。`);
  out.push(`- 診断の状態: 1・2・1w → A優勢、3・4・3w → B優勢、5 両方強い、6 両方弱い、7 場面による。W a:b は A側を選んだ数:B側を選んだ数。`);
  out.push(`- 照合: self（自己評価）は A/B を優勢の側と、both/neither/depends を状態 5/6/7 と比べる。act（実際の行動）は A/B を優勢の側と比べ、na と診断が拮抗の領域は除く。○一致 ×不一致 －比較外。`);
  out.push(`- 閾値は少人数の目安（${REVIEW_NOTE}）`);
  out.push("");

  if (parsed.errors.length || parsed.warnings.length || parsed.duplicates.length) {
    out.push(`## 1. 読み込みの注意`);
    for (const e of parsed.errors) out.push(`- 読めなかった: ${e.line}行目付近 ${e.reason}${e.hintCode ? `（コード ${e.hintCode} の分か）` : ""}`);
    for (const d of parsed.duplicates) out.push(`- 重複: ${d.code} ${tsLabel(d.ts)}（${d.same ? "同じ内容を1件に" : "内容が違うので後のものを採用"}）`);
    for (const w of parsed.warnings) out.push(`- ${w}`);
    out.push("");
  }

  out.push(`## 2. 参加者`);
  out.push(table(["コード", "日時", "モード", "回答", "所要", "戻る", "差替", "skip", "左率", "入力", "体感", "スワイプ", "主軸"],
    model.sessions.map(s => [`${s.code}${s.isRetest ? `（再検査${s.retestIndex}）` : s.retestTotal > 1 ? "（初回）" : ""}`, s.tsLabel, MODE_LABEL[s.mode] ?? s.mode, s.n, fmtDur(s.dur), s.back, s.swaps, s.skips,
      s.leftRate == null ? "—" : `${Math.round(s.leftRate * 100)}%${s.leftWarn ? "⚠位置バイアス" : ""}`,
      Object.entries(s.inp).filter(([, n]) => n).map(([k, n]) => `${INP_LABEL[k]}${n}`).join(" "),
      TIME_LABEL[s.fb?.time] ?? "—", s.fb?.swipe === 0 ? "使わず" : (s.fb?.swipe ?? "—"),
      s.main ? `${s.main.id}${q(s.main.headline)}${s.main.extra ? ` ほか${s.main.extra}本` : ""}` : "—"])));
  out.push("");

  out.push(`## 3. 領域ごとの照合（診断 vs self・act）`);
  const dm = model.domain;
  out.push(`- 全体の一致率: self ${pctText(dm.overall.self)}／act ${pctText(dm.overall.act)}`);
  out.push(table(["領域", "self一致", "act一致", "self・act両方が食い違った人"],
    dm.perDomain.map(p => [`${p.d} ${p.name}（A=${DOMAINS[p.d].a}／B=${DOMAINS[p.d].b}）`, pctText(p.self), pctText(p.act), `${p.bothMismatchPeople}人`])));
  const mark = (r) => ({ match: "○", mismatch: "×", tie: "－", na: "－", none: "" })[r];
  out.push("");
  out.push(table(["コード", ...DOMAIN_NOS.map(d => `領域${d}`)],
    dm.rows.map(r => [r.session.code, ...r.cells.map(c => `状態${c.state ?? "?"} ${c.a ?? "?"}:${c.b ?? "?"} ／自${c.self ?? "?"}${mark(c.selfRes)} 行${c.act ?? "?"}${mark(c.actRes)}`)])));
  out.push("");

  out.push(`## 4. ブラインド比較`);
  const bl = model.blind;
  out.push(`- 自分の結果（own）を選んだ人: ${bl.own}/${bl.total}${bl.pct != null ? `（${bl.pct}%）` : ""}${bl.noAnswer ? `、未回答 ${bl.noAnswer}人` : ""}`);
  if (bl.rows.length) out.push(table(["コード", "選んだ方", "比較用の結果", "並び順"], bl.rows.map(r => [r.session.code, r.pick, r.decoy, r.order])));
  out.push("");

  out.push(`## 5. カード評価`);
  const cs = model.cards;
  out.push(`- 当てはまり度（1〜5）の平均 ${cs.ratingMean == null ? "—" : cs.ratingMean.toFixed(2)}（${cs.ratingN}件）`);
  for (const c of cs.cards) {
    out.push("");
    out.push(`### ${c.id}${q(c.headline)} n=${c.n}／当てはまり度 ${c.mean == null ? "未回答" : c.mean.toFixed(1)}（${c.ratings.join(",") || "—"}）${c.roles.length ? `／役割 ${c.roles.join("・")}` : ""}`);
    const marked = c.sentences.map((s, i) => ({ s, i })).filter(x => x.s.marks);
    if (marked.length) for (const { s, i } of marked) out.push(`- 「違う」${s.marks}人（${s.by.join("、")}）: ${i + 1}文目 ${q(s.text)}`);
    else out.push(`- 「違う」の印: なし`);
    c.scenes.forEach((sc, i) => { if (sc.y || sc.n) out.push(`- 場面${i + 1} ${q(sc.text)}: ありそう${sc.y}／なさそう${sc.n}`); });
    if (c.axis.yes || c.axis.partly || c.axis.no) out.push(`- 「喧嘩の中心か」: はい${c.axis.yes}／一部${c.axis.partly}／いいえ${c.axis.no}`);
  }
  out.push("");

  out.push(`## 6. 設問ごと（反応のあったものだけ。ほかの出題済み設問は省略）`);
  const sig = model.items.items.filter(x => x.flagTotal || x.swappedAway || x.skips || x.hardTotal || x.reasons.length);
  const quiet = model.items.items.filter(x => x.shown).length - sig.length;
  out.push(table(["設問", "文", "表示", "A／左", "B／右", "差替", "skip", "秒(平均/最大)", "一言", "振り返り"],
    sig.map(x => [x.id, itemPlain(x), x.shown, x.pickFirst, x.pickSecond, x.swappedAway, x.skips, x.timeN ? `${sec(x.timeMean)}/${sec(x.timeMax)}` : "—", flagsText(x.flags, FLAG_CODES), flagsText(x.hard, HARD_CODES)])));
  out.push(`- 反応なしの設問 ${quiet}件は省略。全体の回答時間の中央値は ${sec(model.items.overallMedian)}秒。W の「A／左」「B／右」は A行動・B行動、X は左右に出る行動文（文中の「左（傾向）」「右（傾向）」）を選んだ数。`);
  out.push("");

  out.push(`## 7. 見直し候補（自動・小さい標本の目安）`);
  out.push(`- 基準: 一言${REVIEW.flagPeople}人以上／差し替え${REVIEW.swapPeople}人以上／振り返りで迷った${REVIEW.hardNonOkPeople}人以上／Wで${REVIEW.oneSidedMinN}人以上が全員同じ側／回答時間の中央値が全体の${REVIEW.timeRatio}倍超（n≥${REVIEW.timeMinN}）／領域でself・act両方が食い違い${REVIEW.domainBothMismatchPeople}人以上／当てはまり度の平均${REVIEW.cardMeanBelow}未満／「違う」${REVIEW.sentenceMarkPeople}人以上の文`);
  if (!model.review.length) out.push(`- 該当なし`);
  for (const r of model.review) {
    const base = r.type === "item" ? `${itemTitle(r.item)} ${itemPlain(r.item)}` : r.title;
    out.push(`- [${TYPE_LABEL[r.type]}] ${base}${r.quote ? ` ${q(r.quote)}` : ""} — ${r.reasons.join("；")}`);
  }
  out.push("");

  if (model.retests.length) {
    out.push(`## 再検査の比較`);
    out.push(table(["コード", "間隔(日)", "状態が同じ領域", "優勢の側が同じ領域", "主軸", "採用パターンの一致", "levelの平均差", "同じ設問での同じ選択"],
      model.retests.map(r => [r.code, r.gapDays, `${r.states.same}/${r.states.total}`, `${r.states.sameSide}/${r.states.total}`, r.mainSame == null ? "—" : r.mainSame ? "同じ" : "違う", `${r.chosen.inter}/${r.chosen.union}`, r.lvDiff == null ? "—" : r.lvDiff.toFixed(1), `${r.items.agree}/${r.items.common}`])));
    out.push("");
  }

  if (rescore && rescore.diff) {
    out.push(`## 8. 再採点（いまのロジックで作り直した結果が当時と違う人）`);
    for (const r of rescore.rows.filter(x => x.status === "diff")) {
      out.push(`- ${r.session.code}（${r.session.tsLabel}）: ${[
        r.diff.chosen.same ? null : `採用 ${r.diff.chosen.then.map(c => c.join("/")).join(" ")} → ${r.diff.chosen.now.map(c => c.join("/")).join(" ")}`,
        ...r.diff.states.map(s => `領域${s.d}の状態 ${s.then ?? "なし"}→${s.now ?? "なし"}`),
        r.diff.w.length ? `W ${r.diff.w.map(x => `領域${x.d} ${x.then ? x.then.join(":") : "?"}→${x.now.join(":")}`).join("、")}` : null,
        r.diff.lv.length ? `level ${r.diff.lv.map(x => `${x.trait} ${x.then ?? "?"}→${x.now}`).join("、")}` : null].filter(Boolean).join("；")}`);
    }
    out.push("");
  }

  out.push(`## 9. 自由記述`);
  if (!cs.texts.length) out.push(`- なし`);
  for (const t of cs.texts) out.push(`- ${t.code}（${t.kind === "missing" ? "この結果に足りない特徴" : "ひとこと"}）: ${q(t.text)}`);
  return out.join("\n") + "\n";
}
