/* Native strategy interaction checks against a synthetic WS contract, never a plant. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
async function run(){
  const server=http.createServer(async(req,res)=>{try{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.webp':'image/webp','.png':'image/png'}[path.extname(file)]??'text/plain');res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'}),results=[];
  try{for(const [width,height,dpr] of [[1920,1080,1],[1024,768,2],[768,1024,2],[412,915,3],[360,800,3],[800,480,1]]){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/tools/gallery.html`);await page.waitForFunction(()=>window.galleryReady);
    await page.evaluate(()=>{
      const card=document.querySelector('sigen-hybrid-card');card._config.config_entry='strategy-test';card._detailDirty=false;card._closeDetail();
      const original=card._detailContext;card._detailContext=function(id){return {...original.call(this,id),controlPermission:true};};
      const backend={rules:[{personalizationRuleId:17,personalizationRuleName:'Night charging',customDisplayName:'',ruleCondition:'Every day 02:00–05:00, SOC ≤ 40%',ruleEffect:'Force charge'}]},calls=[];card._strategyTestCalls=calls;
      card._hass={...card._hass,callWS:async message=>{
        if(message.type==='sigen_hybrid/plant_configuration')return {section:'strategies',writable:true,value:structuredClone(backend)};
        if(message.type!=='sigen_hybrid/plant_strategy')return {};
        calls.push(structuredClone(message));
        if(message.operation==='preview'){backend.pending=message;return {preview:'00000000-0000-0000-0000-000000000001',action:message.action,name:message.name,instruction:message.instruction};}
        if(message.operation==='apply'){
          if(backend.pending.action==='rename'){backend.rules[0].customDisplayName=backend.pending.name;return {phase:'confirmed',message:'Strategy renamed'};}
          if(backend.pending.action==='delete'){backend.rules=[];return {phase:'confirmed',message:'Strategy deleted'};}
          backend.applied=false;return {phase:'awaiting_response',conversation:'00000000-0000-0000-0000-000000000002'};
        }
        if(message.operation==='read')return {phase:'response',plant_changed:backend.applied===true,blocks:[{type:'content',message:backend.applied?'Your strategy was updated.':'Review the proposed strategy.'},{type:'proposal_card',cards:[{title:'Night charging',ruleCondition:'Every day 02:00–04:00, SOC ≤ 40%',ruleEffect:'Force charge'}]}],buttons:backend.applied?[]:[{index:0,text:'Confirm and apply these strategies'}]};
        if(message.operation==='answer'){backend.applied=true;backend.rules[0].ruleCondition='Every day 02:00–04:00, SOC ≤ 40%';return {phase:'awaiting_response',conversation:'00000000-0000-0000-0000-000000000002'};}
      }};
      card._openDetail('strategies');
    });
    const dialog=page.locator('sigen-hybrid-card').locator('dialog.sigen-detail'),click=label=>dialog.getByRole('button',{name:label,exact:true}).click();
    await click('Night charging Every day 02:00–05:00, SOC ≤ 40% · Force charge');await click('Rename');
    await dialog.getByLabel('Strategy name').fill('Winter charging');await click('Review change');await click('Save name');
    await dialog.getByText('Strategy renamed',{exact:true}).waitFor();await click('Personal strategies');
    await click('Winter charging Every day 02:00–05:00, SOC ≤ 40% · Force charge');await click('Change strategy');
    await dialog.getByLabel('Describe what you want to change').fill('Finish charging at 04:00 instead of 05:00.');await click('Review change');await click('Send to Sigenergy');await click('Refresh response');
    await click('Confirm and apply these strategies');await click('Confirm');await click('Refresh response');
    await dialog.getByText('Plant strategies updated. Refresh the strategy list to inspect the saved rules.',{exact:true}).waitFor();
    await click('Personal strategies');await click('Winter charging Every day 02:00–04:00, SOC ≤ 40% · Force charge');await click('Delete');await click('Review deletion');
    await click('Cancel');await click('Review deletion');await click('Delete strategy');await dialog.getByText('Strategy deleted',{exact:true}).waitFor();await click('Personal strategies');
    await dialog.getByText('No personal strategies in this operating mode.',{exact:true}).waitFor();await click('New strategy');
    await dialog.getByLabel('Describe the strategy you want').fill('Charge between 02:00 and 05:00 when the battery is below 40%.');
    const metrics=await dialog.evaluate(node=>({overflow:node.scrollWidth>node.clientWidth+1,forms:node.querySelectorAll('[data-native-strategy-form]').length}));
    assert.equal(metrics.overflow,false,`${width}: clipped strategy editor`);assert.equal(metrics.forms,1);
    const calls=await page.evaluate(()=>document.querySelector('sigen-hybrid-card')._strategyTestCalls);
    assert.equal(calls.filter(call=>call.operation==='apply').length,3);assert.equal(calls.filter(call=>call.operation==='answer').length,1);
    if(width===1920||width===412)await page.screenshot({path:path.join(root,'docs/images',width===1920?'native-strategy-editor.png':'phone-strategy-editor.png')});
    await click('Review change');await dialog.getByRole('button',{name:'Send to Sigenergy',exact:true}).waitFor();await click('Cancel');
    assert.deepEqual(errors,[]);results.push({width,height,dpr,actions:['rename','edit','confirm','cancel','delete','new'],overflow:metrics.overflow});
    await context.close();
  }}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
  console.log(JSON.stringify({passed:results.length,results}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
