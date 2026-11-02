/* SPDX-License-Identifier: GPL-3.0-only */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const STRATEGY_ROUTES=new Set(['plant_strategy_editor','plant_strategy_rename','plant_strategy_delete']);
const note=value=>`<p class="settings-note">${esc(value)}</p>`;
const button=(label,route,id,disabled=false)=>`<button type="button" class="settings-secondary" data-detail="${route}"${id==null?'':` data-id="${esc(id)}"`}${disabled?' disabled':''}>${esc(label)}</button>`;
export function strategyActions(item,writable){
  return `<div class="settings-actions">${button('Change strategy','plant_strategy_editor',item.personalizationRuleId,!writable)}${button('Rename','plant_strategy_rename',item.personalizationRuleId,!writable)}${button('Delete','plant_strategy_delete',item.personalizationRuleId,!writable)}</div>`;
}
export function newStrategyButton(writable){return button('New strategy','plant_strategy_editor','new',!writable);}
export function strategyBlocks(blocks,fields){
  return (blocks??[]).filter(block=>block&&typeof block==='object'&&['content','proposal_card','proposal_success','proposal_fail','error','clarification_card'].includes(block.type)).map(block=>{
    const message=typeof block.message==='string'?block.message:typeof block.content==='string'&&!block.content.trim().startsWith('{')?block.content:'';
    const cards=Array.isArray(block.cards)?block.cards:Array.isArray(block.payload?.rules)?block.payload.rules:[];
    return `<section class="settings-group">${message?`<p class="native-strategy-message">${esc(message)}</p>`:''}${cards.map(card=>fields(Object.fromEntries(Object.entries({name:card.title,summary:card.summary,condition:card.ruleCondition,action:card.ruleEffect}).filter(([,value])=>value!=null)))).join('')}</section>`;
  }).join('');
}
export function renderStrategyAction(route,ctx,state,fields){
  const item=state.value?.rules?.find(item=>String(item.personalizationRuleId)===String(ctx.id)),creating=ctx.id==='new';
  const action=route==='plant_strategy_delete'?'delete':route==='plant_strategy_rename'?'rename':creating?'create':'edit';
  const title={delete:'Delete plant strategy',rename:'Rename plant strategy',create:'New plant strategy',edit:'Change plant strategy'}[action];
  if(state.loading||state.error||!creating&&!item)return {title,body:note(state.error??(state.loading?'Reading plant configuration…':'This plant strategy is no longer available.'))};
  const op=ctx.strategyOperation?.entry===ctx.config?.config_entry&&ctx.strategyOperation?.route===route&&String(ctx.strategyOperation?.id)===String(ctx.id)?ctx.strategyOperation:null;
  const enabled=state.writable===true&&ctx.controlPermission;
  const details=item?fields({name:item.customDisplayName||item.personalizationRuleName,condition:item.ruleCondition,action:item.ruleEffect}):'';
  const notice=op?.error?`<p role="alert">${esc(op.error)}</p>`:'';
  if(op?.stage==='done')return {title,body:notice+note(op.result?.message)+button('Personal strategies','strategies')};
  if(op?.sent&&op.error)return {title,body:notice+note('Refresh the saved plant strategies before starting another request.')+button('Personal strategies','strategies')};
  if(op?.stage==='preview')return {title:'Review plant strategy change',body:notice+details+
    (op.preview.name?fields({newName:op.preview.name}):'')+(op.preview.instruction?fields({request:op.preview.instruction}):'')+
    note(action==='delete'?'This deletes the strategy from the Sigenergy plant. It cannot be undone here.':action==='rename'?'Save this name on your Sigenergy plant.':'Send this request to Sigenergy’s native strategy assistant. Sending a request can change plant strategies; review any proposal before confirming it.')+
    `<div class="settings-actions"><button type="button" class="settings-secondary" data-native-strategy-cancel>Cancel</button><button type="button" class="settings-save" data-native-strategy-apply>${action==='delete'?'Delete strategy':action==='rename'?'Save name':'Send to Sigenergy'}</button></div>`};
  if(op?.conversation){
    const response=op.response??{},waiting=response.phase==='awaiting_response'||!response.phase;
    const blocks=strategyBlocks(response.blocks,fields),choices=response.buttons??[];
    if(response.phase==='unconfirmed')return {title,body:notice+note(response.message)+button('Personal strategies','strategies')};
    return {title:'Sigenergy strategy assistant',body:notice+blocks+
      (response.plant_changed?note('Plant strategies updated. Refresh the strategy list to inspect the saved rules.'):'')+
      (waiting?note('Waiting for Sigenergy’s response…')+`<button type="button" class="settings-secondary" data-native-strategy-refresh>Refresh response</button>`:
       op.answer?note(`Send “${op.answer.text}” to Sigenergy?`)+`<div class="settings-actions"><button type="button" class="settings-secondary" data-native-strategy-cancel-answer>Cancel</button><button type="button" class="settings-save" data-native-strategy-answer>Confirm</button></div>`:
       `<div class="settings-actions">${choices.map(choice=>`<button type="button" class="settings-secondary" data-native-strategy-choice="${choice.index}">${esc(choice.text)}</button>`).join('')}</div><form data-native-strategy-followup><label class="settings-field"><span>Refine this strategy</span><textarea name="instruction" maxlength="2000" required rows="3"></textarea></label><div class="settings-actions"><button type="submit" class="settings-save">Review response</button></div></form>`)+
      button('Personal strategies','strategies')};
  }
  return {title,body:notice+details+`<form data-native-strategy-form="${action}">`+
    (action==='rename'?`<label class="settings-field"><span>Strategy name</span><input name="name" maxlength="60" required value="${esc(op?.draft?.name??(item.customDisplayName||item.personalizationRuleName))}"></label>`:
     action==='delete'?note('Review the selected strategy before deleting it.'):
     `<label class="settings-field"><span>${creating?'Describe the strategy you want':'Describe what you want to change'}</span><textarea name="instruction" maxlength="2000" required rows="5">${esc(op?.draft?.instruction??'')}</textarea></label>`+note('Uses Sigenergy’s native strategy assistant. Changes are saved on the plant, separate from Home Assistant schedules.'))+
    `<div class="settings-actions"><button type="submit" class="settings-save"${!enabled?' disabled':''}>Review ${action==='delete'?'deletion':'change'}</button></div></form>`};
}

