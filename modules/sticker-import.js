import { parseStickerLines } from './sticker-groups.js';

export function planStickerImport(files, descriptions, text) {
  if (typeof text !== 'string' || text.length > 128000) throw Error('链接文字过长，请分成两次导入');
  const items = files.map((file, i) => ({ kind:'file', file, description:descriptions[i]?.trim() || '', label:file.name, status:'pending' }));
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const item = { kind:'url', raw:raw.trim(), label:`第 ${i+1} 行`, status:'pending' };
    try { Object.assign(item, parseStickerLines(raw)[0]); }
    catch (e) { item.status='failed'; item.error=e.message; }
    items.push(item);
  });
  if (!items.length) throw Error('请先选择图片或粘贴链接');
  if (items.length > 500) throw Error(`识别到 ${items.length} 张，一次最多处理 500 张；素材库总容量仍为 120 张`);
  return { items, running:false, stopped:'', saved:0 };
}

export function importCounts(job) {
  return { total:job.items.length, saved:job.items.filter(i=>i.status==='saved').length,
    failed:job.items.filter(i=>i.status==='failed').length, pending:job.items.filter(i=>i.status==='pending').length };
}

// Commit at most twelve prepared images at a time. Completed batches stay saved;
// retry uses only the remaining items. The job belongs to the initiating draft.
export async function runStickerImport(job, { library, prepare, options, signal, onChange=()=>{} }) {
  if (job.running) return;
  job.running=true;
  try {
    let snapshot=await library.snapshot();
    if (signal.aborted) return;
    if (snapshot.revision !== options.revision) throw Error('素材库已变化，请重新读取后重试');
    let target={...options};
    for (let cursor=0;cursor<job.items.length;) {
      if (signal.aborted) return;
      const room=120-snapshot.assets.length;
      if (room<=0) throw Error('素材库已达 120 张上限，剩余图片未导入；历史图片也占容量');
      const batch=[],members=[];
      while(cursor<job.items.length && batch.length<Math.min(12,room)) {
        const item=job.items[cursor++]; if(item.status!=='pending')continue;
        onChange(job,`正在处理 ${cursor}/${job.items.length} 张`);
        try {
          if(item.kind==='file'&&!item.description)throw Error('请填写图片描述');
          const data=await prepare(item,signal); if(signal.aborted)return;
          batch.push({data,description:item.description||'表情包',category:'收藏',allowedAI:false});members.push(item);
        } catch(e) {
          if(signal.aborted)return;
          item.status='failed';item.error=e.message;onChange(job);
        }
      }
      if (!batch.length) continue;
      // Do not check abort between a confirmed transaction and recording its IDs.
      // Closing during commit must not put successfully saved images back in retry.
      snapshot=await library.addBatch(batch,signal,target);
      for(const item of members)item.status='saved';
      job.categoryId=target.categoryId || snapshot.categories.find(c=>c.name===target.newName.trim()).id;
      target={categoryId:job.categoryId,revision:snapshot.revision};
      onChange(job);
    }
  } catch(e) { if(!signal.aborted)job.stopped=e.message; }
  finally { job.running=false; if(signal.aborted)job.stopped='导入已停止'; onChange(job); }
}

export function remainingImport(job) {
  const remaining=job.items.filter(item=>item.status!=='saved');
  return { files:remaining.filter(i=>i.kind==='file').map(i=>i.file), fileDescriptions:remaining.filter(i=>i.kind==='file').map(i=>i.description),
    urls:remaining.filter(i=>i.kind==='url').map(i=>i.raw).join('\n') };
}
