# OpenPlay Transformation Progress

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Completed
- [-] Blocked / Skipped

---

## P0-1: World 检测与配置发现

- [ ] `packages/opencode/src/world/schema.ts` — WorldID 品牌, WorldInfo 类型
- [ ] `packages/opencode/src/world/world.ts` — World.Service.fromDirectory
- [ ] `packages/opencode/src/project/instance-context.ts` — 新增 `world?: World.Info`
- [ ] `packages/opencode/src/project/project.ts` — 纳入 World 检测

## P0-2: 配置 Schema 扩展

- [ ] `packages/opencode/src/config/config.ts` — Config.Info 新增 `roleplay` 字段
- [ ] `packages/opencode/src/config/agent.ts` — ConfigAgent.Info 新增角色相关字段
- [ ] 配置搜索路径新增 openplay.json 优先

## P0-3: Agent 系统扩展

- [ ] `packages/opencode/src/agent/agent.ts` — Agent.Info 新增字段
- [ ] `packages/opencode/src/agent/agents.ts` — director Agent 定义

## P0-4: 提示词隔离机制

- [ ] `packages/opencode/src/session/prompt.ts` — PromptInput 新增 `roleplay` 字段
- [ ] `packages/opencode/src/session/llm.ts` — 系统提示词组装处应用 roleplay 覆盖
- [ ] `packages/opencode/src/session/prompt/director.txt`
- [ ] `packages/opencode/src/session/prompt/character.txt`

## P0-5: 工具注册模式切换

- [ ] `packages/opencode/src/tool/registry.ts` — 根据 `ctx.world` 过滤可用工具

## P0-6: embody 工具 + god-only-filter

- [ ] `packages/opencode/src/tool/embody.ts`
- [ ] `packages/opencode/src/tool/god-only-filter.ts`

## P0-7: calc 工具

- [ ] `packages/opencode/src/tool/calc.ts` — date, tier, delta, age

## P0-8: 其他 Roleplay 工具

- [ ] `packages/opencode/src/tool/dice-roll.ts`
- [ ] `packages/opencode/src/tool/narrate.ts`
- [ ] `packages/opencode/src/tool/scene-update.ts`

## P0-9: Session 世界关联

- [ ] `packages/opencode/src/session/session.sql.ts` — SessionTable 新增列
- [ ] `packages/opencode/src/session/session.ts` — Session 创建填充 world
- [ ] Migration 文件

## P0-10: 默认 Agent 选择逻辑

- [ ] `packages/opencode/src/session/prompt.ts` — 根据 `ctx.world` 选择默认 agent

---

## P1+ (After P0)

- [ ] P1-1: 前端 UI 适配
- [ ] P1-2: 形态切换支持
- [ ] P1-3: `openplay init` 命令
- [ ] P2-1: L3 输出验证辅助
- [ ] P3: 品牌重命名

---

## Changelog

| Date | Phase | Description |
|------|-------|-------------|
| 2026-05-17 | — | Plan created, progress tracker initialized |