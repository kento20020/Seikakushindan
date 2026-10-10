// 集計ページの表示（DOM を作る関数群）。データは aggregate.js / rescore.js が作る。参加者の文字列は textContent で入れる。
import { h } from "./dom.js";
import { DOMAINS, LOWCONF_LABEL } from "../engine3.js";
import { THREE_VERSIONS } from "../three_version.js";
import {
  REVIEW, REVIEW_NOTE, FLAG_CODES, HARD_CODES, FLAG_LABEL, FLAG_SHORT, INP_LABEL, SELF_LABEL, TIME_LABEL, AXIS_LABEL, MODE_LABEL, TYPE_LABEL,
  LV_TOLERANCE, compareItemIds, compareItemRows, itemIdLabel, fmtDur, itemTable,
} from "./aggregate.js";
import { RESCORE_MODES } from "./rescore.js";

/** 送信の版の内訳（v1 3件・v2 2件） */
export const versionsText = (versions) => Object.entries(versions || {}).filter(([, n]) => n).map(([v, n]) => `${v}（${THREE_VERSIONS[v].bankVersion}）${n}件`).join("・") || "なし";

const DOMAIN_NOS = Object.keys(DOMAINS).map(Number);

// ---------------------------------------------------------------- 部品
export const chip = (text, cls = "", title = "") => h("span", { class: `chip ${cls}`.trim(), title: title || null }, text);
const dash = h("span", { class: "dim" }, "—");
const dashNode = () => dash.cloneNode(true);
export const num = (v, digits = 0) => v == null ? dashNode() : (digits ? Number(v).toFixed(digits) : String(v));

export function section(id, no, title, ...kids) {
  return h("section", { class: "sec", id, "aria-labelledby": `${id}-h` },
    h("h2", { id: `${id}-h` }, no ? h("span", { class: "sec-no", "aria-hidden": "true" }, no) : null, title), ...kids);
}
export const tableWrap = (label, table, cls = "") => h("div", { class: `tbl-wrap ${cls}`.trim(), role: "region", "aria-label": label, tabindex: "0" }, table);
const stat = (label, value, sub, cls = "", unit = "") => h("div", { class: `stat ${cls}`.trim() }, h("div", { class: "stat-v" }, value, unit ? h("small", { class: "unit" }, unit) : null), h("div", { class: "stat-l" }, label), sub ? h("div", { class: "stat-s" }, sub) : null);
const note = (...kids) => h("p", { class: "note" }, ...kids);
const th = (text, cls = "", attrs = {}) => h("th", { scope: "col", class: cls || null, ...attrs }, text);

function wBar(a, b) {
  if (a == null || b == null) return null;
  const n = a + b;
  return h("span", { class: "wbar", title: `A側 ${a} : B側 ${b}`, "aria-hidden": "true" }, n ? [h("i", { class: "a", style: { flexGrow: a } }), h("i", { class: "b", style: { flexGrow: b } })] : null);
}

export function inputMix(inp) {
  const total = inp.s + inp.t + inp.k + inp.x;
  const parts = ["s", "t", "k", "x"].filter(k => inp[k]);
  return h("div", { class: "inpmix" },
    h("span", { class: "inpbar", "aria-hidden": "true" }, parts.map(k => h("i", { class: `i-${k}`, style: { flexGrow: inp[k] } }))),
    h("span", { class: "inptxt" }, total ? parts.map(k => `${INP_LABEL[k]}${inp[k]}`).join(" ") : "—"));
}

