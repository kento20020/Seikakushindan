// 書いた文（日本語の自由記述）→ 判定の入力の一部を、決まった規則で読む（案D の読み取り。決定 U14・U17）。説明：docs/consult-reading.md
// 端末の中だけで動く（どこにも送らない）。同じ文なら必ず同じ結果。DOM なし（node でテスト可能）。
// 値は docs/consult-scoring.md §1 と同じ。読めない項目は入れない（undefined）。
// 安全の言葉は texts.js の SELF_HARM_RE・PARTNER_THREAT_RE をそのまま使う（ここでは新しく作らない）。
//
// 言葉を足すときは、下の「言葉の表」の配列に1行足す。正規表現は先読み（(?=…)・(?!…)）まで。
// 後読み（(?<=…)・(?<!…)）は古いスマホのブラウザで読み込みごと失敗するので使わない（前の文字を見たいときは findAll の before を使う）。
import { SELF_HARM_RE, PARTNER_THREAT_RE } from "./texts.js";

// ---------------------------------------------------------------- 言葉の表
/** 本人を指す言葉 */
const SELF_P = "(?:私|わたし|あたし|自分|僕|ぼく|俺)";
/** 恋人を指す言葉（「彼女」は除く） */
const PARTNER_P = "(?:彼氏|彼(?!女)|カレシ|カレ|相手|向こう)";
/** 恋人でも本人でもない人（「友達に…って言われた」を恋人の言葉と取り違えないため） */
const OTHER_P = "(?:友達|友だち|友人|親|母|父|お母さん|お父さん|姉|兄|妹|弟|先輩|後輩|同僚)";
/** 漢字＋「って」のあとにこれが続いたら、引用ではなく動詞の「て形」（帰ってから・謝ってきた・会ってた） */
const TE_FORM_NEXT = /^(?:から|も|て|た|る|い|な|く|き|来|ま|ほし|欲し|ば|お|あ|し|や|もら|くれ)/;
/** 句の切れ目（ここをまたいで引用や主語を探さない） */
const CUT = "、。！？!?\\n「」";
/** 打ち消し：当たった言葉のすぐ後ろにこれが来たら、当たらなかったことにする（「別れたいわけじゃない」） */
const NEG_AFTER = /^(?:わけ|訳)(?:じゃ|では|でも)|^とは(?:思|言)|^って(?:わけ|訳)(?:じゃ|では)|^(?:ん|の)じゃなく|^のではなく|^わけない|^こと(?:は)?ない/;
/** 恋人が主語（「彼が怒ってる」「彼が言いすぎた」を本人のことと取り違えないため。当たった言葉の前の数文字に使う） */
const PARTNER_SUBJECT_BEFORE = new RegExp(PARTNER_P + "(?:が|は|も|の(?:ほう|方)が)[^" + CUT + "]{0,6}$");
/** 否定の形（「返ってきてない」を「返ってきた」と読まない） */
const NOT_NEG = "(?!い?ない|なかっ|ません|ねー|ず)";

/** 恋人から来た・言われたと分かる、引用のあとの動詞（「…」って来た／言われた） */
const PARTNER_VERB = "(?:言われ|来た|きた|来て|きて|届い|送って(?:き|来)|送られ|返って(?:き|来)|返され|(?:LINE|ライン|メッセージ|メール|連絡|返事|返信|電話)(?:が|も)?(?:来|き|届))" + NOT_NEG;
/** 本人が送った・言ったと分かる、引用のあとの動詞（「…」って送った） */
const SELF_VERB = "(?:送(?:った|っちゃ|ってしまっ|っておい|信し|って(?!き|来|くれ|もら|ほし|欲し))|返(?:した|しちゃ|信し)|言(?:った|っちゃ|ってしまっ|ってやっ)|伝えた|伝えちゃ|LINEした|ラインした|打った|書いた|メッセージ(?:を)?送)";

