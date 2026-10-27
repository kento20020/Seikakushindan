import { h, badge } from './ui.js';
import { resultStory as buildStory } from '../../js/result_story.js';
export function isDeepStory(search = globalThis.location?.search || '') {
  return new URLSearchParams(search).get('rd') !== 'stories';
}
export function resultStory(r, copy) { return buildStory(r, copy, { deep: isDeepStory() }); }

// U54 の表示は比較用に残す。通常は具体例・クロス・特殊を読む U55。
export function showResultStory(search = globalThis.location?.search || '') {
  return !['axes', 'compact'].includes(new URLSearchParams(search).get('rd'));
}
function scenes(items, actual = false) {
  return items?.length ? h('div', { class: 'a-story-scenes' },
    h('p', { class: 'a-story-caption' }, actual ? '今回の場面で選んだ動き' : 'たとえば、こんなときのあなた'),
    h('ul', { class: 'a-story-scene-list' }, items.map(s => h('li', { class: 'a-story-scene' }, s)))) : null;
}
function analysis(item) {
  if (!item.analysis?.length) return null;
  return h('div', { class: 'a-story-analysis' },
    item.analysis.map(p => h('p', null, p)));
}
function nuances(item) {
  return item.nuances?.length ? h('div', { class: 'a-story-nuance' },
    item.nuances.map(n => h('p', { 'data-nuance-domain': n.domain }, n.text))) : null;
}
function balance(item) {
  return h('div', { class: 'a-story-balance' },
    item.strength ? h('p', { class: 'a-story-strength' }, item.strength) : null,
    item.risk ? h('p', null, item.risk) : null,
    item.step ? h('p', { class: 'a-story-step' }, item.step) : null);
}
export function primaryStory(model) {
  const m = model.main;
  return h('div', { class: 'a-story-primary' },
    m ? [m.partial ? h('p', { class: 'a-note' }, 'この主軸は、答えられた2問を手掛かりにしています。') : null,
      analysis(m), scenes(m.scenes), nuances(m), balance(m)] : null);
}
export function storyCards(model) {
  return model.cards.length ? h('div', { class: 'a-story-cards' }, model.cards.map((c, i) =>
    h('section', { class: ['a-story-card', `a-story-${c.kind}`], 'data-pattern': c.id, 'aria-labelledby': `story-label-${i}` },
      h('h2', { class: 'a-story-label', id: `story-label-${i}` }, badge(c.label, { tone: c.kind === 'special' ? 'slate' : 'rose' }),
        h('span', { class: 'a-story-context' }, c.context)),
      c.paragraphs.map(p => h('p', { class: 'a-story-body' }, p)),
      scenes(c.scenes, c.actual), analysis(c), nuances(c), balance(c)))) : null;
}