// ---------------------------------------------------------------- 1 読み込み結果
export function renderLoad(model, { includeRetests, onToggleRetests }) {
  const p = model.parsed;
  const kids = [];
  if (!p.markers) {
    kids.push(h("p", { class: "msg ng" }, "「16DFB1|」で始まる機械用の行が見つかりませんでした。送られてきた本文を、最後の「|END」まで全部貼ってください。"));
  }
  kids.push(h("div", { class: "stats" },
    stat("有効", p.sessions.length, null, p.sessions.length ? "ok" : "", "件"),
    stat("人数", new Set(p.sessions.map(s => s.codeKey)).size, null, "", "人"),
    stat("読めなかった", p.errors.length, null, p.errors.length ? "ng" : "", "件"),
    stat("重複（1件にまとめた）", p.duplicates.length, null, p.duplicates.length ? "warn" : "", "件"),
    stat("再検査（同じコード）", p.groups.length, null, p.groups.length ? "info" : "", "組"),
    stat("機械用の行を検出", p.markers, null, "", "件")));
  if (p.errors.length) {
    kids.push(h("h3", null, "読めなかった箇所"));
    kids.push(h("ul", { class: "errs" }, p.errors.map(e => h("li", { class: "err" },
      h("div", { class: "err-h" }, chip(e.kind === "truncated" ? "途中で切れた" : e.kind === "crc" ? "CRC不一致" : e.kind === "json" ? "JSONエラー" : e.kind === "version" ? "未対応の版" : "形式エラー", "ng"),
        h("b", null, `機械用の行 ${e.n}件目（${e.line}行目付近）`), e.hintCode ? h("span", null, `コード「${e.hintCode}」の分かもしれません。再送をお願いしてください。`) : null),
      h("p", { class: "err-r" }, e.reason),
      e.excerpt ? h("code", { class: "excerpt" }, e.excerpt + "…") : null,
      e.context?.length ? h("div", { class: "err-ctx" }, h("span", { class: "dim" }, "直前の行: "), e.context.join(" ／ ")) : null))));
  }
  if (p.duplicates.length) {
    kids.push(h("h3", null, "重複（同じコード＋開始日時）"));
    kids.push(h("ul", { class: "plain" }, p.duplicates.map(d => h("li", null, h("b", null, d.code), ` ${d.ts} — `, d.same ? "内容が同じなので1件にまとめました。" : "内容が違うので、後に貼られた方を採用しました。"))));
  }
  for (const w of p.warnings) kids.push(h("p", { class: "msg warn" }, w));
  if (p.groups.length) {
    kids.push(h("h3", null, "再検査（同じコードで開始日時が違う）"));
    kids.push(h("label", { class: "check" },
      h("input", { type: "checkbox", id: "inc-retests", checked: includeRetests ? true : null, onchange: (e) => onToggleRetests(e.target.checked) }),
      h("span", null, "再検査（2回目以降）も、以下の集計に含める", h("small", null, "既定は含めない（同じ人を二重に数えないため）。参加者一覧と、ここの比較にはいつも出ます。"))));
    const rows = model.retests;
    kids.push(tableWrap("再検査の比較", h("table", { class: "tbl" },
      h("thead", null, h("tr", null, th("コード"), th("初回"), th("再検査"), th("間隔", "num"), th("状態が同じ領域", "num"), th("優勢の側が同じ", "num"), th("主軸"), th("採用パターン一致", "num"), th("level平均差", "num"), th("同じ設問で同じ選択", "num"))),
      h("tbody", null, rows.map(r => h("tr", null,
        h("th", { scope: "row" }, r.code), h("td", null, r.first.tsLabel), h("td", null, r.later.tsLabel), h("td", { class: "num" }, `${r.gapDays}日`),
        h("td", { class: "num", title: r.states.diffDomains.map(x => `領域${x.d}: ${x.a}→${x.b}`).join("、") }, `${r.states.same}/${r.states.total}`),
        h("td", { class: "num" }, `${r.states.sameSide}/${r.states.total}`),
        h("td", null, r.mainSame == null ? dashNode() : chip(r.mainSame ? "同じ" : "違う", r.mainSame ? "m-match" : "m-none")),
        h("td", { class: "num" }, `${r.chosen.inter}/${r.chosen.union}`),
        h("td", { class: "num" }, r.lvDiff == null ? dashNode() : r.lvDiff.toFixed(1)),
        h("td", { class: "num" }, r.items.common ? `${r.items.agree}/${r.items.common}（${Math.round(r.items.agree / r.items.common * 100)}%）` : dashNode())))))));
    kids.push(note("状態が同じ領域：8領域のうち、再検査でも状態コードが同じだった数。優勢の側が同じ：A/B/拮抗の分類が同じだった数。採用パターン一致：採用された172本の id の共通数/和集合。同じ設問で同じ選択：両方に出た設問で、同じ傾向を選んだ数。"));
  }
  const used = model.used.length;
  kids.push(note(`集計対象：${model.people}人・${used}セッション（設問の版 ${versionsText(model.versions)}）。` + (!includeRetests && model.sessions.length > used ? `再検査 ${model.sessions.length - used}件は集計から除いています。` : "") +
    (Object.values(model.versions || {}).filter(Boolean).length > 1 ? "版で文が違う設問（v2 で書き換えた W・組を入れ替えた X）は、設問ごとの表で版ごとに別の行にしています。" : "")));
  return section("s1", "1", "読み込み結果", ...kids);
}

