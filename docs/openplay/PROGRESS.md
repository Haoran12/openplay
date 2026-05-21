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
| 2026-05-20 | Roleplay memory 支撑：memories/{character}.yaml 为角色主观记忆路径，新增 memory_update 工具 |
| 2026-05-20 | 结构化角色记忆与分层压缩：newest-first 结构化 YAML 条目，渐进压缩规则（每 20 条一档） |
| 2026-05-20 | Roleplay memory 拟人遗忘模型：印象分 0-5，近因更清晰/强印象更抗遗忘/弱印象更快模糊/5分永不压缩 |
| 2026-05-20 | Roleplay memory 高印象稀缺化：每 20 条记忆最多保留 1 条 5 分、3 条 4-5 分，总量溢出时旧高分自动回落，抑制高印象级别泛滥 |
| 2026-05-20 | Roleplay memory 评分语义校正：印象级别明确按角色主观可记忆性/情绪残留评分，而非按上帝视角事件重要性评分 |
| 2026-05-20 | Director embody 报错修复：memory schema 兼容 `{content,...}` 包装字段，异常记忆内容降级为空记忆，避免 `content.trim is not a function` |
| 2026-05-20 | Director embody 稳定性补强：memory schema 入口兼容对象型 payload，避免历史脏数据/包装对象在记忆读取阶段打断 Director 对话 |
| 2026-05-20 | Director 记忆越权修复：`scene_update` 收紧为仅允许 `runtime.yaml` / `records/**`，硬性拒绝 `memories/**`、绝对路径与穿越路径 |
| 2026-05-20 | Character-owned memory flow：新增 `memory_reflect`，由 Director 触发、Character subagent 决定并调用 `memory_update` 写入主观记忆 |
| 2026-05-21 | Director/Character 边界修复：`embody` 改为 objective-first 契约，新增 `sceneFacts`/`situationFrame`/`playerNudge`/`focusHints`，拦截 Director 代写角色认知/心理/意图 |
| 2026-05-21 | Director 越权收紧：扩展 `embody` 主观泄漏拦截，新增对情绪/立场/意图标签化表述的程序级拒绝；明确 `playerNudge` 默认留空，未获玩家明确要求时不得替角色预置主观倾向 |
| 2026-05-21 | Embody 自动注入增强：从 `runtime.yaml` 与角色状态自动注入客观环境、当前身体状态、基线感官能力与当前有效感知状态 |
| 2026-05-21 | Runtime schema 补强：`present_characters` 新增可选结构化身体/携带/束缚/感官受损字段，兼容旧文本字段 |
| 2026-05-21 | runtime.yaml 兼容修复：`current_scene.present_characters` 也会被解析，避免嵌套写法导致 Director 右侧面板名单缺失 |
| 2026-05-21 | 本机路径迁移：默认 XDG 数据/配置/状态/缓存目录改为 `openplay`，启动时一次性迁移旧 `opencode` 本地配置、数据库、历史会话与日志到新路径 |
| 2026-05-21 | Character 绑定自动化：Director 运行时自动生成 `/.openplay/character-bindings.json`，在工作区内维护 角色→设定文件→记忆文件 对应关系 |
| 2026-05-21 | Character 设定注入修复：`embody` / `memory_reflect` 不再依赖预配角色 agent；会自动发现角色设定文件，并向 Character SubAgent 注入本人非 `God Only` 设定内容与记忆文件 |

---

## 待办

（暂无待办项，所有计划阶段已完成）

## Changelog

- 2026-05-21: Director 触发角色链路时，现在会在世界根自动创建或刷新 `/.openplay/character-bindings.json`，把角色名绑定到对应设定文件与记忆文件。
- 2026-05-21: Character SubAgent 提示词新增 `Accessible Setting File` 段；来源为角色本人设定文件中剥离 `God Only` 后的可见内容。
- 2026-05-21: `memory_reflect` 复用同一角色绑定与设定解析链路，避免“有记忆文件但拿不到设定文件”的不一致行为。
