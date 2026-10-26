// U55：主軸・クロス・特殊を読む結果。表示専用。採点／保存には手を入れない。
import { DOMAINS, DOM_OF } from './engine.js';
import { PATTERNS, PATTERN_BY_ID } from './data/patterns.js';
import { copyStatesOf4, copySide4, firstSentence4 } from './result_copy4.js';
import { copyStatesOf3 } from './result_copy3.js';
import { scenesFor } from './three_version.js';
import { idsOfDomain4, ITEMS4 } from './data/questions4.js';
import { SIDE_STORY, CROSS_STEP, SPECIAL_STORY } from './data/result_story.js';

const ids = Object.keys(DOMAINS).map(Number);
const sideKey = t => `${DOM_OF[t]}${DOMAINS[DOM_OF[t]]?.a === t ? 'A' : 'B'}`;
const traitsOf = p => p.cond.traits || (p.cond.clauses || []).map(x => x.split(':')[1]);
const subset = (a, b) => a.every(d => b.includes(d));

/** 24問専用。割合を80問の強さスコアへ変換しない。中／両方高い／形状は測れない。 */
export function storyCandidates4(r) {
  const states = copyStatesOf4(r);
  const match = (t, high = false) => {
    const d = DOM_OF[t], st = states[d], side = copySide4(st);
    return side && DOMAINS[d][side === 'A' ? 'a' : 'b'] === t
      && (high ? ['1', '3'].includes(st) : ['1', '2', '3', '4'].includes(st));
  };
  return PATTERNS.filter(p => {
    const c = p.cond;
    if (c.type === 'cross') return c.traits.every(t => match(t));
    if (c.type === 'specialA') return c.clauses.every(x => x.startsWith('優勢:') && match(x.slice(3)));
    if (c.type === 'specialB') return c.clauses.every(x => x.startsWith('高:') && match(x.slice(2), true));
    return false;
  }).map(p => ({ meta: p, score: p.importance + p.domains.filter(d => ['1', '3'].includes(states[d])).length / 10 }));
}

function directionStory(r) {
  const d = ids.find(d => r.domains?.[d]?.differentDirections);
  if (!d) return null;
  const x = r.domains[d], D = DOMAINS[d], qids = idsOfDomain4(d);
  const name = k => D[x.picks[k] === 'A' ? 'a' : 'b'];
  return {
    id: `context-${d}`, kind: 'special', domains: [d], label: '特殊', context: `${D.name}・普段と場面の違い`,
    paragraphs: [`普段の自分には「${name('U')}」を選んだ一方、具体的な2つの場面では「${name('P')}」を選んでいました。頭ではこうしたいと思っていても、相手を前にすると別の動きが出る。あなたの中には、その両方があるのかもしれません。`],
    scenes: ['P', 'N'].map(k => {
      const q = ITEMS4[qids[k]];
      return `${q.scene} → 今回選んだのは「${x.picks[k] === 'A' ? q.a : q.b}」。`;
    }),
    strength: 'いつもの自分というイメージだけで答えず、その場の自分の動きまで見つめられています。場面によって変わることに気づけるのは、伝え方を選び直す手掛かりです。',
    risk: `ただ、自分では「${name('U')}つもり」でも、相手が受け取るのは実際の動き。「いつも言っていることと違う」と受け取られるすれ違いは起こりそうです。`,
    step: '話す前に「普段はこうしたいけど、今はこうなっている」と二つを分けて伝えてみて。自分にも相手にも、今できる話し方が見えやすくなります。',
    actual: true,
  };
}

