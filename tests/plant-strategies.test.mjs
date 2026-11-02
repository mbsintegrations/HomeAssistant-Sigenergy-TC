import test from 'node:test';
import assert from 'node:assert/strict';
import {renderStrategyAction,strategyActions,newStrategyButton,strategyBlocks} from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-strategies.js';
import {nativeFields,presetTarget,renderPreset} from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-presets.js';

const item={personalizationRuleId:17,personalizationRuleName:'Night charge',ruleCondition:'02:00–05:00',ruleEffect:'Force charge'};
const state={writable:true,value:{rules:[item]}};
const ctx={id:'17',config:{config_entry:'own'},controlPermission:true};

test('native strategies expose actual plant actions independently of HA scheduling',()=>{
  assert.match(strategyActions(item,true),/Change strategy.*Rename.*Delete/s);
  assert.doesNotMatch(strategyActions(item,true),/ disabled/);
  assert.match(newStrategyButton(false),/ disabled/);
  for(const route of ['plant_strategy_editor','plant_strategy_rename','plant_strategy_delete'])assert.equal(presetTarget(route,ctx).section,'strategies');
  const list=renderPreset('strategies',{...ctx,plantConfiguration:{section:'strategies',route:'strategies',...state}},{body:'TC scheduling disabled'});
  assert.match(list.body,/New strategy/);assert.match(list.body,/TC scheduling disabled/);
});

test('rename and delete use the bound native rule and require a distinct review step',()=>{
  const rename=renderStrategyAction('plant_strategy_rename',ctx,state,nativeFields);
  assert.match(rename.body,/maxlength="60"/);assert.match(rename.body,/value="Night charge"/);
  assert.match(rename.body,/Review change/);assert.doesNotMatch(rename.body,/data-native-strategy-apply/);
  const remove=renderStrategyAction('plant_strategy_delete',ctx,state,nativeFields);
  assert.match(remove.body,/02:00–05:00/);assert.match(remove.body,/Review deletion/);
});

test('new and change use the native assistant without creating a local draft',()=>{
  const create=renderStrategyAction('plant_strategy_editor',{...ctx,id:'new'},state,nativeFields);
  assert.match(create.body,/data-native-strategy-form="create"/);assert.match(create.body,/Describe the strategy/);
  const edit=renderStrategyAction('plant_strategy_editor',ctx,state,nativeFields);
  assert.match(edit.body,/data-native-strategy-form="edit"/);assert.match(edit.body,/02:00–05:00/);
  assert.doesNotMatch(edit.body,/Save draft|data-settings-form/);
});

test('native confirmation shows the exact requested change, cancellation and irreversible deletion',()=>{
  const context={...ctx,strategyOperation:{entry:'own',route:'plant_strategy_delete',id:'17',stage:'preview',preview:{action:'delete',preview:'opaque'}}};
  const result=renderStrategyAction('plant_strategy_delete',context,state,nativeFields);
  assert.match(result.body,/cannot be undone/);assert.match(result.body,/data-native-strategy-cancel/);assert.match(result.body,/data-native-strategy-apply/);
  assert.match(result.body,/Night charge/);
});

test('foreign-plant previews cannot render on another entry and unavailable writes remain disabled',()=>{
  const context={...ctx,strategyOperation:{entry:'different',route:'plant_strategy_delete',id:'17',stage:'preview',preview:{}}};
  assert.doesNotMatch(renderStrategyAction('plant_strategy_delete',context,state,nativeFields).body,/data-native-strategy-apply/);
  assert.match(renderStrategyAction('plant_strategy_rename',{...ctx,controlPermission:false},state,nativeFields).body,/ disabled/);
});

test('native assistant responses remain escaped data and only server-listed buttons are rendered',()=>{
  const blocks=[{type:'content',message:'<img src=x onerror=bad()>'},{type:'proposal_card',cards:[{ruleCondition:'Night',ruleEffect:'Charge'}]}];
  const html=strategyBlocks(blocks,nativeFields);
  assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/Night/);
  const context={...ctx,strategyOperation:{entry:'own',route:'plant_strategy_editor',id:'17',conversation:'opaque',response:{phase:'response',blocks,buttons:[{index:0,text:'Apply proposal'}]}}};
  assert.match(renderStrategyAction('plant_strategy_editor',context,state,nativeFields).body,/data-native-strategy-choice="0"/);
});