// ---------------------------------------------------------------- 2 参加者一覧
export function renderParticipants(model) {
  const used = new Set(model.used.map(s => s.id));
  const rows = model.sessions.map(s => h("tr", { class: used.has(s.id) ? null : "excluded" },
    h("th", { scope: "row", class: "sticky" }, s.code,
      s.isRetest ? chip(`再検査${s.retestIndex}`, "info") : (s.retestTotal > 1 ? chip("初回", "info") : null),
      used.has(s.id) ? null : chip("集計対象外", "m-none", "「再検査も集計に含める」で入れられます"),
      chip(s.qv, `ver ver-${s.qv}`, `設問の版 ${s.qv}（${s.app ?? "app なし"}）`)),
    h("td", { class: "nw" }, s.tsLabel), h("td", { class: "nw" }, MODE_LABEL[s.mode] ?? s.mode ?? "—"),
    h("td", { class: "num" }, s.n), h("td", { class: "num" }, fmtDur(s.dur)), h("td", { class: "num" }, s.back), h("td", { class: "num" }, s.swaps), h("td", { class: "num" }, s.skips),
    h("td", { class: "num" }, s.leftRate == null ? dashNode() : [`${Math.round(s.leftRate * 100)}%`, s.leftWarn ? chip("位置バイアス", "ng", "左ばかり／右ばかり選んでいます（0.85以上か0.15以下）") : null]),
    h("td", null, inputMix(s.inp)),
    h("td", { class: "main" }, s.main ? [h("b", null, s.main.id), ` ${s.main.headline}`, s.main.extra ? h("span", { class: "dim" }, ` ほか${s.main.extra}本`) : null] : dashNode()),
    h("td", { class: "nw" }, TIME_LABEL[s.fb?.time] ?? dashNode()),
    h("td", { class: "num" }, s.fb?.swipe === 0 ? "使わず" : (s.fb?.swipe ?? dashNode()))));
  return section("s2", "2", "参加者一覧",
    model.sessions.length ? tableWrap("参加者一覧", h("table", { class: "tbl", id: "tbl-participants" },
      h("thead", null, h("tr", null, th("コード", "sticky"), th("開始日時"), th("モード"), th("回答数", "num"), th("所要時間", "num"), th("戻る", "num"), th("差し替え", "num"), th("スキップ", "num"), th("左を選んだ割合", "num"), th("入力方法"), th("主軸"), th("体感"), th("スワイプ", "num", { title: "スワイプの使いやすさ 1〜5（0＝使わなかった）" }))),
      h("tbody", null, rows))) : h("p", { class: "empty" }, "有効な回答がありません。"),
    note("左を選んだ割合が 0.85 以上か 0.15 以下だと、内容ではなく位置で答えた可能性があります（位置バイアスの警告）。体感は「長い／ちょうどいい／短い」、スワイプ評価は 1〜5（0＝使わなかった）。"));
}

// ---------------------------------------------------------------- 3 領域ごとの照合
const MARK = { match: "○", mismatch: "×", tie: "－", na: "－", none: "？" };
const CHIP_CLS = { match: "m-match", mismatch: "m-mismatch", tie: "m-none", na: "m-none", none: "m-none" };
const SIDE_CLS = { A: "side-a", B: "side-b" };

function cell(c) {
  if (!c.state && c.a == null) return h("td", { class: "dm" }, dashNode());
  const sideCls = c.cls === "A" || c.cls === "B" ? SIDE_CLS[c.cls] : "side-t";
  return h("td", { class: `dm ${sideCls}` },
    h("div", { class: "dm-state", title: c.label }, h("b", null, c.state ?? "—"), " ", c.label),
    h("div", { class: "dm-w" }, `W ${c.a ?? "?"}:${c.b ?? "?"}`, wBar(c.a, c.b)),
    h("div", { class: "dm-chips" },
      chip(`自 ${c.self ? (c.self === "A" || c.self === "B" ? c.self : SELF_LABEL[c.self]) : "—"} ${MARK[c.selfRes]}`, CHIP_CLS[c.selfRes], `自己評価 ${SELF_LABEL[c.self] ?? "未回答"}：` + ({ match: "診断と一致", mismatch: "診断と不一致", none: "比較できない" })[c.selfRes]),
      chip(`行 ${c.act ? (c.act === "na" ? "なし" : c.act) : "—"} ${MARK[c.actRes]}`, CHIP_CLS[c.actRes], `実際の行動 ${c.act === "na" ? "覚えていない" : (c.act ?? "未回答")}：` + ({ match: "診断と一致", mismatch: "診断と不一致", tie: "診断が拮抗なので比較しない", na: "除外", none: "比較できない" })[c.actRes])));
}

const rateText = (r) => r.n ? h("span", null, h("b", null, `${r.m}/${r.n}`), h("span", { class: "dim" }, ` ${r.pct}%`)) : dashNode();

