import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const engines=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));await mkdir(path.join(root,'test-results'),{recursive:true});
const server=createServer(async(req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://test').pathname);if(!file.startsWith(root)){res.writeHead(403).end();return;}try{const body=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/plain');res.end(body);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await engines[process.env.BROWSER_ENGINE||'chromium'].launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const b=(p,n)=>p.getByRole('button',{name:n,exact:true}),box=p=>p.getByLabel('消息输入框',{exact:true});
const wait=async(fn,label)=>{for(let i=0;i<180;i++){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out '+label);};
const histories=(p,tt)=>p.evaluate(tt=>tt?Object.values(JSON.parse(localStorage.getItem('fixture.tt.store')||'{}')).filter(v=>v.messages):Object.keys(localStorage).filter(k=>k.startsWith('yui-glass-phone.messages.v1:')).map(k=>JSON.parse(localStorage.getItem(k))),tt);
async function chat(p,name='好友甲'){await b(p,'返回手机桌面').click();await b(p,'打开消息').click();await wait(()=>b(p,`打开聊天：${name}`).count(),'friend list');await b(p,`打开聊天：${name}`).click();}
async function add(p,name){await b(p,'返回手机桌面').click();await b(p,'打开消息').click();await b(p,'联系人').click();await b(p,'登记人物').click();await b(p,'手动创建人物').click();await p.getByLabel('人物名字',{exact:true}).fill(name);await p.getByLabel('开局关系',{exact:true}).selectOption('friend');await b(p,'保存人物').click();await wait(async()=> (await p.locator('.profile-status').textContent()).includes('已保存到当前存档'),'saved profile');await b(p,'取消').click();}
try{
 for(const tt of [false,true]){
  const context=await browser.newContext({viewport:{width:393,height:740}}),p=await context.newPage();p.setDefaultTimeout(6500);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript({content:await readFile(path.join(root,'tests/profile-mock.js'),'utf8')});
  if(tt)await p.addInitScript({content:await readFile(path.join(root,'tests/tt-mock.js'),'utf8')});else await p.route('**/api/users/me',r=>r.fulfill({json:{handle:'test-user'}}));
  const requests=[];let mode='rich',release;
  await p.route('https://ai.fixture.test/**',async r=>{
   if(r.request().method()==='OPTIONS'){await r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type'}});return;}
   const body=r.request().postDataJSON();requests.push(body);const ctx=JSON.parse(body.messages.at(-1).content);
   if(mode==='delay')await new Promise(resolve=>release=resolve);
   const reply=mode==='invalid'?{phoneReply:1,messages:[{type:'text',text:'不应落库'},{type:'sticker',assetId:'made-up'}],settlements:[]}:mode==='refund'?{phoneReply:1,messages:[{type:'transfer',amount:'3.33',note:'可退回'}],settlements:[]}:mode==='plain'||mode==='delay'?'later':{phoneReply:1,messages:[{type:'text',text:'收到啦🙂'},{type:'sticker',assetId:ctx.availableStickers[0]?.id},{type:'transfer',amount:'8.88',note:'请你喝茶'}],settlements:ctx.pendingTransfers.length?[{messageId:ctx.pendingTransfers[0].messageId,action:'receive'}]:[]};
   await r.fulfill({json:{choices:[{message:{content:typeof reply==='string'?reply:JSON.stringify(reply)},finish_reason:'stop'}]}}).catch(()=>{});
  });
  await p.goto(base+'/preview.html');await p.evaluate(async()=>{await new Promise((resolve,reject)=>{const r=indexedDB.open('yui-glass-phone.assets.v1',1);r.onupgradeneeded=()=>{const store=r.result.createObjectStore('assets',{keyPath:'key'});store.createIndex('account','account');};r.onsuccess=()=>{const db=r.result,tx=db.transaction('assets','readwrite');tx.objectStore('assets').put({version:1,id:'upgrade',key:'upgrade-account:upgrade',account:'upgrade-account',data:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',description:'旧升级图片',category:'收藏',allowedAI:true,hidden:false});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};r.onerror=reject;});});await p.evaluate(async()=>{const {saveConfig,defaultConfig}=await import('/modules/ai.js');saveConfig(window,{...defaultConfig(),baseUrl:'https://ai.fixture.test/v1',model:'fixture'});localStorage.setItem('tavern_friends_old','UNCHANGED');});
  await add(p,'好友甲');await add(p,'好友乙');await chat(p);
  await b(p,'添加附件').click();
  assert.equal(await b(p,'添加附件').getAttribute('aria-expanded'),'true');
  const grid=p.locator('.attachment-panel[data-view="home"]');assert.equal(await grid.locator('.attachment-tool').count(),2);
  const panelBounds=await grid.boundingBox(),aBounds=await b(p,'表情包').boundingBox(),bBounds=await b(p,'转账').boundingBox(),composerBounds=await p.locator('.text-composer').boundingBox();
  assert(Math.abs(aBounds.y-bBounds.y)<2);assert(aBounds.width<90);assert(panelBounds.height<135);assert(panelBounds.y+panelBounds.height<=composerBounds.y+1);
  assert.equal(await grid.locator('svg').count(),2);assert.equal(await grid.locator('.profile-action').count(),0);
  await p.screenshot({path:path.join(root,`test-results/attachments-tools-${tt?'tt':'st'}.png`)});
  await b(p,'添加附件').click();assert(await grid.isHidden());await b(p,'添加附件').click();await p.locator('.real-messages').click({position:{x:20,y:30}});assert(await grid.isHidden());
  await b(p,'添加附件').click();await p.keyboard.press('Escape');assert(await grid.isHidden());
  await box(p).fill('未发送草稿');await b(p,'添加附件').click();await b(p,'转账').click();await p.setViewportSize({width:393,height:420});if(tt)await p.evaluate(()=>ttMock.emitLayout({version:1,safeFrame:{left:0,top:0,width:393,height:420},ime:{keyboardOffset:0}}));await p.getByLabel('转账金额',{exact:true}).fill('12.34');await b(p,'发送转账').scrollIntoViewIfNeeded();let small=await b(p,'发送转账').boundingBox();assert(small.y>=0&&small.y+small.height<=420);await p.keyboard.press('Escape');assert(await p.locator('.attachment-panel').isHidden());assert(await box(p).isVisible());await p.setViewportSize({width:393,height:740});if(tt)await p.evaluate(()=>ttMock.emitLayout({version:1,safeFrame:{left:0,top:24,width:375,height:620},ime:{keyboardOffset:0}}));await b(p,'添加附件').click();await b(p,'转账').click();assert.equal(await p.getByLabel('转账金额',{exact:true}).inputValue(),'12.34');await p.getByLabel('转账金额',{exact:true}).fill('5元');await b(p,'发送转账').click();assert((await p.locator('.attachment-panel .profile-status').textContent()).includes('金额'));
  await p.getByLabel('转账金额',{exact:true}).fill('5.20');const currency=await p.locator('.transfer-currency').boundingBox(),moneyField=await p.getByLabel('转账金额',{exact:true}).boundingBox();assert(currency.x<moneyField.x&&Math.abs(currency.y-moneyField.y)<30);await p.screenshot({path:path.join(root,`test-results/attachments-transfer-${tt?'tt':'st'}.png`)});await p.getByLabel('转账备注',{exact:true}).fill('<img onerror=alert(1)>');await b(p,'发送转账').click();await wait(async()=>!(await p.locator('.pending-message').count())&&(await histories(p,tt))[0]?.messages.length===1,'transfer saved');assert.equal(await box(p).inputValue(),'未发送草稿');assert.equal(requests.length,0);assert.equal(await p.locator('.transfer-bubble img').count(),0);
  await b(p,'返回').click();assert((await b(p,'打开聊天：好友甲').textContent()).includes('5.20'));await b(p,'打开聊天：好友甲').click();assert.equal(await box(p).inputValue(),'未发送草稿');await box(p).fill('');
  await b(p,'添加附件').click();await b(p,'表情包').click();await wait(()=>b(p,'导入表情包').count(),'empty library');assert.equal(await p.locator('.sticker-tab').count(),1);assert.equal(await p.locator('.sticker-tab.active').textContent(),'收藏');const surface=await p.locator('.attachment-panel').evaluate(e=>({bg:getComputedStyle(e).backgroundImage,radius:getComputedStyle(e).borderRadius,blur:getComputedStyle(e).backdropFilter||getComputedStyle(e).webkitBackdropFilter}));assert(surface.bg.includes('gradient'));assert.equal(surface.radius,'22px');assert(surface.blur.includes('22px'));assert.equal(await p.locator('.sticker-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),4);const compact=await p.locator('.attachment-panel').boundingBox();assert(compact.height<300);await p.screenshot({path:path.join(root,`test-results/attachments-empty-${tt?'tt':'st'}.png`)});await b(p,'添加表情包').click();
  const data=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.fillStyle='#aaa0bb';x.fillRect(0,0,128,128);x.fillStyle='#31313a';x.font='70px sans-serif';x.fillText('☺',28,88);return c.toDataURL();});
  await p.getByLabel('选择表情包图片',{exact:true}).setInputFiles({name:'smile.png',mimeType:'image/png',buffer:Buffer.from(data.split(',')[1],'base64')});
  await p.screenshot({path:path.join(root,`test-results/attachments-import-${tt?'tt':'st'}.png`)});await p.getByLabel('图片描述 1',{exact:true}).fill('草稿');await p.locator('.attachment-head').getByRole('button',{name:'返回',exact:true}).click();await b(p,'添加表情包').click();assert.equal(await p.getByLabel('图片描述 1',{exact:true}).inputValue(),'草稿');await p.getByLabel('图片描述 1',{exact:true}).fill('开心 <img onerror=evil()>');await p.getByLabel('保存到分类',{exact:true}).selectOption('new');await p.getByLabel('新分类名称',{exact:true}).fill('心情');await b(p,'保存到表情包').click();await wait(()=>b(p,'发送表情包：开心 <img onerror=evil()>').count(),'import');
  await p.screenshot({path:path.join(root,`test-results/attachments-library-${tt?'tt':'st'}.png`)});
  // Collection is an independent category; long-press a category to assign people.
  await b(p,'收藏').click();await wait(()=>b(p,'导入表情包').count(),'empty favorites');assert.equal(await p.locator('.sticker-send').count(),0);await b(p,'心情').click();
  const tab=b(p,'心情');await tab.dispatchEvent('pointerdown',{button:0,clientX:50,clientY:50});await p.waitForTimeout(650);await wait(()=>b(p,'保存分类').count(),'long press category');
  await p.getByLabel('分类名称',{exact:true}).fill('应取消');await p.getByLabel('允许 好友乙 使用',{exact:true}).check();await b(p,'取消修改').click();await wait(()=>b(p,'心情').count(),'category cancel');await p.locator('.sticker-more summary').click();await b(p,'管理当前分类').click();await wait(()=>p.getByLabel('分类名称',{exact:true}).count(),'reopen category');assert.equal(await p.getByLabel('分类名称',{exact:true}).inputValue(),'心情');assert(!(await p.getByLabel('允许 好友乙 使用',{exact:true}).isChecked()));await p.getByLabel('分类名称',{exact:true}).fill('开心');await p.getByLabel('允许 好友甲 使用',{exact:true}).check();await b(p,'保存分类').click();await wait(()=>b(p,'开心').count(),'saved group');
  await b(p,'发送表情包：开心 <img onerror=evil()>').click();await wait(async()=>!(await p.locator('.pending-message').count())&&(await histories(p,tt))[0].messages.length===2,'sticker send');await wait(()=>p.locator('.message-sticker[src]').count(),'asset rendered');assert.equal(requests.length,0);
  await p.waitForTimeout(850);
  if(tt)await p.evaluate(()=>ttMock.messageFailAfterWrite=true);else await p.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('yui-glass-phone.messages'))throw Error('full');return originalSet.call(this,k,v);};});
  await b(p,'让对方回复').click();await wait(()=>b(p,'核对并重试').count(),'rich save failure');const count=requests.length;assert.equal(count,1);assert(!JSON.stringify(requests).includes('data:image'));
  if(tt)await p.evaluate(()=>ttMock.messageFailAfterWrite=false);else await p.evaluate(()=>Storage.prototype.setItem=originalSet);
  await b(p,'核对并重试').click();await wait(async()=>!(await b(p,'核对并重试').count())&&!(await p.locator('.pending-message').count()),'batch confirmed');assert.equal(requests.length,count);
  let h=(await histories(p,tt))[0];assert.equal(h.messages.length,5);assert.equal(h.messages[0].transfer.state,'received');assert.equal(h.messages[4].transfer.state,'pending');assert.equal(h.version,3);
  await b(p,'转账详情：5.20元，已收款').click();assert.equal(await b(p,'确认收款').count(),0);assert((await p.locator('.receipt-state').textContent()).includes('对方已收款'));await b(p,'关闭附件面板').click();await b(p,'转账详情：8.88元，待收款').click();assert.equal(await p.locator('.receipt-state').textContent(),'等待你收款');await p.screenshot({path:path.join(root,`test-results/attachments-receipt-${tt?'tt':'st'}.png`)});await b(p,'确认收款').click();await wait(async()=> (await histories(p,tt))[0].messages[4].transfer.state==='received','receive');await b(p,'转账详情：8.88元，已收款').click();assert.equal(await b(p,'确认收款').count(),0);await b(p,'关闭附件面板').click();
  await p.screenshot({path:path.join(root,`test-results/attachments-chat-${tt?'tt':'st'}.png`)});
  await chat(p,'好友乙');assert.equal(await p.locator('.sp-message-cv2').count(),0);await chat(p);assert.equal(await p.locator('.real-messages .sp-message-cv2').count(),5);
  mode='invalid';await p.waitForTimeout(850);await b(p,'让对方回复').click();await wait(()=>requests.length===2,'invalid request');await wait(async()=>!(await b(p,'停止回复').count()),'invalid response');assert.equal((await histories(p,tt))[0].messages.length,5);
  // Long press selects without sending; cancellation changes no history.
  await b(p,'添加附件').click();await b(p,'表情包').click();await b(p,'开心').click();
  await b(p,'发送表情包：开心 <img onerror=evil()>').dispatchEvent('pointerdown',{button:0,clientX:50,clientY:50});await p.waitForTimeout(650);await wait(()=>b(p,'删除所选').count(),'long press selection');assert.equal((await histories(p,tt))[0].messages.length,5);
  await b(p,'删除所选').click();await b(p,'取消').click();await b(p,'选择表情包：开心 <img onerror=evil()>').click();await b(p,'删除所选').click();await b(p,'确认删除').click();await wait(()=>b(p,'导入表情包').count(),'deleted library item');await b(p,'关闭附件面板').click();
  await p.reload();await b(p,'打开消息').click();await wait(()=>b(p,'打开聊天：好友甲').count(),'reload');await b(p,'打开聊天：好友甲').click();await wait(async()=>await p.locator('.message-sticker[src]').count()===2,'historical assets preserved');assert.equal(await b(p,'转账详情：8.88元，已收款').count(),1);
  mode='refund';await b(p,'让对方回复').click();await wait(()=>b(p,'转账详情：3.33元，待收款').count(),'new transfer for refund');await b(p,'转账详情：3.33元，待收款').click();await b(p,'确认退回').click();await wait(()=>b(p,'转账详情：3.33元，已退回').count(),'refund saved');await b(p,'转账详情：3.33元，已退回').click();assert.equal(await p.locator('.receipt-state').textContent(),'你已退回');assert.equal(await b(p,'确认收款').count(),0);assert.equal(await b(p,'确认退回').count(),0);await b(p,'关闭附件面板').click();
  const assetsResult=await p.evaluate(async data=>{
    const {createStickerLibrary,readSticker,fetchSticker,STICKER_DB}=await import('/modules/stickers.js');
    const a=createStickerLibrary(window,'isolated-A'),other=createStickerLibrary(window,'isolated-B');const failures=[];
    const fail=async(fn,label)=>{try{await fn();failures.push(label);}catch{}};
    const gif=Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0));
    const gifData=await readSticker(new Blob([gif],{type:'image/gif'}),window);
    const asset={data:gifData,description:'GIF',category:'动图',allowedAI:false};await a.addBatch([asset]);
    const hidden=(await a.list())[0];await a.update(hidden.id,{hidden:true});
    await fail(()=>readSticker(new Blob(['<svg onload=evil()>'],{type:'image/svg+xml'}),window),'SVG accepted');
    await fail(()=>readSticker(new Blob(['not image'],{type:'image/png'}),window),'bad decode');
    await fail(()=>readSticker(new Blob([new Uint8Array(2097153)],{type:'image/png'}),window),'oversize');
    const abort=new AbortController();abort.abort();await fail(()=>a.addBatch([asset],abort.signal),'aborted write');
    await fail(()=>a.addBatch([asset,{...asset,description:''}]),'partial invalid batch');
    const requested=[];const fake={FileReader,Image,Blob,fetch:async(url,options)=>{requested.push(options);return new Response(Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});}};
    await fetchSticker('https://image.fixture.test/one.png',fake);
    await fail(()=>fetchSticker('javascript:alert(1)',fake),'unsafe URL');
    await fail(()=>fetchSticker('https://image.fixture.test/huge', {...fake,fetch:async()=>new Response('x',{headers:{'Content-Type':'image/png','Content-Length':'2097153'}})}),'huge remote');
    // Fill another account to verify capacity rejection leaves its complete history intact.
    const full=createStickerLibrary(window,'capacity');for(let i=0;i<10;i++)await full.addBatch(Array.from({length:12},()=>asset));await fail(()=>full.addBatch([asset]),'capacity');
    const corrupt=createStickerLibrary(window,'corrupt');await corrupt.addBatch([asset]);const [c]=await corrupt.list();
    await new Promise((resolve,reject)=>{const r=indexedDB.open(STICKER_DB,2);r.onsuccess=()=>{const db=r.result,tx=db.transaction('assets','readwrite');tx.objectStore('assets').put({...c,data:'javascript:evil()'});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};});
    await fail(()=>corrupt.list(),'corrupt read');await fail(()=>corrupt.addBatch([asset]),'corrupt overwrite');
    return {failures,own:(await a.list()).length,other:(await other.list()).length,capacity:(await full.list()).length,gifPreserved:(await a.get(hidden.id)).data===gifData,request:requested[0]};
  },data);
  assert.deepEqual(assetsResult.failures,[]);assert.equal(assetsResult.own,1);assert.equal(assetsResult.other,0);assert.equal(assetsResult.capacity,120);assert(assetsResult.gifPreserved);assert.equal(assetsResult.request.credentials,'omit');assert.equal(assetsResult.request.redirect,'error');
  const groupsResult=await p.evaluate(async data=>{
    const {createStickerLibrary,STICKER_DB}=await import('/modules/stickers.js');
    const {FAVORITES,parseStickerLines}=await import('/modules/sticker-groups.js');
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(STICKER_DB,2);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
    const upgrade=await createStickerLibrary(window,'upgrade-account').snapshot();if(upgrade.assets[0].description!=='旧升级图片'||!upgrade.permissionReview||upgrade.categories[0].bindings.length)throw Error('v1 upgrade failed');
    const old={version:1,id:'legacy',key:'legacy-account:legacy',account:'legacy-account',data,description:'旧图',category:'旧分类',hidden:false,allowedAI:true};
    await new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').put(old);tx.oncomplete=resolve;tx.onerror=reject;});db.close();
    const lib=createStickerLibrary(window,'legacy-account'),first=await lib.snapshot(),again=await lib.snapshot(),failures=[];
    const check=(v,label)=>{if(!v)failures.push(label);};const fail=async(fn,label)=>{try{await fn();failures.push(label);}catch{}};
    check(first.categories.length===2&&JSON.stringify(first)===JSON.stringify(again),'idempotent upgrade');check(first.permissionReview,'legacy permission review');check((await lib.available('save-A','person-A')).length===0,'legacy broad permission not granted');
    const cat=first.categories.find(c=>c.name==='旧分类');let saved=await lib.saveCategory(cat.id,'专用',[{archiveId:'save-A',personId:'person-A'},{archiveId:'save-B',personId:'person-B'}],first.revision);
    check((await lib.available('save-A','person-A')).length===1,'owner permission');check((await lib.available('save-B','person-A')).length===0,'archive isolation');check((await lib.available('save-A','person-B')).length===0,'person isolation');
    await fail(()=>lib.saveCategory(cat.id,'stale',[],first.revision),'stale write');
    const canceled=new AbortController();canceled.abort();await fail(()=>lib.removeCategory(cat.id,saved.revision,canceled.signal),'aborted delete');
    saved=await lib.saveCategory(cat.id,'更名',cat.bindings=[{archiveId:'save-A',personId:'person-A'}],saved.revision);check(saved.categories.find(c=>c.id===cat.id).name==='更名','same category ID');check((await lib.available('save-A','person-A')).length===1,'rename retains grants');
    await fail(()=>lib.removeCategory(FAVORITES,saved.revision),'favorites removed');await fail(()=>lib.saveCategory(FAVORITES,'改名',[],saved.revision),'favorites renamed');
    saved=await lib.addBatch([{data,description:'新图',category:'收藏',allowedAI:false}],undefined,{categoryId:cat.id,revision:saved.revision});check(saved.assets.filter(a=>a.categoryId===cat.id).length===2,'add to category');
    await fail(()=>lib.removeBatch(['legacy','missing'],saved.revision),'partial delete');check(!(await lib.get('legacy')).hidden,'atomic delete failure');
    saved=await lib.removeCategory(cat.id,saved.revision);check(saved.assets.every(a=>a.hidden),'category delete hides whole group');check((await lib.get('legacy')).data===data,'historical image retained');check((await lib.available('save-A','person-A')).length===0,'deleted category unavailable');
    const raw=await new Promise((resolve,reject)=>{const r=indexedDB.open(STICKER_DB,2);r.onsuccess=()=>{const d=r.result,tx=d.transaction('categories','readonly'),q=tx.objectStore('categories').get('legacy-account');q.onsuccess=()=>{resolve(q.result);d.close();};q.onerror=reject;};r.onerror=reject;});check(raw.legacyBackup[0].allowedAI===true&&raw.legacyBackup[0].category==='旧分类','legacy metadata backup');
    const bad=createStickerLibrary(window,'bad-groups');await bad.addBatch([{data,description:'x',category:'收藏',allowedAI:false}]);
    await new Promise((resolve,reject)=>{const r=indexedDB.open(STICKER_DB,2);r.onsuccess=()=>{const d=r.result,tx=d.transaction('categories','readwrite');tx.objectStore('categories').put({account:'bad-groups',version:99});tx.oncomplete=()=>{d.close();resolve();};tx.onerror=reject;};});await fail(()=>bad.snapshot(),'bad groups read');await fail(()=>bad.addBatch([{data,description:'x',category:'收藏',allowedAI:false}]),'bad groups overwrite');
    return failures;
  },data);assert.deepEqual(groupsResult,[]);
  const before=await histories(p,tt);mode='delay';await p.waitForTimeout(850);await b(p,'让对方回复').click();await wait(()=>requests.length===4,'switch request');await p.evaluate(()=>profileMock.switch('0','second-chat'));release();await wait(()=>b(p,'登记人物').count(),'switched archive');assert.equal(await p.locator('.contact-row').count(),0);assert.deepEqual(await histories(p,tt),before);
  await p.evaluate(()=>profileMock.switch('1','different-card'));await wait(()=>b(p,'登记人物').count(),'different card');assert.equal(await p.locator('.contact-row').count(),0);assert.equal(await p.evaluate(()=>localStorage.getItem('tavern_friends_old')),'UNCHANGED');
  assert.deepEqual(errors,[]);console.log(`PASS ${tt?'TT':'ST'} attachments: gray UI, validation, preserved draft, local import/library, safe text, own and AI stickers/transfers, receipt/retry atomicity, refresh, hidden asset history, other friends/archives, cancelled AI, old storage unchanged`);await context.close();
 }
}finally{await browser.close();server.close();}
