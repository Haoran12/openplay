# OpenPlay Transformation Progress

## 已完成阶段（归档）

### P0 全部完成（2026-05-17）

P0-1 至 P0-10 全部完成，包括：World 检测、配置 Schema 扩展、Agent 系统扩展、提示词隔离、工具注册模式切换、embody+god-only-filter、calc/dice/narrate/scene_update 工具、Session 世界关联、默认 Agent 选择逻辑。

### P1 全部完成（2026-05-17 ~ 2026-05-20）

- P1-1: 前端 UI 适配（角色名显示、叙事面板、工具渲染器）
- P1-2: 形态切换支持（runtime.yaml form 字段）
- P1-3: `openplay init` 命令
- P1-4: 结构化 memory schema + 分层压缩策略

### P2-1 完成（2026-05-20）

God Only 过滤 + Subagent 派发：使用 yaml 库解析，大小写不敏感匹配，文件级/字段级 god-only 提取，缓存机制。

### P3 完成（2026-05-17）

品牌重命名：opencode → openplay，@opencode-ai → @openplay-ai，bin/opencode → bin/openplay。

---

## 近期修复（2026-05-17 ~ 2026-05-20）

| 日期 | 描述 |
|------|------|
| 2026-05-17 | 数据库迁移修复：drizzle.config.ts 使用 HOME 环境变量，自动修复 session 表缺失列 |
| 2026-05-17 | 基本对话降级修复：default_agent 失效时自动回退到可用主 agent |
| 2026-05-17 | Roleplay 运行态隔离修复：runtime.yaml 为世界检测第一信号，Director 不继承开发态 AGENTS.md/CLAUDE.md |
| 2026-05-17 | Character Subagent 启用修复：新增隐藏 character subagent，embody 派发固定调用该 subagent |
| 2026-05-18 | Character limited-view 补强：embody 注入程序化 Core Self-Knowledge，执行 God Only 剥离 |
| 2026-05-20 | Director 上下文压缩策略优化：专用 compaction 摘要模板，recent-context 预算提升到 ~64K token |
| 2026-05-20 | Director narrate 正文级渲染：UI 移除 narrate 对 BasicTool 工具卡壳依赖，直接渲染为正文块 |
| 2026-05-20 | TUI narrate 专用渲染：注册 TOOL_RULES，final completed 直接输出 markdown 正文 |
| 2026-05-20 | TUI narrate 正文色与正文块语义：使用 assistant 级正文色，取消 final/system dim 语义 |
| 2026-05-20 | Roleplay memory 支撑：新增 memory_update 工具，角色主观记忆现固定写入角色目录内 `memory.yaml` |
| 2026-05-20 | 结构化角色记忆与分层压缩：newest-first 结构化 YAML 条目，渐进压缩规则（每 20 条一档） |
| 2026-05-20 | Roleplay memory 拟人遗忘模型：印象分 0-5，近因更清晰/强印象更抗遗忘/弱印象更快模糊/5分永不压缩 |
| 2026-05-20 | Roleplay memory 高印象稀缺化：每 20 条记忆最多保留 1 条 5 分、3 条 4-5 分，总量溢出时旧高分自动回落，抑制高印象级别泛滥 |
| 2026-05-20 | Roleplay memory 评分语义校正：印象级别明确按角色主观可记忆性/情绪残留评分，而非按上帝视角事件重要性评分 |
| 2026-05-20 | Director embody 报错修复：memory schema 兼容 `{content,...}` 包装字段，异常记忆内容降级为空记忆，避免 `content.trim is not a function` |
| 2026-05-20 | Director embody 稳定性补强：memory schema 入口兼容对象型 payload，避免历史脏数据/包装对象在记忆读取阶段打断 Director 对话 |
| 2026-05-20 | Director 记忆越权修复：`scene_update` 收紧为仅允许 `runtime.yaml` / `records/**`，硬性拒绝角色资源路径、绝对路径与穿越路径 |
| 2026-05-20 | Character-owned memory flow：新增 `memory_reflect`，由 Director 触发、Character subagent 决定并调用 `memory_update` 写入主观记忆 |
| 2026-05-21 | Director/Character 边界修复：`embody` 改为 objective-first 契约，新增 `sceneFacts`/`situationFrame`/`playerNudge`/`focusHints`，拦截 Director 代写角色认知/心理/意图 |
| 2026-05-21 | Director 越权收紧：扩展 `embody` 主观泄漏拦截，新增对情绪/立场/意图标签化表述的程序级拒绝；明确 `playerNudge` 默认留空，未获玩家明确要求时不得替角色预置主观倾向 |
| 2026-05-21 | Embody 自动注入增强：从 `runtime.yaml` 与角色状态自动注入客观环境、当前身体状态、基线感官能力与当前有效感知状态 |
| 2026-05-21 | Runtime schema 补强：`present_characters` 新增可选结构化身体/携带/束缚/感官受损字段，兼容旧文本字段 |
| 2026-05-21 | runtime.yaml 兼容修复：`current_scene.present_characters` 也会被解析，避免嵌套写法导致 Director 右侧面板名单缺失 |
| 2026-05-21 | 本机路径迁移：默认 XDG 数据/配置/状态/缓存目录改为 `openplay`，启动时一次性迁移旧 `opencode` 本地配置、数据库、历史会话与日志到新路径 |
| 2026-05-21 | Character 目录化重构：角色改为 `characters/<dir>/profile.yaml + memory.yaml + knowledge/` 结构，共用目录索引按 `profile.yaml` 解析真实名 |
| 2026-05-21 | Character 自主读取链路：新增 `character_view_read`，Character 子代理从资源清单主动读取自身资源，Director 不再注入完整设定/记忆正文 |
| 2026-05-21 | Character prompt 重构：Character system prompt 与 `embody`/`memory_reflect` 改为 manifest/resource 驱动，保持正向信息边界 |
| 2026-05-21 | 角色迁移工具：新增 `openplay migrate-characters`，可将旧平铺角色文件与顶层 memories 迁移为目录化结构并输出报告 |
| 2026-05-21 | `openplay init` 更新：不再创建顶层 `memories/`，改为生成角色目录结构说明 |