/** 相手の最後のメッセージの種類（partnerLast）。引用の中身や「彼から…来た」の部分に、上から順に当てる */
const PARTNER_KINDS = [
  ["breakup", /別れ(?:よう|たい|る|て|話|ましょう)|終わりにしよう|もう無理|おしまいにしよう/],
  ["space", /距離(?:を)?(?:置|お)(?:き|こ|い)|(?:一人|ひとり)に(?:なりたい|して)|しばらく(?:連絡|会わ|話さ)|少し離れ|時間(?:を|が)?(?:置|ほしい|欲しい|ちょうだい)|冷却期間/],
  ["apology", /ごめん|すまん|すみません|悪かった|申し訳|謝/],
  ["talk_proposal", /話(?:そう|し合おう|し合いたい|がしたい)|会って話|ちゃんと話したい|電話(?:しよう|できる|していい)/],
  ["attack", /もういい|うざ|ウザ|最悪|いい加減|勝手に|知らない|しつこ|めんどくさ|面倒くさ|ふざけ|最低|嫌い|うるさ|意味(?:わから|分から|不明)|ありえない|は\?|なんで|何で|責め|キレ|文句/],
  ["explain", /言い訳|説明|長文|言い返|反論|だって|でも|そういう(?:つもり|意味)/],
  ["casual", /ご(?:は|飯)ん|ご飯|おはよう|おやすみ|お疲れ|おつかれ|明日|何してる|普通に|いつも通り|いつもどおり|何事もなかった|スタンプ/],
];
/** 自分の最後のメッセージの種類（selfLast）。本人の引用の中身に、上から順に当てる */
const SELF_KINDS = [
  ["hold", /落ち着いたら|後で(?:話|連絡)|あとで(?:話|連絡)|また(?:話そう|連絡する|明日)|明日(?:話|連絡)|時間(?:を|が)?(?:ちょうだい|ほしい|欲しい|置こう|おこう)|考えさせて|冷静になったら|頭(?:を)?冷やす|一旦|いったん/],
  ["apology", /ごめん|すみません|すまん|悪かった|申し訳|謝/],
  ["attack", /もういい|うざ|ウザ|最悪|いい加減|勝手に|知らない|しつこ|ふざけ|最低|嫌い|うるさ|意味(?:わから|分から)|ありえない|は\?|なんで|何で|責め|キレ/],
  ["reconcile", /仲直り|おはよう|大好き|好きだよ|会いたい|またね|楽しみ|ありがとう/],
  ["explain", /だって|でも|説明|言い訳|理由|そういう(?:つもり|意味)/],
];
/** 引用のない、本人のふるまい（selfLast）。「謝ったけど」「言い返しちゃった」 */
const SELF_ACTS = [
  ["apology", /謝(?:った|っちゃった|りの(?:LINE|ライン|連絡))/],
  ["attack", /言い返し(?:た|ちゃ)|責め(?:た|ちゃ)|キレ(?:た|ちゃ)|怒鳴(?:った|っちゃ)|(?:きつく|キツく|ひどいこと(?:を)?)言っ(?:た|ちゃ)/],
];

