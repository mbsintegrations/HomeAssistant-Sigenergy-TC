/* Browser interactions use synthetic WebSocket responses, never a plant. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
async function run(){
  const server=http.createServer(async(req,res)=>{try{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.webp':'image/webp','.png':'image/png'}[path.extname(file)]??'text/plain');res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:'chrome'}),results=[];
  try{for(const [width,height,dpr] of [[1920,1080,1],[1024,768,2],[412,915,3],[360,800,3]]){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/tools/gallery.html`);await page.waitForFunction(()=>window.galleryReady);
    await page.evaluate(()=>{
      const card=document.querySelector('sigen-hybrid-card');delete card._config.config_entry;card._detailDirty=false;card._closeDetail();
      const original=card._state;card._state=function(key){return key==='control_status'?{attributes:{ac_session_api_version:1,config_entry_id:'test-entry'}}:original.call(this,key);};
      card._acCalls=[];card._hass={...card._hass,callWS:async request=>{card._acCalls.push(request);return request.operation==='preview'?{token:'test-token',surplus:true}:{};}};
      card._chargerAction('ac','start','test-charger');
    });
    const dialog=page.locator('sigen-hybrid-card').locator('dialog.sigen-manual-dialog');
    await dialog.getByRole('button',{name:'Temporary Fast Charging',exact:true}).waitFor();
    if(width===1920)await page.screenshot({path:path.join(root,'docs/images/ac-temporary-fast.png')});
    const metrics=await dialog.evaluate(node=>({overflow:node.scrollWidth>node.clientWidth+1,bottom:node.getBoundingClientRect().bottom}));
    assert.equal(metrics.overflow,false,`${width}: clipped AC dialog`);assert.ok(metrics.bottom<=height,`${width}: dialog exceeds viewport`);
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('sigen-hybrid-card')._dialogOpen);
    assert.equal(await page.evaluate(()=>document.querySelector('sigen-hybrid-card')._acCalls.filter(x=>x.operation==='start').length),0);
    await page.evaluate(()=>document.querySelector('sigen-hybrid-card')._chargerAction('ac','start','test-charger'));
    await dialog.getByRole('button',{name:'Wait for solar',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('sigen-hybrid-card')._dialogOpen);
    assert.equal(await page.evaluate(()=>document.querySelector('sigen-hybrid-card')._acCalls.filter(x=>x.operation==='start').length),0);
    await page.evaluate(()=>document.querySelector('sigen-hybrid-card')._chargerAction('ac','start','test-charger'));
    await dialog.getByRole('button',{name:'Temporary Fast Charging',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('sigen-hybrid-card')._dialogOpen);
    const starts=await page.evaluate(()=>document.querySelector('sigen-hybrid-card')._acCalls.filter(x=>x.operation==='start'));
    assert.deepEqual(starts,[{type:'sigen_hybrid/ac_charge_session',config_entry:'test-entry',operation:'start',token:'test-token',temporary_fast:true}]);
    // Cancelling while the read-only preview is in flight must not start later.
    await page.evaluate(()=>{const card=document.querySelector('sigen-hybrid-card');card._hass.callWS=request=>new Promise(resolve=>{card._finishPreview=resolve;});card._chargerAction('ac','start','test-charger');});
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('sigen-hybrid-card')._dialogOpen);
    await page.evaluate(()=>document.querySelector('sigen-hybrid-card')._finishPreview({token:'late',surplus:false}));
    await page.waitForTimeout(30);
    assert.equal(await dialog.count(),0);assert.deepEqual(errors,[]);results.push({width,height,cancel:true,temporaryFast:true,overflow:metrics.overflow});
    await context.close();
  }}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
  console.log(JSON.stringify({passed:results.length,results}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
