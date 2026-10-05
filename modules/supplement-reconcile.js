import { clone,sameJson } from './contacts.js';
import { kindOf } from './rich-messages.js';
import { validateText,validateHistory,messagePersonId } from './messages.js';
import { supplementBlocks,entryStart,entryEnd,unplain,plain,digest,sourceValue,messageRow,formatSupplement,legacySupplement,makeReceipt,SUPPLEMENT_KEY } from './supplement.js';

export function applyReconciliation(history,{expectedRevision,changes=[],synced=[]}){
  if(history.revision!==expectedRevision)throw Error('手机消息已变化，请重新核对；未覆盖新内容');
  const next=clone(history),ids=new Set();
  for(const change of changes){
    if(ids.has(change.id))throw Error('同一条消息有多处修改，请先核对');ids.add(change.id);
    const m=next.messages.find(m=>m.messageId===change.id);if(!m||messagePersonId(m)!==change.personId)throw Error('补记与手机消息对应关系变化');
    if(change.text===null){next.messages=next.messages.filter(m=>m.messageId!==change.id);next.deletedMessageIds=[...new Set([...(next.deletedMessageIds||[]),change.id])];}
    else {if(kindOf(m)!=='text')throw Error('表情包和转账只能删除，请在手机内操作转账状态');validateText(change.text);m.text=change.text;m.editedAt=new Date().toISOString();}
  }
  next.storySyncedIds=[...new Set([...(next.storySyncedIds||[]),...synced])];
  if(sameJson(history,next))return history;
  next.version=Math.max(2,next.version);next.revision++;return validateHistory(next,history.archiveId);
}
function parseEntries(block){
  const receipt=block.receipt;
  if(!Array.isArray(receipt.entries)||receipt.entries.length>2000)throw Error('逐条补记索引损坏');
  const matches=[...block.text.matchAll(/<!-- yui-message:([a-f0-9-]{36}) -->\n([\s\S]*?)\n<!-- \/yui-message:\1 -->/g)],byId=new Map();
  for(const match of matches){if(byId.has(match[1]))throw Error('补记中消息标记重复');byId.set(match[1],match[2]);}
  const known=new Set(receipt.entries.map(e=>e.id));if(known.size!==receipt.entries.length||matches.some(m=>!known.has(m[1])))throw Error('补记中出现未知或重复消息标记');
  const outside=block.text.replace(/<!-- yui-message:([a-f0-9-]{36}) -->\n[\s\S]*?\n<!-- \/yui-message:\1 -->/g,'').replace(/\s+/g,' ').trim();
  if(outside!==formatSupplement(receipt.batchId,[]).replace(/\s+/g,' ').trim())throw Error('补记标记或说明被修改，请恢复标记，仅编辑“内容”下的文字');
  return byId;
}
export async function planFloor(win,book,history,message){
  const blocks=supplementBlocks(message),changes=[],seen=new Set(),synced=[],models=[];
  for(const block of blocks){
    const r=block.receipt;if(r.archiveId!==book.id)continue;synced.push(...r.sourceIds);
    if(r.version===1){
      if(await digest(win,block.text)!==r.hash)throw Error('旧版补记已修改，无法可靠识别逐条对应关系，请先恢复原内容');
      const rows=r.sourceIds.map(id=>history.messages.find(m=>m.messageId===id)).map(m=>m&&messageRow(book,history,m));
      if(rows.some(r=>!r)||legacySupplement(r.batchId,rows)!==block.text)throw Error('旧版补记与手机内容不同，无法自动升级，请先核对');
      models.push({block,ids:r.sourceIds});continue;
    }
    const parsed=parseEntries(block),headers=new Map();
    for(const e of r.entries){
      if(!r.sourceIds.includes(e.id)||seen.has(e.id)||!['text','sticker','transfer'].includes(e.type)||![e.sourceHash,e.textHash,e.headerHash].every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h)))throw Error('消息对应关系重复或损坏');seen.add(e.id);
      const m=history.messages.find(m=>m.messageId===e.id);if(m&&(messagePersonId(m)!==e.personId||kindOf(m)!==e.type))throw Error('消息身份或类型不符');
      if(!m&&!history.deletedMessageIds?.includes(e.id))throw Error('关联手机消息缺失，未自动删除正文');
      let text=null;
      if(parsed.has(e.id)){
        const part=parsed.get(e.id),divider='\n<!-- yui-content -->\n',at=part.indexOf(divider);if(at<0)throw Error('请保留补记的“内容：”标记');
        const header=part.slice(0,at+divider.length);if(await digest(win,header)!==e.headerHash)throw Error('补记的发送者、时间或引用被修改，请只编辑内容');
        headers.set(e.id,header);
        const raw=part.slice(at+divider.length);text=raw.trim()?unplain(raw):null;
      }
      const bodyChanged=text===null||await digest(win,text)!==e.textHash;
      const phoneChanged=!m||await digest(win,sourceValue(m))!==e.sourceHash;
      if(bodyChanged){
        if(phoneChanged){if((!m&&text===null)||(m&&kindOf(m)==='text'&&text===m.text))continue;throw Error('手机和正文同时修改了同一条消息，请将两边内容改成一致后重试');}
        if(m)changes.push({id:e.id,personId:e.personId,text});
      }
    }
    models.push({block,ids:r.sourceIds,headers});
  }
  const nextHistory=applyReconciliation(history,{expectedRevision:history.revision,changes,synced});
  const next=clone(message);let body=message.mes;
  for(const {block,ids,headers} of models){const rows=ids.map(id=>nextHistory.messages.find(m=>m.messageId===id)).filter(Boolean).map(m=>{const row=messageRow(book,nextHistory,m),old=headers?.get(m.messageId);if(old){const end=old.lastIndexOf('\n内容：\n'),prefix=old.slice(0,end),quoteAt=prefix.indexOf('\n引用：');row.header=(quoteAt<0?prefix:prefix.slice(0,quoteAt))+(row.quote?'\n引用：'+plain(row.quote):'')+old.slice(end);}return row;});
    const replacement=formatSupplement(block.receipt.batchId,rows);body=body.replace(block.text,()=>replacement);
    const index=next.extra[SUPPLEMENT_KEY].batches.findIndex(r=>r.batchId===block.receipt.batchId);
    next.extra[SUPPLEMENT_KEY].batches[index]=await makeReceipt(win,book.id,block.receipt.batchId,rows,ids);
  }
  next.mes=body;syncActiveSwipe(next);
  return {next,changes,synced,nextHistory,changed:!sameJson(next,message)||!sameJson(nextHistory,history)};
}
export function syncActiveSwipe(message){
  if(Array.isArray(message.swipes)){message.swipes[message.swipe_id]=message.mes;message.swipe_info||=[];message.swipe_info[message.swipe_id]={...(message.swipe_info[message.swipe_id]||{}),extra:clone(message.extra)};}
}
