# OpenPlay Transformation Progress

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Completed
- [-] Blocked / Skipped

---

## P0-1: World 检测与配置发现

- [x] `packages/opencode/src/world/schema.ts` — WorldID 品牌, WorldInfo 类型
- [x] `packages/opencode/src/world/world.ts` — World.Service.fromDirectory
- [x] `packages/opencode/src/project/instance-context.ts` — 新增 `world?: World.Info`
- [x] `packages/opencode/src/project/instance-store.ts` — 纳入 World 检测

## P0-2: 配置 Schema 扩展

- [x] `packages/opencode/src/config/config.ts` — Config.Info 新增 `roleplay` 字段
- [x] `packages/opencode/src/config/agent.ts` — ConfigAgent.Info 新增角色相关字段
- [x] 配置搜索路径新增 openplay.json 优先

## P0-3: Agent 系统扩展

- [x] `packages/opencode/src/agent/agent.ts` — Agent.Info 新增字段（persona, senses, knowledgeAccess, statePath, isDirector）
- [x] `packages/opencode/src/agent/agent.ts` — director 内置 Agent 定义（条件性加入，仅 roleplay 模式）

## P0-4: 提示词隔离机制

- [x] `packages/opencode/src/session/roleplay.ts` — RoleplayContext 类型 + override 工具函数
- [x] `packages/opencode/src/session/prompt.ts` — PromptInput 新增 `roleplay` 字段
- [x] `packages/opencode/src/session/system.ts` — environment/skills 支持 roleplay 参数
- [x] `packages/opencode/src/session/prompt/director.txt` — 导演系统提示词
- [x] `packages/opencode/src/session/prompt/character.txt` — 角色系统提示词模板
- [x] `packages/opencode/src/agent/prompt/director.txt` — Agent 层导演提示词拷贝

## P0-5: 工具注册模式切换

- [x] `packages/opencode/src/tool/registry.ts` — 根据 `ctx.world` + `isDirector` 过滤可用工具（ROLEPLAY_TOOL_IDS 白名单）

## P0-6: embody 工具 + god-only-filter

- [x] `packages/opencode/src/tool/embody.ts` — 角色代入派发工具 + filterGodOnly 函数
- [x] `packages/opencode/src/tool/embody.txt` — 工具描述
- [x] `packages/opencode/src/tool/god-only-filter.ts` — 导出 filterGodOnly（从 embody re-export）
- [x] `packages/opencode/src/tool/registry.ts` — 注册 embody 工具

## P0-7: calc 工具

- [x] `packages/opencode/src/tool/calc.ts` — date, tier, delta, age
- [x] `packages/opencode/src/tool/calc.txt` — 工具描述
- [x] `packages/opencode/src/tool/registry.ts` — 注册 calc 工具

## P0-8: 其他 Roleplay 工具

- [x] `packages/opencode/src/tool/dice-roll.ts` — 骰子工具
- [x] `packages/opencode/src/tool/dice-roll.txt` — 工具描述
- [x] `packages/opencode/src/tool/narrate.ts` — 叙事生成工具
- [x] `packages/opencode/src/tool/narrate.txt` — 工具描述
- [x] `packages/opencode/src/tool/scene-update.ts` — 场景状态更新工具
- [x] `packages/opencode/src/tool/scene-update.txt` — 工具描述
- [x] `packages/opencode/src/tool/registry.ts` — 注册 dice_roll, narrate, scene_update

## P0-9: Session 世界关联

- [x] `packages/opencode/src/session/session.sql.ts` — SessionTable 新增 `world_id`, `world_path` 列
- [x] `packages/opencode/src/session/session.ts` — Session.Info 新增 `worldID`, `worldPath` 字段；创建时填充 world
- [x] Migration 文件 `migration/20260516200659_add_world_fields/`

## P0-10: 默认 Agent 选择逻辑

- [x] `packages/opencode/src/agent/agent.ts` — 当 `ctx.world` 存在时，defaultInfo 返回 `director` agent

---

## P1+ (After P0)

- [x] P1-1: 前端 UI 适配
- [x] P1-2: 形态切换支持
- [x] P1-3: `openplay init` 命令
- [x] P2-1: God Only 过滤 + Subagent 派发
- [ ] P3: 品牌重命名

---

## Changelog

