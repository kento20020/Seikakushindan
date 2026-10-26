// U57：既存の解釈に内面・循環・反例を足す。採点・保存は変更しない。
import { DOMAINS } from './engine.js';
import { ITEMS4, idsOfDomain4 } from './data/questions4.js';
import { copyStatesOf4, copySide4 } from './result_copy4.js';
import { copyStatesOf3 } from './result_copy3.js';
import { INNER, CROSS_INNER, SPECIAL_INNER, NEUTRAL } from './data/result_analysis.js';

/** 同じ優勢でも、場面の反例や比較方法の違いを消さない。数値がないときは作らない。 */
export function answerNuance(r, d) {
  const D = DOMAINS[d];
  if (!D) return null;
  if (r?.diagnosisVersion === 'v4') {
    const x = r.domains?.[d];
    if (!x || x.n !== 3 || x.differentDirections || x.a === 3 || x.b === 3) return null;
    const major = x.a > x.b ? 'A' : 'B', minor = major === 'A' ? 'B' : 'A';
    const k = ['P', 'N'].find(k => x.picks?.[k] === minor);
    if (!k) return null;
    const qids = idsOfDomain4(d), q = ITEMS4[qids[k]], other = ITEMS4[qids[k === 'P' ? 'N' : 'P']];
    const picked = (q, side) => side === 'A' ? q.a : q.b;
    return { domain: d, questionIds: [other.id, q.id], text:
      `ただし、いつも同じ動きではありません。「${other.scene}」では「${picked(other, major)}」を選んだ一方、「${q.scene}」では「${picked(q, minor)}」を選んでいます。「${D[major === 'A' ? 'a' : 'b']}」を基本にしながらも、この場面では切り替える余地がある。その違いを生む条件に、あなたの動き方を理解する手掛かりがありそうです。` };
  }
  const x = r?.states?.[d];
  if (!x) return null;
  if (x.check && Number.isFinite(x.LA) && Number.isFinite(x.LB) && x.LA !== x.LB) {
    const chosen = x.a > x.b ? D.a : x.b > x.a ? D.b : null;
    if (!chosen) return null;
    const other = x.LA > x.LB ? D.a : D.b;
    return { domain: d, questionIds: [], text:
      `この軸には、単純に片側へまとめにくい点もあります。同じ場面の二択では「${chosen}」を多く選びましたが、ほかの領域の行動と比べたときは「${other}」が強く出ています。「どちらをするか」と「ほかのことより何が出やすいか」は別の問い。この違いから、いつも${chosen}と決めつけず、もう一方が出る場面も残して読む必要があります。` };
  }
  if (['2', '4'].includes(x.state)) {
    const chosen = copySide4(x.state) === 'A' ? D.a : D.b;
    const other = chosen === D.a ? D.b : D.a;
    return { domain: d, questionIds: [], text:
      `今回の回答では「${chosen}」が優勢ですが、「${other}」も弱い状態ではありません。一方の行動を選べることと、もう一方の気持ちや動きが消えることは別です。動いたあとに迷いが戻るなら、最初の選択が嘘だったと決めず、何が満たされず残ったのかを見る余地があります。` };
  }
  return null;
}

/** 新しいオブジェクトだけを返し、元のモデルと回答を変更しない。 */
export function deepenStory(r, model) {
  const states = r?.diagnosisVersion === 'v4' ? copyStatesOf4(r) : copyStatesOf3(r);
  const usedNuance = new Set();
  const nuances = domains => domains.map(d => {
    if (usedNuance.has(d)) return null;
    const n = answerNuance(r, d);
    if (n) usedNuance.add(d);
    return n;
  }).filter(Boolean);
  let main = model.main && { ...model.main };
  if (main) {
    if (main.id === 'PAIR-7B-8B') {
      main.analysis = [CROSS_INNER['X78-4']];
      main.risk = INNER['8B'][1];
    } else {
      const d = main.domains[0], state = states[d], side = copySide4(state);
      const depth = side ? INNER[`${d}${side}`] : NEUTRAL[state] || NEUTRAL['7'];
      main.analysis = [depth[0]];
      main.risk = depth[1];
      if (!side) main.strength = state === '5'
        ? '反対に見える二つの必要に気づけるところがあります。どちらかを消さず、今優先するものを分けられれば、選択肢を増やせます。'
        : state === '6' ? null : '一つの方法に決めず、状況に応じて選ぶ余地があります。その柔軟さを、自分の希望も残す方向で使えそうです。';
    }
    main.nuances = nuances(main.domains);
  }
  const cards = model.cards.map(c => {
    let analysis = CROSS_INNER[c.id] || SPECIAL_INNER[c.id];
    if (c.actual) {
      const d = c.domains[0], side = r.domains[d].picks.P;
      analysis = INNER[`${d}${side}`]?.[0];
    }
    return { ...c, analysis: analysis ? [analysis] : [], nuances: c.actual ? [] : nuances(c.domains) };
  });
  return { ...model, main, cards, analysisVersion: 'result-depth-1', note:
    '今回の回答から、行動の背景やすれ違い方を読み解いています。内側の理由は一つに決めず、日常の自分に重なるところから読んでみてください。' };
}