export function renderDomain(model) {
  const dm = model.domain;
  const head = h("tr", null, th("コード", "sticky"), DOMAIN_NOS.map(d => h("th", { scope: "col", class: "dm-h" }, h("div", null, h("b", null, d), ` ${DOMAINS[d].name}`), h("div", { class: "dm-ab" }, h("span", { class: "ta" }, `A ${DOMAINS[d].a}`), h("span", { class: "tb" }, `B ${DOMAINS[d].b}`)))), th("この人の一致"));
  const body = dm.rows.map(r => h("tr", null,
    h("th", { scope: "row", class: "sticky" }, r.session.code, r.session.isRetest ? chip(`再${r.session.retestIndex}`, "info", "再検査") : null),
    r.cells.map(cell),
    h("td", { class: "dm-tot" }, h("div", null, "自 ", rateText(r.self)), h("div", null, "行 ", rateText(r.act)))));
  const foot = [
    h("tr", { class: "rate" }, h("th", { scope: "row", class: "sticky" }, "自己評価と一致"), dm.perDomain.map(p => h("td", null, rateText(p.self))), h("td", null, rateText(dm.overall.self))),
    h("tr", { class: "rate" }, h("th", { scope: "row", class: "sticky" }, "実際の行動と一致"), dm.perDomain.map(p => h("td", null, rateText(p.act))), h("td", null, rateText(dm.overall.act))),
    h("tr", { class: "rate" }, h("th", { scope: "row", class: "sticky" }, "両方が食い違い"), dm.perDomain.map(p => h("td", { class: p.bothMismatchPeople >= REVIEW.domainBothMismatchPeople ? "hot" : null }, `${p.bothMismatchPeople}人`)), h("td", null, dashNode())),
  ];
  return section("s3", "3", "領域ごとの照合（診断 × 自己評価 × 実際の行動）",
    h("div", { class: "stats" },
      stat("自己評価との一致", dm.overall.self.n ? `${dm.overall.self.pct}%` : "—", `${dm.overall.self.m}/${dm.overall.self.n}（参加者×領域）`, "info"),
      stat("実際の行動との一致", dm.overall.act.n ? `${dm.overall.act.pct}%` : "—", `${dm.overall.act.m}/${dm.overall.act.n}（na・拮抗の領域を除く）`, "info")),
    h("div", { class: "legend" },
      h("span", null, "診断の状態：1・2・1w → ", chip("A", "side-a-chip"), "　3・4・3w → ", chip("B", "side-b-chip"), "　5＝両方強い　6＝両方弱い　7＝場面による"),
      h("span", null, chip("自 A ○", "m-match"), "一致 ", chip("自 B ×", "m-mismatch"), "不一致 ", chip("行 A －", "m-none"), "比較外（na、または診断が拮抗）")),
    dm.rows.length ? tableWrap("領域ごとの照合", h("table", { class: "tbl dm-tbl", id: "tbl-domain" }, h("thead", null, head), h("tbody", null, body), h("tfoot", null, foot))) : h("p", { class: "empty" }, "集計対象がありません。"),
    note("自己評価（自）は A／B を診断の優勢の側と、両方強い・両方弱い・場面による を状態 5・6・7 と比べます。実際の行動（行）は A／B を優勢の側と比べ、「覚えていない」と、診断が拮抗（5・6・7）の領域は一致率から除きます（拮抗なら A でも B でも矛盾しないため）。W は A側:B側 の選択数。"));
}

// ---------------------------------------------------------------- 4 ブラインド比較
export function renderBlind(model) {
  const b = model.blind;
  return section("s4", "4", "ブラインド比較",
    h("div", { class: "stats" }, stat("自分の結果（own）を選んだ人", b.total ? `${b.own}/${b.total}` : "—", b.pct != null ? `${b.pct}%` : "", "info"), b.noAnswer ? stat("未回答", b.noAnswer, null, "warn", "人") : null),
    b.rows.length ? tableWrap("ブラインド比較", h("table", { class: "tbl" },
      h("thead", null, h("tr", null, th("コード"), th("選んだ方"), th("比較用の結果"), th("並び順"))),
      h("tbody", null, b.rows.map(r => h("tr", null, h("th", { scope: "row" }, r.session.code), h("td", null, chip(r.pick === "own" ? "自分の結果（own）" : "別の結果（decoy）", r.pick === "own" ? "m-match" : "m-mismatch")), h("td", null, r.decoy || dashNode()), h("td", null, r.order || dashNode())))))) : h("p", { class: "empty" }, "ブラインド比較の回答がありません。"),
    note("自分の上位3本と、別の人の結果の上位3本を名前を伏せて並べ、どちらが自分に近いかを選んでもらった結果です。own を選ぶ人が多いほど、結果が自分らしく読めているといえます（5人なら 4人以上が目安）。"));
}

// ---------------------------------------------------------------- 5 カード評価
function stars(mean) { return mean == null ? "未回答" : `${mean.toFixed(1)} / 5`; }

