import { clone, record, sameJson } from './contacts.js';
export const PRESETS_KEY='yui-glass-phone.presets.v1';
export const PRESETS_BACKUP_KEY=PRESETS_KEY+'.backup';
export const PRESET_STYLE='采用自然的手机聊天表达，少写旁白和动作描写。语气和回复长短符合人物性格，线上聊天习惯优先采用线上人设。';
export const FIXED_BLOCKS=[
 {key:'context',name:'人物与参考资料',description:'来源角色卡、线上人设、当前用户人设、勾选世界书及按人物开启的正文参考。'},
 {key:'history',name:'当前手机会话',description:'按 API 设置的条数读取当前好友的已保存消息。'},
 {key:'format',name:'回复与功能格式',description:'程序维护角色回复、表情包和交易状态规则；不能关闭、删除或移动。'}
];
const uuid=()=>crypto.randomUUID();
export const textBlock=(name='新条目',content='')=>({id:uuid(),type:'text',name,content,role:'system',enabled:true});
export const builtinPreset=()=>({id:'builtin',name:'Yui 默认',blocks:[{id:'builtin-style',type:'text',name:'聊天风格',content:PRESET_STYLE,role:'system',enabled:true}],unsupported:[],attribution:[]});
export function createLibrary(legacy={}){
 const library={version:1,revision:0,activeId:'builtin',presets:[builtinPreset()]};
 if(legacy.frontPrompt?.trim() || legacy.prompt && legacy.prompt!==PRESET_STYLE){const p={id:uuid(),name:'原有提示词',blocks:[],unsupported:[],attribution:[]};if(legacy.frontPrompt?.trim())p.blocks.push(textBlock('前置提示词',legacy.frontPrompt));p.blocks.push(textBlock('聊天风格',legacy.prompt||PRESET_STYLE));library.presets.push(p);library.activeId=p.id;}
 return library;
}
const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim());
export function validatePreset(p){
 if(!record(p)||!text(p.id,128,true)||!text(p.name,80,true)||!Array.isArray(p.blocks)||p.blocks.length>80||!Array.isArray(p.unsupported)||p.unsupported.length>100||!Array.isArray(p.attribution)||p.attribution.length>30)throw Error('预设格式不支持，未保存');
 const ids=new Set();let size=0;
 for(const b of p.blocks){if(!record(b)||!text(b.id,128,true)||ids.has(b.id)||b.type!=='text'||!text(b.name,100,true)||!text(b.content,12000)||!['system','user','assistant'].includes(b.role)||typeof b.enabled!=='boolean')throw Error('预设条目无效或 ID 重复');ids.add(b.id);size+=b.content.length;}
 if(size>100000||p.unsupported.some(x=>!text(x,500))||p.attribution.some(x=>!text(x,300)))throw Error('预设内容过长');
 return p;
}
export function validateLibrary(l){
 if(!record(l)||l.version!==1||!Number.isSafeInteger(l.revision)||l.revision<0||!Array.isArray(l.presets)||!l.presets.length||l.presets.length>30)throw Error('预设库格式不支持，原数据保留');
 const ids=new Set();for(const p of l.presets){validatePreset(p);if(ids.has(p.id))throw Error('预设 ID 重复');ids.add(p.id);}
 if(!sameJson(l.presets.find(p=>p.id==='builtin'),builtinPreset())||!ids.has(l.activeId)||JSON.stringify(l).length>1000000)throw Error('固定预设、当前选择或容量无效');return l;
}
export function readPresets(win,legacy={}){
 const raw=win.localStorage.getItem(PRESETS_KEY);if(raw===null)return {raw,library:createLibrary(legacy)};
 let library;try{library=JSON.parse(raw);}catch{throw Error('预设库损坏，已停止读取和覆盖');}return {raw,library:validateLibrary(library)};
}
export function selectedPreset(l){validateLibrary(l);return l.presets.find(p=>p.id===l.activeId);}
export function savePresets(win,library,expectedRaw){
 validateLibrary(library);if(win.localStorage.getItem(PRESETS_KEY)!==expectedRaw)throw Error('预设已被其他窗口修改，请重新打开后再编辑');
 const next=clone(library);next.revision++;
 try{
  if(expectedRaw!==null){win.localStorage.setItem(PRESETS_BACKUP_KEY,expectedRaw);if(win.localStorage.getItem(PRESETS_BACKUP_KEY)!==expectedRaw)throw Error();}
  const raw=JSON.stringify(next);win.localStorage.setItem(PRESETS_KEY,raw);if(win.localStorage.getItem(PRESETS_KEY)!==raw)throw Error();return {raw,library:next};
 }catch{throw Error('预设保存未确认，草稿保留；请重新读取核对，未自动覆盖重试');}
}
export function copyPreset(p,name=p.name+' 副本'){validatePreset(p);return {...clone(p),id:uuid(),name:name.slice(0,80),blocks:p.blocks.map(b=>({...clone(b),id:uuid()}))};}
export function moveBlock(p,id,delta){if(p.id==='builtin')throw Error('请先复制内置预设');const i=p.blocks.findIndex(b=>b.id===id),j=i+delta;if(i<0||j<0||j>=p.blocks.length)return false;[p.blocks[i],p.blocks[j]]=[p.blocks[j],p.blocks[i]];return true;}
export function exportPreset(p){validatePreset(p);return JSON.stringify({yuiPhonePreset:1,name:p.name,blocks:p.blocks.map(({id,type,name,content,role,enabled})=>({id,type,name,content,role,enabled})),unsupported:p.unsupported,attribution:p.attribution},null,2);}
export function importPreset(raw){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>1000000)throw Error('预设文件最多 1 MB');
 let v;try{v=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw Error('不是有效的预设 JSON');}
 if(!record(v)||!(v.yuiPhonePreset===1||v.__nuojijiChatPreset===true)||!text(v.name,80,true)||!Array.isArray(v.blocks)||v.blocks.length>100)throw Error('仅支持 Yui v1 或 nuopreset 条目格式；不能直接导入酒馆完整 API 预设');
 if(v.__nuojijiChatPreset && v.mode!==undefined && v.mode!=='online')throw Error('此文件不是线上聊天预设');
 const p={id:uuid(),name:v.name,blocks:[],unsupported:[],attribution:[]},report=[];
 if(v.yuiPhonePreset===1){p.unsupported=clone(v.unsupported||[]);p.attribution=clone(v.attribution||[]);}
 else{
  if(text(v.author,200,true))p.attribution.push('作者：'+v.author);
  if(Array.isArray(v.credits))for(const c of v.credits.slice(0,20))if(record(c))p.attribution.push([c.name,c.author].filter(x=>typeof x==='string').join(' · ').slice(0,300));
 }
 const seen=new Set();
 for(const b of v.blocks){
  if(!record(b)||b.enabled!==undefined&&typeof b.enabled!=='boolean')throw Error('存在无效条目');if(seen.has(b.id))report.push('重复条目 ID 已分配新 ID');seen.add(b.id);
  if(b.type==='marker'){
   const key=String(b.key||b.id||'未知').slice(0,100);
   if(key==='format'){report.push('format 使用 Yui 固定功能协议，不读取原手机内置正文');continue;}
   p.unsupported.push(('未映射占位项：'+key+'（原文件没有提示词正文）').slice(0,500));continue;
  }
  if(b.type!=='text'||typeof b.content!=='string')throw Error('未知条目类型，尚未导入');
  const name=String(b.name||b.title||'导入条目').slice(0,100),block={...textBlock(name,b.content),role:b.role||'system',enabled:b.enabled!==false};
  if(v.__nuojijiChatPreset && b.injection && (b.injection.position!=='relative'||Number(b.injection.depth)!==0)){block.enabled=false;p.unsupported.push('条目“'+name+'”的深度位置不支持；文字保留为关闭条目，请编辑确认');}
  if(/\{\{[^{}]+\}\}/.test(b.content)){block.enabled=false;p.unsupported.push('条目“'+name+'”含未解析变量；关闭导入，请替换为实际文字');}
  p.blocks.push(block);
 }
 if(v.regexRules?.length)report.push('附带正则未执行或安装，请在原应用查看用途');if(record(v.params)&&Object.keys(v.params).length)report.push('附带模型参数未覆盖当前 API 设置');
 validatePreset(p);report.unshift(`可编辑文字 ${p.blocks.length} 条，暂不支持 ${p.unsupported.length} 项`);return {preset:p,report};
}
export function presetMessages(p){validatePreset(p);return p.blocks.filter(b=>b.enabled&&b.content.trim()).map(b=>({role:b.role,content:b.content}));}
