import test from 'node:test';
import assert from 'node:assert/strict';
import {energySankey} from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-sankey.js';

const sources = () => [{key:'solar',value:24.03},{key:'battery',value:9.55},{key:'grid',value:34.45}];
const consumers = () => [{key:'battery',value:39.11},{key:'home',value:28.79},{key:'dc',value:null},{key:'ac',value:null},{key:'grid',value:.14}];
const assertFiniteLinks = model => {
  assert.ok(model.links.length>0);
  for (const link of model.links) {
    assert.ok(link.source.key!==link.target.key);
    for (const key of ['value','yL','yR','hL','hR']) assert.ok(Number.isFinite(link[key]),key);
    assert.ok(link.value>0 && link.hL>0 && link.hR>0);
  }
};

test('unknown EV day counters no longer suppress a balanced recorded allocation', () => {
  const left=sources(),right=consumers(),before=structuredClone({left,right}),model=energySankey(left,right);
  assertFiniteLinks(model);
  assert.equal(model.complete,false);assert.equal(model.partial,true);assert.equal(model.balanced,true);
  assert.deepEqual(model.missingConsumers,['dc','ac']);assert.match(model.notice,/EV energy totals unavailable/);
  assert.deepEqual({left,right},before,'layout must not mutate supplied counters');
  for (const key of ['dc','ac']) {
    assert.equal(model.right.find(node=>node.key===key).value,null);
    assert.equal(model.links.filter(link=>link.target.key===key).length,0);
  }
  assert.ok(Math.abs(model.totalLeft-68.03)<.00001);
  assert.ok(Math.abs(model.totalRight-68.04)<.00001);
  for(const node of model.left){const allocated=model.links.filter(link=>link.source.key===node.key).reduce((sum,link)=>sum+link.value,0);assert.ok(Math.abs(allocated-node.value)<.001);}
});

test('known EV energy is included while another unavailable EV counter stays unknown', () => {
  const right=consumers();right.find(node=>node.key==='home').value-=2;right.find(node=>node.key==='ac').value=2;
  const model=energySankey(sources(),right);assertFiniteLinks(model);
  assert.equal(model.partial,true);assert.deepEqual(model.missingConsumers,['dc']);
  assert.ok(model.links.some(link=>link.target.key==='ac'));
});

test('a complete allocation retains both independent measured totals and all node floors', () => {
  const left=[{key:'solar',value:18.6},{key:'battery',value:10.4},{key:'grid',value:8}];
  const right=[{key:'battery',value:12.2},{key:'home',value:24.8},{key:'ac',value:0},{key:'grid',value:0}];
  const model=energySankey(left,right);assertFiniteLinks(model);
  assert.equal(model.complete,true);assert.equal(model.partial,false);assert.equal(model.notice,null);
  assert.equal(model.totalLeft,37);assert.equal(model.totalRight,37);
  assert.deepEqual(model.missingConsumers,[]);
  assert.ok(model.links.every(link=>!['ac','grid'].includes(link.target.key)));
  assert.equal(model.right.at(-1).y+model.right.at(-1).height,480);
});

test('a missing source or core consumer cannot be treated as an optional EV gap', () => {
  for (const key of ['solar','battery','grid']) {
    const left=sources();left.find(node=>node.key===key).value=null;
    assert.equal(energySankey(left,consumers()).links.length,0,key);
  }
  for (const key of ['home','battery','grid']) {
    const right=consumers();right.find(node=>node.key===key).value=null;
    const model=energySankey(sources(),right);assert.equal(model.links.length,0,key);assert.equal(model.partial,false);
  }
});

test('a large missing energy budget is not normalized into apparently complete flows', () => {
  const right=consumers();right.find(node=>node.key==='home').value=5;
  const model=energySankey(sources(),right);
  assert.equal(model.balanced,false);assert.equal(model.links.length,0);assert.equal(model.partial,false);assert.equal(model.notice,null);
});

test('invalid negative, nonfinite or string counters never count as unknown EV data', () => {
  for(const bad of [-1,NaN,Infinity,'0',false]) {
    const right=consumers();right.find(node=>node.key==='ac').value=bad;
    const model=energySankey(sources(),right);assert.equal(model.links.length,0,String(bad));
    assert.ok([...model.left,...model.right].every(node=>Number.isFinite(node.y)&&Number.isFinite(node.height)));
  }
});

test('zero budgets, empty inputs and impossible same-device paths do not create ribbons', () => {
  for(const [left,right] of [[[],[]],[[{key:'solar',value:0}],[{key:'home',value:0}]],[[{key:'battery',value:10}],[{key:'battery',value:10}]]]) {
    assert.equal(energySankey(left,right).links.length,0);
  }
});
