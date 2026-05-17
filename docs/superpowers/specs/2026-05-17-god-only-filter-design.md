# God Only 过滤 + Subagent 派发设计

## 概述

补全 P2-1：实现完整的 God Only 内容过滤逻辑，并派发受限 Subagent 进行角色认知与意图推演。

## 设计决策

| 决策点 | 选择 | 原因 |
|--------|------|------|
| YAML 解析库 | `yaml` (eijinhong) | 轻量、现代、错误信息友好 |
| 过滤范围 | 读取所有 YAML 文件 | 符合 PLAN.md 设计 |
| 匹配策略 | 精确字符串匹配 | 安全性最高，不误删 |
| 文件级标记 | 支持 | 符合 PLAN.md 设计 |
| 缓存策略 | 首次扫描 + 缓存 | 平衡性能与复杂度 |
| Subagent 实现 | 复用 Session/Agent 框架 | 符合 PLAN.md 设计 |

## 架构

```
embody 工具调用
    │
    ├── GodOnlyFilter.Service.getForbiddenSet()
    │       │
    │       ├── 首次调用：扫描世界目录 *.yaml
    │       │   ├── 解析 YAML（yaml 库）
    │       │   ├── 递归提取 God Only 内容
    │       │   └── 缓存到 InstanceState
    │       │
    │       └── 后续调用：返回缓存
    │
    ├── filterL2View(l2View, forbiddenSet)
    │       └── 精确字符串匹配 → 替换为 [已隐去]
    │
    └── 创建 Subagent Session
            ├── 工具集：仅 question
            ├── roleplay 覆盖：禁用真实 env/instructions/skills
            ├── system prompt：角色卡 + character.txt
            └── 执行并返回 L3 输出
```

## 组件

### 1. GodOnlyFilter 服务

**文件：** `packages/opencode/src/tool/god-only-filter.ts`

```typescript
interface ForbiddenSet {
  strings: Set<string>  // 禁止字符串集
  fileHashes: Map<string, string>  // 文件路径 → 内容 hash
}

class GodOnlyFilter.Service extends Context.Service {
  getForbiddenSet(): Effect<ForbiddenSet>
  refresh(): Effect<void>
}
```

### 2. YAML 解析逻辑

**God Only 检测规则：**

1. 文件级：顶层 `access: God Only` → 整个文件内容加入禁止集
2. 字段级：嵌套对象中 `access: God Only` → 提取关联的 content/current/description 等字段值

**大小写不敏感匹配：**
- `God Only` / `god only` / `GOD ONLY` / `god-only` / `God-Only` 均识别

**内容提取：**
- 对于带 `access: God Only` 的对象，提取以下字段值：
  - `content`
  - `current`
  - `description`
  - `note`
  - `value`
  - 以及所有字符串类型的子字段

### 3. Subagent 派发

**工具限制：** 仅 `question`

**Roleplay 覆盖：**
- `environmentOverride`: 游戏内环境描述
- `instructionOverride`: 空字符串（禁用 AGENTS.md）
- `skillsOverride`: 空字符串（禁用 skills）

**System Prompt：**
- 角色卡内容
- character.txt 模板
- 清洗后的 L2 视图
- 当前情境描述

## 文件清单

### 新增

| 文件 | 职责 |
|------|------|
| `tool/god-only-filter.ts` | GodOnlyFilter 服务 + extractForbiddenContent |

### 修改

| 文件 | 改动 |
|------|------|
| `tool/embody.ts` | 重构：调用过滤器 + 派发 Subagent |
| `package.json` | 添加 `yaml` 依赖 |

## 实施步骤

1. 添加 `yaml` 依赖
2. 实现 `god-only-filter.ts` 服务
3. 重构 `embody.ts`：集成过滤器 + Subagent 派发
4. 测试验证

## 测试用例

### YAML 文件示例

```yaml
# 文件级 god-only
access: God Only
secret_info: "这是整个文件都保密的内容"
```

```yaml
# 字段级 god-only
name: 宋祈
age: 25
secret:
  content: "隐藏的身世秘密"
  access: god-only
background:
  current: "公开背景"
  note:
    description: "真实背景"
    access: God Only
```

### 预期行为

1. 文件级 god-only：整个 YAML 内容进入禁止集
2. 字段级 god-only：`"隐藏的身世秘密"` 和 `"真实背景"` 进入禁止集
3. l2View 中精确匹配到这些字符串 → 替换为 `[已隐去]`
