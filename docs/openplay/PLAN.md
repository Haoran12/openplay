# OpenPlay Transformation Plan

OpenPlay 将 opencode（一款开源 Coding Agent）改造为 openplay（一款 Roleplay Agent），保留文件查找与编辑、自主决策等核心能力，新增信息隔离、场景模拟、独立角色代入等角色扮演功能。

## 核心原则

**能用 Agent 做的事，不写代码做。**

程序只做确定性的事：God Only 过滤、数值计算、工具权限隔离、提示词隔离。
其余全部交给 Director Agent 的推理能力。

### 程序做的（确定性，不可绕过）

- God Only 内容剥离（embody 工具内部）
- 确定性数值计算（calc 工具：日期差、tier、delta、age）
- 随机数生成（dice_roll 工具）
- Subagent 工具权限隔离（只有 question）
- Subagent 提示词隔离（禁用真实 env/instructions/skills）
- Subagent 无法访问文件系统（无 read/glob/grep）

### Agent（Director）做的（需要理解力）

- 读取和理解 YAML 数据（任意格式、拼写错误、字段变体）
- 判断 Condition 条件（"云梦泽妖族可知" → 检查角色归属）
- 判断 self / participant / List 条件
- 构造 L2 视图（选择角色能感知的内容、翻译数值为体感描述）
- 理解双格式字段（简单值 vs 受控对象 `{content, access}`）
- 理解多属性集（形态切换）
- 决定角色行动结果、生成叙事文本

## 关键架构决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 计算引擎 | 基础计算内置 TS，保留 MCP 扩展协议 | 语言一致性，但保留外部扩展能力 |
| Director 实现 | 复用现有 Agent 框架 | 最小改动，利用已有权限/提示词系统 |
| 角色状态格式 | YAML 文件 | 与原有角色扮演插件兼容 |
| 功能范围 | 双模式（Roleplay / Coding） | 目录即模式声明 |
| 世界检测 | openplay.json 优先 | 有世界标记 → roleplay，无 → coding |
| 配置命名 | openplay.json / openplay.jsonc | 与产品名一致，与 opencode.json 不冲突 |
| 品牌重命名 | 最后统一做 | 减少开发中的冲突 |
| God Only 过滤 | 程序化，不依赖 LLM | 硬安全边界，不能信任 LLM 记忆 |

## 信息隔离架构

### 三层隔离

```
第一层：提示词隔离
  Subagent 的 system prompt = 角色卡 + 输出格式约束
  Subagent 的 environment = 游戏内环境（不是真实文件路径）
  Subagent 的 instructions = 空（不加载 AGENTS.md）
  Subagent 的 skills = 空

第二层：工具隔离
  Subagent 可用工具 = [question]
  Subagent 不可用工具 = [read, glob, grep, shell, edit, write,
                         world_query, scene_update, calc, ...]
  embody 工具传入的 l2View 已经被 God Only 过滤

第三层：God Only 程序化过滤
  embody 工具在将 l2View 传给 Subagent 之前：
  1. 读取所有 YAML 文件
  2. 递归提取所有 access="God Only"/"god-only" 关联的 content
  3. 整个文件顶层标记 god-only 的，全部内容进入禁止集
  4. 扫描 l2View 参数，匹配禁止字符串 → 替换为 [已隐去]
  5. 将清洗后的 l2View 传给 Subagent
```

### Director → Character 数据流

