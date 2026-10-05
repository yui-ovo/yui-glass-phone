import test from 'node:test';
import assert from 'node:assert/strict';
import {planStickerImport,runStickerImport,importCounts,remainingImport} from '../modules/sticker-import.js';
const lines=n=>Array.from({length:n},(_,i)=>`图${i}:https://image.test/${i}.png`).join('\n');
function fixture(){let revision=0;const assets=[],sizes=[];let failure=false;return {assets,sizes,set fail(v){failure=v;},snapshot:async()=>({revision,assets:[...assets],categories:[{id:'cat',name:'新分类'}]}),addBatch:async(items,signal,options)=>{if(failure)throw Error('quota');assert.equal(options.revision,revision);assert(items.length<=12);if(signal.aborted)throw Error('abort');sizes.push(items.length);assets.push(...items);revision++;return {revision,assets:[...assets],categories:[{id:'cat',name:'新分类'}]};}};}
const args=(lib,controller=new AbortController())=>({library:lib,prepare:async i=>i.url||i.file.name,options:{revision:0,newName:'新分类'},signal:controller.signal});
test('whole import splits 29 images into 12/12/5 and rejects rapid duplicate execution',async()=>{
 const lib=fixture(),job=planStickerImport([],[],lines(29)),a=args(lib);await Promise.all([runStickerImport(job,a),runStickerImport(job,a)]);assert.deepEqual(lib.sizes,[12,12,5]);assert.deepEqual(importCounts(job),{total:29,saved:29,failed:0,pending:0});assert.deepEqual(remainingImport(job),{files:[],fileDescriptions:[],urls:''});assert.equal(job.categoryId,'cat');
});
test('invalid lines and image failures are reported individually; retry has no previously saved items',async()=>{
 const lib=fixture(),job=planStickerImport([{name:'bad.gif'}],['坏图'],lines(14)+'\n不是链接');const a=args(lib);a.prepare=async item=>{if(item.kind==='file')throw Error('解码失败');return item.url;};await runStickerImport(job,a);assert.deepEqual(importCounts(job),{total:16,saved:14,failed:2,pending:0});const rest=remainingImport(job);assert.equal(rest.files.length,1);assert.equal(rest.urls,'不是链接');assert(job.items.some(i=>i.error==='解码失败'));
 const retry=planStickerImport(rest.files,rest.fileDescriptions,'已修正:https://image.test/fix.png');await runStickerImport(retry,{...args(lib),options:{revision:2,categoryId:'cat'}});assert.equal(lib.assets.length,16);assert.deepEqual(lib.sizes,[12,2,2]);
});
test('storage failure stops later batches and retry saves only the remainder',async()=>{
 const lib=fixture(),job=planStickerImport([],[],lines(25));const a=args(lib);a.onChange=()=>{if(importCounts(job).saved===12)lib.fail=true;};await runStickerImport(job,a);assert.equal(job.stopped,'quota');assert.equal(lib.assets.length,12);const rest=remainingImport(job);assert.equal(rest.urls.split('\n').length,13);lib.fail=false;await runStickerImport(planStickerImport([],[],rest.urls),{...args(lib),options:{revision:1,categoryId:'cat'}});assert.equal(lib.assets.length,25);
});
test('close during confirmed commit retains saved batch and does not start another',async()=>{
 const lib=fixture(),controller=new AbortController(),commit=lib.addBatch;lib.addBatch=async(...a)=>{const result=await commit(...a);controller.abort();return result;};const job=planStickerImport([],[],lines(25));await runStickerImport(job,args(lib,controller));assert.equal(importCounts(job).saved,12);assert.equal(importCounts(job).pending,13);assert.equal(job.stopped,'导入已停止');assert.equal(lib.sizes.length,1);
});
test('preparation cancellation, revision conflicts and remaining capacity keep uncommitted inputs',async()=>{
 const lib=fixture(),controller=new AbortController(),job=planStickerImport([],[],lines(15));await runStickerImport(job,{...args(lib,controller),prepare:async()=>{controller.abort();return 'image';}});assert.equal(lib.assets.length,0);assert.equal(importCounts(job).pending,15);
 const conflict=planStickerImport([],[],lines(2));await runStickerImport(conflict,{...args(lib),options:{revision:99,categoryId:'cat'}});assert(conflict.stopped.includes('变化'));assert.equal(lib.assets.length,0);
 lib.assets.push(...Array(119).fill({data:'old'}));const full=planStickerImport([],[],lines(3));await runStickerImport(full,args(lib));assert.equal(lib.assets.length,120);assert.equal(importCounts(full).saved,1);assert.equal(importCounts(full).pending,2);assert(full.stopped.includes('120'));
});
