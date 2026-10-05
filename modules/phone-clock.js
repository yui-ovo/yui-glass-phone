export const defaultClockSettings = () => ({ mode:'story', manual:null });
export function validateClockSettings(value) {
  if (!value || !['story','device'].includes(value.mode) || (value.manual !== null && (!value.manual || !['date','time','weekday','anchor'].every(k=>typeof value.manual[k]==='string' && value.manual[k].length<=500)))) throw Error('剧情时间设置无效');
  if(value.manual && /^(\d{1,2})[:：](\d{2})$/.test(value.manual.time)){const [hour,minute]=value.manual.time.split(/[:：]/).map(Number);if(hour>23||minute>59)throw Error('剧情时间超出范围');}
  return value;
}
const known = value => value && !/^(未知|未明确|未明|不详)$/.test(value);
function fields(raw) {
  const field = name => new RegExp(`(?:^|[|｜,，;；\\n])\\s*(?:${name})\\s*[=＝:]\\s*([^|｜,，;；\\n]+)`,'iu').exec(raw)?.[1]?.trim() || '';
  const value={date:field('date'),time:field('time'),weekday:field('weekday|星期')};
  if (Object.values(value).some(v=>v.length>200)) return null;
  const numeric=/^(\d{1,2})[:：](\d{2})$/.exec(value.time);
  if (numeric && (Number(numeric[1])>23 || Number(numeric[2])>59)) return null;
  if (!known(value.date) && !known(value.time)) return null;
  return {date:known(value.date)?value.date:'',time:known(value.time)?value.time:'',weekday:known(value.weekday)?value.weekday:''};
}
export function parseStoryTime(raw) {
  if(typeof raw!=='string')return null;
  const values=new Map();
  for(const m of raw.matchAll(/<!--\s*(QQJ|SDC|myknots)-end\s+([\s\S]*?)-->/gi))values.set(m[1].toLowerCase(),fields(m[2]));
  const usable=[...values.values()].filter(Boolean);
  if (!usable.length)return null;
  if (usable.some(v=>JSON.stringify(v)!==JSON.stringify(usable[0])))return {ambiguous:true};
  return usable[0];
}
export const selectedBody = m => Array.isArray(m?.swipes) && Number.isInteger(m.swipe_id) ? m.swipes[m.swipe_id] : m?.mes;
function anchor(text,index) { text=text.replace(/<yui_phone>[\s\S]*?<\/yui_phone>/g,'').trimEnd();let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return `${index}:${text.length}:${hash>>>0}`; }
export function storyTime(win,book) {
  const config=validateClockSettings(book?.phoneClock || defaultClockSettings());
  if(config.mode==='device')return undefined;
  const unknown={source:'story',status:'unknown',date:'',time:'',weekday:'',text:'剧情时间未明确',anchor:''};
  let chat;try{chat=win.SillyTavern?.getContext()?.chat;}catch{return unknown;}
  if(!Array.isArray(chat))return unknown;
  let latest=-1,latestAnchor='';
  for(let i=chat.length-1;i>=0;i--){const m=chat[i];if(!m)continue;if(m.is_user!==false||m.role==='tool'||m.extra?.tool_invocations||m.isPhoneMessage||m.isGaigaiPrompt||m.isGaigaiData)continue;latest=i;latestAnchor=anchor(String(selectedBody(m)||''),i);break;}
  if(config.manual && config.manual.anchor===latestAnchor){const {date,time,weekday}=config.manual;return {source:'story',status:'manual',date,time,weekday,anchor:latestAnchor,text:[date,weekday,time].filter(Boolean).join(' ')||'剧情时间未明确'};}
  for(let i=latest;i>=0;i--){const m=chat[i];if(!m||m.is_user!==false||m.role==='tool'||m.extra?.tool_invocations||m.isPhoneMessage||m.isGaigaiPrompt||m.isGaigaiData)continue;const parsed=parseStoryTime(selectedBody(m));if(parsed?.ambiguous)return {...unknown,status:'ambiguous',anchor:latestAnchor,text:'剧情时间标记冲突，请手动校正'};if(parsed)return {source:'story',status:i===latest?'current':'carried',...parsed,anchor:latestAnchor,messageIndex:i,text:[parsed.date,parsed.weekday,parsed.time].filter(Boolean).join(' ')};}
  return {...unknown,anchor:latestAnchor};
}
export function clockDisplay(win,book) {
  const value=storyTime(win,book);
  if(!value){const now=new Date();return {time:now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}),date:now.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'}),note:'设备时间'};}
  return {time:value.time||'--:--',date:[value.date,value.weekday].filter(Boolean).join(' ')||'剧情时间未明确',note:({manual:'手动校正 · 新正文出现后自动同步',carried:'沿用上次剧情时间',ambiguous:'剧情时间标记冲突',unknown:'剧情时间未明确',current:'剧情时间'})[value.status]};
}
export function stampStoryTime(win,book,message) {const value=storyTime(win,book);if(value)message.storyTime=value;return message;}
