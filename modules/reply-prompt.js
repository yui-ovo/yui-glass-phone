import { buildPrompt, replyContext, readConfig } from './ai.js';
import { ACTION_PROTOCOL, kindOf } from './rich-messages.js';
import { conversationId } from './messages.js';
import { createMessageStore } from './message-host.js';
import { createStickerLibrary } from './stickers.js';
export function assemblePhonePrompt(context,history,id,config,catalog,preset){
 const prompt=buildPrompt(context,history,id,config.historyCount,config.prompt,config.frontPrompt,preset);
 prompt.push({role:'system',content:ACTION_PROTOCOL});
 prompt.push({role:'user',content:JSON.stringify({availableStickers:catalog.map(({id,description,category})=>({id,description,category})),pendingTransfers:history.messages.filter(m=>m.conversationId===conversationId(id)&&kindOf(m)==='transfer'&&m.transfer.state==='pending'&&m.sender.kind==='self').map(m=>({messageId:m.messageId,...m.transfer}))})});
 if(JSON.stringify(prompt).length>180000)throw Error('参考内容过长，请减少条目、表情包授权或历史条数');return prompt;
}
export async function previewPhonePrompt(win,profiles,id,preset,signal){
 const session=await profiles.load(signal),person=session.book.people.find(p=>p.id===id&&p.relation.friend&&!p.deletedAt);
 if(!person)throw Error('请先选择当前存档的好友');
 const context=replyContext(win,session.book,person),history=await createMessageStore(win,profiles,session,signal).read();
 const catalog=win.indexedDB?await createStickerLibrary(win,session.account).available(session.book.id,id):[];
 profiles.assertSession(session,signal);return assemblePhonePrompt(context,history,id,readConfig(win),catalog,preset);
}