/** 本人が送ったと分かる言い方（引用なし）。lastSender = self の手がかり */
const SELF_SENT = [
  /送った(?:けど|のに|ら|が|んだけど|あと|きり|っきり)/,
  new RegExp(SELF_P + "(?:から|が|は|も)[^" + CUT + "]{0,12}?(?:送った|LINEした|ラインした|連絡した|謝った|電話した|メッセージした)"),
  /謝った(?:けど|のに|ら|が|んだけど)/,
];
/** 返事を待っている言い方（「既読無視」「返事が来ない」）。lastSender = self、ongoing = false の手がかり */
const WAITING = [
  /既読(?:スルー|無視|のまま|ついた(?:まま|けど|のに)|ついて(?:る|いる)のに|だけ|つかない)/,
  /未読(?:スルー|無視|のまま)/,
  /返(?:事|信)(?:が|は|も)?(?:来|こ|き)(?:ない|てない|ていない)/,
  /返(?:事|信)(?:が|は|も)?(?:ない|なし)/,
  /返って(?:こない|きてない|来てない|こなく|ない)/,
  /無視(?:され|して(?:く|る))/,
  /ブロック(?:され)/,
  /音沙汰(?:が)?ない/,
  /連絡(?:が|も)?(?:来|こ)(?:ない|なく)/,
  /反応(?:が)?ない/,
];
/** 恋人から来たと分かる言い方（引用なし）。lastSender = partner の手がかり。当たった部分は種類（PARTNER_KINDS）を当てる範囲にもなる */
const PARTNER_SENT = [
  new RegExp(PARTNER_P + "(?:から|が|より)[^" + CUT + "]{0,24}?(?:来た|きた|来て|きて|届い|送って(?:き|来)|送られ)" + NOT_NEG),
  new RegExp(PARTNER_P + "(?:から|より)(?:の)?(?:LINE|ライン|連絡|メッセージ|返事|返信|電話)(?:が|は|も)?(?:あっ|来|き|届)" + NOT_NEG),
  /謝られ|謝って(?:き|来)(?!い?ない|なかっ)/,
  new RegExp("[^" + CUT + "]{0,12}?送って(?:き|来)(?:た|て)(?!い?ない|なかっ)"),
  new RegExp(PARTNER_P + "(?:が|は|も|から)[^" + CUT + "]{0,8}?謝(?:った|って(?:き|来)|罪)"),
  /別れ(?:話|よう)(?:を|と|って)?(?:され|言われ|切り出され)/,
];
/** まだ返していない言い方。lastSender = partner の手がかり（返したくない・返せてないは ongoing = false も） */
const UNREPLIED = [
  [/返(?:したくない|せてない|せていない|してない|していない|事(?:を)?(?:してない|できてない|したくない))/, true],
  [/まだ返して(?:い)?ない/, true],
  [/(?:なんて|何て|どう)返せば|返信(?:に)?(?:迷|困)|返事(?:に)?(?:迷|困)|返し方/, false],
];
/** どちらも送っていない言い方。lastSender = none の手がかり */
const NONE_SENT = [
  /(?:お互い|どっちも|どちらも)(?:連絡|LINE|ライン)(?:を)?(?:して|取って|とって)(?:い)?ない/,
  /(?:お互い|どっちも|どちらも)(?:送って|連絡して)(?:い)?ない/,
];
/** いま言い合いの最中（ongoing = true） */
const ONGOING = [
  /(?:今|いま)(?!朝|日|回|度|まで|さら|後|頃)(?:も|まさに|ちょうど)?[^。！？!?\n]{0,6}?(?:言い合|口論)/,
  /言い合い(?:の)?(?:最中|中)/,
  /言い合って(?:る|いる)/,
  /(?:喧嘩|けんか|ケンカ|口論)の最中/,
  /まさに(?:喧嘩|けんか|ケンカ|言い合)/,
  /ヒートアップ/,
  /(?:LINE|ライン|電話)で(?:ずっと|まだ)?(?:言い合って|喧嘩して|けんかして|ケンカして)(?:る|いる)/,
];
/** やりとりが止まっている・時間がたっている言い方（ongoing = false）。WAITING・返したくない・3時間以上の経過もこれに数える */
const STOPPED = [
  /冷戦/,
  /帰って(?:から|きてから)|帰った(?:あと|後)/,
  /別れ際/,
  /そのまま(?:帰|寝)/,
  /それ(?:から|きり|っきり)(?:連絡|話して|何も)/,
  /黙(?:って|り込)/,
  /口(?:を)?きいて(?:い)?ない/,
  /寝(?:ちゃった|てしまった|た)(?:けど|から|あと)/,
  /(?:週末|今度|次に?|明日|来週|あさって)(?:に)?会う/,   // これから会う＝いまは言い合っていない
];
/** したいこと（intent）。引用を消した地の文に当てる */
const INTENT = [
  ["apologize", /謝(?:りたい|ろう(?:と|か)|ろうかな|った(?:ほう|方)がいい|るべき|れば(?:いい|いいか)|罪したい)|どこまで謝|どう謝|ごめん(?:って|と)(?:言|伝|送)りたい/],
  ["tell", /話(?:し合いたい|がしたい|をしたい|したい)|伝えたい|切り出(?:したい|し方|すには|そう)|言いたいことがある|話したいことがある|分かってもらいたい/],
  ["request_space", /(?:一人|ひとり)に(?:なりたい|してほしい)|少し離れたい|距離(?:を)?(?:置|お)きたい|しばらく(?:会いたくない|連絡(?:を)?(?:取り|と|し)たくない)|時間(?:を)?置きたい/],
];
/** 「話したい」の前にあったら当たらなかったことにする（「電話したい」） */
const INTENT_BEFORE = { tell: /電$/ };
/** 今回のゴール（goal） */
const GOAL = [
  ["reconcile", /仲直り(?:したい|しよう|できる)|元(?:通り|どおり)に|前みたいに|(?:関係|普通)に?戻(?:りたい|したい)|仲良く(?:したい|なりたい)/],
  ["understood", /(?:分|わ)かって(?:ほしい|欲しい|もらいたい)|理解して(?:ほしい|欲しい)|気持ちを(?:知|分か|わか)って/],
  ["settle", /決着(?:を)?(?:つけ|させ)|はっきりさせ|白黒|(?:ケリ|けり)を?つけ|(?:ちゃんと|根本的に|しっかり)解決|話を終わらせ/],
];
/** 原因の自己評価（cause）。self と partner が両方当たったら both */
const CAUSE = [
  ["both", /お互い(?:さま|様|に?悪|言い(?:すぎ|過ぎ))|(?:どっち|どちら|両方)(?:も|とも)悪/],
  ["self", new RegExp(SELF_P + "(?:が|の(?:ほう|方)が)(?:悪(?:い|かった)|言い(?:すぎ|過ぎ)|キツ|きつ|ひど|酷)|言い(?:すぎ|過ぎ)(?:た|ちゃった|てしまった)|" + SELF_P + "のせい|" + SELF_P + "が原因|やらかし")],
  ["partner", new RegExp(PARTNER_P + "(?:が|の(?:ほう|方)が)(?:悪(?:い|かった)|言い(?:すぎ|過ぎ)|約束を?破|嘘|浮気|遅刻|ドタキャン)|" + PARTNER_P + "のせい|" + PARTNER_P + "が原因|浮気され|嘘(?:を)?つかれ|約束(?:を)?破られ|ドタキャンされ")],
];
/** 同じ喧嘩のくり返し（repeat） */
const REPEAT = [
  [true, /毎回|毎月|毎週|いつも同じ|また同じ|同じ(?:こと|理由|話|内容)で|何回も|何度も|くり返|繰り返|前にも(?:同じ|あった)|何回目|いつもこう|またこの/],
  [false, /初めて(?:の)?(?:大きい|大きな|ちゃんとした|本気の)?(?:喧嘩|けんか|ケンカ)/],
];
/** もう仲直りした（afterMakeup）。「仲直りしたい」は当てない */
const AFTER_MAKEUP = [
  [true, /仲直り(?:は|も)?(?:した|できた)(?!い)|一応仲直り/],
  [false, /仲直り(?:は|も)?(?:して(?:い)?ない|できて(?:い)?ない)|まだ仲直り/],
];
/** 本人の温度（selfTemp）。いちばん後ろに書かれたものを使う */
const TEMP = [
  ["high", /腹(?:が)?立|ムカ(?:つ|ムカ|ッ)|むか(?:つ|っ)|イライラ|いらいら|イラッ|いらっ|怒って(?:る|いる|ます)|怒りが|キレ(?:そう|てる|ている)|許せない|悔しい|くやしい|頭に(?:き|来)て|ブチギレ|納得(?:でき|いか)ない/],
  ["cooling", /落ち着いてきた|少し落ち着いた|だいぶ落ち着いた|ちょっと落ち着いた|冷めてきた/],
  ["calm", /落ち着いて(?:る|いる|います)|冷静(?:に)?(?:なれた|になった|です|だよ|でいる|だ|(?=[。！？!?\n]|$))|もう怒って(?:ない|いない)|怒ってはいない/],
];