```
Director Agent (持有 L1 真相)
  │
  ├── 用 read 工具读取所有 YAML（看到一切，包括 God Only）
  │
  ├── 用 calc 工具做确定性计算
  │   calc date "966-03-17" "1003-07-17"  →  年龄
  │   calc tier 2500                        →  "Master 级别"
  │   calc delta 2500 1500                  →  "差距显著"
  │
  ├── 自行理解数据，为每个角色构造 L2 视图（Agent 推理）
  │   - 看到 "access: God Only" → 不放入任何角色的 L2
  │   - 看到 "access: Condition: 云梦泽妖族可知" → 判断角色归属
  │   - 看到 "access: self" → 仅角色本人可见
  │   - 数值翻译为体感描述
  │
  ├── 调用 embody(character="孟缘", l2View=..., situation=...)
  │   │  embody 内部：
  │   │  1. 构建角色 Agent 配置
  │   │  2. 程序化过滤 l2View 中的 God Only 内容
  │   │  3. 创建 Subagent Session（受限权限：只有 question）
  │   │  4. 传入 roleplay 覆盖（禁用真实 env/instructions/skills）
  │   │  5. 返回 L3 输出
  │   │
  │   └── Character Subagent 只看到：
  │       ├── 角色卡 + 输出格式约束（system prompt）
  │       ├── 游戏内环境（environmentOverride）
  │       ├── 清洗后的 L2 视图文本
  │       └── 当前情境描述
  │       ❌ 没有 read/glob/grep
  │       ❌ 没有真实文件路径/日期/平台信息
  │       ❌ 所有 God Only 内容已被程序剥离
  │
  └── 收到 L3 输出，继续导演流程
```

## 模式检测

**目录即模式：**
- 含 `openplay.json` 或 `openplay.jsonc` → 世界根目录 → Roleplay 模式
- 含 `runtime.yaml`（无 openplay.json）→ 最简世界 → Roleplay 模式
- 都不含 → Coding 模式（与原 opencode 完全相同）

**`World.Service.fromDirectory` 检测逻辑：**
```
从 CWD 向上搜索：
1. 找到 openplay.json/jsonc → 世界根
2. 未找到 → 向上找 runtime.yaml → 世界根（最简世界）
3. 都未找到 → 返回 undefined → coding 模式
4. 找到后：读 id 字段，不存在则生成 wld_UUID 并写回
```

**InstanceContext 扩展：**
```typescript
interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
  world?: World.Info  // 新增，存在则为 roleplay 模式
}
```

## 世界目录结构

```
my-world/                                ← 用户的世界目录
├── openplay.json                        ← 世界配置
├── runtime.yaml                         ← 场景状态（热数据）
├── .init/                               ← 重置快照
├── characters/                          ← 角色定义
│   ├── SongQi.yaml
│   ├── Xiadie-HiddenFeatures.yaml       ← god-only 独立文件
│   └── ...
├── worldview/
│   ├── Arguments.yaml                   ← tier 定义
│   ├── world_base.yaml                  ← 世界基础知识
│   └── ...
├── location_and_faction/
├── social/
├── records/                             ← 事件记录
└── others/
```

## 访问控制系统

### 六种访问标签

| 标签 | 格式 | 过滤逻辑 | 实现方式 |
|------|------|----------|----------|
| `Public` / `public` | 字符串 | 所有人可见 | Director 直接放入 L2 |
| `God Only` / `god-only` | 字符串 | 仅 Director | **程序化剥离** |
| `Condition: X` | 条件字符串 | 满足条件者可见 | Director 判断 |
| `self` | 固定值 | 仅角色本人 | Director 判断 |
| `participant` | 固定值 | 事件参与者 | Director 判断 |
| `List: A, B` | 名单 | 名单中的角色 | Director 判断 |

### YAML 字段双格式

```yaml
# 简单格式 — 直接返回
name: 宋祈

# 受控格式 — Director 判断访问权限
name:
  current: 宋祈
  note:
    description: 从小被竹灵养大...
    access: self

# 带 apparent_content — 无权限时返回 apparent_content
species:
  content: 妖精/竹
  apparent_content: 妖精
  access: "Condition: 云梦泽妖族可知"
```

只有 God Only 由程序强制剥离。其余五类全部由 Director Agent 判断。

## 工具清单

### Roleplay 模式工具（Director 可用）