export function renderCards(model) {
  const cs = model.cards;
  const list = cs.cards.map(c => h("article", { class: `pcard${c.mean != null && c.mean < REVIEW.cardMeanBelow ? " low" : ""}` },
    h("header", null,
      h("div", { class: "pc-id" }, h("b", null, c.id), c.roles.map(r => chip(r, "info"))),
      h("h3", null, c.headline),
      h("div", { class: "pc-meta" }, `n=${c.n}`, " ／ 当てはまり度 ", h("b", null, stars(c.mean)), c.ratings.length ? h("span", { class: "dim" }, `（${c.ratings.join("、")}）`) : null)),
    c.one ? h("p", { class: "pc-one" }, c.one) : null,
    h("ol", { class: "sent" }, c.sentences.map(s => h("li", { class: s.marks ? "marked" : null },
      h("span", { class: "sent-t" }, s.text), s.marks ? chip(`違う ${s.marks}人`, "m-mismatch", s.by.join("、")) : null, s.marks ? h("span", { class: "dim by" }, s.by.join("、")) : null))),
    h("ul", { class: "scenes" }, c.scenes.map((sc, i) => h("li", null, h("span", { class: "sc-t" }, `${sc.label ?? `場面${i + 1}`}　${sc.text}`),
      h("span", { class: "sc-n" }, chip(`ありそう ${sc.y}`, sc.y ? "m-match" : "m-none"), chip(`なさそう ${sc.n}`, sc.n ? "m-mismatch" : "m-none"), sc.blank ? h("span", { class: "dim" }, ` 未回答${sc.blank}`) : null)))),
    c.axis.yes || c.axis.partly || c.axis.no || c.axis.blank ? h("div", { class: "axis" }, h("span", { class: "dim" }, "「喧嘩の中心か」"), chip(`${AXIS_LABEL.yes} ${c.axis.yes}`, c.axis.yes ? "m-match" : "m-none"), chip(`${AXIS_LABEL.partly} ${c.axis.partly}`, "m-none"), chip(`${AXIS_LABEL.no} ${c.axis.no}`, c.axis.no ? "m-mismatch" : "m-none")) : null,
    c.people.length ? h("div", { class: "pc-by dim" }, `評価した人：${c.people.join("、")}`) : null));
  const texts = h("div", { class: "free" }, h("h3", null, "自由記述"),
    cs.texts.length ? h("ul", { class: "quotes" }, cs.texts.map(t => h("li", null, h("div", { class: "q-h" }, h("b", null, t.code), chip(t.kind === "missing" ? "この結果に足りない、自分の特徴" : "ひとこと", "info")), h("blockquote", null, t.text)))) : h("p", { class: "empty" }, "自由記述はありません。"));
  return section("s5", "5", "カード評価",
    h("div", { class: "stats" }, stat("当てはまり度の平均", cs.ratingMean == null ? "—" : cs.ratingMean.toFixed(2), `${cs.ratingN}件の評価`, "info"), stat("評価されたパターン", cs.cards.length, null, "", "本")),
    cs.cards.length ? h("div", { class: "pcards" }, list) : h("p", { class: "empty" }, "カード評価がありません。"),
    cs.cards.length ? note(`「違う」の印の番号は ${cs.base === 0 ? "0" : "1"} 始まりとして文に対応させています（詳細説明を「。」で区切った順）。並びは当てはまり度の低い順。`) : null,
    texts);
}

// ---------------------------------------------------------------- 6 設問ごとの表
const ITEM_COLS = [
  { key: "id", label: "設問", cmp: (a, b) => compareItemIds(a.id, b.id) },
  { key: "text", label: "設問文", nosort: true },
  { key: "shown", label: "表示", num: true, get: x => x.shown },
  { key: "pickFirst", label: "A／左", num: true, get: x => x.pickFirst, title: "W：A行動を選んだ数／X：左に出た行動文を選んだ数" },
  { key: "pickSecond", label: "B／右", num: true, get: x => x.pickSecond, title: "W：B行動を選んだ数／X：右に出た行動文を選んだ数" },
  { key: "swappedAway", label: "差し替え", num: true, get: x => x.swappedAway, title: "別の設問に差し替えられた回数" },
  { key: "skips", label: "スキップ", num: true, get: x => x.skips },
  { key: "timeMean", label: "平均秒", num: true, get: x => x.timeMean },
  { key: "timeMax", label: "最大秒", num: true, get: x => x.timeMax },
  { key: "flagTotal", label: "一言", get: x => x.flagTotal },
  { key: "hardTotal", label: "振り返り", get: x => x.hardTotal },
  { key: "reasons", label: "見直し", get: x => x.reasons.length },
];
const REASON_SHORT = { flag: "一言", swap: "差し替え", hard: "迷い", oneside: "偏り", time: "時間" };

export function itemTextNode(x) {
  if (!x.known) return h("div", { class: "it-text" }, h("div", { class: "dim" }, x.stem));
  if (x.kind === "W") return h("div", { class: "it-text" }, h("div", { class: "it-stem" }, x.stem),
    h("div", { class: "it-side side-a" }, h("b", null, "A"), x.textFirst), h("div", { class: "it-side side-b" }, h("b", null, "B"), x.textSecond));
  return h("div", { class: "it-text" },
    h("div", { class: "it-side side-a" }, h("b", null, "左"), h("small", { class: "tr" }, x.first.trait), x.textFirst),
    h("div", { class: "it-side side-b" }, h("b", null, "右"), h("small", { class: "tr" }, x.second.trait), x.textSecond));
}

function counts(map, codes, short = FLAG_SHORT, labels = FLAG_LABEL) {
  const on = codes.filter(c => map[c]);
  return on.length ? h("span", { class: "cnts" }, on.map(c => chip(`${short[c]} ${map[c]}`, c === "ok" ? "m-none" : "warn", `${labels[c]}（${c}）`))) : dashNode();
}

