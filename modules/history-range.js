import {forPerson,MAX_MESSAGES,MAX_TOTAL_TEXT} from './messages.js';
import {readConfig,defaultConfig} from './ai.js';
import {syncedIds} from './supplement.js';
export function historyRange(win,history,person){
  const messages=forPerson(history,person.id);let limit;try{limit=readConfig(win).historyCount;}catch{limit=defaultConfig().historyCount;}
  let known=new Set(history.storySyncedIds||[]);try{known=syncedIds(history,win.SillyTavern?.getContext()?.chat||[],history.archiveId);}catch{}
  const remaining=messages.filter(m=>!known.has(m.messageId)).length,totalChars=history.messages.reduce((n,m)=>n+m.text.length,0);
  return {shown:Math.min(messages.length,limit),omitted:Math.max(0,messages.length-limit),total:messages.length,pending:remaining,sharing:!!person.storyContext?.sharePhone,long:remaining>limit,nearCapacity:history.messages.length>=MAX_MESSAGES*.9||totalChars>=MAX_TOTAL_TEXT*.9,stored:history.messages.length,max:MAX_MESSAGES};
}
