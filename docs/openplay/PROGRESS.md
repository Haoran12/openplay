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
| 2026-06-27 | `playerNudge` 主观传递放开：移除 `playerNudge` 的主观拦截限制，允许通过该字段传递主观想法、判断或结论，绕过 `sceneFacts`/`situationFrame` 等字段的主观用词拦截 |
| 2026-05-21 | Embody 自动注入增强：从 `runtime.yaml` 与角色状态自动注入客观环境、当前身体状态、基线感官能力与当前有效感知状态 |
| 2026-05-21 | Runtime schema 补强：`present_characters` 新增可选结构化身体/携带/束缚/感官受损字段，兼容旧文本字段 |
| 2026-05-21 | runtime.yaml 兼容修复：`current_scene.present_characters` 也会被解析，避免嵌套写法导致 Director 右侧面板名单缺失 |
| 2026-05-21 | 本机路径迁移：默认 XDG 数据/配置/状态/缓存目录改为 `openplay`，启动时一次性迁移旧 `opencode` 本地配置、数据库、历史会话与日志到新路径 |
| 2026-05-21 | Character 目录化重构：角色改为 `characters/<dir>/profile.yaml + memory.yaml + knowledge/` 结构，共用目录索引按 `profile.yaml` 解析真实名 |
| 2026-05-21 | Character 自主读取链路：新增 `character_view_read`，Character 子代理从资源清单主动读取自身资源，Director 不再注入完整设定/记忆正文 |
| 2026-05-21 | Character prompt 重构：Character system prompt 与 `embody`/`memory_reflect` 改为 manifest/resource 驱动，保持正向信息边界 |
| 2026-05-21 | 角色迁移工具：曾新增 `openplay migrate-characters`，用于将旧平铺角色文件与顶层 memories 迁移为目录化结构；该命令已于 2026-06-26 退役 |
| 2026-05-21 | `openplay init` 更新：不再创建顶层 `memories/`，改为生成角色目录结构说明 |

---

## 待办

