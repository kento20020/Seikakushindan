import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeResult4 } from '../js/engine4.js';
import { resultCopy4 } from '../js/result_copy4.js';
import { resultCopy3 } from '../js/result_copy3.js';
import { resultStory } from '../js/result_story.js';
import { deepenStory, answerNuance } from '../js/result_analysis.js';
import { INNER, CROSS_INNER, SPECIAL_INNER } from '../js/data/result_analysis.js';
import { PATTERNS } from '../js/data/patterns.js';
import { DOM_OF, DOMAINS } from '../js/engine.js';
import { ITEMS4 } from '../js/data/questions4.js';
import { fromScores } from '../js/adaptive3.js';
import { PROFILE_SAMPLES3 } from '../js/data/samples3.js';
function result(spec) {
 const a={};for(let d=1;d<=8;d++)[...(spec[d]||'???')].forEach((p,i)=>{
 if(p!=='-')a[`${['U','P','N'][i]}${d}`]=p==='?'?{status:'unknown',value:null}:{status:'answered',value:p==='A'?1:-1};});
 return computeResult4(a);
}
test('同じ優勢でも、反対側を選んだ場面を回答そのままで書き分ける',()=>{
 const a=result({1:'AAB'}),b=result({1:'ABA'});
 const x=resultStory(a,resultCopy4(a)),y=resultStory(b,resultCopy4(b));
 assert.equal(x.main.id,y.main.id);
 assert.notEqual(x.main.nuances[0].text,y.main.nuances[0].text);
 assert.deepEqual(x.main.nuances[0].questionIds,['P1','N1']);
 assert.deepEqual(y.main.nuances[0].questionIds,['N1','P1']);
 assert.ok(x.main.nuances[0].text.includes(ITEMS4.N1.b));
 assert.ok(y.main.nuances[0].text.includes(ITEMS4.P1.b));
 for(const spec of [{1:'AAA'},{1:'AA?'},{1:'A--'},{1:'ABB'}])assert.equal(answerNuance(result(spec),1),null);
});
test('80問の比較方向の違いを残し、24問の場面や実体験を作らない',()=>{
 const r={states:{1:{state:'2',a:4,b:1,n:5,LA:40,LB:80,check:true,mWA:20,mWB:-20}}};
 const m=resultStory(r,resultCopy3(r)),n=m.main.nuances[0];
 assert.deepEqual(n.questionIds,[]);assert.match(n.text,/向き合う/);assert.match(n.text,/距離を取る/);
 assert.match(n.text,/ほかの領域/);assert.ok(!n.text.includes('LINE'));
 const noLevels=structuredClone(r);delete noLevels.states[1].LA;
 assert.ok(!answerNuance(noLevels,1).text.includes('が強く出ています'));
});
test('全クロスで独自の内面・関係の循環を持ち、条件に沿った分析へ届く',()=>{
 const cross=PATTERNS.filter(p=>p.kind==='cross');
 assert.equal(cross.length,80);assert.equal(new Set(Object.values(CROSS_INNER)).size,80);
 for(const p of cross){
  const spec={};for(const t of p.cond.traits){const d=DOM_OF[t];spec[d]=DOMAINS[d].a===t?'AAA':'BBB';}
  const r=result(spec),m=resultStory(r,resultCopy4(r));
  const found=m.cards.find(c=>c.id===p.id);
  if(found)assert.deepEqual(found.analysis,[CROSS_INNER[p.id]]);
  else { assert.equal(p.id,'X78-4');assert.deepEqual(m.main.analysis,[CROSS_INNER[p.id]]); }
 }
 assert.equal(Object.keys(INNER).length,16);
 assert.equal(Object.keys(SPECIAL_INNER).length,18);
});
test('A/Bの全256組み合わせで分析が空にならず、原結果・本文・判定を変更しない',()=>{
 for(let mask=0;mask<256;mask++){
 const r=result(Object.fromEntries(Array.from({length:8},(_,i)=>[i+1,mask&(1<<i)?'BBB':'AAA']))),c=resultCopy4(r);
 const old=resultStory(r,c,{deep:false}),before=JSON.stringify({r,c,old});
 const m=deepenStory(r,old);
 assert.ok(m.main.analysis.length&&m.main.risk);
 assert.ok(m.cards.every(x=>x.analysis.length));
 assert.deepEqual(m.cards.map(x=>x.id),old.cards.map(x=>x.id));
 assert.equal(JSON.stringify({r,c,old}),before);
 const ds=[...m.main.nuances,...m.cards.flatMap(x=>x.nuances)].map(x=>x.domain);
 assert.equal(ds.length,new Set(ds).size);
 }
});
test('欠損は人物像で埋めず、普段と場面の逆転は理想と本音と断定しない',()=>{
 for(const spec of [{},{1:'A--'}]){const r=result(spec),m=resultStory(r,resultCopy4(r));assert.equal(m.main,null);assert.equal(m.cards.length,0);}
 const r=result({1:'ABB'}),m=resultStory(r,resultCopy4(r));
 assert.ok(m.cards[0].actual);assert.deepEqual(m.cards[0].analysis,[INNER['1B'][0]]);
 assert.ok(!m.cards[0].paragraphs.join('').includes('頭ではこうしたい'));
});
test('80問の両方強い・中間を同じ万能な長所にまとめない。表示の切り替えも非破壊',()=>{
 const models=['5','6','7'].map(state=>{
 const r={states:{1:{state,a:3,b:3}},select:{chosen:[{role:'主軸',meta:{id:`B1-${state}`,kind:'basic'}}],hits:[]}};
 return resultStory(r,resultCopy3(r));});
 assert.equal(new Set(models.map(x=>x.main.analysis[0])).size,3);
 assert.equal(models[1].main.strength,null);
 for(const p of PROFILE_SAMPLES3){const r=fromScores(p.scores,{duel:p.duel,version:'v3'}).result(),c=resultCopy3(r);
 const old=resultStory(r,c,{deep:false}),m=resultStory(r,c);
 assert.ok(!old.analysisVersion);assert.ok(m.analysisVersion);
 assert.deepEqual(old.cards.map(x=>x.id),m.cards.map(x=>x.id));
 }
});
