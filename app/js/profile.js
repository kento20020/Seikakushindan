// U62：選択式プロフィールの画面試作。入力はこの画面のメモリ内だけ。保存・相談連携はしない。
import { h, icon, topBar, badge, helpFoot } from './ui.js';

const WORK = ['会社員', '公務員', '自営業・フリーランス', '学生', '学生・働いている', 'パート・アルバイト', '専業主婦・主夫', '休職中・求職中', 'その他', '回答しない'];
const VALUES = ['安心できること', '誠実さ・信頼', '気持ちを言葉にする', '一緒に過ごす時間', 'お互いの自由', '価値観の近さ', '支え合えること', 'ときめき', '将来への考え方', '対等でいられること'];
const RELATIONS = [
  ['dating', '交際中'], ['engaged', '婚約中'], ['married', '結婚している'],
  ['crush', '片思い'], ['before', '交際前・関係を確かめたい'], ['ex', '別れた相手'],
  ['none', '今は相手がいない'], ['other', 'その他'], ['private', '回答しない'],
];
const DURATIONS = ['3か月未満', '3か月〜6か月未満', '6か月〜1年未満', '1年〜2年未満', '2年〜3年未満', '3年〜5年未満', '5年〜10年未満', '10年以上', '回答しない'];
const hasDuration = value => ['dating', 'engaged', 'married', 'ex', 'other'].includes(value);

export function render(root) {
  const state = { work: '', age: '', values: [], relation: '', duration: '' };
  const stage = h('div', { class: 'a-profile-stage' });
  root.append(h('div', { class: 'a-profile' },
    topBar({ title: 'プロフィール', back: '#mypage', heading: true }),
    h('header', { class: 'a-profile-intro' },
      h('span', { class: 'a-profile-mark', 'aria-hidden': 'true' }, icon('person', { size: 28 })),
      h('p', { class: 'a-profile-lead' }, 'あなたのこと、ふたりのこと。'),
      h('p', { class: 'a-note' }, '近いものを選んで、プロフィールを作れます。', h('br'), '答えられる項目だけで大丈夫です。')),
    h('p', { class: 'a-profile-trial' }, badge('お試し', { tone: 'line' }), '入力内容は保存されません。相談への反映もまだ行いません。'),
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
        h('span', { class: 'a-profile-choice-face' }, h('span', null, label), icon('check', { size: 16 })));
    }));
  }
  const legend = (number, title) => h('legend', null, h('span', { class: 'a-profile-number', 'aria-hidden': 'true' }, number), title);

  function edit(focus = false) {
    const duration = select('duration', DURATIONS);
    const durationSelect = duration.querySelector('select');
    const durationLabel = h('label', { for: 'profile-duration' }, '相手との交際期間');
    const durationNote = h('p', { class: 'a-note', id: 'profile-duration-note' });
    durationSelect.setAttribute('aria-describedby', 'profile-duration-note');
    const updateDuration = () => {
      const enabled = hasDuration(state.relation);
      durationSelect.disabled = !enabled;
      if (!enabled) { state.duration = ''; durationSelect.value = ''; }
      durationLabel.textContent = state.relation === 'ex' ? '交際していた期間' : '相手との交際期間';
      durationNote.textContent = !enabled ? '交際していた、または交際中の相手がいる場合に選べます。'
        : state.relation === 'married' ? '結婚前を含め、交際を始めてからの期間を選んでください。'
          : 'おおよその期間で大丈夫です。';
    };
    updateDuration();
    const form = h('form', { class: 'a-profile-form', onsubmit: e => { e.preventDefault(); preview(); } },
      h('div', { class: 'a-profile-panel' },
        h('fieldset', null, legend('01', '職業・就学状況'), choices('work', WORK)),
        h('fieldset', null, legend('02', h('label', { for: 'profile-age' }, '年齢')),
          select('age', ['15歳以下', ...Array.from({ length: 84 }, (_, i) => `${i + 16}歳`), '100歳以上', '回答しない'])),
        h('fieldset', null, legend('03', '恋愛で大切にしたいこと'),
          h('p', { class: 'a-note a-profile-hint' }, '当てはまるものを、いくつでも。'), choices('values', VALUES, true))),
      h('div', { class: 'a-profile-panel' },
        h('fieldset', null, legend('04', '相手との関係性'), choices('relation', RELATIONS, false, updateDuration)),
        h('fieldset', null, legend('05', durationLabel), duration, durationNote)),
      h('button', { type: 'submit', class: 'a-btn a-btn-block a-profile-next' }, '選んだ内容を確認', icon('arrow-right')));
    stage.replaceChildren(form);
    if (focus) { form.querySelector('input').focus({ preventScroll: true }); stage.scrollIntoView({ block: 'start' }); }
  }
  function preview() {
    const relation = RELATIONS.find(([value]) => value === state.relation)?.[1];
    const rows = [
      ['職業・就学状況', state.work], ['年齢', state.age],
      ['恋愛で大切にしたいこと', VALUES.filter(value => state.values.includes(value)).join('、')],
      ['相手との関係性', relation],
      [state.relation === 'ex' ? '交際していた期間' : '相手との交際期間', hasDuration(state.relation) ? state.duration : !state.relation || state.relation === 'private' ? '' : '該当なし'],
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