- [x] Character 目录索引、manifest/resource 读取工具、角色 session 定位
- [x] `embody` / `memory_reflect` / `memory_update` 切换到角色目录结构
- [x] Character / Director prompt 改为角色自主读取资源
- [x] `openplay init` 切换到目录化角色结构
- [x] 退役 `openplay migrate-characters`：移除会将角色目录名收缩为角色名的旧迁移命令与其测试
- [x] 清理剩余历史文档中对旧结构的零散描述
- [x] `embody` 支持结构化当前事件输入，保留完整 speech/action 并程序级拒绝他人主观信息泄露
- [x] Director `narrate` 主输出语义打通：metadata/UI/transcript/compaction 统一识别 player-facing narrative
- [x] Director `narrate` 终端正文修复：CLI/TUI completed 态仅渲染真实 output，禁止回退到 tool input 伪装正文
- [x] Director 右侧面板 `runtime.yaml` 兼容解析修复：旧式 `current_date` / 标量 `current_scene` 与 `environment.time/location` 都能正确显示时间地点和在场人物
- [x] Director 回合强制 `scene_update`：Roleplay Director 每轮开始时首个工具调用必须是 `scene_update`
- [x] WebUI 阅读体验增强：叙事连续阅读视图、角色最近一次代入卡片、场景变更时间线与 runtime/角色目录快捷入口
- [x] `openplay web` 局域网便捷启动：支持 `--lan` 并继续兼容 `--hostname 0.0.0.0`
- [x] `openplay-ui` 一键同时打开 OpenPlay 与 Roleplay WebUI
- [x] Roleplay WebUI 右侧状态面板人物卡片排版调整：在场人物字段改为单行 inline 展示，仅对字段名做弱强调，避免字段名与内容分行。
- [x] Roleplay WebUI 右侧状态面板在场人物 name 支持弹出只读 `profile.yaml` 预览，使用对话框和高亮代码块展示。
- [x] Roleplay WebUI 新增模型轨迹查看入口：右上角“切换文件树”左侧增加按钮，可按主会话 / Character SubAgent / 工具调用查看真实请求与响应内容。
- [x] `openplay-ui` 会话级高保真 Trace：新增当前会话 Trace 开关、子代理继承、独立 JSONL 存储与 7 天保留、`GET /session/:id/trace` 查询接口，以及可读/原始双视图 Trace 阅读器
- [x] Director 同场景人物连续性修复：`embody` 复用同角色同场景 Character 子会话，保留完整子会话历史；场景连续性锚点改由内部 scene-state 维护，不再依赖 `runtime.yaml.current_scene.scene_id`，并对用户手改/损坏 `runtime.yaml` 保持 fail-open 降级。
- [x] Director 人物连续性止血修复：修复 `SessionID is not defined` 运行时错误；连续性查找/复用失败时 `embody` 自动降级为 fresh Character 子会话，不能阻断当次采样；`scene_update(runtime.yaml)` 现自动刷新内部场景连续性状态，`openplay init` 不再默认写 `current_scene.scene_id`。
- [x] Director 场景连续性锚点内置化：`scene_update` 全量覆盖 `runtime.yaml` 时，内部 scene-state 会按 `current_scene.date/location` 自动保留或切换场景 key，避免 `scene_id` 被覆盖后人物连续性丢失。
- [x] Director 场景切换判定收紧：短时/短距导致的 `date/location` 变化不再自动切场；只有显式 `# openplay: scene_transition=switch` 才会轮换内部 scene key。
- [x] Director 会话边界接入场景边界：新建 Director 会话会自动轮换内部 scene key，不再复用旧会话的场景连续性。
- [x] Embody 显式注入场景时间地点：Character 子代理每轮固定收到从 `runtime.yaml` 抽取的当前时间/地点锚点，降低连续子会话中的日期地点幻觉。

## Changelog

