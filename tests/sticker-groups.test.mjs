import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateGroups,validateGroups,usableBy,parseStickerLines,FAVORITES} from '../modules/sticker-groups.js';
test('legacy categories migrate once with stable assignments, backup and no broadened AI access',()=>{
 const a=[{id:'1',category:'心情',allowedAI:true,hidden:false},{id:'2',category:'心情',allowedAI:false,hidden:false},{id:'3',category:'收藏',allowedAI:false,hidden:false}];let i=0;const d=migrateGroups('a',a,()=>String(++i));assert.equal(d.categories.length,2);assert.equal(d.assignments['1'],d.assignments['2']);assert.equal(d.assignments['3'],FAVORITES);assert(d.permissionReview);assert.equal(d.legacyBackup[0].allowedAI,true);assert(d.categories.every(c=>!c.bindings.length));assert.equal(validateGroups(d,'a',a),d);
});
test('category grants use archive and person IDs, and hide blocks sending',()=>{
 const a={categoryId:'cat',hidden:false},c=[{id:'cat',bindings:[{archiveId:'save-A',personId:'id-A'}]}];assert(usableBy(a,c,'save-A','id-A'));assert(!usableBy(a,c,'save-B','id-A'));assert(!usableBy(a,c,'save-A','id-B'));assert(!usableBy({...a,hidden:true},c,'save-A','id-A'));assert(!usableBy(a,[{...c[0],bindings:[]}],'save-A','id-A'));
});
test('batch links retain per-picture descriptions, spaces and URL colons; reject unsafe input',()=>{
 assert.deepEqual(parseStickerLines('开心 点头:https://x.test/a.png\n晚安：https://x.test/b.gif?q=a:b'),[{description:'开心 点头',url:'https://x.test/a.png'},{description:'晚安',url:'https://x.test/b.gif?q=a:b'}]);assert.equal(parseStickerLines('https://x.test/a')[0].description,'');for(const s of ['x:javascript:evil()','x:https://user:pass@x.test/a','description only'])assert.throws(()=>parseStickerLines(s));
});
test('corruption, duplicate categories and unmatched old-window assets stop writes',()=>{
 const a=[{id:'1',category:'收藏',allowedAI:false,hidden:false}],d=migrateGroups('a',a,()=> 'x');assert.throws(()=>validateGroups(d,'b',a));assert.throws(()=>validateGroups(d,'a',[...a,{id:'missing'}]));assert.throws(()=>validateGroups({...d,categories:[...d.categories,{id:'x',name:'收藏',bindings:[]}]},'a',a));
});