// ---------------------------------------------------------------- 時間の言葉（elapsed）
/** 区切り：3時間以内／半日以内／1〜2日／3日以上（js/ui/consult_state.js の GROUPS.elapsed と同じ） */
export function elapsedOfHours(h) {
  if (!(h >= 0)) return undefined;
  return h <= 3 ? "lt3h" : h <= 12 ? "3h_12h" : h < 72 ? "12h_2d" : "ge3d";
}
const KANJI_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** "2" "2.5" "二" "十二" "二十" → 数。数・何はおおよそ（unit で変える） */
function numOf(s, unit) {
  if (s === "数") return unit === "h" ? 4 : 3;
  if (s === "何") return unit === "h" ? 5 : 4;
  if (/^\d/.test(s)) return Number(s);
  if (s.includes("十")) { const [a, b] = s.split("十"); return (a ? KANJI_NUM[a] ?? 1 : 1) * 10 + (b ? KANJI_NUM[b] ?? 0 : 0); }
  return KANJI_NUM[s] ?? NaN;
}
const N = "(\\d+(?:\\.\\d+)?|[一二三四五六七八九十]{1,3}|数|何)";
/**
 * 時間の言葉の表。[正規表現, 時間（h）を返す関数, 種類]。種類 point は「いつ」（さっき・昨日・3日前）でそのまま使う。
 * duration は「どれくらい」（2時間・3日）で、前後に止まっている言葉（STATE_NEAR）があるときだけ使う（「3時間電話で喧嘩した」の3時間は使わない）
 */