- 2026-06-29: 为 `openplay-ui` 补齐会话级高保真 Trace 链路：Session 现持久化 `trace.enabled` 并在 Character/子代理会话创建时自动继承；模型 Trace 独立写入 `~/.local/share/openplay/log/model-trace/`，按会话+日期分段 JSONL 存储，写入最近索引并仅对该目录执行 7 天保留清理。新增 `PATCH /session/:id` Trace 控制与 `GET /session/:id/trace` 阅读接口，返回原始事件与可用性/保留期元信息；WebUI 设置页新增 Trace 阅读偏好，Session header 与 Roleplay 右侧面板新增显式状态/入口，统一接入新的 Trace 阅读器，可在 Readable/Raw 间切换并复制原始记录。
- 2026-06-29: 修正 Roleplay WebUI “模型轨迹”弹窗高度设置未实际生效的问题：底层通用 `Dialog` 之前只允许给内容层传 class，`x-large` 容器仍被固定在约 600px 高；现补充容器级尺寸覆盖入口，并将模型轨迹弹窗外层容器提升到更高的桌面尺寸，避免窗口继续显得过扁。
- 2026-06-29: 继续收紧 Roleplay WebUI “模型轨迹”查看器默认范围与列表密度：左侧卡片列缩窄并移除内容预览，仅保留归属/时间/目录元信息；默认只显示最近 7 天轨迹，并将该查看入口可见范围限制为最近 30 天，作为替代“自动清理旧日志”的 UI 层收口，避免误删真实会话历史。
- 2026-06-29: 修复 Roleplay WebUI “模型轨迹”弹窗卡死：不再在打开时强制拉取主会话与全部 Character 子会话的完整历史，改为先加载已缓存/首屏消息并仅渲染最近一批卡片；更早历史改为用户手动按需加载。同时将资源加载键从不稳定数组改为稳定字符串，避免响应式反复触发重复同步与重渲染。
- 2026-06-29: 调整 Roleplay WebUI “模型轨迹”弹窗可读性：增大弹窗宽高与详情区可视高度；对详情中的 Markdown / 代码块启用强制换行，避免长 JSON、长目录或单行文本横向溢出。
- 2026-06-29: Roleplay WebUI 右上角新增“模型轨迹”入口，位于“切换文件树”左侧。弹窗会补拉主会话与 Character 子会话完整历史，并按“主会话 / SubAgent / 工具调用”整理为卡片；详情页用分段代码块展示真实发送给模型的文本、角色子代理往返内容，以及工具调用的输入/输出，提升长回合审计可读性。
- 2026-06-29: 收紧 `embody` 对人物子代理的场景锚点注入：除客观环境摘要外，现额外把 `runtime.yaml` 中当前场景的时间/地点作为独立固定段落与 `environmentOverride` 明确传给 Character 子代理；优先读取 `current_scene.date/location`，缺失时回退 `environment.time/location`，并补充回归测试覆盖 `"1003-07-14 上午"` / `"今庭-荆州-襄陵县"` 这类格式。
- 2026-06-29: 人物子代理连续会话链路排查：确认 `embody` 自 2026-06-26 起按“同父 Director 会话 + 同角色 + 同 sceneKey”复用 Character 子会话；新的场景 prompt 每轮都会追加进同一子会话历史，旧轮次中角色先前的 `inner_thought` / `action_intent` / `outward_action` 也持续保留。当前实现没有按轮裁剪或总结旧场景历史，且 scene-state 默认 `keep` 仅靠显式 `scene_transition=switch` 轮换 key，因此在 runtime 已明显推进但未切 key 时，旧场景残留更容易干扰当前人物输出。
- 2026-06-27: Director `calc` 工具挡位系统重构：Tiers 改为区间语义 `[min, max)`，更新为 Mundane/Apprentice/Adept/Master/Ascendant/Transcendent 六档并附带中文描述；Delta 改为绝对差值分级 `[0,150)/[150,400)/[400,1000)/[1000,∞)`，描述同步中文化。
- 2026-06-27: `playerNudge` 主观传递放开：移除 `playerNudge` 的主观拦截限制，允许通过该字段传递主观想法、判断或结论，绕过 `sceneFacts`/`situationFrame` 等字段的主观用词拦截
- 2026-06-26: 退役 `openplay migrate-characters` CLI 迁移命令，并删除对应测试。该命令会在迁移旧平铺角色文件时按解析出的角色名重建目录，导致用户原本带“所属+名字”语义的目录名被收缩为“名字”。
- 2026-06-26: 将 Director 会话边界并入场景边界规则：`.openplay/scene-state.json` 现记录写入该场景 key 的父会话；新建 Director 会话后首次写 `runtime.yaml` 会自动切到新 scene key，即使场景内容相同也不继承旧会话连续性。
- 2026-06-26: 收紧 Director 场景切换规则：`.openplay/scene-state.json` 现默认保留当前内部 scene key，`current_scene.date/location` 的短时或短距离变化不会自动断开人物连续性；只有在 `scene_update(runtime.yaml)` 内容首行显式写入 `# openplay: scene_transition=switch` 时，程序才切换到新场景。
- 2026-06-26: 调整 Director 场景连续性设计：人物连续性锚点不再存放在 `runtime.yaml.current_scene.scene_id`；`scene_update(runtime.yaml)` 现自动维护内部 `.openplay/scene-state.json`，按 `current_scene.date/location` 保留同场景 key 或在换场时切新 key。同步移除 `openplay init` 默认生成的 `scene_id`，并更新 Director prompt / runtime 文档口径。
- 2026-06-26: 调整 Roleplay WebUI 右侧状态面板人物卡片排版：在场人物字段改为同一行展示，字段名仅保留弱强调样式，避免字段名与内容拆行。
- 2026-06-26: 增强 Roleplay WebUI 右侧状态面板交互：点击在场人物 name 会以只读悬浮对话框打开对应 `profile.yaml`，并用高亮代码块预览内容。
- 2026-06-26: 修复 Director 人物连续性回归：`embody` 连续性路径补上缺失的 `SessionID` 依赖与 effect API 修正，避免 `SessionID is not defined` / 连续性查找异常打断角色采样；当复用子会话失败时自动回退为 fresh Character 子会话继续采样。同步更新 `openplay init`，新建世界的 `runtime.yaml` 默认写入结构化 `current_scene.scene_id/date/location`，为同场景连续性提供稳定初始锚点。
- 2026-06-26: 修复 Director 模式人物连续性：`embody` 现按“同父 Director 会话 + 同角色 + 同场景”复用 Character 子会话，默认保留完整角色历史与已读取资源；新增 `runtime.yaml.current_scene.scene_id` 推荐边界字段，并在 `runtime.yaml` 缺失、损坏或被用户手改时自动 fail-open 降级，避免角色扮演因 runtime 问题卡住。
- 2026-06-26: 重构本地开发版 `openplay-ui` 启动器：不再打开 `openplay web` 的 4096 内嵌页，而是直接启动 4096 后端与 3000 Vite 开发页，并将浏览器打开到 3000 的 Roleplay 专用 UI，确保本地调试落在实际的特殊 WebUI 上。
- 2026-06-26: 修复 Roleplay WebUI 工具审计展开区代码块长行截断：`embody` sample、`scene_update`、`calc`、`dice_roll` 与 `via_narrate` 审计内容中的代码块现启用自动换行，避免超长单行 JSON / 文本在消息流中显示不全。
- 2026-06-26: 调整 Roleplay WebUI 消息流审计展示：`narrate` 下方冗余 `via_narrate` 痕迹降为低权重可折叠行；`embody` sample、`scene_update`、`calc`、`dice_roll` 等工具调用改为默认收起但可点击展开查看输入/输出过程，减少正文干扰同时保留审计可读性。
- 2026-06-26: 调整 Roleplay WebUI 右下角开发帧率面板显示条件：改为按 Director Agent 模式判断，在 Director 会话中不再渲染 `DebugBar`，避免 roleplay 界面右下角出现 FPS/性能诊断面板。
- 2026-06-26: 修复 Roleplay WebUI 右侧文件内容面板关闭后的残留占位：主消息区宽度回退现在同时依赖“右栏已开启”和“当前确有文件标签”，避免关闭文件查看后因残留 tab 状态导致左侧消息区继续被挤压。
- 2026-06-26: 修复 Roleplay WebUI 状态面板布局回归：主会话区在状态面板可见时不再占满整行，而是显式预留右栏宽度，避免场景状态面板虽然已渲染却被挤出视口外。
- 2026-06-26: 修复 Roleplay WebUI 状态面板显示条件错误：不再把全局默认 `reviewPanel.opened=true` 误判成“文件侧栏已显式打开”，恢复场景状态面板默认可见；仅当真正打开文件标签或文件树时，才临时让位给文件侧栏。
- 2026-06-26: 修复 Roleplay WebUI 状态面板可达性回归：文件/Review 侧栏打开后新增可见的关闭入口，允许用户直接返回右侧场景/角色状态面板，避免 `date/location` 等场景信息“消失”后无路切回。
- 2026-06-26: 修复 Roleplay WebUI 右侧面板交互：桌面端角色/场景侧栏改为稳定宽度；当点击“编辑 runtime.yaml”或“打开角色目录”时，roleplay 侧栏会正确让位给可见的文件/Review 侧栏；目录快捷入口默认切到 `All files`，避免落在 `Changes` 标签下看似无效。
- 2026-06-26: 修复 WebUI 启动时的残留品牌导入：`packages/app/src/index.css` 从已不存在的 `@opencode-ai/ui/styles/tailwind` 切换到 `@openplay-ai/ui/styles/tailwind`，恢复 Vite/Tailwind 样式入口解析。
- 2026-06-26: 修复 `packages/opencode/test/session/prompt.test.ts` 的过期 `sessions.messages` 调用签名，恢复仓库 `bun turbo typecheck` 通过。
- 2026-06-26: WebUI 阅读体验增强：会话时间线新增“仅看叙事 / 全部”切换，`narrate` 正文可在连续阅读视图中按顺序串读；右侧角色面板新增最近一次 Character 子代理输入/输出卡片、`records/*` 场景变更时间线，以及 `runtime.yaml` / 角色目录快捷入口。
- 2026-06-26: WebUI 阅读体验调整：阅读模式切换移到固定标题卡区域，避免用户必须滚动消息列表顶部才能找到阅读模式开关。
- 2026-06-26: WebUI 阅读体验再调整：阅读模式切换并入会话标题行右侧动作区，避免额外占用一整行并压缩消息内容区域。
- 2026-06-26: 网络启动便捷性补强：`openplay web` 新增 `--lan`，可直接绑定 `0.0.0.0` 并打印局域网访问地址；仍支持 `openplay web --hostname 0.0.0.0`。
- 2026-06-25: 收紧 Director 首工具约束：Roleplay Director 现在每轮开始时首个工具调用必须是 `scene_update`；若先调用其他工具，会被程序直接拦截并要求先更新 `runtime.yaml`。保留既有 `embody` 后必须继续走到 `narrate` 或 `question` 的回合收束约束，并补充 session prompt 回归测试。
- 2026-06-24: 修复 Director 右侧面板 `runtime.yaml` 摘要解析：`World.fromDirectory` 现兼容旧式 `current_date` + 标量 `current_scene`，并可从 `environment.time/location` 回填场景时间地点；补充 `world` 与 HTTP API 回归测试，确保右侧面板能稳定显示当前时间、地点和在场人物。
- 2026-06-24: 修复 Director `narrate` 终端渲染回退错误：CLI/run 链路不再在 completed 且 `output` 缺失时回退展示 `input.content`，避免把工具调用参数误显示成“正文叙事”；补充回归测试覆盖该场景。
- 2026-06-24: TUI `narrate` 对 completed 但空 `output` 的异常态改为显式提示 `Narrate completed without output`，不再误显示为仍在 `Narrating...`，便于区分真实无输出与渲染链路问题。
- 2026-06-08: WebUI 消息展示美化：Roleplay 工具（`embody`/`calc`/`dice_roll`/`scene_update`）默认折叠为最小化审计痕迹；`narrate` 改为居中文学卡片样式，突出叙事正文；角色面板增强为卡片化布局，带在场状态指示器与快捷编辑入口。
- 2026-06-08: 提示词模板外置（方案B）：世界目录新增 `prompts/` 子目录，`openplay init` 自动创建；Agent 系统加载时优先读取世界目录 `prompts/character.txt` 和 `prompts/director.txt`，不存在时自动回退到内置默认模板；用户可通过 WebUI 或文件编辑器直接修改，无需重新编译应用。
- 2026-06-07: Director `narrate` 新增 `primary_output` / `narrative` presentation metadata；Web 时间线改为“正文块 + 可折叠审计痕迹”，transcript 默认按 assistant 正文导出，compaction prune 保护这类 player-facing narrative 不被当普通工具输出优先裁剪。
- 2026-05-26: 修复 Director `calc` 年龄调用 schema 导出错误：`calc.type` 改用 `Schema.Literals([...])`，避免 JSON Schema 误退化为仅允许 `"date"`，并补充参数 schema 回归测试覆盖 `age`/`tier`/`delta` 枚举值。
- 2026-05-25: 角色读取链路改为目录索引 + manifest/resource 驱动；Character 通过 `character_view_read` 主动读取自身资源。
- 2026-05-25: `memory_update` 改为固定写入角色目录内 `memory.yaml`，`scene_update` 明确拒绝角色资源路径。
- 2026-05-25: `openplay init` 不再创建顶层 `memories/`；当时曾新增 `openplay migrate-characters` 迁移命令与报告输出，该命令已于 2026-06-26 退役。
- 2026-05-26: 当时补齐 `openplay migrate-characters` 迁移命令测试，覆盖旧平铺角色文件、顶层 `memories/`、gm notes 与知识资源迁移；对应命令与测试已于 2026-06-26 删除。
- 2026-05-26: 收紧 `runtime.yaml` 文档措辞，去掉仍显旧式的“玩家不应直接编辑”表述。
- 2026-05-26: 手工完成 `/home/refzhu/airp/xdworld` 剩余角色目录化迁移，补齐 `孟缘`、`沈烟`、`李昀` 的 `profile.yaml`，为缺失角色补建 `memory.yaml`，并将绑定表统一切到 `characters/<dir>/{profile,memory}.yaml`。
- 2026-05-26: 清理 `/home/refzhu/airp/xdworld` 的旧平铺角色文件、顶层 `memories/*.yaml` 与冗余 `遐蝶_Hidden/` 目录，仅保留目录化角色资源结构。
- 2026-05-26: Character 长期知识自治增强：新增 `knowledge_update` / `knowledge_reflect`，角色可在自身 `knowledge/**` 下沉淀与修订对社会、自然、身体感知及其他人物的长期认知。
- 2026-05-26: Character 目录资源补强：`readManifest` 会为角色目录自动补齐 starter knowledge 文件，默认提供 `social_and_world.md`、`nature_and_body.md`、`knowledge/people/README.md`。
- 2026-05-26: Character/Director prompt 扩展知识库分工：将 episodic memory 与 durable knowledge 明确分离，Director 不再通过 `scene_update` 越权改写角色知识资源。
- 2026-05-26: `embody` 新增结构化 `sceneEvents` 输入；Director 可把当前场景中的 speech / outward action / objective result 以 JSON 完整传给 Character，避免被摘要压扁。
- 2026-05-26: `embody` 结构化事件隔离收紧：程序级拒绝 `inner_thought`、emotion、intent、plan 等他人主观字段进入 Character SubAgent，并对 `sceneEvents` 中残留的 God Only 字符串执行同样过滤。
- 2026-06-04: Director 模式角色子代理 prompt 重构：收紧 `character.txt` 为角色基线约束，`embody` 改为变量化场景模板，向 Character 明确注入“你是谁、你身在何处、你此刻如何感到并会怎样反应”的临场信息；`sceneEvents` 同步改为更贴近角色感知的可读呈现，并移除“这不是什么题”一类否定式提示语。
- 2026-06-29: 知识文件目录契约明确化：移除 `knowledge/people/` 子目录，改为在 `knowledge/` 一级目录下直接创建特定人物/地区/势力的 `.md` 文件；新增 `world_base.yaml` 作为整体世界观与自然规则文件；在 `knowledge_reflect`、`knowledge_update`、Director prompt 中明确区分整体性文件（`world_base.yaml`、`social_and_world.md`、`nature_and_body.md`）与特定对象文件（`<name>.md`）；明确角色数值/能力/经历/身份/观念应写入 `profile.yaml` 而非知识文件。
- 2026-06-29: 知识文件目录契约补充：明确 `profile.yaml` 用于角色自身的 attributes/abilities/experience/mindModel/role/appearance，他人信息在 `knowledge/<name>.md` 处理；要求创建新知识文件前检查现有文件避免重复。
- 2026-06-29: 修复 `openplay-ui` 右上角重复 Trace 阅读器入口：会话 header 现只保留通用 Trace 阅读器按钮，移除 roleplay 模式下重复显示的旧审计图标，避免同一功能出现两个入口。
