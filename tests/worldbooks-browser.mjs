import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const engines=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));await mkdir(path.join(root,'test-results'),{recursive:true});
const server=createServer(async(req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://test').pathname);
 if(!file.startsWith(root)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/plain');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await engines[process.env.BROWSER_ENGINE||'chromium'].launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const b=(p,name)=>p.getByRole('button',{name,exact:true}), check=(p,name)=>p.getByRole('checkbox',{name,exact:true});
async function wait(fn,label){for(let i=0;i<180;i++){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out: '+label);}
async function books(p,tt){return p.evaluate(tt=>tt?Object.values(JSON.parse(localStorage.getItem('fixture.tt.store')||'{}')).filter(v=>v.people):Object.keys(localStorage).filter(k=>k.startsWith('yui-glass-phone.contacts.v1:')).flatMap(k=>Object.values(JSON.parse(localStorage.getItem(k)).books)),tt);}
const imported={name:'线上规则.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({entries:{1:{uid:1,comment:'线上语气',content:'不要小说旁白🙂'},2:{uid:2,comment:'<img src=x onerror=alert(1)>',content:'<script>不是脚本</script>',disable:true}}}))};
try{
 for(const tt of [false,true]){
  const context=await browser.newContext({viewport:{width:393,height:740}}),page=await context.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript({content:await readFile(path.join(root,'tests/profile-mock.js'),'utf8')});
  if(tt)await page.addInitScript({content:await readFile(path.join(root,'tests/tt-mock.js'),'utf8')});else await page.route('**/api/users/me',r=>r.fulfill({json:{handle:'test-user'}}));
  await page.route('**/scripts/world-info.js',r=>r.fulfill({contentType:'text/javascript',body:'export function getWorldInfoSettings(){return window.profileMock.worldSettings;}'}));
  await page.addInitScript(()=>{
   const p=window.profileMock;
   p.cards[0].data.extensions.world='当前主书';p.cards[1].data.extensions.world='其他主书';
   p.worldSettings={world_info:{charLore:[{name:'story',extraBooks:['当前副书']},{name:'other',extraBooks:['其他副书']}]}};
   const entry=(comment,content)=>({entries:{1:{uid:1,comment,content}}});
   p.worlds={'当前主书':{entries:{1:{uid:1,comment:'人物经历',content:'经历资料'},2:{uid:2,comment:'状态栏',content:'正文状态栏不得发送'}}},'当前副书':entry('补充','补充资料'),'其他主书':entry('保密','其他角色不得读取'),'其他副书':entry('保密2','不得读取2'),'通用书':entry('通用习惯','简短聊天')};
   p.reads=[];const getContext=window.SillyTavern.getContext;
   window.SillyTavern.getContext=()=>{const ctx=getContext();ctx.loadWorldInfo=async name=>{p.reads.push(name);if(p.delay)await new Promise(r=>p.release=r);return structuredClone(p.worlds[name]);};return ctx;};
  });
  await page.goto(base+'/preview.html');
  const originalHost=await page.evaluate(()=>JSON.stringify([profileMock.worlds,profileMock.worldSettings,profileMock.cards]));
  await b(page,'打开消息').click();await b(page,'联系人').click();await b(page,'登记人物').click();await b(page,'从当前角色卡带入').click();
  await page.getByLabel('人物名字',{exact:true}).fill('测试人物');await page.getByLabel('开局关系',{exact:true}).selectOption('friend');
  await page.getByText('AI 回复参考 · 世界书',{exact:true}).click();await b(page,'当前角色世界书').click();
  await wait(()=>check(page,'参考：当前主书 · 人物经历').count(),'current books');
  assert.deepEqual(await page.getByLabel('选择世界书',{exact:true}).locator('option').allTextContents(),['当前主书','当前副书']);
  await check(page,'参考：当前主书 · 人物经历').check();await wait(()=>check(page,'参考：当前主书 · 人物经历').isEnabled(),'select experience');
  await check(page,'参考：当前主书 · 状态栏').check();await wait(()=>check(page,'参考：当前主书 · 状态栏').isEnabled(),'select status');await check(page,'参考：当前主书 · 状态栏').uncheck();
  await b(page,'添加未绑定角色的世界书').click();await wait(()=>check(page,'参考：通用书 · 通用习惯').count(),'unbound');
  assert.deepEqual(await page.getByLabel('选择世界书',{exact:true}).locator('option').allTextContents(),['通用书']);await check(page,'参考：通用书 · 通用习惯').check();await wait(()=>check(page,'参考：通用书 · 通用习惯').isEnabled(),'general selected');
  const file=page.getByLabel('导入世界书文件',{exact:true});await file.setInputFiles(imported);await wait(()=>page.getByRole('checkbox',{name:/线上语气$/}).count(),'file preview');
  const importedCheck=page.getByRole('checkbox',{name:/线上语气$/});assert.equal(await importedCheck.isChecked(),false);await importedCheck.check();await wait(()=>importedCheck.isEnabled(),'file selected');
  assert.equal(await page.locator('.worldbook-entry img, .worldbook-entry script').count(),0);
  await file.setInputFiles(imported);await wait(()=>file.isEnabled(),'repeat import');assert(await importedCheck.isChecked());assert((await page.locator('.material-summary').textContent()).includes('已选 3 条'));
  assert.equal((await books(page,tt)).length,0,'selection is draft only');
  await b(page,'保存人物').click();await wait(async()=> (await page.locator('.profile-status').textContent()).includes('已保存到当前存档'),'saved');
  const stored=await books(page,tt);assert.equal(stored[0].people[0].roleplayMaterials.length,4);assert.equal(stored[0].people[0].aiExcludedMaterials.length,1);
  const content=await page.evaluate(async book=>{const {replyContext}=await import('/modules/ai.js');return replyContext(window,book,book.people[0]);},stored[0]);assert.equal(content.worldbook.length,3);assert(!JSON.stringify(content).includes('正文状态栏不得发送'));
  if(!tt){await page.getByText('AI 回复参考 · 世界书',{exact:true}).evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(root,'test-results/worldbooks-select.png')});}
  await file.setInputFiles({name:'损坏.json',mimeType:'application/json',buffer:Buffer.from('{')});await wait(async()=> (await page.locator('.profile-status').textContent()).includes('JSON'),'bad JSON');assert.deepEqual(await books(page,tt),stored);
  // A failed profile save retains the modified selection and leaves the saved record untouched.
  await importedCheck.uncheck();if(tt)await page.evaluate(()=>ttMock.fail=true);else await page.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('yui-glass-phone'))throw Error('quota');return originalSet.call(this,k,v);};});
  await b(page,'保存人物').click();await wait(async()=> (await page.locator('.profile-status').textContent()).includes('草稿仍在此页'),'save failed');assert.equal(await importedCheck.isChecked(),false);assert.deepEqual(await books(page,tt),stored);
  if(tt)await page.evaluate(()=>ttMock.fail=false);else await page.evaluate(()=>Storage.prototype.setItem=originalSet);
  await b(page,'取消').click();await page.reload();await b(page,'打开消息').click();await b(page,'打开聊天：测试人物').click();await b(page,'聊天资料').click();
  await page.getByText('AI 回复参考 · 世界书',{exact:true}).click();assert(await page.getByRole('checkbox',{name:/线上语气$/}).isChecked());assert.equal(await check(page,'参考：当前主书 · 状态栏').isChecked(),false);
  assert.equal(await page.evaluate(()=>JSON.stringify([profileMock.worlds,profileMock.worldSettings,profileMock.cards])),originalHost);
  await page.evaluate(()=>profileMock.cards[1].shallow=true);await b(page,'添加未绑定角色的世界书').click();await wait(async()=> (await page.locator('.profile-help').allTextContents()).some(t=>t.includes('无法确认全部角色绑定')),'unknown bindings');assert(await page.getByLabel('选择世界书',{exact:true}).isHidden());
  assert(!(await page.evaluate(()=>profileMock.reads)).some(name=>name.startsWith('其他')));
  await page.evaluate(()=>{profileMock.cards[1].shallow=false;profileMock.delay=true;});await b(page,'当前角色世界书').click();await page.waitForFunction(()=>!!profileMock.release);await page.evaluate(()=>profileMock.switch('1','new-chat'));await page.evaluate(()=>{profileMock.delay=false;profileMock.release();});await wait(()=>b(page,'登记人物').count(),'switched');assert.equal(await page.locator('.worldbook-entry').count(),0);assert.deepEqual(await books(page,tt),stored);
  await page.reload();await b(page,'打开消息').click();await b(page,'打开聊天：测试人物').click();await b(page,'聊天资料').click();await page.getByText('AI 回复参考 · 世界书',{exact:true}).click();
  await page.evaluate(()=>{const original=File.prototype.text;File.prototype.text=async function(){await new Promise(r=>profileMock.releaseFile=r);return original.call(this);};});
  await page.getByLabel('导入世界书文件',{exact:true}).setInputFiles(imported);await page.waitForFunction(()=>!!profileMock.releaseFile);await page.evaluate(()=>profileMock.switch('1','file-switch'));await page.evaluate(()=>profileMock.releaseFile());await wait(()=>b(page,'登记人物').count(),'file switched');assert.equal(await page.locator('.worldbook-entry').count(),0);assert.deepEqual(await books(page,tt),stored);
  assert.deepEqual(errors,[]);console.log('PASS '+(tt?'TT':'ST')+' worldbooks: primary/auxiliary filtering, direct exclusion, import/repeat/invalid, cancel/failed save, refresh, host unchanged, shallow unknown, late switch');await context.close();
 }
}finally{await browser.close();server.close();}