const TIMES = [
  [/ついさっき|今さっき|さっき|先ほど|さきほど|ちょっと前|少し前|今しがた/, () => 0.5, "point"],
  [/一昨日|おととい/, () => 40, "point"],
  [/昨日|昨夜|昨晩|ゆうべ|夕べ|きのう/, () => 18, "point"],
  [/今朝/, () => 6, "point"],
  [/先週|先月/, () => 24 * 7, "point"],
  [new RegExp("(\\d+)分(?:前|くらい|ほど|も|たつ|経)"), (m) => Number(m[1]) / 60, "point"],
  [new RegExp(N + "時間(半)?前"), (m) => numOf(m[1], "h") + (m[2] ? 0.5 : 0), "point"],
  [new RegExp(N + "日前"), (m) => 24 * numOf(m[1], "d"), "point"],
  [new RegExp(N + "(?:週間|週)前"), (m) => 24 * 7 * numOf(m[1], "d"), "point"],
  [new RegExp(N + "日目"), (m) => 24 * numOf(m[1], "d"), "point"],
  [new RegExp(N + "時間(半)?"), (m) => numOf(m[1], "h") + (m[2] ? 0.5 : 0), "duration"],
  [/半日/, () => 12, "duration"],
  [/一晩|ひと晩/, () => 14, "duration"],
  [/(?:丸)?一日中?|丸1日/, () => 24, "duration"],
  [new RegExp(N + "日(?:間)?"), (m) => 24 * numOf(m[1], "d"), "duration"],
  [new RegExp(N + "週間"), (m) => 24 * 7 * numOf(m[1], "d"), "duration"],
  [new RegExp(N + "(?:ヶ|か|カ|ヵ)月"), (m) => 24 * 30 * numOf(m[1], "d"), "duration"],
];
/** duration を使ってよい、前後の言葉（止まっている・たっている） */
const STATE_AFTER = /冷戦|返(?:事|信)?(?:が|は)?(?:来|こ)ない|返って(?:こ|き|来)|既読|未読|無視|連絡(?:が|を|も)?(?:取って|とって|して|来て)?(?:ない|いない|なし)|経(?:つ|った|過)|たっ|たつ|過ぎ|すぎ|ずっと|放置|音沙汰|そのまま|まま|口(?:を)?きいて|話して(?:い)?ない|会って(?:い)?ない|返して(?:い)?ない|返せて(?:い)?ない/;
const STATE_BEFORE = /冷戦|無視|既読|未読|スルー|返(?:事|信)(?:が)?(?:ない|来ない)|連絡(?:が)?(?:ない|来ない)/;
/** 付き合っている長さは経過時間ではない */
const RELATION_BEFORE = /付き合って(?:から)?[^。]{0,3}$|交際[^。]{0,3}$/;

// ---------------------------------------------------------------- 道具
const sentenceBounds = (t, i) => {
  let s = i, e = i;
  while (s > 0 && !/[。！？!?\n]/.test(t[s - 1])) s--;
  while (e < t.length && !/[。！？!?\n]/.test(t[e])) e++;
  return [s, e];
};
const short = (s, max = 20) => { const a = [...s.trim()]; return a.length > max ? a.slice(0, max - 1).join("") + "…" : a.join(""); };

/**
 * re に当たる箇所をすべて（打ち消し・前の文字の条件で外したものを除く）。[{ index, end, text, m }]
 * @param {{ neg?: boolean, before?: RegExp }} [opt] neg：打ち消しを外す（既定 true）、before：当たった言葉の前8文字がこれに当たれば外す
 */
function findAll(t, re, { neg = true, before = null } = {}) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const out = [];
  for (const m of t.matchAll(g)) {
    if (!m[0]) continue;
    const end = m.index + m[0].length;
    if (neg && NEG_AFTER.test(t.slice(end, end + 8))) continue;
    if (before && before.test(t.slice(Math.max(0, m.index - 8), m.index))) continue;
    out.push({ index: m.index, end, text: m[0], m });
  }
  return out;
}
const first = (t, re, opt) => findAll(t, re, opt)[0] || null;

/** 表（[値, 正規表現] の配列）を上から当てて、最初に当たった値。{ value, hit } か null */
function kindOf(text, table) {
  for (const [value, re] of table) { const hit = first(text, re); if (hit) return { value, hit }; }
  return null;
}

/** 根拠の言葉：同じ側の重なる手がかり（「既読」「無視され」）をつないだ範囲。発言はそのまま */
function unionText(narr, events, ev) {
  if (ev.from == null) return ev.text;
  let a = ev.from, b = ev.at, grew = true;
  while (grew) {
    grew = false;
    for (const e of events) {
      if (e.side !== ev.side || e.from == null || e.at <= a || e.from >= b) continue;
      if (e.from < a || e.at > b) { a = Math.min(a, e.from); b = Math.max(b, e.at); grew = true; }
    }
  }
  return narr.slice(a, b);
}

/** 全角の数字・記号を半角に（NFKC）。『』“” は「」にそろえる */
export function normalizeText(text) {
  return String(text ?? "").normalize("NFKC").replace(/[『“]/g, "「").replace(/[』”]/g, "」");
}