export function bindNativeStrategies(card){
  clearTimeout(card._strategyPollTimer);
  const root=card._detailDialog,current=card._detailStack?.at(-1);
  if(!root||!STRATEGY_ROUTES.has(current?.route))return;
  const own=()=>root===card._detailDialog&&current===card._detailStack?.at(-1)&&card._config.config_entry===entry;
  const entry=card._config.config_entry;
  const redraw=()=>{if(own()){card._detailDirty=false;card._openDetail(current.route,current.id,true);}};
  const request=async data=>{
    if(card._strategyBusy)return null;
    card._strategyBusy=true;root.querySelectorAll('[data-native-strategy-form] button,[data-native-strategy-apply],[data-native-strategy-answer],[data-native-strategy-choice],form[data-native-strategy-followup] button,[data-native-strategy-refresh]').forEach(button=>button.disabled=true);
    let status=root.querySelector('[data-native-strategy-status]');if(!status){status=document.createElement('output');status.dataset.nativeStrategyStatus='';status.className='settings-form-result';status.setAttribute('aria-live','polite');root.querySelector('.detail-body')?.append(status);}status.textContent={preview:'Reading current plant strategies…',apply:'Sending strategy request…',read:'Reading Sigenergy’s response…',answer:'Sending response…'}[data.operation];
    try{return await card._hass.callWS({type:'sigen_hybrid/plant_strategy',config_entry:entry,...data});}
    catch(error){if(own()){card._strategyOperation={...card._strategyOperation,entry,route:current.route,id:current.id,error:error?.message??'The request was not confirmed. Refresh the plant before trying again.'};}return null;}
    finally{card._strategyBusy=false;}
  };
  const form=root.querySelector('[data-native-strategy-form]');
  form?.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity())return;
    const action=form.dataset.nativeStrategyForm,data={operation:'preview',action,...(current.id==='new'?{}:{rule_id:Number(current.id)}),...(action==='rename'?{name:form.elements.name.value}:['create','edit'].includes(action)?{instruction:form.elements.instruction.value}:{})};
    card._strategyOperation={entry,route:current.route,id:current.id,draft:data};
    const result=await request(data);if(result&&own())card._strategyOperation={entry,route:current.route,id:current.id,stage:'preview',preview:result};redraw();
  });
  root.querySelector('[data-native-strategy-cancel]')?.addEventListener('click',()=>{card._strategyOperation=null;redraw();});
  root.querySelector('[data-native-strategy-apply]')?.addEventListener('click',async()=>{
    const op=card._strategyOperation,token=op?.preview?.preview;if(!token||op.sent)return;op.sent=true;
    const result=await request({operation:'apply',preview:token});
    if(result&&own())card._strategyOperation={entry,route:current.route,id:current.id,stage:result.conversation?'conversation':'done',conversation:result.conversation,result};
    redraw();
  });
  const read=async()=>{
    const op=card._strategyOperation;if(!op?.conversation||!own())return;
    const result=await request({operation:'read',conversation:op.conversation});if(result&&own())op.response=result;redraw();
  };
  root.querySelector('[data-native-strategy-refresh]')?.addEventListener('click',read);
  for(const choice of root.querySelectorAll('[data-native-strategy-choice]'))choice.addEventListener('click',()=>{
    const op=card._strategyOperation,button=Number(choice.dataset.nativeStrategyChoice);op.answer={button,text:choice.textContent};redraw();
  });
  root.querySelector('[data-native-strategy-cancel-answer]')?.addEventListener('click',()=>{card._strategyOperation.answer=null;redraw();});
  root.querySelector('[data-native-strategy-followup]')?.addEventListener('submit',event=>{
    event.preventDefault();if(!event.target.reportValidity())return;const instruction=event.target.elements.instruction.value;card._strategyOperation.answer={instruction,text:instruction};redraw();
  });
  root.querySelector('[data-native-strategy-answer]')?.addEventListener('click',async()=>{
    const op=card._strategyOperation,answer=op.answer;if(!answer||answer.sent)return;answer.sent=true;
    const result=await request({operation:'answer',conversation:op.conversation,...(answer.button==null?{instruction:answer.instruction}:{button:answer.button})});
    if(own()){const state=card._strategyOperation;state.answer=null;state.response=null;if(result){state.error=null;state.polls=0;}}redraw();
  });
  const op=card._strategyOperation;
  if(op?.conversation&&(!op.response||op.response.phase==='awaiting_response')&&!op.error&&(op.polls??0)<12){op.polls=(op.polls??0)+1;card._strategyPollTimer=setTimeout(read,10000);}
}
