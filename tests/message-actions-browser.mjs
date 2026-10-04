import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const engines = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(root,'test-results'),{recursive:true});
const server=createServer(async(req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://test').pathname);
  if(!file.startsWith(root)){res.writeHead(403).end();return;}
  try{const body=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/plain');res.end(body);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await engines[process.env.BROWSER_ENGINE||'chromium'].launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const b=(page,name)=>page.getByRole('button',{name,exact:true});
const input=page=>page.getByLabel('消息输入框',{exact:true});
const bubbles=page=>page.locator('.real-messages .sp-message-bubble-cv2');
const wait=async(check,label)=>{for(let i=0;i<160;i++){if(await check())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out: '+label);};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=','base64');
async function histories(page,tt){return page.evaluate(tt=>tt?Object.values(JSON.parse(localStorage.getItem('fixture.tt.store')||'{}')).filter(v=>v.messages):Object.keys(localStorage).filter(k=>k.startsWith('yui-glass-phone.messages.v1:')).map(k=>JSON.parse(localStorage.getItem(k))),tt);}
async function home(page){await b(page,'返回手机桌面').click();}
async function openChat(page){await home(page);await b(page,'打开消息').click();await wait(()=>b(page,'打开聊天：小晴').count(),'list');await b(page,'打开聊天：小晴').click();}
const layer=page=>page.locator('.message-action-layer');
async function menu(page,index=0){await bubbles(page).nth(index).dispatchEvent('contextmenu');await wait(()=>b(page,'编辑').isVisible(),'menu');}
async function text(page,value){await input(page).fill(value);await b(page,'发送').click();await wait(async()=>await input(page).inputValue()==='' && !(await page.locator('.pending-message').count()),'saved');}
async function edit(page,index,value){await menu(page,index);await b(page,'编辑').click();await page.getByLabel('编辑消息内容',{exact:true}).fill(value);await b(page,'保存消息修改').click();await wait(()=>layer(page).isHidden(),'edited');}
async function remove(page,index){await menu(page,index);await b(page,'删除').click();await b(page,'确认删除消息').click();await wait(()=>layer(page).isHidden(),'deleted');}
try {
 for(const tt of [false,true]){
  const context=await browser.newContext({viewport:{width:393,height:740},hasTouch:true}),page=await context.newPage();page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript({content:await readFile(path.join(root,'tests/profile-mock.js'),'utf8')});
  if(tt)await page.addInitScript({content:await readFile(path.join(root,'tests/tt-mock.js'),'utf8')});else await page.route('**/api/users/me',route=>route.fulfill({json:{handle:'test-user'}}));
  await page.route('**/thumbnail?**',route=>route.fulfill({contentType:'image/png',body:png}));
  let release,mode='normal';const requests=[];
  await page.route('https://ai.fixture.test/**',async route=>{
   if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST'}});return;}
   requests.push(route.request().postDataJSON());if(mode==='delay')await new Promise(r=>release=r);
   if(mode==='error'){await route.fulfill({status:500,body:'fixture'});return;}
   await route.fulfill({json:{choices:[{message:{content:'对方的文字'},finish_reason:'stop'}]}}).catch(()=>{});
  });
  await page.goto(base+'/preview.html');
  await page.evaluate(()=>localStorage.setItem('yui-glass-phone.ai.v1',JSON.stringify({version:1,baseUrl:'https://ai.fixture.test/v1',apiKey:'fixture',model:'fixture-model',temperature:.8,maxTokens:800,historyCount:40})));
  await b(page,'打开设置').click();await b(page,'独立 API 设置').click();await page.getByText('高级设置',{exact:true}).click();assert.equal(await page.getByLabel('等待时间（秒）',{exact:true}).inputValue(),'120');await page.getByLabel('等待时间（秒）',{exact:true}).fill('90');
  await page.getByText('手机聊天提示词',{exact:true}).click();const prompt=page.getByLabel('提示词内容',{exact:true});const defaultPrompt=await prompt.inputValue();assert(defaultPrompt.includes('手机'));await prompt.fill('只用短句，聊天风格测试');await b(page,'恢复默认提示词').click();assert.equal(await prompt.inputValue(),defaultPrompt);await prompt.fill('只用短句，聊天风格测试');await b(page,'保存 API 设置').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('yui-glass-phone.ai.v1')).timeoutSeconds),90);
  await home(page);await b(page,'打开消息').click();await b(page,'联系人').click();await b(page,'登记人物').click();await b(page,'从当前角色卡带入').click();await page.getByLabel('人物名字',{exact:true}).fill('小晴');await page.getByLabel('开局关系',{exact:true}).selectOption('friend');await b(page,'保存人物').click();await wait(async()=> (await page.locator('.profile-status').textContent()).includes('已保存到当前存档'),'profile');await b(page,'取消').click();await openChat(page);
  await text(page,'原消息');await text(page,'保留的消息');await page.waitForTimeout(850);
  mode='delay';await b(page,'让对方回复').click();await wait(()=>requests.length===1,'generating');assert.equal(requests[0].messages[0].content,'只用短句，聊天风格测试');assert(await b(page,'灵动岛：停止回复').isVisible());assert.equal(await page.locator('.message-local-note').count(),0);assert(!(await page.locator('.message-feedback').textContent()).includes('正在请求'));
  if(!tt)await page.screenshot({path:path.join(root,'test-results/island-generating.png')});
  await b(page,'灵动岛：停止回复').click();release();await page.waitForTimeout(70);assert.equal(await bubbles(page).count(),2);assert.equal(await page.locator('.reply-island.is-generating').count(),0);
  // Press cancellation on movement, then an actual held pointer opens the menu.
  const bubble=bubbles(page).first();await bubble.dispatchEvent('pointerdown',{pointerId:1,isPrimary:true,button:0,pointerType:'touch',clientX:100,clientY:200});await bubble.dispatchEvent('pointermove',{pointerId:1,isPrimary:true,pointerType:'touch',clientX:100,clientY:220});await page.waitForTimeout(560);assert(await layer(page).isHidden());await bubble.dispatchEvent('pointerup',{pointerId:1,isPrimary:true,button:0,pointerType:'touch'});
  await bubble.dispatchEvent('pointerdown',{pointerId:2,isPrimary:true,button:0,pointerType:'touch',clientX:100,clientY:200});await page.waitForTimeout(560);await bubble.dispatchEvent('pointerup',{pointerId:2,isPrimary:true,button:0,pointerType:'touch'});assert(await b(page,'编辑').isVisible());
  if(!tt)await page.screenshot({path:path.join(root,'test-results/message-menu.png')});
  const popup=page.locator('.message-action-card[data-kind="menu"]');
  assert.equal(await popup.locator('button').count(),5);assert.equal(await popup.locator('button svg').count(),5);
  assert.equal(await popup.locator('h2').count(),0);assert.equal(await b(page,'关闭菜单').count(),0);
  assert.equal(await layer(page).evaluate(node=>getComputedStyle(node).backdropFilter || getComputedStyle(node).webkitBackdropFilter),'none');
  const menuRect=await popup.boundingBox(),bubbleRect=await bubble.boundingBox(),frameRect=await page.locator('.directory-view').boundingBox();
  assert(menuRect.height<=56 && menuRect.width<=230);assert(menuRect.x>=frameRect.x && menuRect.x+menuRect.width<=frameRect.x+frameRect.width);
  assert(Math.abs(menuRect.y+menuRect.height-bubbleRect.y)<12 || Math.abs(menuRect.y-bubbleRect.y-bubbleRect.height)<12,'popup next to selected bubble');
  await layer(page).click({position:{x:8,y:frameRect.height-8}});assert(await layer(page).isHidden());
  await menu(page);await page.keyboard.press('Escape');assert(await layer(page).isHidden());
  await menu(page);await page.setViewportSize({width:393,height:430});await wait(()=>layer(page).isHidden(),'resize dismisses popup');
  await menu(page);const compactMenu=await popup.boundingBox(),compactFrame=await page.locator('.directory-view').boundingBox();
  assert(compactMenu.y>=compactFrame.y && compactMenu.y+compactMenu.height<=compactFrame.y+compactFrame.height,'short frame contains menu');
  await page.setViewportSize({width:393,height:740});await wait(()=>layer(page).isHidden(),'restore frame');await menu(page);
  await b(page,'编辑').click();await page.getByLabel('编辑消息内容',{exact:true}).fill('取消草稿');await b(page,'取消编辑').click();assert.equal((await histories(page,tt))[0].messages[0].text,'原消息');
  await edit(page,0,'修改后的消息🙂\n<script>只是文字</script>');const id=(await histories(page,tt))[0].messages[0].messageId;assert.equal(await page.locator('.sp-message-bubble-cv2 script').count(),0);
  await menu(page,0);await b(page,'引用').click();assert((await page.locator('.message-quote-preview').textContent()).includes('修改后的消息'));await home(page);await b(page,'打开消息').click();await b(page,'打开聊天：小晴').click();assert(await page.locator('.message-quote-preview').isVisible());await text(page,'引用回复');assert.equal((await histories(page,tt))[0].messages[2].replyTo,id);
  const quote=page.locator('.real-messages .message-quote');
  assert.equal(await bubbles(page).nth(2).textContent(),'引用回复');assert.equal(await page.locator('.sp-message-bubble-cv2 .message-quote').count(),0);assert.equal(await quote.locator('script').count(),0);
  await edit(page,0,'这是一段比较长的被引用消息，用来检查灰色引用条是否会超出手机边缘。'.repeat(8));
  const longQuote=await quote.boundingBox(),quoteFrame=await page.locator('.real-messages').boundingBox();assert(longQuote.x>=quoteFrame.x && longQuote.x+longQuote.width<=quoteFrame.x+quoteFrame.width);assert(longQuote.height<28);assert(await quote.evaluate(node=>node.scrollWidth>node.clientWidth));
  await edit(page,0,'刚才我语气不太好');assert((await quote.textContent()).includes('刚才我语气不太好'));
  const replyRect=await bubbles(page).nth(2).boundingBox(),quoteRect=await quote.boundingBox();assert(quoteRect.y>=replyRect.y+replyRect.height+4 && quoteRect.y<replyRect.y+replyRect.height+8);assert(Math.abs(quoteRect.x+quoteRect.width-replyRect.x-replyRect.width)<1,'outgoing quote aligns with bubble right edge');
  if(!tt)await page.screenshot({path:path.join(root,'test-results/message-quote-style.png')});
  await edit(page,0,'引用应显示新内容');assert((await quote.textContent()).includes('引用应显示新内容'));await remove(page,0);assert((await quote.textContent()).includes('原消息已删除'));assert(!JSON.stringify(await histories(page,tt)).includes('引用应显示新内容'));
  mode='normal';await page.waitForTimeout(850);await b(page,'让对方回复').click();await wait(async()=>await bubbles(page).count()===3 && !(await page.locator('.pending-message').count()),'reply');assert(!JSON.stringify(requests.at(-1)).includes('引用应显示新内容'));assert(JSON.stringify(requests.at(-1)).includes('原消息已删除'));
  await edit(page,2,'手动调整对方回复');assert.equal((await histories(page,tt))[0].messages[2].source,'ai-reply');
  // Multi-select persists actual deletion, with failure/uncertain acknowledgement handled by original operation ID.
  await menu(page,0);await b(page,'多选').click();await page.waitForTimeout(950);await page.getByLabel('选择消息：手动调整对方回复',{exact:true}).click();assert(await b(page,'删除所选 2 条').isVisible());await b(page,'删除所选 2 条').click();await b(page,'取消删除').click();assert.equal((await histories(page,tt))[0].messages.length,3);await b(page,'删除所选 2 条').click();
  if(tt)await page.evaluate(()=>ttMock.messageFailAfterWrite=true);else await page.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('yui-glass-phone.messages'))throw Error('full');return originalSet.call(this,k,v);};});
  await b(page,'确认删除消息').click();await wait(()=>b(page,'核对并重试修改').count(),'failed mutation');if(!tt)assert.equal((await histories(page,tt))[0].messages.length,3);
  if(tt)await page.evaluate(()=>ttMock.messageFailAfterWrite=false);else await page.evaluate(()=>Storage.prototype.setItem=originalSet);
  await b(page,'核对并重试修改').click();await wait(()=>layer(page).isHidden(),'retry mutation');assert.equal((await histories(page,tt))[0].messages.length,1);assert.equal(await bubbles(page).count(),1);assert((await bubbles(page).textContent()).includes('引用回复'));
  await page.reload();await b(page,'打开消息').click();await wait(()=>b(page,'打开聊天：小晴').count(),'refresh');await b(page,'打开聊天：小晴').click();assert.equal(await bubbles(page).count(),1);assert((await quote.textContent()).includes('原消息已删除'));assert.equal(await bubbles(page).textContent(),'引用回复');
  if(!tt)await page.screenshot({path:path.join(root,'test-results/message-quote.png')});
  mode='error';await b(page,'让对方回复').click();await wait(()=>b(page,'灵动岛：查看回复提示').count(),'error island');await b(page,'灵动岛：查看回复提示').click();assert((await page.locator('.toast').textContent()).includes('HTTP 500'));assert.equal(await page.locator('.message-feedback').textContent(),'');
  if(tt){await menu(page,0);await b(page,'删除').click();await page.evaluate(()=>{ttMock.waitMessage=true;delete ttMock.releasewaitMessage;});await b(page,'确认删除消息').click();await page.waitForFunction(()=>ttMock.releasewaitMessage);await page.evaluate(()=>profileMock.switch('0','switch-during-delete'));await page.evaluate(()=>{ttMock.waitMessage=false;ttMock.releasewaitMessage();});await wait(()=>b(page,'登记人物').count(),'switch');assert.equal(await page.locator('.contact-row').count(),0);await wait(async()=> (await histories(page,true))[0].messages.length===0,'old write');}
  assert.deepEqual(errors,[]);console.log(`PASS ${tt?'TT':'ST'} island/prompt/actions: animation-stop, custom prompt/timeout, long-press/scroll, edit/cancel, dynamic quotes, hard delete/multi-delete, failure retry, refresh/context, late TT mutation`);await context.close();
 }
}finally{await browser.close();server.close();}