// ---------------------------------------------------------------- 発言（引用）
// 発言を見つける正規表現（引用のあとの動詞・前の主語）
const PARTNER_AFTER = new RegExp("^(?:って|と|て)?[^" + CUT + "]{0,6}?" + PARTNER_VERB);
const SELF_AFTER = new RegExp("^(?:って|と|て)?[^" + CUT + "]{0,6}?" + SELF_VERB);
const SELF_BEFORE = new RegExp(SELF_P + "(?:が|から|は|も)[^" + CUT + "]{0,6}$");
const PARTNER_BEFORE = new RegExp(PARTNER_P + "(?:が|から|は|も|より)[^" + CUT + "]{0,6}$");
const TO_PARTNER_BEFORE = new RegExp(PARTNER_P + "に[^" + CUT + "]{0,6}$");
const OTHER_BEFORE = new RegExp(OTHER_P + "(?:が|から|に|は)[^" + CUT + "]{0,10}$");
const OTHER_IN = new RegExp(OTHER_P + "(?:が|から|に|は)");
const PARTNER_VERB_HEAD = new RegExp("^" + PARTNER_VERB);
const SUBJECT_HEAD = new RegExp("^.*(?:" + PARTNER_P + "|" + SELF_P + "|" + OTHER_P + ")(?:から|が|に|は|も|より)");
const BARE_QUOTE = new RegExp("([^" + CUT + "]{1,30}?)(って|と(?=言われ))(?=([^" + CUT + "]{0,6}?)(" + PARTNER_VERB + "|" + SELF_VERB + "))", "g");

/**
 * 文の中の発言。「」の引用と、「ごめんって来た」のような「」なしの引用。
 * [{ start, end（中身の範囲）, content, who: "self"|"partner"|"other"|null, at（動詞の終わりの位置）, tail（引用のあとの「って来た」など）, quoted }]
 */
