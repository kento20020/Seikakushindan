// U62・U63：選択式プロフィールの画面試作。入力はこの画面のメモリ内だけ。保存・相談連携はしない。
import { h, icon, topBar, badge, helpFoot } from './ui.js';
import { STATUS, VALUE_GROUPS, VALUES, RELATIONS, DURATIONS } from './profile_options.js';

export function render(root) {
  const state = { status: '', age: '', values: [], relation: '', duration: '' };
  let activeGroup = 0;
  const stage = h('div', { class: 'a-profile-stage' });
  root.append(h('div', { class: 'a-profile' },
    topBar({ title: 'プロフィール', back: '#mypage', heading: true }),
    h('p', { class: 'a-profile-trial' }, badge('お試し', { tone: 'line' }), '入力内容は保存・相談への反映を行いません。'),
    stage, helpFoot()));

  const select = (name, options) => {
    const el = h('select', { class: 'a-input a-profile-select', id: `profile-${name}`, name,
      onchange: e => { state[name] = e.target.value; } },
    h('option', { value: '' }, '選んでください'), options.map(label => h('option', { value: label }, label)));
    el.value = state[name];
    return h('div', { class: 'a-profile-select-wrap' }, el, icon('chevron-down', { size: 18 }));
  };
  function choices(name, options, multiple = false, onChange = () => {}) {
    return h('div', { class: 'a-profile-choices' }, options.map(entry => {
      const [value, label] = Array.isArray(entry) ? entry : [entry, entry];
      const input = h('input', { type: multiple ? 'checkbox' : 'radio', name, value,
        onchange: e => {
          if (multiple) state[name] = e.target.checked ? [...state[name], value] : state[name].filter(v => v !== value);
          else state[name] = value;
          onChange();
        } });
      input.checked = multiple ? state[name].includes(value) : state[name] === value;
      return h('label', { class: 'a-profile-choice' }, input,
        h('span', { class: 'a-profile-choice-face' }, h('span', null, label), icon('check', { size: 14 })));
    }));
  }
  const legend = (number, title) => h('legend', null, h('span', { class: 'a-profile-number', 'aria-hidden': 'true' }, number), title);

  function valuePicker() {
    const grid = h('div', { id: 'profile-value-options', role: 'group' });
    const count = h('span', { 'aria-live': 'polite', 'aria-atomic': 'true' });
    const selectedList = h('div', { class: 'a-profile-selected-list' });
    const summary = h('summary', null, '選択した項目', count, icon('chevron-down', { size: 16 }));
    const buttons = VALUE_GROUPS.map((group, i) => h('button', {
      type: 'button', class: 'a-profile-category', 'aria-controls': 'profile-value-options',
      onclick: () => { activeGroup = i; showGroup(); updateSelection(); },
    }, h('span', null, group.name), h('span', { class: 'a-profile-category-count', 'aria-hidden': 'true' })));
    function showGroup() {
      grid.setAttribute('aria-label', VALUE_GROUPS[activeGroup].name);
      grid.replaceChildren(choices('values', VALUE_GROUPS[activeGroup].items, true, updateSelection));
    }
    function updateSelection() {
      count.textContent = `（${state.values.length}）`;
      buttons.forEach((button, i) => {
        const n = VALUE_GROUPS[i].items.filter(value => state.values.includes(value)).length;
        button.setAttribute('aria-pressed', String(i === activeGroup));
        button.setAttribute('aria-label', `${VALUE_GROUPS[i].name}、10項目${n ? `、${n}項目選択中` : ''}`);
        button.lastChild.textContent = n ? String(n) : '';
      });
      selectedList.replaceChildren(...VALUES.filter(value => state.values.includes(value)).map(value =>
        h('button', { type: 'button', class: 'a-profile-selected-chip', 'aria-label': `${value}の選択を解除`, onclick: () => {
          state.values = state.values.filter(v => v !== value);
          showGroup(); updateSelection(); summary.focus();
        } }, value, icon('close', { size: 12 }))),
        ...(state.values.length ? [] : [h('p', { class: 'a-note' }, 'まだ選択していません。')]));
    }
    showGroup(); updateSelection();
    return h('div', { class: 'a-profile-values' },
      h('p', { class: 'a-note a-profile-hint' }, `${VALUES.length}項目から複数選択`),
      h('div', { class: 'a-profile-categories', role: 'group', 'aria-label': '価値観の分野' }, buttons),
      grid,
      h('details', { class: 'a-profile-selected' }, summary, selectedList));
  }

  function edit(focus = false) {
    const form = h('form', { class: 'a-profile-form', onsubmit: e => { e.preventDefault(); preview(); } },
      h('div', { class: 'a-profile-panel' },
        h('fieldset', null, legend('01', 'ステータス'), choices('status', STATUS)),
        h('fieldset', null, legend('02', h('label', { for: 'profile-age' }, '年齢')),
          select('age', ['15歳以下', ...Array.from({ length: 84 }, (_, i) => `${i + 16}歳`), '100歳以上', '回答を控える'])),
        h('fieldset', null, legend('03', '恋愛で大切にしたいこと'), valuePicker())),
      h('div', { class: 'a-profile-panel' },
        h('fieldset', null, legend('04', '相手との関係性'), choices('relation', RELATIONS)),
        h('fieldset', null, legend('05', h('label', { for: 'profile-duration' }, '相手との交際期間')),
          select('duration', DURATIONS))),
      h('button', { type: 'submit', class: 'a-btn a-btn-block a-profile-next' }, '選んだ内容を確認', icon('arrow-right')));
    stage.replaceChildren(form);
    if (focus) { form.querySelector('input').focus({ preventScroll: true }); stage.scrollIntoView({ block: 'start' }); }
  }
  function preview() {
    const relation = RELATIONS.find(([value]) => value === state.relation)?.[1];
    const rows = [
      ['ステータス', state.status], ['年齢', state.age],
      ['恋愛で大切にしたいこと', VALUES.filter(value => state.values.includes(value)).join('、')],
      ['相手との関係性', relation], ['相手との交際期間', state.duration],
    ];
    const heading = h('h2', { class: 'a-profile-preview-title', tabindex: '-1' }, 'あなたのプロフィール');
    stage.replaceChildren(h('section', { class: 'a-profile-panel a-profile-preview' }, heading,
      h('dl', null, rows.map(([label, value]) => h('div', null, h('dt', null, label), h('dd', null, value || '未選択'))))),
      h('button', { type: 'button', class: 'a-btn a-btn-outline a-btn-block', onclick: () => edit(true) }, icon('pencil'), '選び直す'),
      h('a', { class: 'a-link a-link-tap a-profile-exit', href: '#mypage' }, 'マイページへ戻る'));
    heading.focus({ preventScroll: true });
    stage.scrollIntoView({ block: 'start' });
  }
  edit();
}
