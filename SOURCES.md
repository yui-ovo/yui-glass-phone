# 本轮代码来源与接口依据

仅修改 yui-ovo/yui-glass-phone。用户授权审查复用自己的 [yui-pocket](https://github.com/yui-ovo/yui-pocket/tree/d079e19216e8d7d83b008e821761d36929639e8f)，基线 0.2.0-alpha.12。

- `modules/contacts.js`：参考旧 `src/contacts.ts`、`src/worldbook.ts` 的 UUID、关系、账号、资料模型与校验；补强类型检查，保留关联资料及未知字段。
- `modules/avatar.js`：适配旧 `src/appearance.ts` 的 `readDecoration` 栅格检查、尺寸限制与重编码；URL 加载增加取消/超时。
- `modules/host.js`：适配旧 `src/profile-host.ts`、`src/tt-host.ts`；改为新项目命名空间，保留宿主分支与 captured chat store，增加会话代次与空/损坏数据区别。
- `modules/directory.js`：为新灰玻璃界面编写。没有复制旧 UI、素材或动态加载旧扩展。
- `tests/profile-mock.js`、`tests/tt-mock.js`：复用旧项目模拟宿主思路/夹具，TT 命名空间改为新项目。其余测试为新项目编写。
- 运行代码为原生 JS ES modules，无 TypeScript/旧 extension.js/远程运行库，无构建步骤。

## 核实范围

ST 固定接口基线 1.18.0，commit `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`：

- [st-context.js](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/st-context.js)：当前卡、chatId、chatMetadata.integrity、缩略图和事件门面。
- [users-private.js](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/endpoints/users-private.js)：只读 `/api/users/me` 返回 handle。

TT 固定接口基线 2.2.0，commit `9693a4ec47cd4552f90878bccab453f176de0f18`：

- [ExtensionDEV.md](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/ExtensionDEV.md)、[Chat.md](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/docs/API/Chat.md)、[chat.js](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/src/tauri/main/api/chat.js)：ready 与 `api.chat.open(ref).store` 的 listKeys/getJson/setJson/renameKey。
- [extensions.js](https://github.com/Darkatse/TauriTavern/blob/9693a4ec47cd4552f90878bccab453f176de0f18/src/scripts/extensions.js)：manifest activate/enable/disable/delete hooks。
- 沿用旧项目已核实的 safeFrame/keyboardOffset 与存储目录约束。角色身份使用 PNG 文件名主体；文件名 SHA-256 作为条目后缀，避免复制聊天保留相同 integrity 时串资料。

这是公开 ABI 子集适配与模拟验证，不代表运行了真实 ST 服务端或 TT 原生应用。TT 不请求 ST `/api/users/me`，不使用私有 invoke，不读取消息数组、不修改聊天正文或 metadata。

本轮不引用其他作者小手机实现。原机身/基础聊天样式继续沿用用户之前提供并授权使用的正文手机美化；此前参考记录保留在 README 历史说明中。

## 0.5.0 文字消息

新增 messages.js/message-host.js/messenger.js/message-view.js，业务模型与联系人分开。复用本项目已经核实的 ST 账号读取和 TT chat store API，不增加宿主消息/模型端点。Web Locks 使用浏览器公开 API；缺失时停止写入消息。原生 store 无 compare-and-swap，不宣称跨进程原子事务。

按用户本轮要求再次核对其 regex-2026-10-03T16_57_48.251Z.json，真实文字气泡继续使用原 cv2 布局和 CSS，替换的是文本数据来源。没有复制旧 yui-pocket 的聊天 UI。

## 0.6.0 独立 AI 接口依据

仅检查官方宿主源码和公开接口，没有引入其他小手机实现。

- [ST context](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/st-context.js)：name1、powerUserSettings、characters、getWorldInfoNames、loadWorldInfo。
- [ST personas](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/personas.js)：当前 persona_description 与 user_avatar；头像仅在用户点击带入时通过宿主 personas 模块读取。
- [TT context](https://github.com/Darkatse/TauriTavern/blob/main/src/scripts/st-context.js)：核实同名当前人设/世界书接口。
- [TT 前端契约](https://github.com/Darkatse/TauriTavern/blob/main/docs/FrontendHostContract.md)：同源请求路由适配不等于第三方网络代理。本版独立 API 直接 fetch 外部地址，不套用 ST 服务端生成端点。

本轮读取的是当前官方源码；真实 TT 2.3.0 仍需用户配置接口后实测。

## 0.7.0 消息操作设计

按用户确认的交互方案独立实现：灵动岛显示请求状态，气泡长按菜单，规范化消息编辑/删除/引用与原宿主存储整合。前一轮讨论参考了 Phone Mode 的独立提示词组织和柚月的长按/多选交互说明与源码，仅用于理解行为，没有复制其提示词、实现、UI 或素材。

## 0.8.0 世界书绑定读取

2026-10-05 核对官方宿主源码，未引入其他作者小手机实现：

- ST release，commit 06bde939fb1e9c4c8d8641d810f0a916b5bce127：[world-info.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js)、[utils.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/utils.js)。主绑定来自 character.data.extensions.world；额外绑定来自 getWorldInfoSettings().world_info.charLore，name 对应去扩展名的 avatar 文件标识。
- TT main，commit a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375：[world-info.js](https://github.com/Darkatse/TauriTavern/blob/a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375/src/scripts/world-info.js)、[st-context.js](https://github.com/Darkatse/TauriTavern/blob/a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375/src/scripts/st-context.js)。同源模块只读设置与已有 context 角色元数据，条目继续走 loadWorldInfo；不调用 ST 服务端接口或 TT 私有 invoke。

缺少完整角色资料/额外绑定时返回未知，不自动调用 unshallowCharacter 或读取其他卡/历史。当前宿主源码与模拟检查不代表 TT 2.3.0 真机或所有 ST 版本验收。文件解析、复选交互和导入标识由本项目独立实现；外部内容仅作为文本保存。

## 0.9.0 表情包与转账

审查用户恢复的 yui-ovo/yui-sillyphone 的 phone-ui.html（ef39b16362b70fea18eb6a1d0fe333659b72d9ac），确认旧版同层保存、素材库、转账和收退款的行为。新模块根据用户确认的需求独立实现，沿用灰玻璃手机原存储适配；没有复制旧 HTML、标签解析器、生成提示词或媒体插件调用，也没有读取旧用户数据。没有复制柚月/Phone Mode 的实现、UI 或素材。

浏览器 IndexedDB 仅用于新命名空间的本机图片资产；ST/TT 消息仍走已有 message-host。无新增运行时依赖或构建链。

## 0.8.1 精简角色字段核对

修正上一版把 shallow 标记本身视为未知绑定的判断。核实 TT v2.3.0 标签对应 a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375：

- [TT CharacterDto](https://github.com/Darkatse/TauriTavern/blob/a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375/src-tauri/crates/tt-application/src/dto/character_dto.rs)：精简角色 extensions 明确保留 world。
- [TT 前端角色转换](https://github.com/Darkatse/TauriTavern/blob/a1855be4a4f8b6ee7cd0374a84dbb3709c3e5375/src/tauri/main/services/characters/character-service.js)：映射到 data.extensions，shallow 标记继续保留。
- [ST toShallow](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/characters.js)：精简角色同样保留 data.extensions.world，默认空字符串。

本项目只读取已有元数据，不调用这些服务端或原生私有实现；字段缺失时继续返回未知。


## 0.9.2 旧版面板样式移植

按用户明确要求移植其 yui-ovo/yui-sillyphone/phone-ui.html 的 sticker-panel、header、tabs、filter、grid、upload-zone 表情包样式与四页签结构（此前核实基线 ef39b16362b70fea18eb6a1d0fe333659b72d9ac）。增加本项目附件作用域，调整宽度/页签间距/最大高度以适配现手机。原 sendTransfer 使用浏览器 prompt，没有独立 CSS；新弹窗保留现有安全金额校验与业务逻辑。未引入旧 AI 识图接口、全局脚本、同层存储或其他作者实现。此节是本次用户授权的 UI 复用记录，先前版本未复用 UI 的历史说明只适用于对应版本。