/** main は原稿の主軸と一貫させ、追加は条件を満たす旧版パターンから選ぶ。 */
export function resultStory(r, copy) {
  const four = r?.diagnosisVersion === 'v4';
  const states = four ? copyStatesOf4(r) : copyStatesOf3(r);
  const d = copy.primaryDomain, side = copy.side;
  const mainDomains = copy.kind === 'pair' ? [7, 8] : d ? [d] : [];
  const mainKey = d && side ? `${d}${side}` : null;
  const mainData = SIDE_STORY[mainKey];
  const usedStrengths = new Set(mainKey ? [mainKey] : []);
  const seen = new Set(copy.paragraphs || []);
  const fresh = texts => (texts || []).filter(t => { if (!t || seen.has(t)) return false; seen.add(t); return true; });
  const neutralHit = !four && !mainData ? r?.select?.chosen?.find(h => h.role === '主軸' && h.meta?.kind === 'basic') : null;
  const base = PATTERN_BY_ID[neutralHit?.meta.id || `B${d}-${states[d]}`];
  const main = mainData ? {
    id: copy.copyId, domains: mainDomains,
    scenes: fresh(copy.kind === 'pair' ? scenesFor('X78-4', 'v3', PATTERN_BY_ID['X78-4'].text.scenes)
      : !four && base ? scenesFor(base.id, r.version || 'v3', base.text.scenes) : mainData.scenes),
    strength: mainData.strength, risk: copy.kind === 'pair' ? SIDE_STORY['8B'].risk : mainData.risk,
    partial: four && ['1w', '3w'].includes(states[d]),
  } : base ? {
    id: base.id, domains: base.domains, scenes: fresh(scenesFor(base.id, r.version || 'v3', base.text.scenes)),
    strength: '一つのやり方に自分を固定せず、相手やその日の状態に応じて別の動きを選べる余地があります。迷いがあることも、自分の希望を確かめる入口になります。',
    risk: '自分の中では状況に合わせていても、相手には前回との違いが読めないことがあります。「今はどうしたいか」を言わずにいると、相手任せのまま不満だけ残りがちです。',
  } : null;
  // 80問はその回答に対する既存の評価結果を使う（推定の24問へ変換しない）。
  const hits = four ? storyCandidates4(r) : (r?.select?.hits || r?.select?.chosen || []);
  const candidates = hits.map(h => ({ p: PATTERN_BY_ID[h.meta?.id], score: h.score || 0 }))
    .filter(x => x.p && ['cross', 'special'].includes(x.p.kind) && (x.p.cond.type !== 'shape' || SPECIAL_STORY[x.p.id]));
  const chosenIds = new Set((r?.select?.chosen || []).map(h => h.meta.id));
  const rank = (a, b) => Number(chosenIds.has(b.p.id)) - Number(chosenIds.has(a.p.id)) || b.score - a.score || a.p.id.localeCompare(b.p.id);
  const special = four ? directionStory(r) : null;
  const specialHit = !special ? candidates.filter(x => x.p.kind === 'special' && SPECIAL_STORY[x.p.id]).sort(rank)[0] : null;
  const covered = new Set([...mainDomains, ...(special?.domains || specialHit?.p.domains || [])]);
  const cross = [];
  let pool = candidates.filter(x => x.p.kind === 'cross'
    && !subset(x.p.domains, mainDomains)
    && !(specialHit && subset(x.p.domains, specialHit.p.domains)));
  while (cross.length < 2 && pool.length) {
    // 新しい領域が増える解釈を優先。同じ組の言い換えを積み上げない。
    pool.sort((a, b) => b.p.domains.filter(d => !covered.has(d)).length - a.p.domains.filter(d => !covered.has(d)).length || rank(a, b));
    const next = pool.shift();
    if (cross.length && next.p.domains.every(d => covered.has(d))) continue;
    cross.push(next.p); next.p.domains.forEach(d => covered.add(d));
  }
  const card = p => {
    const traits = traitsOf(p);
    const key = traits.map(sideKey).find(k => SIDE_STORY[k] && !usedStrengths.has(k));
    if (key) usedStrengths.add(key);
    const extra = SPECIAL_STORY[p.id];
    return {
      id: p.id, kind: p.kind, domains: p.domains, label: p.kind === 'cross' ? 'クロス' : '特殊',
      context: traits.length ? traits.join(' × ') : '複数の場面に共通する動き',
      paragraphs: fresh([p.text.detail]),
      scenes: fresh(scenesFor(p.id, four ? 'v3' : r.version || 'v3', p.text.scenes)),
      strength: extra?.[0] || (key ? SIDE_STORY[key].strength : null),
      step: extra?.[1] || CROSS_STEP[p.domains.join('')],
    };
  };
  const cards = cross.map(card);
  if (special) { special.paragraphs = fresh(special.paragraphs); special.scenes = fresh(special.scenes); cards.push(special); }
  else if (specialHit) cards.push(card(specialHit.p));
  // 成立しない分類を穴埋めしない。データ不足なら元の保留原稿を読める。
  return { main, cards, intro: copy.kind === 'primary' ? [firstSentence4(copy.paragraphs[0])] : copy.paragraphs, note: '場面例は、今回の回答から考えられる動き方です。自分に重なるところから読んでみてください。' };
}
