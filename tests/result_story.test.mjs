import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeResult4 } from '../js/engine4.js';
import { resultCopy4 } from '../js/result_copy4.js';
import { resultCopy3 } from '../js/result_copy3.js';
import { resultStory, storyCandidates4 } from '../js/result_story.js';
import { SIDE_STORY, CROSS_STEP, SPECIAL_STORY } from '../js/data/result_story.js';
import { PATTERNS } from '../js/data/patterns.js';
import { fromScores } from '../js/adaptive3.js';
import { PROFILE_SAMPLES3 } from '../js/data/samples3.js';
import { showResultStory } from '../app/js/result_story.js';
function result(spec) {
 const a={};
 for(let d=1;d<=8;d++) [...(spec[d]||'???')].forEach((p,i)=>{
  if(p!=='-')a[`${['U','P','N'][i]}${d}`]=p==='?'?{status:'unknown',value:null}:{status:'answered',value:p==='A'?1:-1};
 });
 return computeResult4(a);
}
test('24問：主軸に場面・長所・短所、クロスと特殊に旧版の具体例と改善を追加',()=>{
 const r=result(Object.fromEntries(Array.from({length:8},(_,i)=>[i+1,'AAA']))), c=resultCopy4(r);
 const before=JSON.stringify({r,c}), m=resultStory(r,c);
 assert.equal(m.main.scenes.length,2);assert.ok(m.main.strength&&m.main.risk);
 assert.equal(m.cards.filter(x=>x.kind==='cross').length,2);
 assert.equal(m.cards.filter(x=>x.kind==='special').length,1);
 for(const x of m.cards)assert.ok(x.paragraphs.length&&x.scenes.length&&x.step);
 const sp=m.cards.find(x=>x.kind==='special');
 assert.ok(m.cards.filter(x=>x.kind==='cross').every(x=>!x.domains.every(d=>sp.domains.includes(d))),'特殊の部分集合を重ねない');
 const texts=[...m.intro,...m.main.scenes,m.main.strength,m.main.risk,...m.cards.flatMap(x=>[...x.paragraphs,...x.scenes,x.strength,x.step].filter(Boolean))];
 assert.equal(new Set(texts).size,texts.length);
 assert.equal(JSON.stringify({r,c}),before);
});
test('2軸の向きで別の具体例になり、主軸以外の未回答から推測しない',()=>{
 const a=result({1:'AAA',2:'AAA'}), b=result({1:'AAA',2:'BBB'});
 assert.deepEqual(storyCandidates4(a).map(h=>h.meta.id),['X12-1']);
 assert.deepEqual(storyCandidates4(b).map(h=>h.meta.id),['X12-2']);
 assert.notDeepEqual(resultStory(a,resultCopy4(a)).cards[0].scenes,resultStory(b,resultCopy4(b)).cards[0].scenes);
 assert.equal(resultStory(result({1:'AA?'}),resultCopy4(result({1:'AA?'}))).cards.length,0);
});
test('普段と場面の逆転は優勢に混ぜず、実際に選んだ場面を特殊で読む',()=>{
 const r=result({1:'ABB',2:'AAA',4:'AAA'}), m=resultStory(r,resultCopy4(r));
 assert.ok(storyCandidates4(r).every(h=>!h.meta.domains.includes(1)));
 const s=m.cards.find(x=>x.id==='context-1');
 assert.ok(s.actual);assert.equal(s.scenes.length,2);
 assert.match(s.paragraphs[0],/向き合う/);assert.match(s.paragraphs[0],/距離を取る/);
});
test('24問の高条件は3問一致のみ。両方高い・中水準・形状を作らない',()=>{
 assert.ok(storyCandidates4(result({3:'BBB',6:'AAA'})).some(h=>h.meta.id==='S07'));
 assert.ok(!storyCandidates4(result({3:'BBA',6:'AAA'})).some(h=>h.meta.id==='S07'));
 const r=result(Object.fromEntries(Array.from({length:8},(_,i)=>[i+1,'AAA'])));
 assert.ok(storyCandidates4(r).every(h=>!['specialC','shape'].includes(h.meta.cond.type)));
 assert.ok(!storyCandidates4(r).some(h=>['S09','S10','S13','S14','S15'].includes(h.meta.id)));
});
test('欠損・同数・ペアを無理にクロスや特殊で埋めない',()=>{
 for(const spec of [{},{1:'A--'},{1:'AB?',2:'AB?'}]){
  const r=result(spec),m=resultStory(r,resultCopy4(r));assert.equal(m.main,null);assert.equal(m.cards.length,0);
 }
 const r=result({7:'BBB',8:'BBB'}),m=resultStory(r,resultCopy4(r));
 assert.equal(m.main.domains.length,2);assert.equal(m.main.scenes.length,2);
 assert.ok(!m.cards.some(x=>x.id==='X78-4'));
});
test('80問：各サンプルの既存の成立条件と版を守り、回答・保存用の結果を変えない',()=>{
 for(const p of PROFILE_SAMPLES3){
  const r=fromScores(p.scores,{duel:p.duel,version:'v3'}).result(),before=JSON.stringify(r);
  const m=resultStory(r,resultCopy3(r)), valid=new Set(r.select.hits.map(h=>h.meta.id));
  assert.ok(m.cards.every(x=>valid.has(x.id)));
  assert.ok(m.cards.every(x=>!x.actual));
  if(r.select.chosen.some(h=>h.role==='主軸'&&h.meta.kind==='basic'))assert.ok(m.main);
  assert.equal(JSON.stringify(r),before);
 }
});
test('16傾向・全クロス・利用可能な特殊に追記原稿がある。旧表示は明示切替で残す',()=>{
 assert.equal(Object.keys(SIDE_STORY).length,16);
 for(const x of Object.values(SIDE_STORY))assert.ok(x.scenes.length===2&&x.strength&&x.risk);
 for(const p of PATTERNS.filter(p=>p.kind==='cross'))assert.ok(CROSS_STEP[p.domains.join('')],p.id);
 for(const p of PATTERNS.filter(p=>p.kind==='special'&&!['S16','S17'].includes(p.id)))assert.ok(SPECIAL_STORY[p.id],p.id);
 assert.ok(showResultStory(''));assert.ok(!showResultStory('?rd=axes'));assert.ok(!showResultStory('?rd=compact'));
});