function itemRow(x) {
  return h("tr", { id: `item-${x.key ?? x.id}`, class: x.reasons.length ? "flagged" : null, "data-qv": x.variant || null },
    h("th", { scope: "row", class: "sticky it-id" }, x.id, x.variant ? chip(x.variant, `ver ver-${x.variant}`, `設問の版 ${x.variant} の文`) : null, h("div", { class: "it-sub", title: x.domainName || null }, x.kind === "W" ? `領域${x.domain}` : `ラウンド${x.round}`), h("div", { class: "it-sub" }, x.srcLabel)),
    h("td", { class: "it-cell" }, itemTextNode(x)),
    h("td", { class: "num" }, x.shown), h("td", { class: "num", title: x.first.trait || "" }, x.pickFirst), h("td", { class: "num", title: x.second.trait || "" }, x.pickSecond),
    h("td", { class: "num" }, x.swappedAway || dashNode()), h("td", { class: "num" }, x.skips || dashNode()),
    h("td", { class: "num", title: x.timeN ? `n=${x.timeN}、中央値 ${x.timeMedian.toFixed(1)}秒` : "" }, x.timeMean == null ? dashNode() : x.timeMean.toFixed(1)),
    h("td", { class: "num" }, x.timeMax == null ? dashNode() : x.timeMax.toFixed(1)),
    h("td", null, counts(x.flags, FLAG_CODES)),
    h("td", null, counts(x.hard, HARD_CODES)),
    h("td", null, x.reasons.length ? h("span", { class: "cnts" }, x.reasons.map(r => chip(REASON_SHORT[r.code], "ng", r.text))) : dashNode()));
}

/** 設問表（絞り込み・並べ替えつき）。ui = {sort:{key,dir}, onlyReview, kind, unseen} は admin.js が持つ */
export function renderItems(model, ui, rerender) {
  const t = ui.unseen ? itemTable(model.used, { includeUnseen: true }) : model.items;
  let rows = t.items.filter(x => (ui.kind === "all" || x.kind === ui.kind) && (!ui.onlyReview || x.reasons.length));
  const col = ITEM_COLS.find(c => c.key === ui.sort.key) || ITEM_COLS[0];
  const dir = ui.sort.dir;
  rows = [...rows].sort((a, b) => {
    if (col.get) {
      const x = col.get(a), y = col.get(b);
      if ((x == null) !== (y == null)) return x == null ? 1 : -1;     // 値のない行は並べ替えの向きに関係なく最後
      if (x != null && x !== y) return (x - y) * dir;
    } else {
      const d = col.cmp(a, b);
      if (d) return d * dir;
    }
    return compareItemRows(a, b);
  });
  const head = h("tr", null, ITEM_COLS.map(c => c.nosort ? th(c.label) : h("th", { scope: "col", class: `${c.num ? "num" : ""} ${c.key === "id" ? "sticky" : ""}`.trim(), title: c.title || null, "aria-sort": ui.sort.key === c.key ? (ui.sort.dir > 0 ? "ascending" : "descending") : "none" },
    h("button", { type: "button", class: "th-sort", dataset: { key: c.key }, onclick: () => { ui.sort = { key: c.key, dir: ui.sort.key === c.key ? -ui.sort.dir : (c.key === "id" ? 1 : -1) }; rerender(c.key); } },
      c.label, h("span", { class: "arrow", "aria-hidden": "true" }, ui.sort.key === c.key ? (ui.sort.dir > 0 ? "▲" : "▼") : "↕")))));
  const total = t.items.length;
  return h("div", { class: "items-body" },
    h("div", { class: "stats" },
      stat("出題された設問", `${model.items.shownIds}`, `W ${model.items.items.filter(x => x.kind === "W" && x.shown).length}/${model.items.totalW}・X ${model.items.items.filter(x => x.kind === "X" && x.shown).length}/${model.items.totalX}`),
      stat("全体の回答時間の中央値", model.items.overallMedian == null ? "—" : `${model.items.overallMedian.toFixed(1)}秒`, "枠ごとの回答時間", "info"),
      stat("見直し候補の設問", model.items.items.filter(x => x.reasons.length).length, null, "warn", "件")),
    h("div", { class: "controls" },
      h("label", { class: "inline" }, h("input", { type: "checkbox", id: "items-only", checked: ui.onlyReview ? true : null, onchange: (e) => { ui.onlyReview = e.target.checked; rerender(null, "items-only"); } }), "見直し候補だけ"),
      h("label", { class: "inline" }, "種別", h("select", { id: "items-kind", onchange: (e) => { ui.kind = e.target.value; rerender(null, "items-kind"); } },
        [["all", "すべて"], ["W", "W（同じ場面の左右）"], ["X", "X（行動文どうしの比較）"]].map(([v, l]) => h("option", { value: v, selected: ui.kind === v ? true : null }, l)))),
      h("label", { class: "inline" }, h("input", { type: "checkbox", id: "items-unseen", checked: ui.unseen ? true : null, onchange: (e) => { ui.unseen = e.target.checked; rerender(null, "items-unseen"); } }), "出題されなかった設問も表示"),
      h("span", { class: "dim count" }, `${rows.length}/${total}行を表示`)),
    rows.length ? tableWrap("設問ごとの表", h("table", { class: "tbl items-tbl", id: "tbl-items" }, h("thead", null, head), h("tbody", null, rows.map(itemRow)))) : h("p", { class: "empty" }, "該当する設問がありません。"),
    note("表示：その設問が出た回数（差し替えられたものを含む）。A／左・B／右：選ばれた側の数（W は A行動・B行動、X は左右に出た行動文）。平均秒・最大秒は、その設問を最後に見て答えた（または答えずに進んだ）ときの回答時間です（差し替えた設問の時間は記録されません）。一言：カード下の「一言」ボタン、振り返り：振り返りで選んだ理由（迷っていないは ok）。列の見出しで並べ替えられます。"));
}