---

## 待办

- [x] Character 目录索引、manifest/resource 读取工具、角色 session 定位
- [x] `embody` / `memory_reflect` / `memory_update` 切换到角色目录结构
- [x] Character / Director prompt 改为角色自主读取资源
- [x] `openplay init` 切换到目录化角色结构
- [x] `openplay migrate-characters` 迁移命令
- [x] 更完整的迁移命令测试与 CLI 集成测试
- [x] 清理剩余历史文档中对旧结构的零散描述
- [x] `embody` 支持结构化当前事件输入，保留完整 speech/action 并程序级拒绝他人主观信息泄露

## Changelog

- 2026-05-26: 修复 Director `calc` 年龄调用 schema 导出错误：`calc.type` 改用 `Schema.Literals([...])`，避免 JSON Schema 误退化为仅允许 `"date"`，并补充参数 schema 回归测试覆盖 `age`/`tier`/`delta` 枚举值。
- 2026-05-25: 角色读取链路改为目录索引 + manifest/resource 驱动；Character 通过 `character_view_read` 主动读取自身资源。
- 2026-05-25: `memory_update` 改为固定写入角色目录内 `memory.yaml`，`scene_update` 明确拒绝角色资源路径。
- 2026-05-25: `openplay init` 不再创建顶层 `memories/`，新增 `openplay migrate-characters` 迁移命令与报告输出。
- 2026-05-26: 补齐 `openplay migrate-characters` 迁移命令测试，覆盖旧平铺角色文件、顶层 `memories/`、gm notes 与知识资源迁移。
- 2026-05-26: 收紧 `runtime.yaml` 文档措辞，去掉仍显旧式的“玩家不应直接编辑”表述。
- 2026-05-26: 手工完成 `/home/refzhu/airp/xdworld` 剩余角色目录化迁移，补齐 `孟缘`、`沈烟`、`李昀` 的 `profile.yaml`，为缺失角色补建 `memory.yaml`，并将绑定表统一切到 `characters/<dir>/{profile,memory}.yaml`。
- 2026-05-26: 清理 `/home/refzhu/airp/xdworld` 的旧平铺角色文件、顶层 `memories/*.yaml` 与冗余 `遐蝶_Hidden/` 目录，仅保留目录化角色资源结构。
- 2026-05-26: Character 长期知识自治增强：新增 `knowledge_update` / `knowledge_reflect`，角色可在自身 `knowledge/**` 下沉淀与修订对社会、自然、身体感知及其他人物的长期认知。
- 2026-05-26: Character 目录资源补强：`readManifest` 会为角色目录自动补齐 starter knowledge 文件，默认提供 `social_and_world.md`、`nature_and_body.md`、`knowledge/people/README.md`。
- 2026-05-26: Character/Director prompt 扩展知识库分工：将 episodic memory 与 durable knowledge 明确分离，Director 不再通过 `scene_update` 越权改写角色知识资源。
- 2026-05-26: `embody` 新增结构化 `sceneEvents` 输入；Director 可把当前场景中的 speech / outward action / objective result 以 JSON 完整传给 Character，避免被摘要压扁。
- 2026-05-26: `embody` 结构化事件隔离收紧：程序级拒绝 `inner_thought`、emotion、intent、plan 等他人主观字段进入 Character SubAgent，并对 `sceneEvents` 中残留的 God Only 字符串执行同样过滤。