| 工具 | 类型 | 说明 |
|------|------|------|
| `read` | 保留 | 读 YAML 文件，Director 用于读取 L1 真相 |
| `glob` | 保留 | 发现世界目录中的文件 |
| `grep` | 保留 | 搜索世界观内容 |
| `calc` | 新增 | 确定性数值计算 |
| `dice_roll` | 新增 | 骰子/概率判定 |
| `embody` | 新增 | 角色代入派发 |
| `narrate` | 新增 | 叙事文本生成 |
| `scene_update` | 新增 | 场景状态更新、事件记录 |
| `question` | 保留 | 向玩家请求决策 |

### Coding 模式工具（与原 opencode 相同）

shell, edit, write, read, glob, grep, task, task_status, fetch, search, question, skill, plan, ...

### Character Subagent 工具（极受限）

仅 `question`。

## 配置 Schema

### openplay.json

```jsonc
{
  "id": "wld_a1b2c3d4...",           // 自动生成，首次启动时写入
  "roleplay": {
    "worldPath": ".",                 // 世界目录相对路径
    "currentDate": "1003-07-17",      // 游戏内日期
    "narrativeStyle": {
      "language": "early_modern",
      "rhetoric": "balanced",
      "psychology": "mixed",
      "pacing": "varied"
    },
    "recordThreshold": 5             // 事件记录触发阈值
  },
  "agent": {
    "director": {
      "model": { "id": "claude-sonnet-4-20250514" },
      "isDirector": true
    },
    "孟缘": {
      "model": { "id": "claude-sonnet-4-20250514" },
      "persona": "竹精灵，沉稳内敛...",
      "senses": { "vision": "Master", "hearing": "Adept" },
      "knowledgeAccess": ["Public", "Condition:修行者"],
      "statePath": "characters/MengYuan.yaml"
    }
  }
}
```

## 改造阶段

### P0-1: World 检测与配置发现

**新增文件：**
- `packages/opencode/src/world/schema.ts` — WorldID 品牌, WorldInfo 类型
- `packages/opencode/src/world/world.ts` — World.Service.fromDirectory

**改动文件：**
- `packages/opencode/src/project/instance-context.ts` — 新增 `world?: World.Info`
- `packages/opencode/src/project/project.ts` — 纳入 World 检测

### P0-2: 配置 Schema 扩展

**改动文件：**
- `packages/opencode/src/config/config.ts` — Config.Info 新增 `roleplay` 字段
- `packages/opencode/src/config/agent.ts` — ConfigAgent.Info 新增角色相关字段

**配置搜索路径新增：**
- `openplay.jsonc` / `openplay.json` 优先于 `opencode.jsonc` / `opencode.json`
- `.openplay/` 目录优先于 `.opencode/`

### P0-3: Agent 系统扩展

**改动文件：**
- `packages/opencode/src/agent/agent.ts` — Agent.Info 新增 `persona`, `senses`, `knowledgeAccess`, `statePath`, `isDirector`
- `packages/opencode/src/agent/agents.ts` — 新增 `director` 内置 Agent

**默认 Agent 选择：** `ctx.world ? "director" : "build"`

### P0-4: 提示词隔离机制

**改动文件：**
- `packages/opencode/src/session/prompt.ts` — PromptInput 新增 `roleplay` 字段
- `packages/opencode/src/session/llm.ts` — 系统提示词组装处应用 roleplay 覆盖

**新增类型：**
```typescript
interface RoleplayContext {
  environmentOverride?: string  // undefined=默认, ""=禁用, 非空=替换
  instructionOverride?: string
  skillsOverride?: string
}
```

**新增文件：**
- `packages/opencode/src/session/prompt/director.txt`
- `packages/opencode/src/session/prompt/character.txt`

### P0-5: 工具注册模式切换

**改动文件：**
- `packages/opencode/src/tool/registry.ts` — 根据 `ctx.world` 过滤可用工具

### P0-6: embody 工具 + god-only-filter（核心）

**新增文件：**
- `packages/opencode/src/tool/embody.ts`
- `packages/opencode/src/tool/god-only-filter.ts`