export function renderItemsSection(model, ui) {
  const holder = h("div", { id: "items-holder" });
  const rerender = (focusKey, focusId) => {
    holder.replaceChildren(renderItems(model, ui, rerender));
    if (focusKey) holder.querySelector(`.th-sort[data-key="${focusKey}"]`)?.focus();
    if (focusId) holder.querySelector(`#${focusId}`)?.focus();
  };
  holder.append(renderItems(model, ui, rerender));
  return section("s6", "6", "設問ごとの表", holder);
}

// ---------------------------------------------------------------- 7 見直し候補
export function renderReview(model) {
  const list = model.review;
  const byType = {};
  for (const r of list) (byType[r.type] ||= []).push(r);
  const kids = [];
  kids.push(h("p", { class: "msg info" }, REVIEW_NOTE));
  kids.push(h("div", { class: "stats" }, ["item", "domain", "pattern", "sentence"].map(k => stat(TYPE_LABEL[k], (byType[k] || []).length, null, (byType[k] || []).length ? "warn" : "", "件"))));
  if (!list.length) kids.push(h("p", { class: "empty" }, "該当するものはありません。"));
  for (const k of ["item", "domain", "pattern", "sentence"]) {
    if (!byType[k]) continue;
    kids.push(h("h3", null, `${TYPE_LABEL[k]}（${byType[k].length}件）`));
    kids.push(h("ul", { class: "review" }, byType[k].map(r => h("li", { class: "rv" },
      h("div", { class: "rv-h" }, h("b", null, r.type === "item" ? itemIdLabel(r.item) : r.title), r.type === "item" ? h("span", { class: "dim" }, r.item.kind === "W" ? `領域${r.item.domain} ${r.item.domainName}` : `${r.item.first.trait} vs ${r.item.second.trait}`) : null),
      r.type === "item" ? itemTextNode(r.item) : null,
      r.quote ? h("blockquote", null, r.quote) : null,
      h("ul", { class: "why" }, r.reasons.map(x => h("li", null, x)))))));
  }
  kids.push(h("details", { class: "thresholds" }, h("summary", null, "しきい値（js/admin/aggregate.js の REVIEW）"),
    h("table", { class: "tbl compact" }, h("tbody", null, Object.entries(REVIEW).map(([k, v]) => h("tr", null, h("th", { scope: "row" }, h("code", null, k)), h("td", { class: "num" }, String(v))))))));
  return section("s7", "7", "見直し候補（自動）", ...kids);
}

// ---------------------------------------------------------------- 8 再採点
const STATUS = { same: ["当時と同じ", "m-match"], diff: ["差分あり", "ng"], nores: ["当時の結果なし", "warn"], error: ["再採点できない", "ng"] };
const lowConfText = (o) => {
  const ds = Object.keys(o || {});
  return ds.length ? ds.map(d => `領域${d}（${(o[d].reasons || []).map(x => LOWCONF_LABEL[x]).join("・")}）`).join("、") : "なし";
};

