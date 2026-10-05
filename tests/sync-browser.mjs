import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const engines=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));await mkdir(path.join(root,'test-results'),{recursive:true});
const server=createServer(async(req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://test').pathname);if(!file.startsWith(root)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'text/plain');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await engines[process.env.BROWSER_ENGINE||'chromium'].launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const b=(p,name)=>p.getByRole('button',{name,exact:true});
const wait=async(fn,label)=>{for(let i=0;i<240;i++){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout '+label);};
const settle=async p=>{await wait(()=>p.evaluate(async()=>!(await import('/modules/sync-events.js')).phoneSyncStatus(window).busy),'sync finished');await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
try{for(const tt of [false,true]){
 const context=await browser.newContext({viewport:{width:393,height:740}}),p=await context.newPage(),errors=[];p.setDefaultTimeout(8000);p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript({content:await readFile(path.join(root,'tests/profile-mock.js'),'utf8')});if(tt)await p.addInitScript({content:await readFile(path.join(root,'tests/tt-mock.js'),'utf8')});else await p.route('**/api/users/me',r=>r.fulfill({json:{handle:'test-user'}}));await p.addInitScript({content:await readFile(path.join(root,'tests/sync-mock.js'),'utf8')});
 await p.goto(base+'/preview.html');
 await p.evaluate(async()=>{
  const {createProfileHost}=await import('/modules/host.js'),{newPerson,defaultStoryPolicy}=await import('/modules/contacts.js'),{createMessageStore}=await import('/modules/message-host.js'),{createMessage}=await import('/modules/messages.js');
  const host=createProfileHost(window),signal=new AbortController().signal,session=await host.load(signal),person=newPerson(undefined,'测试好友');person.relation={known:true,accountKnown:true,friend:true};person.storyContext={...defaultStoryPolicy(),sharePhone:true,phoneCount:200};const book=structuredClone(session.book);book.people.push(person);book.storySync={enabled:true,excludedIds:[]};await host.save(session,book,signal);const store=createMessageStore(window,host,session,signal);
  for(let i=0;i<55;i++){const h=await store.read();await store.send(createMessage(book.id,person.id,`第${i}条`,i+1),h.revision);}host.dispose();
 });
 await p.reload();await b(p,'打开消息').click();await b(p,'打开聊天：测试好友').click();await wait(()=>p.locator('.real-messages [data-message-id]').count(),'history');assert.equal(await p.locator('.real-messages [data-message-id]').count(),50);assert.equal(await p.locator('.real-messages').getByText('第0条',{exact:true}).count(),0);
 await p.locator('.chat-history-info summary').click();assert((await p.locator('.chat-history-info').textContent()).includes('较早 15 条'));assert((await p.locator('.chat-history-info').textContent()).includes('总结状态未确认'));await b(p,'查看更早消息（还有 5 条）').click();assert.equal(await p.locator('.real-messages [data-message-id]').count(),55);
 await p.evaluate(()=>profileMock.emit('GENERATION_AFTER_COMMANDS','normal'));assert((await p.evaluate(()=>profileMock.story[0].mes)).includes('第54条'));
 await p.evaluate(async()=>{const m=profileMock.story[0];m.mes=m.mes.replace('\n第54条\n','\n楼层小铅笔修改\n');await profileMock.emit('MESSAGE_UPDATED',0);});await wait(()=>p.locator('.real-messages').getByText('楼层小铅笔修改',{exact:true}).count(),'pencil sync');
 const bubble=p.locator('.real-messages .sp-message-bubble-cv2').filter({hasText:'楼层小铅笔修改'});await bubble.scrollIntoViewIfNeeded();await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await bubble.dispatchEvent('contextmenu');await b(p,'编辑').click();await p.getByLabel('编辑消息内容',{exact:true}).fill('手机修改后');await b(p,'保存消息修改').click();await wait(async()=>(await p.evaluate(()=>profileMock.story[0].mes)).includes('手机修改后'),'phone edit sync');
 await settle(p);const edited=p.locator('.real-messages .sp-message-bubble-cv2').filter({hasText:'手机修改后'});await edited.scrollIntoViewIfNeeded();await settle(p);await edited.dispatchEvent('contextmenu');await b(p,'删除').click();await b(p,'确认删除消息').click();await wait(async()=>!(await p.evaluate(()=>profileMock.story[0].mes)).includes('手机修改后'),'phone delete sync');assert.equal(await p.locator('.real-messages').getByText('手机修改后',{exact:true}).count(),0);
 await p.evaluate(async()=>{const {supplementBlocks,entryStart,entryEnd}=await import('/modules/supplement.js');const m=profileMock.story[0],r=supplementBlocks(m)[0].receipt,id=r.entries.at(-1).id;const a=m.mes.indexOf(entryStart(id)),z=m.mes.indexOf(entryEnd(id));m.mes=m.mes.slice(0,a)+m.mes.slice(z+entryEnd(id).length);await profileMock.emit('MESSAGE_UPDATED',0);});await wait(async()=>await p.locator('.real-messages [data-message-id]').count()===53,'pencil deletion');
 await p.reload();await b(p,'打开消息').click();await b(p,'打开聊天：测试好友').click();await wait(()=>p.locator('.real-messages [data-message-id]').count(),'reload');assert.equal(await p.locator('.real-messages [data-message-id]').count(),50);assert(!(await p.locator('.real-messages').textContent()).includes('手机修改后'));
 await p.setViewportSize({width:320,height:540});if(tt)await p.evaluate(()=>ttMock.emitLayout({version:1,safeFrame:{left:0,top:24,width:320,height:516},ime:{keyboardOffset:0}}));await p.locator('.real-messages').evaluate(e=>e.scrollTop=0);assert(await p.locator('.real-messages').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await p.screenshot({path:path.join(root,`test-results/sync-${tt?'tt':'st'}-${process.env.BROWSER_ENGINE||'chromium'}.png`)});
 assert.deepEqual(errors,[]);console.log(`PASS ${tt?'TT':'ST'} 50-message display, load older, context range, both-direction pencil/phone edits and deletes, reload persistence, 320px`);await context.close();
}}finally{await browser.close();server.close();}