| Date | Phase | Description |
|------|-------|-------------|
| 2026-05-17 | P0-1 | World 检测与配置发现完成：新增 world/schema.ts (WorldID 品牌), world/world.ts (Service.fromDirectory 检测逻辑), 修改 instance-context.ts (新增 world? 字段), 修改 instance-store.ts (启动时检测 world) |
| 2026-05-17 | P0-2 | 配置 Schema 扩展完成：新增 config/roleplay.ts (NarrativeStyle, ConfigRoleplay.Info), 修改 config.ts (Info 新增 roleplay 字段 + openplay 配置加载路径), 修改 config/agent.ts (Info 新增 persona/senses/knowledgeAccess/statePath/isDirector), 修改 config/paths.ts (.openplay 目录搜索) |
| 2026-05-17 | P0-3 | Agent 系统扩展完成：修改 agent/agent.ts (Agent.Info 新增 persona/senses/knowledgeAccess/statePath/isDirector 字段, 新增 director 内置 Agent 仅在 world 存在时激活, 配置加载时传播角色相关字段) |
| 2026-05-17 | P0-4 | 提示词隔离机制：新增 session/roleplay.ts (RoleplayContext 类型 + applyEnvironmentOverride/applyInstructionOverride/applySkillsOverride 工具函数), 修改 session/prompt.ts (PromptInput 新增 roleplay 字段), 修改 session/system.ts (environment/skills 支持 roleplay override 参数), 创建 director.txt + character.txt 提示词模板 |
| 2026-05-17 | P0-5 | 工具注册模式切换：修改 tool/registry.ts (新增 ROLEPLAY_TOOL_IDS 白名单, 当 isDirector + world 存在时过滤掉非角色扮演工具) |
| 2026-05-17 | P0-7 | calc 工具：新增 tool/calc.ts (支持 date/tier/delta/age 四种确定性计算), 新增 tool/calc.txt (工具描述), 修改 registry.ts 注册 calc 工具 |
| 2026-05-17 | P0-8 | 其他 Roleplay 工具：新增 dice-roll.ts (骰子工具), narrate.ts (叙事生成工具), scene-update.ts (场景状态更新工具), 均含 .txt 描述; 修改 registry.ts 注册三个工具 |
| 2026-05-17 | P0-6 | embody 工具 + god-only-filter：新增 tool/embody.ts (角色代入工具含 filterGodOnly 函数), 新增 tool/embody.txt, 新增 tool/god-only-filter.ts (re-export), 修改 registry.ts 注册 embody |
| 2026-05-17 | P0-9 | Session 世界关联：修改 session.sql.ts (新增 world_id/world_path 列), 修改 session.ts (Info 新增 worldID/worldPath 字段, 创建时从 ctx.world 填充), 生成 migration |
| 2026-05-17 | P0-10 | 默认 Agent 选择逻辑：修改 agent.ts (当 ctx.world 存在时 defaultInfo 返回 director agent) |
| 2026-05-17 | P1-2 | 形态切换支持：新增 docs/openplay/runtime-yaml-schema.md (runtime.yaml 字段说明，含 form 形态字段) |
| 2026-05-17 | P1-3 | `openplay init` 命令：新增 cli/cmd/init.ts (交互式世界初始化，检查并创建 openplay.json/runtime.yaml 及目录结构) |
| 2026-05-17 | P2-1 | God Only 过滤 + Subagent 派发：重构 tool/god-only-filter.ts (使用 yaml 库解析，大小写不敏感匹配，文件级/字段级 god-only 提取，缓存机制), 重构 tool/embody.ts (调用 GodOnlyFilter 服务，派发受限 Subagent Session，仅 question 工具，roleplay 覆盖), 添加 yaml 依赖, 更新 registry.ts 和测试文件 |

## P2-1: God Only 过滤 + Subagent 派发

- [x] 添加 `yaml` 依赖到 `packages/opencode/package.json`
- [x] `packages/opencode/src/tool/god-only-filter.ts` — 重构：使用 yaml 库解析，大小写不敏感匹配，文件级/字段级 god-only 提取，缓存机制
- [x] `packages/opencode/src/tool/embody.ts` — 重构：调用 GodOnlyFilter 服务，派发受限 Subagent Session（仅 question 工具，roleplay 覆盖）
- [x] `packages/opencode/src/tool/registry.ts` — 添加 GodOnlyFilter.Service 依赖，更新 defaultLayer
- [x] 更新测试文件以提供 GodOnlyFilter.Service

---

## P1-1: 前端 UI 适配

- [x] `packages/opencode/src/server/routes/instance/httpapi/groups/instance.ts` — PathInfo 新增 `world` 可选字段
- [x] `packages/opencode/src/server/routes/instance/httpapi/handlers/instance.ts` — getPath handler 返回 world 信息
- [x] `packages/sdk/js/src/v2/gen/types.gen.ts` — 新增 WorldInfo 类型, Path 新增 world?, Agent 新增 persona/isDirector/senses/knowledgeAccess/statePath
- [x] `packages/ui/src/context/data.tsx` — agent 类型从 `{ name, color }` 扩展为完整 `Agent` 类型
- [x] `packages/ui/src/components/message-part.tsx` — 新增 agentDisplayName 函数, 用户/助手消息 meta 行使用角色显示名；新增 embody/narrate/dice_roll/calc/scene_update 工具渲染器
- [x] `packages/ui/src/components/message-part.css` — 新增 narrative-output 样式
- [x] `packages/ui/src/components/icon.tsx` — 新增 user/dice/quill/calculator/file-edit 图标
- [x] `packages/app/src/utils/agent.ts` — 新增 director 色调, 新增 agentDisplayName 函数
- [x] `packages/app/src/utils/roleplay.ts` — 新增 roleplay 工具函数（isRoleplayMode, getDirectorAgent, etc.）

## P1-2: 形态切换支持

- [x] `docs/openplay/runtime-yaml-schema.md` — 新增，说明 runtime.yaml 字段结构（含 form 形态字段）