**embody 执行流程：**
1. 校验 character 在 present_characters 中
2. 构建角色 Agent 配置
3. 读取所有 YAML，构建 God Only 禁止字符串集
4. 程序化扫描 l2View 参数，替换禁止内容为 `[已隐去]`
5. 构造游戏内环境描述
6. 创建 Subagent Session（受限权限）
7. 传入 roleplay 环境覆盖
8. 返回 Subagent 的 L3 输出

### P0-7: calc 工具

**新增文件：**
- `packages/opencode/src/tool/calc.ts`

支持：date（日期差，含 BC）、tier（数值→层级）、delta（差距）、age（角色年龄）

### P0-8: 其他 Roleplay 工具

**新增文件：**
- `packages/opencode/src/tool/dice-roll.ts`
- `packages/opencode/src/tool/narrate.ts`
- `packages/opencode/src/tool/scene-update.ts`

### P0-9: Session 世界关联

**改动文件：**
- `packages/opencode/src/session/session.sql.ts` — SessionTable 新增 `world_id`, `world_path`
- `packages/opencode/src/session/session.ts` — Session 创建时填充 world

### P0-10: 默认 Agent 选择逻辑

**改动文件：**
- `packages/opencode/src/session/prompt.ts` — 根据 `ctx.world` 选择默认 agent

## 文件清单

### 新增文件

```
packages/opencode/src/
├── world/
│   ├── schema.ts                       # WorldID, WorldInfo 类型
│   └── world.ts                        # World.Service (fromDirectory, 检测逻辑)
├── tool/
│   ├── embody.ts                       # 角色代入派发工具
│   ├── god-only-filter.ts              # God Only 内容过滤
│   ├── calc.ts                         # 确定性计算工具
│   ├── dice-roll.ts                    # 骰子工具
│   ├── narrate.ts                     # 叙事生成工具
│   └── scene-update.ts                # 场景更新工具
├── session/prompt/
│   ├── director.txt                   # 导演系统提示词
│   └── character.txt                  # 角色系统提示词模板
└── migration/<timestamp>_world_fields/
    └── migration.sql
```

### 改动文件

```
packages/opencode/src/
├── project/instance-context.ts         # 新增 world 字段
├── project/project.ts                  # 纳入 World 检测
├── config/config.ts                    # 新增 roleplay 字段
├── config/agent.ts                     # 新增角色相关字段
├── agent/agent.ts                      # Agent.Info 新增字段
├── agent/agents.ts                     # director Agent 定义
├── session/prompt.ts                   # PromptInput + roleplay 覆盖
├── session/llm.ts                      # 系统提示词组装
├── session/session.sql.ts              # SessionTable 新增列
├── session/session.ts                  # Session 创建填充 world
├── session/system.ts                  # director prompt 加载
└── tool/registry.ts                    # 模式切换过滤
```

## 实施顺序

```
P0-1 (World检测) ─── P0-2 (配置) ─── P0-3 (Agent扩展)
     │                                  │
     │                                  ├── P0-10 (默认Agent)
     │                                  │
     ├── P0-5 (工具注册) ─────────────── P0-6 (embody + filter)
P0-4 (提示词隔离) ───────────────────── P0-6
                                         │
P0-7 (calc) ─────────────────────────── │
P0-8 (dice/narrate/scene_update) ───── │
P0-9 (Session关联) ─────────────────── │
                                        │
                                   P0-6 ← 核心，最后验证
```

建议顺序：P0-1 → P0-2 → P0-3 → P0-4 → P0-5 → P0-7 → P0-8 → P0-6 → P0-9 → P0-10

## P1+ 阶段（P0 完成后）

- P1-1: 前端 UI 适配（角色名显示、叙事面板）
- P1-2: 形态切换支持（runtime.yaml form 字段）
- P1-3: `openplay init` 命令
- P2-1: L3 输出验证辅助（检测 God Only 泄漏提示）
- P3: 品牌重命名（opencode → openplay，全局）