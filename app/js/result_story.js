import { h, badge } from './ui.js';
export { resultStory } from '../../js/result_story.js';

// U54 の表示は比較用に残す。通常は具体例・クロス・特殊を読む U55。
export function showResultStory(search = globalThis.location?.search || '') {
  return !['axes', 'compact'].includes(new URLSearchParams(search).get('rd'));
}
function scenes(items, actual = false) {
  return items?.length ? h('div', { class: 'a-story-scenes' },
    h('p', { class: 'a-story-caption' }, actual ? '今回の場面で選んだ動き' : 'たとえば、こんなときのあなた'),
    h('ul', null, items.map(s => h('li', null, s)))) : null;
}
function balance(item) {
  return h('div', { class: 'a-story-balance' },
    item.strength ? h('p', { class: 'a-story-strength' }, h('span', { class: 'a-story-caption' }, '活きている長所'), item.strength) : null,
    item.risk ? h('p', null, h('span', { class: 'a-story-caption' }, 'つまずきやすいところ'), item.risk) : null,
    item.step ? h('p', { class: 'a-story-step' }, h('span', { class: 'a-story-caption' }, '次に試してみるなら'), item.step) : null);
}
export function primaryStory(model) {
  const m = model.main;
  return h('div', { class: 'a-story-primary' },
    h('p', { class: 'a-note a-story-note' }, model.note),
    m ? [m.partial ? h('p', { class: 'a-note' }, 'この主軸は、答えられた2問を手掛かりにしています。') : null,
      scenes(m.scenes), balance(m)] : null);
}
export function storyCards(model) {
  return model.cards.length ? h('div', { class: 'a-story-cards' }, model.cards.map((c, i) =>
    h('section', { class: ['a-story-card', `a-story-${c.kind}`], 'data-pattern': c.id, 'aria-labelledby': `story-label-${i}` },
      h('h2', { class: 'a-story-label', id: `story-label-${i}` }, badge(c.label, { tone: c.kind === 'special' ? 'slate' : 'rose' }),
        h('span', null, c.kind === 'special' ? 'いくつかの傾向が重なったとき' : '二つの傾向が重なったとき')),
      h('p', { class: 'a-story-context' }, c.context),
      c.paragraphs.map(p => h('p', { class: 'a-story-body' }, p)),
      scenes(c.scenes, c.actual), balance(c)))) : null;
}
