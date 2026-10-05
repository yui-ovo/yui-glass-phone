import { memoryPolicy } from './memory-policy.js';
import { sameJson } from './contacts.js';

export const MEMORY_BRIDGE_KEY = 'qqj_v3_public_bridge_v1';
const labels = {
  name:'姓名', aliases:'别名', gender:'性别', age:'年龄', birthday:'生日', species:'种族', notes:'补充资料',
  height:'身高', build:'体型', face:'面容', hair:'头发', eyes:'眼睛', distinctiveFeatures:'辨识特征',
  clothingStyle:'衣着风格', appearance:'外貌', occupation:'职业', organization:'组织', socialIdentity:'身份',
  background:'经历', identityRelations:'身份关系', personality:'性格', conduct:'处事方式', expression:'表达习惯',
  likes:'喜好', dislikes:'厌恶', principles:'原则', nsfw:'亲密设定',
};
const boundaries = { private:'仅此人物本人知情', authorial:'作者塑造参考，不代表人物知情', shared:'已共享', expressed:'已表达', observable:'可观察' };
const failure = status => status === 'disabled' ? '千千结已关闭，请先启用，或关闭此人物的记忆联动' : '千千结尚未准备好当前存档，请在插件中检查后重试';
function invoke(bridge, method) {
  if (typeof bridge[method] !== 'function') throw Error('当前千千结版本缺少所需读取接口，请更新插件');
  try { return bridge[method](); } catch { throw Error('千千结读取失败，请在插件中检查后重试'); }
}
function sameIdentity(a,b) {
  return !!a && !!b && ['hostChatId','qqjChatId','characterLocator','personaLocator'].every(key => sameJson(a[key],b[key]));
}
export function memoryConnection(win) {
  const bridge = win[MEMORY_BRIDGE_KEY];
  if (!bridge) throw Error('未检测到千千结读取接口，请确认已安装并启用支持公开接口的版本');
  if (bridge.schemaVersion !== 1 || bridge.kind !== 'qqj-public-memory-bridge') throw Error('千千结接口版本不支持，请更新小手机或千千结');
  const status = invoke(bridge,'getStatus'), identity = status?.identity;
  if (status?.status !== 'ready') throw Error(failure(status?.status));
  const hostChatId = win.SillyTavern?.getContext()?.chatId;
  if (typeof hostChatId !== 'string' || !hostChatId || identity?.hostChatId !== hostChatId
    || typeof identity.qqjChatId !== 'string' || !identity.qqjChatId || identity.qqjChatId.length > 1000) throw Error('千千结与当前存档尚未对应，请等待插件完成切换后重试');
  return { bridge, identity:structuredClone(identity) };
}
function verify(win, connection, value) {
  if (!sameIdentity(connection.identity,value?.identity)) throw Error('千千结记忆所属存档已变化，请重新读取');
  const now=memoryConnection(win);
  if (now.bridge !== connection.bridge || !sameIdentity(now.identity,connection.identity)) throw Error('千千结存档或人设已变化，请重新读取');
}
function snapshot(win, connection) {
  const data=invoke(connection.bridge,'getSnapshot');
  if (data?.status !== 'ready') throw Error(failure(data?.status));
  verify(win,connection,data);return data;
}
export function memoryPeople(win) {
  const connection=memoryConnection(win), data=snapshot(win,connection), people=new Map();
  for (const item of data.people?.items || []) if (typeof item.entityId === 'string' && item.entityId && item.entityId.length <= 1000) people.set(item.entityId,{id:item.entityId,name:item.displayName || item.entityDisplayName || '未命名人物'});
  for (const item of data.cse?.currentSubjects || []) if (typeof item.subjectEntityId === 'string' && item.subjectEntityId && item.subjectEntityId.length <= 1000 && !people.has(item.subjectEntityId)) people.set(item.subjectEntityId,{id:item.subjectEntityId,name:item.displayName || '未命名人物'});
  return { identity:connection.identity, people:[...people.values()] };
}
export function readMemoryReference(win, person) {
  const policy=memoryPolicy(person);
  // Off means no plugin access, including getters and status reads.
  if (!policy.enabled) return undefined;
  const connection=memoryConnection(win);
  if (connection.identity.qqjChatId !== policy.chatId) throw Error('此人物关联的是另一份千千结存档，请在人物资料中重新关联');
  const parts=[];
  if (policy.plot) {
    const data=invoke(connection.bridge,'getPromptSnapshot');
    verify(win,connection,data);
    if (data?.status !== 'ready' || data.scope !== 'latest-prepared') throw Error('千千结暂无为当前正文准备好的记忆；请先在千千结检查，或取消勾选剧情记忆');
    const texts=[data.prequel?.text,data.recall?.text].filter(text => typeof text === 'string' && text.trim());
    if (!texts.length) throw Error('千千结剧情记忆为空，请取消勾选或准备记忆后重试');
    parts.push('【最近为正文准备的记忆；可能包含已选人物状态，并非针对本条手机消息重新检索】\n'+[...new Set(texts)].join('\n\n'));
  }
  if (policy.profile || policy.state) {
    const data=snapshot(win,connection);
    if (policy.profile) {
      const matches=(data.people?.items || []).filter(p => p.entityId === policy.entityId);
      if (matches.length !== 1 || !matches[0].profile) throw Error('绑定人物的千千结档案未加载或已删除，请检查人物关联');
      const profile=matches[0].profile, fields=Object.entries(labels).filter(([key])=>typeof profile[key] === 'string' && profile[key].trim()).map(([key,label])=>`${label}：${profile[key]}`);
      if (!fields.length) throw Error('绑定人物的千千结档案为空');
      parts.push('【绑定人物档案】\n'+fields.join('\n'));
    }
    if (policy.state) {
      const matches=(data.cse?.currentSubjects || []).filter(p => p.subjectEntityId === policy.entityId);
      if (matches.length !== 1) throw Error('绑定人物的千千结状态未加载或已删除，请检查人物关联');
      const lines=[];
      for (const [layer,label] of [['core','核心'],['adaptive','关系与适应'],['situational','当前情境']]) {
        for (const item of matches[0][layer] || []) {
          if (typeof item.text !== 'string' || !item.text.trim()) continue;
          const boundary=boundaries[item.visibility] || '知情范围未明确，不推定已知';
          lines.push(`${label} / ${boundary}${item.towardEntityId ? ` / 对象：${item.towardDisplayName || item.towardEntityId}` : ''}：${item.text}${item.reason ? `\n依据：${item.reason}` : ''}`);
        }
      }
      if (!lines.length) throw Error('绑定人物暂无已保存状态，请取消勾选人物状态后重试');
      parts.push(`【绑定人物状态${data.cse.ready ? '' : '；仅已保存部分，不代表完整现状'}】\n`+lines.join('\n'));
    }
  }
  verify(win,connection,{identity:connection.identity});
  const text=parts.join('\n\n');
  // Preserve qualifiers and knowledge boundaries: never silently cut a memory mid-sentence.
  if (text.length > policy.maxChars) throw Error(`千千结参考共 ${text.length} 字，超过设置的 ${policy.maxChars} 字；请减少参考内容或调整上限后预览`);
  return { source:'千千结', identity:connection.identity, entityId:policy.entityId, text };
}