function findSpeech(t) {
  const out = [];
  // 「」の引用：後ろの動詞 → 前の主語 の順で、誰の言葉かを決める
  for (const m of t.matchAll(/「([^「」]{1,80})」/g)) {
    const start = m.index + 1, end = start + m[1].length;
    const afterEnd = (() => { const j = t.slice(end + 1).search(/[「。！？!?\n]/); return j < 0 ? t.length : end + 1 + j; })();
    const after = t.slice(end + 1, Math.min(afterEnd, end + 1 + 14));
    const before = t.slice(Math.max(0, m.index - 12), m.index);
    let who = null, verb = "";
    const pa = after.match(PARTNER_AFTER), sa = after.match(SELF_AFTER);
    if (pa && (!sa || pa[0].length <= sa[0].length)) { who = "partner"; verb = pa[0]; }
    else if (sa) { who = "self"; verb = sa[0]; }
    else if (OTHER_BEFORE.test(before)) who = "other";
    else if (SELF_BEFORE.test(before) || TO_PARTNER_BEFORE.test(before)) who = "self";
    else if (PARTNER_BEFORE.test(before)) who = "partner";
    if (who === "partner" && /言われ/.test(verb) && OTHER_BEFORE.test(before)) who = "other";   // 「友達に「…」って言われた」
    out.push({ start, end, content: m[1], who, at: end + 1 + verb.length, tail: verb, quoted: true });
  }
  // 「」なしの引用：「…って来た／言われた／送った」。前の切れ目から「って」までを中身にして、主語の言葉は外す
  const quotedRanges = out.map(q => [q.start - 1, q.end + 1]);
  for (const m of t.matchAll(BARE_QUOTE)) {
    if (quotedRanges.some(([s, e]) => m.index < e && s < m.index + m[0].length)) continue;   // 「」の中の「って」は数えない
    // 動詞の「て形」（帰ってから・謝ってきた・返ってきた）は引用ではない
    if (/[\u4E00-\u9FFF々]$/.test(m[1]) && TE_FORM_NEXT.test(t.slice(m.index + m[1].length + m[2].length))) continue;
    let content = m[1], start = m.index;
    const strip = content.match(SUBJECT_HEAD);
    const clause = content;
    if (strip) { start += strip[0].length; content = content.slice(strip[0].length); }
    if (!content) continue;
    const verb = m[4];
    let who = PARTNER_VERB_HEAD.test(verb) ? "partner" : "self";
    if (OTHER_IN.test(clause)) who = "other";
    const at = m.index + m[0].length + m[3].length + verb.length;
    out.push({ start, end: start + content.length, content, who, at, tail: m[2] + m[3] + verb, quoted: false });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 発言の中身を消した地の文（位置は同じ）。本人の希望（謝りたい・距離を置きたい）を、相手の言葉から読まないため */
function maskSpeech(t, speech) {
  // 位置は UTF-16 の単位のまま（中身を同じ長さの「＿」に置き換える）
  let out = "", pos = 0;
  for (const s of speech) {
    if (s.start < pos) continue;
    out += t.slice(pos, s.start) + "＿".repeat(s.end - s.start);
    pos = s.end;
  }
  return out + t.slice(pos);
}

// ---------------------------------------------------------------- 読み取り
/**
 * 書いた文 → 判定の入力の一部。
 * @param {string} text
 * @returns {{ fields: object, evidence: { [key: string]: string }, safety: { selfHarm: boolean, partnerThreat: boolean } }}
 *   fields：lastSender・elapsed・partnerLast・ongoing・selfTemp・intent・goal・cause・repeat・afterMakeup・selfLast のうち読めたものだけ
 *   evidence：項目ごとの根拠になった言葉（短く。確認の画面で見せる）
 */
export function extractRules(text) {
  const raw = String(text ?? "");
  const safety = { selfHarm: SELF_HARM_RE.test(raw), partnerThreat: PARTNER_THREAT_RE.test(raw) };
  const t = normalizeText(raw);
  const fields = {}, evidence = {};
  const set = (k, v, ev) => { if (fields[k] === undefined && v !== undefined) { fields[k] = v; evidence[k] = short(ev); } };
  if (!t.trim()) return { fields, evidence, safety };

  const speech = findSpeech(t);
  const narr = maskSpeech(t, speech);

  // ---- 出来事（誰が最後に送ったか）。位置がいちばん後ろのものを最後のやりとりとみなす
  const events = [];   // { side: "self"|"partner"|"none", at, text, kind?, kindText? }
  for (const s of speech) {
    if (s.who !== "self" && s.who !== "partner") continue;
    const k = kindOf(s.content, s.who === "partner" ? PARTNER_KINDS : SELF_KINDS);
    events.push({ side: s.who, at: s.at, text: (s.quoted ? `「${s.content}」` : s.content) + s.tail, kind: k?.value, kindText: k?.hit.text, speech: true });
  }
  const masked = (h) => h.text.includes("＿");   // 発言と重なる地の文は、発言のほうで数える
  for (const re of SELF_SENT) for (const h of findAll(narr, re, { before: PARTNER_SUBJECT_BEFORE })) if (!masked(h)) events.push({ side: "self", from: h.index, at: h.end, text: h.text });
  for (const re of WAITING) for (const h of findAll(narr, re)) events.push({ side: "self", from: h.index, at: h.end, text: h.text, waiting: true });
  for (const re of PARTNER_SENT) for (const h of findAll(narr, re)) {
    if (masked(h)) continue;
    const k = kindOf(h.text.replace(new RegExp("^" + PARTNER_P + "(?:から|が|より|は|も)"), ""), PARTNER_KINDS);
    events.push({ side: "partner", from: h.index, at: h.end, text: h.text, kind: k?.value, kindText: k?.hit.text });
  }
  for (const [re, stopped] of UNREPLIED) for (const h of findAll(narr, re)) events.push({ side: "partner", from: h.index, at: h.end, text: h.text, unreplied: true, stopped });
  for (const re of NONE_SENT) for (const h of findAll(narr, re)) events.push({ side: "none", from: h.index, at: h.end, text: h.text });
  events.sort((a, b) => a.at - b.at);
  const lastEvent = events[events.length - 1];
  if (lastEvent) set("lastSender", lastEvent.side, unionText(narr, events, lastEvent));

  // ---- 相手の最後のメッセージの種類：相手からのいちばん後ろの発言・知らせ（種類が分かるもの）
  const partnerMsgs = events.filter(e => e.side === "partner" && !e.unreplied);
  const lastPartnerMsg = partnerMsgs[partnerMsgs.length - 1];
  if (lastPartnerMsg?.kind) set("partnerLast", lastPartnerMsg.kind, lastPartnerMsg.kindText);
  // ---- 自分の最後のメッセージの種類：本人のいちばん後ろの発言、なければ地の文のふるまい（謝った・言い返した）
  const selfSpeech = events.filter(e => e.side === "self" && e.speech);
  const selfActs = [];
  for (const [kind, re] of SELF_ACTS) for (const h of findAll(narr, re, { before: PARTNER_SUBJECT_BEFORE })) selfActs.push({ at: h.end, kind, text: h.text });
  const selfCands = [...selfSpeech.filter(e => e.kind).map(e => ({ at: e.at, kind: e.kind, text: e.kindText })), ...selfActs].sort((a, b) => a.at - b.at);
  const lastSelf = selfCands[selfCands.length - 1];
  if (lastSelf) set("selfLast", lastSelf.kind, lastSelf.text);

  // ---- 経過時間：最後のやりとりにいちばん近い時間の言葉
  const times = [];
  for (const [re, hoursOf, kind] of TIMES) {
    for (const h of findAll(narr, re, { neg: false })) {
      if (times.some(x => h.index < x.end && x.index < h.end)) continue;   // 先に当たった（長い）言葉と重なるものは使わない
      const beforeText = narr.slice(Math.max(0, h.index - 8), h.index);
      if (RELATION_BEFORE.test(beforeText)) continue;
      if (kind === "duration") {
        const [, sEnd] = sentenceBounds(t, h.index);
        const after = narr.slice(h.end, Math.min(sEnd, h.end + 12));
        if (!STATE_AFTER.test(after) && !STATE_BEFORE.test(beforeText)) continue;
      }
      const hours = hoursOf(h.m);
      if (Number.isFinite(hours)) times.push({ index: h.index, end: h.end, hours, text: h.text });
    }
  }
  if (times.length) {
    let pick;
    // 目印：最後のやりとり（「なんて返せば」のような迷いの言葉は目印にしない）
    const anchor = events.filter(e => !(e.unreplied && !e.stopped)).at(-1);
    if (anchor) {
      const [s, e] = sentenceBounds(t, Math.max(0, Math.min(t.length - 1, anchor.at - 1)));
      const same = times.filter(x => x.index >= s && x.index < e);
      const pool = same.length ? same : times;
      const dist = (x) => Math.abs(x.index - anchor.at);
      pick = pool.reduce((a, b) => (dist(b) < dist(a) || (dist(b) === dist(a) && b.index > a.index) ? b : a));
    } else pick = times.reduce((a, b) => (b.index > a.index ? b : a));
    set("elapsed", elapsedOfHours(pick.hours), pick.text);
  }

  // ---- 言い合いの最中か：最中の言葉が、止まっている言葉より後ろにあれば true
  const onHits = ONGOING.flatMap(re => findAll(narr, re));
  const stopHits = [
    ...STOPPED.flatMap(re => findAll(narr, re)),
    ...events.filter(e => e.waiting || e.stopped).map(e => ({ index: e.at, end: e.at, text: e.text })),
  ];
  const lastOn = onHits.sort((a, b) => a.index - b.index).at(-1);
  const lastStop = stopHits.sort((a, b) => a.index - b.index).at(-1);
  if (lastOn && (!lastStop || lastOn.index > lastStop.index)) set("ongoing", true, lastOn.text);
  else if (lastStop) set("ongoing", false, lastStop.text);
  else if (fields.elapsed && fields.elapsed !== "lt3h") set("ongoing", false, evidence.elapsed);

  // ---- 地の文から：したいこと・ゴール・原因・くり返し・仲直り・温度
  for (const [value, re] of INTENT) {
    const h = first(narr, re, { before: INTENT_BEFORE[value] ?? null });
    if (h) { set("intent", value, h.text); break; }
  }
  for (const [value, re] of GOAL) { const h = first(narr, re); if (h) { set("goal", value, h.text); break; } }
  const causeHit = {};
  for (const [value, re] of CAUSE) { const h = first(narr, re, { before: value === "self" ? PARTNER_SUBJECT_BEFORE : null }); if (h) causeHit[value] = h; }
  if (causeHit.both) set("cause", "both", causeHit.both.text);
  else if (causeHit.self && causeHit.partner) set("cause", "both", `${causeHit.self.text}／${causeHit.partner.text}`);
  else if (causeHit.self) set("cause", "self", causeHit.self.text);
  else if (causeHit.partner) set("cause", "partner", causeHit.partner.text);
  for (const [value, re] of REPEAT) { const h = first(narr, re); if (h) { set("repeat", value, h.text); break; } }
  for (const [value, re] of AFTER_MAKEUP) { const h = first(narr, re); if (h) { set("afterMakeup", value, h.text); break; } }
  if (fields.afterMakeup === true && fields.ongoing === undefined) set("ongoing", false, evidence.afterMakeup);
  const temps = TEMP.flatMap(([value, re]) => findAll(narr, re, { before: value === "high" ? PARTNER_SUBJECT_BEFORE : null }).map(h => ({ ...h, value })));
  const lastTemp = temps.sort((a, b) => a.index - b.index).at(-1);
  if (lastTemp) set("selfTemp", lastTemp.value, lastTemp.text);

  return { fields, evidence, safety };
}
