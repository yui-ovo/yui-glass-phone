import test from 'node:test';
import assert from 'node:assert/strict';
import {newBook,newPerson,validateBook} from '../modules/contacts.js';
import {friendPrompt,scanFriendEvents,sourceCurrent,applyFriendEvent,manualFriendAction} from '../modules/friends.js';
import {createFriendBridge,FRIEND_PROMPT_KEY} from '../modules/friend-bridge.js';
import {supplementFixture} from './supplement-fixture.mjs';
const fixture=()=>{const book=newBook(),p=newPerson(undefined,'角色甲'),other=newPerson(undefined,'不参与');p.friendLinkEnabled=true;book.people.push(p,other);return {book,p,other};};
const event=(b,p,type,extra={})=>({id:crypto.randomUUID(),archiveId:b.id,personId:p.id,type,account:['share_self','request_incoming'].includes(type)?b.self.account:p.account,note:'剧情明确发生',...extra});
const marker=e=>'<!-- yui-friend '+JSON.stringify(e)+' -->';
async function item(b,e){const source={is_user:false,mes:'<content>剧情证据</content>\n'+marker(e)},r=await scanFriendEvents({crypto},b,[source]);return r.events[0];}
test('fixed accounts and opt-in remain compatible, constrain pending account edits and keep unselected people out of prompt',()=>{
 const {book,p,other}=fixture();assert.equal(validateBook(book),book);const prompt=friendPrompt(book);assert(prompt.includes(p.account));assert(prompt.includes(book.self.account));assert(!prompt.includes(other.account));p.friendLinkEnabled=false;assert.equal(friendPrompt(book),'');p.friendLinkEnabled=true;
 const pending=manualFriendAction(book,p.id,'request','你好');assert(!pending.people[0].relation.friend);assert.equal(book.people[0].friendRequest,undefined);assert.throws(()=>validateBook({...pending,self:{...pending.self,account:'new_account'}}));assert.throws(()=>manualFriendAction(pending,p.id,'request'));
 pending.people[0].account='new_account';assert.throws(()=>validateBook(pending));
});
test('keywords, user/system floors and fenced examples do not propose events; invalid identities/duplicates do not apply',async()=>{
 const {book,p}=fixture(),e=event(book,p,'met');
 let result=await scanFriendEvents({crypto},book,[{is_user:false,mes:'我不想加他微信。'}, {is_user:true,mes:marker(e)},{is_user:false,is_system:true,mes:marker(e)},{is_user:false,mes:'```\n'+marker(e)+'\n```'}]);assert.equal(result.events.length,0);
 result=await scanFriendEvents({crypto},book,[{is_user:false,mes:[marker({...e,archiveId:'other'}),marker({...e,account:'wrong_account'}),marker({...e,personId:'missing'})].join('\n')}]);assert.equal(result.events.length,0);assert(result.warnings.length);
 result=await scanFriendEvents({crypto},book,[{is_user:false,mes:marker(e)+'\n'+marker({...e,note:'不同'})}]);assert.equal(result.events.length,0);assert(result.warnings.length);
});
test('sharing either account does not create friendship; proposals and ignores do not mutate source',async()=>{
 const {book,p}=fixture();const a=await item(book,event(book,p,'share_character'));assert.equal(book.people[0].relation.accountKnown,false);let next=applyFriendEvent(book,a);assert(next.people[0].relation.accountKnown);assert(!next.people[0].relation.friend);assert.equal(next.people[0].knowsSelfAccount,undefined);
 next=applyFriendEvent(next,await item(next,event(next,p,'share_self')));assert(next.people[0].knowsSelfAccount);assert(!next.people[0].relation.friend);const ignored=applyFriendEvent(book,a,true);assert.deepEqual(ignored.people[0].relation,book.people[0].relation);assert.equal((await scanFriendEvents({crypto},ignored,[a.source])).events.length,0);assert.deepEqual(applyFriendEvent(next,a),next);
});
test('request confirmation and later acceptance are separate, rejection does not befriend',async()=>{
 const {book,p}=fixture();let next=applyFriendEvent(book,await item(book,event(book,p,'request_incoming')));assert.equal(next.people[0].friendRequest.direction,'incoming');assert(!next.people[0].relation.friend);next=manualFriendAction(next,p.id,'accept');assert(next.people[0].relation.friend);assert.equal(next.people[0].friendRequest,undefined);
 const outgoing=manualFriendAction(book,p.id,'request','我是同学');const rejected=applyFriendEvent(outgoing,await item(outgoing,event(outgoing,p,'declined')));assert(!rejected.people[0].relation.friend);assert.equal(rejected.people[0].friendRequest,undefined);assert.equal(rejected.people[0].friendOutcome.status,'declined');assert(friendPrompt(rejected).includes('"status":"declined"'));
 const accepted=applyFriendEvent(outgoing,await item(outgoing,event(outgoing,p,'accepted')));assert(accepted.people[0].relation.friend);assert.throws(()=>applyFriendEvent(book,{event:event(book,p,'accepted'),key:'a'.repeat(64)}));
});
test('source edit, deletion and swipe invalidate confirmation; reviewed event stays deduplicated after moving floors',async()=>{
 const {book,p}=fixture(),a=await item(book,event(book,p,'met'));assert(sourceCurrent([a.source],a));a.source.swipe_id=1;assert(!sourceCurrent([a.source],a));a.source.swipe_id=undefined;a.source.mes='删除了标记';assert(!sourceCurrent([a.source],a));assert(!sourceCurrent([],a));
 const next=applyFriendEvent(book,a,true),r=await scanFriendEvents({crypto},next,[{is_user:false,mes:'更早楼层'},{is_user:false,mes:a.marker}]);assert.equal(r.events.length,0);
});
for(const tt of [false,true])test(`${tt?'TT':'ST'} prompt lifecycle respects opt-in, generation type, archive switch and no body writes`,async()=>{
 const f=supplementFixture(tt);f.profiles.valid=()=>true;f.ctx.setExtensionPrompt=(key,value,position,depth,scan,role)=>{f.ctx.extensionPrompts[key]={value,position,depth,scan,role};};
 const b=createFriendBridge(f.win,f.profiles);await f.emit('GENERATION_AFTER_COMMANDS','normal');assert.equal(f.ctx.extensionPrompts[FRIEND_PROMPT_KEY],undefined);f.book.people[0].friendLinkEnabled=true;
 await f.emit('GENERATION_AFTER_COMMANDS','normal');assert(f.ctx.extensionPrompts[FRIEND_PROMPT_KEY].value.includes(f.book.self.account));assert.equal(f.ctx.extensionPrompts[FRIEND_PROMPT_KEY].position,1);assert.equal(f.state.writes,0);
 await f.emit('GENERATION_AFTER_COMMANDS','quiet');assert.equal(f.ctx.extensionPrompts[FRIEND_PROMPT_KEY],undefined);await f.emit('GENERATION_AFTER_COMMANDS','normal',{},true);assert.equal(f.ctx.extensionPrompts[FRIEND_PROMPT_KEY],undefined);
 let resolve;f.setPause(new Promise(r=>resolve=r));const late=f.emit('GENERATION_AFTER_COMMANDS','normal');await f.emit('CHAT_CHANGED');resolve();await late;assert.equal(f.ctx.extensionPrompts[FRIEND_PROMPT_KEY],undefined);assert.equal(f.state.writes,0);b.dispose();assert.equal(f.ctx.extensionPrompts.other.value,'keep');
});