/** rs = rescoreAll(…, {mode})。onMode(mode) で「当時の版のロジック」「v2 のロジック」を切り替える */
export function renderRescore(rs, { onMode = null } = {}) {
  const mode = rs.mode || "then";
  const rows = rs.rows.map(r => {
    const d = r.diff;
    const detail = [];
    if (d) {
      if (!d.chosen.same) detail.push(h("li", { class: "rs-chosen" }, h("b", null, "採用パターン"), "　当時 ", d.chosen.then.map(c => c.join("/")).join("　"), " → いま ", d.chosen.now.map(c => c.join("/")).join("　")));
      for (const s of d.states) detail.push(h("li", null, h("b", null, `領域${s.d} ${DOMAINS[s.d].name}`), `　当時 ${s.then ?? "なし"}（${s.thenLabel}） → いま ${s.now ?? "なし"}（${s.nowLabel}）`));
      for (const x of d.w) detail.push(h("li", null, h("b", null, `領域${x.d} W`), `　当時 ${x.then ? x.then.join(":") : "なし"} → いま ${x.now.join(":")}`));
      if (d.lv.length) detail.push(h("li", null, h("b", null, "level"), `　${d.lv.map(x => `${x.trait} ${x.then ?? "なし"}→${x.now}`).join("、")}`));
    }
    if (r.lowConf && !r.lowConf.same) detail.push(h("li", { class: "rs-lowconf" }, h("b", null, "確度低"), `　当時 ${r.qv === "v1" ? "（v1 には確度低の扱いなし）" : lowConfText(r.lowConf.then)} → いま ${lowConfText(r.lowConf.now)}`));
    else if (r.lowConf && Object.keys(r.lowConf.now).length) detail.push(h("li", { class: "rs-lowconf dim" }, `確度低：${lowConfText(r.lowConf.now)}（当時と同じ）`));
    for (const p of r.problems || []) detail.push(h("li", { class: "dim" }, p));
    const [label, cls] = STATUS[r.status];
    return h("tr", { "data-code": r.session.code, "data-qv": r.qv },
      h("th", { scope: "row" }, r.session.code, r.session.isRetest ? chip(`再検査${r.session.retestIndex}`, "info") : null, " ", chip(r.qv, `ver ver-${r.qv}`, `送信の版 ${r.qv}`)),
      h("td", null, r.session.tsLabel), h("td", null, chip(label, cls)),
      h("td", null, detail.length ? h("ul", { class: "diffs" }, detail) : (r.status === "same" ? h("span", { class: "dim" }, `採用 ${r.now.chosen.length}本、8領域の状態、16傾向のlevel、Wの a:b がすべて一致`) : dashNode())));
  });
  const choice = h("fieldset", { class: "rs-mode", id: "rescore-mode" },
    h("legend", null, "再採点に使うロジック"),
    Object.entries(RESCORE_MODES).map(([k, label]) => h("label", { class: "inline" },
      h("input", { type: "radio", name: "rescore-mode", value: k, id: `rescore-mode-${k}`, checked: mode === k ? true : null, onchange: (e) => { if (e.target.checked && onMode) onMode(k); } }),
      label)));
  return section("s8", "8", "再採点（いまのロジックとの比較）",
    choice,
    mode === "v2" ? h("p", { class: "msg info", id: "rescore-v2-note" }, "v2 のロジック（確度低の領域を含むパターン ×0.8、矛盾枠は W と X の向きがそろう領域だけ）で、当時答えた設問だけを採点し直しています。追加質問の出し方（v2 の計画：拮抗 → 向きが逆 → 優勢（弱）、上限 W8・X8）は再現できません（当時と違う設問を聞いていたはずなので、v2 で受けた場合の結果そのものではありません）。") : null,
    h("div", { class: "stats" }, stat("当時と同じ", rs.same, null, rs.same ? "ok" : "", "人"), stat("差分あり", rs.diff, null, rs.diff ? "ng" : "", "人"), rs.other ? stat("結果なし／再採点できない", rs.other, null, "warn", "人") : null),
    rs.rows.length ? tableWrap("再採点", h("table", { class: "tbl", id: "tbl-rescore" }, h("thead", null, h("tr", null, th("コード"), th("開始日時"), th("結果"), th("差分"))), h("tbody", null, rows))) : h("p", { class: "empty" }, "再採点できる回答がありません。"),
    note(`回答ログ（rec）から scoreRecords3 → select3 / domainStates3 を、いまのコードで計算し直して、当時の結果（res）と比べています。「当時の版のロジック」は送信の版（v1 の送信は v1、v2 の送信は v2。qv の無い送信は v1）のロジックで、閾値や設問を変えたあとの確認用です。level は ±${LV_TOLERANCE} までの違い（丸め方の差）は差分にしません。再検査も含め、読み込めた全セッションが対象です。`));
}

// ---------------------------------------------------------------- 9 出力
export function outputBlock({ id, title, desc, text, filename, bom, type, onCopy, onDownload, rows = 5 }) {
  return h("div", { class: "out", id: `out-${id}` },
    h("div", { class: "out-h" }, h("h3", null, title), h("span", { class: "dim" }, `${text.length.toLocaleString("ja-JP")}文字`)),
    desc ? h("p", { class: "note" }, desc) : null,
    h("div", { class: "row" },
      h("button", { type: "button", class: "btn primary", id: `copy-${id}`, onclick: () => onCopy(text, id) }, "コピー"),
      h("button", { type: "button", class: "btn", id: `dl-${id}`, onclick: () => onDownload(filename, text, { bom, type }) }, `ファイルに保存（${filename}）`),
      h("span", { class: "copied", id: `copied-${id}`, role: "status" })),
    h("textarea", { class: "preview", readonly: true, rows, "aria-label": `${title}のプレビュー`, spellcheck: "false" }, text));
}

export function renderOutput(blocks) {
  return section("s9", "9", "出力", note("CSV は UTF-8（BOM 付き）で保存するので Excel でそのまま開けます。コピーは BOM なしです。「Claude に貼る用」は、上の2〜7を表と箇条書きにまとめ、設問やパターンの文を引用してあります。"), ...blocks);
}

