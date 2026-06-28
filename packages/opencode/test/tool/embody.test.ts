import { describe, expect, test } from "bun:test"
import {
  buildCharacterSettingSection,
  buildRoleplayEnvironmentOverride,
  buildCharacterSelfKnowledge,
  buildScenePlacement,
  buildSubagentSystemPrompt,
  detectSubjectiveLeakage,
  ensureCharacterBinding,
  matchReusableRoleplaySession,
  formatSceneEventsSection,
  inferCharacterBindingsFromFiles,
  EmbodyTool,
  resolveRuntimeSceneKey,
  sanitizeSceneEvents,
  tryParseCharacterSample,
} from "@/tool/embody"
import { readManifest, resolveForCharacter } from "@/tool/character-directory"
import { filterL2View, type ForbiddenSet } from "@/tool/god-only-filter"
import { GodOnlyFilter } from "@/tool/god-only-filter"
import { characterMemoryPath } from "@/tool/memory-update"
import { formatMemoryEntry, normalizeMemoryFile } from "@/tool/memory-schema"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { Session } from "@/session/session"
import fs from "fs/promises"
import path from "path"
import { tmpdir, tmpdirScoped } from "../fixture/fixture"
import { Context, Effect, Layer } from "effect"
import type { TaskPromptOps } from "@/tool/task"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageID, SessionID } from "@/session/schema"
import { Truncate } from "@/tool/truncate"
import { InstanceRef } from "@/effect/instance-ref"

describe("tool.embody", () => {
  const forbiddenSet: ForbiddenSet = {
    strings: new Set(["男", "天道筑基"]),
    fileHashes: new Map(),
  }

  test("builds stable self-knowledge from character state while keeping god-only content out", () => {
    const lines = buildCharacterSelfKnowledge({
      character: "孟缘",
      characterAgent: {
        knowledgeAccess: ["Condition: 云梦泽妖族可知"],
        senses: { vision: "Master", hearing: "Adept" },
      },
      stateContent: `
name: 孟缘
gender:
  content: 女
  access: self
species:
  content: 竹妖
  apparent_content: 妖
  access: "Condition: 云梦泽妖族可知"
cultivation:
  content: 天道筑基
  access: God Only
realm:
  content: 筑基后期
  access: self
faction: 云梦泽
form:
  content: 青衣女子
  access: self
status:
  content: 左臂带伤
  access: self
`,
      forbiddenSet,
    })

    expect(lines).toContain("- Name: 孟缘")
    expect(lines).toContain("- Gender: 女")
    expect(lines).toContain("- Species: 竹妖")
    expect(lines).toContain("- Cultivation: 筑基后期")
    expect(lines).toContain("- Faction: 云梦泽")
    expect(lines).toContain("- Current form: 青衣女子")
    expect(lines).toContain("- Current state: 左臂带伤")
    expect(lines).toContain("- Sensory capabilities: vision=Master, hearing=Adept")
    expect(lines.join("\n")).not.toContain("天道筑基")
  })

  test("falls back to apparent content when condition is not satisfied", () => {
    const lines = buildCharacterSelfKnowledge({
      character: "孟缘",
      characterAgent: {
        knowledgeAccess: [],
      },
      stateContent: `
species:
  content: 龙裔妖修
  apparent_content: 妖修
  access: "Condition: 龙宫嫡系可知"
`,
    })

    expect(lines).toContain("- Species: 妖修")
    expect(lines.join("\n")).not.toContain("龙裔妖修")
  })

  test("applies god-only string stripping to self-knowledge and perception text", () => {
    const lines = buildCharacterSelfKnowledge({
      character: "孟缘",
      stateContent: `
gender: 男
cultivation:
  content: 天道筑基
  access: self
`,
      forbiddenSet,
    })

    expect(lines).toEqual(["- Name: 孟缘"])
    expect(filterL2View("你隐约察觉到天道筑基的气息。", forbiddenSet)).toBe("你隐约察觉到[已隐去]的气息。")
  })

  test("parses strict json character samples", () => {
    expect(
      tryParseCharacterSample(
        '{"inner_thought":"她终于不哭了。","speech":"别怕，我在。","action_intent":"继续抱稳她，轻声安抚。","outward_action":"下巴轻轻抵着她的发顶。"}',
      ),
    ).toEqual({
      inner_thought: "她终于不哭了。",
      speech: "别怕，我在。",
      action_intent: "继续抱稳她，轻声安抚。",
      outward_action: "下巴轻轻抵着她的发顶。",
    })
  })

  test("normalizes aliased fields from parsed json", () => {
    expect(
      tryParseCharacterSample(
        '{"inner_monologue":"她还小。","dialogue":"我不会不要你。","intent":"先让她安心睡会儿。","gesture":"指腹轻轻拍着她的背。"}',
      ),
    ).toEqual({
      inner_thought: "她还小。",
      speech: "我不会不要你。",
      action_intent: "先让她安心睡会儿。",
      outward_action: "指腹轻轻拍着她的背。",
    })
  })

  test("extracts embedded json from stray prose instead of failing", () => {
    expect(
      tryParseCharacterSample(
        '先给导演一个样本：\n```json\n{"inner_thought":"湖风有些凉。","speech":"","action_intent":"再把她往怀里拢紧一点。","outward_action":"抬手替她拢了拢鬓发。"}\n```',
      ),
    ).toEqual({
      inner_thought: "湖风有些凉。",
      speech: "",
      action_intent: "再把她往怀里拢紧一点。",
      outward_action: "抬手替她拢了拢鬓发。",
    })
  })

  test("returns undefined for non-json samples instead of throwing", () => {
    expect(tryParseCharacterSample("她只是低头抱紧遐蝶，没有说话，只把呼吸放得更轻。")).toBeUndefined()
  })

  test("includes explicit sensory traits in self-knowledge", () => {
    const lines = buildCharacterSelfKnowledge({
      character: "孟缘",
      characterAgent: {
        senses: { vision: "Master" },
        senseTraits: ["狐狸血脉，嗅觉敏锐", "对灵力扰动敏感"],
      },
    })

    expect(lines).toContain("- Sensory capabilities: vision=Master")
    expect(lines).toContain("- Sensory traits: 狐狸血脉，嗅觉敏锐、对灵力扰动敏感")
  })

  test("collects sensory traits from state yaml when present", () => {
    const lines = buildCharacterSelfKnowledge({
      character: "孟缘",
      stateContent: `
sense_traits:
  - 夜视优于常人
  - 对魂魄波动敏感
`,
    })

    expect(lines).toContain("- Sensory traits: 夜视优于常人、对魂魄波动敏感")
  })

  test("builds accessible setting section from non-god-only character state", () => {
    const section = buildCharacterSettingSection({
      character: "孟缘",
      stateContent: `
孟缘:
  name: 孟缘
  role:
    content: 云梦泽的大妖长老
    access: self
  relationship:
    access: "Condition: 云梦泽妖族可知"
    宋祈: 配偶关系
  hidden_truth:
    content: 被封印过
    access: God Only
`,
    })

    expect(section).toContain("name: 孟缘")
    expect(section).toContain("role: 云梦泽的大妖长老")
    expect(section).toContain("宋祈: 配偶关系")
    expect(section).not.toContain("被封印过")
  })

  test("rejects subjective leakage in objective embody inputs", () => {
    expect(
      detectSubjectiveLeakage({
        sceneFacts: "你意识到她在故意试探你。",
        situationFrame: "她站在门边看着你。",
      }),
    ).toContain("sceneFacts contains subjective interpretation")

    expect(
      detectSubjectiveLeakage({
        sceneFacts: "门外脚步停在竹阶前，烛影轻轻一晃。",
        situationFrame: "你怀疑门外的人认出了你。",
      }),
    ).toContain("situationFrame contains subjective interpretation")

    expect(
      detectSubjectiveLeakage({
        sceneFacts: "她的语气让你不由得警惕起来。",
        situationFrame: "她缓步走近，袖口还带着雨气。",
      }),
    ).toContain("sceneFacts contains subjective interpretation")

    expect(
      detectSubjectiveLeakage({
        sceneFacts: "她站在门边，指尖轻轻敲了两下门框。",
        focusHints: "重点留意她话里的试探和敌意。",
        situationFrame: "她没有立刻进门。",
      }),
    ).toContain("focusHints contains subjective interpretation")

    expect(
      detectSubjectiveLeakage({
        sceneFacts: "她站在门边，眼神短暂停在你袖口。",
        situationFrame: "她明显是在故意试探你会不会让步。",
      }),
    ).toContain("situationFrame contains subjective interpretation")

    expect(
      detectSubjectiveLeakage({
        sceneFacts: "她站在门边，袖口带着雨气。",
        situationFrame: "她刚刚停步，尚未入门。",
        sceneEvents: [
          {
            actor: "宋祈",
            inner_thought: "先试试看她会不会退。",
            speech: "我能进来吗？",
          },
        ],
      }),
    ).toContain("sceneEvents[0].inner_thought exposes another character's private subjective state")

    expect(
      detectSubjectiveLeakage({
        sceneFacts: "她站在门边，袖口带着雨气。",
        situationFrame: "她刚刚停步，尚未入门。",
        sceneEvents: [
          {
            actor: "宋祈",
            action: "抬手轻敲门框两下",
            target_intent: "逼你先表态",
          },
        ],
      }),
    ).toContain("sceneEvents[0].target_intent exposes another character's private subjective state")
  })

  test("allows structured scene events with observable speech, action, and results", () => {
    expect(
      detectSubjectiveLeakage({
        sceneFacts: "门边有潮湿雨气，竹阶上还残着水声。",
        situationFrame: "她停在门边，先敲门，再开口。",
        sceneEvents: [
          {
            type: "speech",
            actor: "宋祈",
            speech: "我能进来吗？",
          },
          {
            type: "action",
            actor: "宋祈",
            action: "指节轻轻敲了两下门框",
          },
          {
            type: "result",
            actor: "门",
            result: "门框发出两声很轻的空响",
          },
        ],
      }),
    ).toBeUndefined()
  })

  test("sanitizes god-only strings inside structured scene events", () => {
    const sceneEvents = [
      {
        actor: "宋祈",
        speech: "你身上还带着天道筑基的余波。",
        action: "抬手碰了碰你的衣袖。",
      },
    ]

    expect(sanitizeSceneEvents(sceneEvents, forbiddenSet)).toEqual([
      {
        actor: "宋祈",
        speech: "你身上还带着[已隐去]的余波。",
        action: "抬手碰了碰你的衣袖。",
      },
    ])

    expect(formatSceneEventsSection(sceneEvents)).toContain("宋祈开口：“你身上还带着天道筑基的余波。”")
    expect(formatSceneEventsSection(sceneEvents)).toContain("宋祈随后抬手碰了碰你的衣袖。")
  })

  test("builds an embodied subagent prompt with concrete scene placement", () => {
    const prompt = buildSubagentSystemPrompt({
      character: "孟缘",
      persona: "寡言，谨慎，先观人再出手。",
      selfKnowledgeSection: "- Name: 孟缘\n- Faction: 云梦泽",
      visibleResourcesSection: "profile.yaml\nmemory.yaml\nknowledge/social_and_world.md",
      scenePlacementSection: "- 当前时间：1003-07-14 上午\n- 当前地点：今庭-荆州-襄陵县",
      objectiveEnvironmentSection: "- 夜雨刚停，竹舍檐角还在滴水\n- 屋内烛火微晃，窗纸映着浅黄光",
      bodyStateSection: "- 左臂旧伤未愈，抬得太急会牵扯发痛",
      baselineSensorySection: "- 对灵力扰动敏感",
      effectiveSensorySection: "- 雨后空气潮冷，脚步声在竹阶上格外清楚",
      situationFrame: "夜色已深，门外来人停在竹阶前，还没有立刻进门。",
      sceneFacts: "你听见潮湿衣摆擦过门框的轻响，门外人的呼吸稳而不急。",
      sceneEventsSection: "- 宋祈开口：“我能进来吗？”\n- 宋祈随后指节轻轻敲了两下门框",
      focusHints: "先留意门外人的脚步、呼吸和说话时停顿的位置。",
      playerNudge: "如果现场线索足够，可以略微多留意对方语气里的迟疑。",
    })

    expect(prompt).toContain("当前角色：孟缘")
    expect(prompt).toContain("请立刻进入这个角色的当下处境。")
    expect(prompt).toContain("## 先把自己放进这一刻")
    expect(prompt).toContain("### 你此刻明确身在")
    expect(prompt).toContain("当前时间：1003-07-14 上午")
    expect(prompt).toContain("当前地点：今庭-荆州-襄陵县")
    expect(prompt).toContain("### 你所处的环境")
    expect(prompt).toContain("### 眼前的局势")
    expect(prompt).toContain("### 你刚刚亲历的言行")
    expect(prompt).toContain("宋祈开口：“我能进来吗？”")
    expect(prompt).toContain("### 玩家给你的引导")
    expect(prompt).toContain("只返回一个 JSON 对象")
  })

  test("extracts scene placement from runtime.yaml-compatible data", () => {
    expect(
      buildScenePlacement({
        runtime: {
          current_scene: {
            date: "1003-07-14 上午",
            location: "今庭-荆州-襄陵县",
          },
          environment: {
            time: "不应覆盖 current_scene.date",
            location: "不应覆盖 current_scene.location",
          },
        },
      }),
    ).toEqual({
      date: "1003-07-14 上午",
      location: "今庭-荆州-襄陵县",
    })

    expect(
      buildScenePlacement({
        runtime: {
          environment: {
            time: "1003-07-14 上午",
            location: "今庭-荆州-襄陵县",
          },
        },
      }),
    ).toEqual({
      date: "1003-07-14 上午",
      location: "今庭-荆州-襄陵县",
    })
  })

  test("builds roleplay environment override with explicit time and location", () => {
    expect(
      buildRoleplayEnvironmentOverride({
        character: "孟缘",
        scenePlacement: {
          date: "1003-07-14 上午",
          location: "今庭-荆州-襄陵县",
        },
      }),
    ).toContain("当前时间：1003-07-14 上午。")

    expect(
      buildRoleplayEnvironmentOverride({
        character: "孟缘",
        scenePlacement: {
          date: "1003-07-14 上午",
          location: "今庭-荆州-襄陵县",
        },
      }),
    ).toContain("当前地点：今庭-荆州-襄陵县。")
  })

  test("auto-creates starter knowledge resources and exposes them in manifest", async () => {
    await using dir = await tmpdir()
    const worldPath = dir.path
    const characterDir = path.join(worldPath, "characters", "孟缘")
    await fs.mkdir(characterDir, { recursive: true })
    await fs.writeFile(path.join(characterDir, "profile.yaml"), "name: 孟缘\n")
    const manifest = await Effect.runPromise(
      Effect.gen(function* () {
        const fsService = yield* AppFileSystem.Service
        const resolved = yield* resolveForCharacter({ fs: fsService, worldPath, character: "孟缘" })
        expect(resolved.info).toBeDefined()
        return yield* readManifest({ fs: fsService, info: resolved.info! })
      }).pipe(Effect.provide(AppFileSystem.defaultLayer)),
    )

    expect(manifest).toContain("profile.yaml")
    expect(manifest).toContain("knowledge/world_base.yaml")
    expect(manifest).toContain("knowledge/social_and_world.md")
    expect(manifest).toContain("knowledge/nature_and_body.md")
    expect(await fs.readFile(path.join(characterDir, "knowledge", "world_base.yaml"), "utf-8")).toContain(
      "世界观基础",
    )
    expect(await fs.readFile(path.join(characterDir, "knowledge", "social_and_world.md"), "utf-8")).toContain(
      "对社会与世道的长期认知",
    )
  })

  test("allows player nudge to pass subjective thoughts without restriction", () => {
    expect(
      detectSubjectiveLeakage({
        sceneFacts: "门外脚步停在竹阶前，烛影轻轻一晃。",
        situationFrame: "门外的人停在门前，没有立刻出声。",
        playerNudge: "如果多个客观线索都支持，请更留意对方语气中的试探意味。",
      }),
    ).toBeUndefined()

    expect(
      detectSubjectiveLeakage({
        sceneFacts: "门外脚步停在竹阶前，烛影轻轻一晃。",
        situationFrame: "门外的人停在门前，没有立刻出声。",
        playerNudge: "你已经意识到她在试探你。",
      }),
    ).toBeUndefined()

    expect(
      detectSubjectiveLeakage({
        sceneFacts: "门外脚步停在竹阶前，烛影轻轻一晃。",
        situationFrame: "门外的人停在门前，没有立刻出声。",
        playerNudge: "先把她认定为带着敌意而来。",
      }),
    ).toBeUndefined()
  })

  test("uses fixed per-character memory path", () => {
    expect(characterMemoryPath("/world", "孟缘")).toBe("/world/characters/孟缘/memory.yaml")
  })

  test("parses structured memory entries newest-first", () => {
    const file = normalizeMemoryFile(`
version: 1
entries:
  - id: old
    created_at: 2026-05-19T08:00:00.000Z
    impression: 2
    summary: 初见宋祈时，她在雨里递来一盏灯。
    time: "灵历1003年三月初二，夜"
    location: 云梦泽北岸
    scene_feeling: 湖风冷，心却松了一瞬
    observed_people: [宋祈]
    self_observation: 我接过灯，袖口还在滴水。
    others_observation: 她只说“拿着”，声音很轻。
  - id: new
    created_at: 2026-05-20T08:00:00.000Z
    impression: 4
    summary: 今日重逢时，她先认出了我的脚步声。
    time: "灵历1003年三月初三，黄昏"
    location: 旧竹桥
    scene_feeling: 风软，胸口却发紧
    observed_people: [宋祈, 遐蝶]
    self_observation: 我停在桥心，没有立刻开口。
    others_observation: 宋祈回头望来，先叫了我的名字。
`)

    expect(file.entries.map((item) => item.id)).toEqual(["new", "old"])
    expect(file.compression_policy.engraved_preserved).toBe(true)
    expect(file.compression_policy.impression_modulated).toBe(true)
    expect(formatMemoryEntry(file.entries[0])).toContain("印象 4/5")
    expect(formatMemoryEntry(file.entries[0])).toContain("时间=灵历1003年三月初三，黄昏")
    expect(formatMemoryEntry(file.entries[0])).toContain("在场人物=宋祈、遐蝶")
  })

  test("compresses older memories with human-like forgetting: recent clearer, weak faster, strong slower, engraved preserved", () => {
    const entries = Array.from({ length: 45 }, (_, index) => ({
      id: `m-${index}`,
      created_at: `2026-05-${String(45 - index).padStart(2, "0")}T08:00:00.000Z`,
      impression: index === 24 ? 5 : index === 25 ? 4 : index === 26 ? 0 : 2,
      summary: `记忆 ${index}`,
      time: `时间 ${index}`,
      location: `地点 ${index}`,
      scene_feeling: `感受 ${index}`,
      observed_people: [`人物${index}`],
      self_observation: `自己 ${index}`,
      others_observation: `他人 ${index}`,
      compression: 0,
    }))
    const file = normalizeMemoryFile(
      `entries:\n${entries
        .map(
          (entry) => `  - id: ${entry.id}
    created_at: ${entry.created_at}
    impression: ${entry.impression}
    summary: ${entry.summary}
    time: ${entry.time}
    location: ${entry.location}
    scene_feeling: ${entry.scene_feeling}
    observed_people: [${entry.observed_people[0]}]
    self_observation: ${entry.self_observation}
    others_observation: ${entry.others_observation}`,
        )
        .join("\n")}`,
    )

    const engraved = file.entries.find((item) => item.id === "m-24")
    const strong = file.entries.find((item) => item.id === "m-25")
    const weak = file.entries.find((item) => item.id === "m-26")
    const ordinary = file.entries.find((item) => item.id === "m-27")
    const recent = file.entries[0]

    expect(recent.compression).toBe(0)
    expect(engraved?.compression).toBe(0)
    expect(strong?.compression).toBe(0)
    expect(ordinary?.compression).toBe(1)
    expect(weak?.compression).toBeGreaterThan(ordinary?.compression ?? 0)
    expect(weak?.self_observation).toBe("")
  })

  test("rebalances high impressions so 4/5 do not flood each 20-memory block", () => {
    const entries = Array.from({ length: 8 }, (_, index) => ({
      id: `quota-${index}`,
      created_at: `2026-05-${String(20 - index).padStart(2, "0")}T08:00:00.000Z`,
      impression: 4,
      summary: `高印象记忆 ${index}`,
      time: `时间 ${index}`,
      location: `地点 ${index}`,
      scene_feeling: `感受 ${index}`,
      observed_people: [`人物${index}`],
      self_observation: `自己 ${index}`,
      others_observation: `他人 ${index}`,
      compression: 0,
    }))

    const file = normalizeMemoryFile({
      entries,
    })

    expect(file.entries.slice(0, 3).map((item) => item.impression)).toEqual([4, 4, 4])
    expect(file.entries.slice(3).every((item) => item.impression === 3)).toBe(true)
  })

  test("preserves only one engraved memory per 20-memory block and demotes later 5s", () => {
    const file = normalizeMemoryFile({
      entries: [
        {
          id: "engraved-newest",
          created_at: "2026-05-20T08:00:00.000Z",
          impression: 5,
          summary: "第一段刻骨记忆",
          time: "今晨",
          location: "桥头",
          scene_feeling: "发烫",
          observed_people: ["宋祈"],
          self_observation: "我停了下来。",
          others_observation: "她先叫了我。",
          compression: 0,
        },
        {
          id: "engraved-later",
          created_at: "2026-05-19T08:00:00.000Z",
          impression: 5,
          summary: "第二段也被错误标成刻骨",
          time: "昨夜",
          location: "廊下",
          scene_feeling: "沉",
          observed_people: ["宋祈"],
          self_observation: "我没有说话。",
          others_observation: "她看了我很久。",
          compression: 0,
        },
      ],
    })

    expect(file.entries[0].impression).toBe(5)
    expect(file.entries[1].impression).toBe(4)
  })

  test("migrates legacy plain text memories into highly compressed summaries", () => {
    const file = normalizeMemoryFile(`
- 她在雨夜递给我一盏灯。
- 我记得她说“回家再哭”。
    `)

    expect(file.entries).toHaveLength(2)
    expect(file.entries[0].summary).toContain("我记得她说“回家再哭”")
    expect(file.entries[1].summary).toContain("她在雨夜递给我一盏灯")
    expect(file.entries[1].compression).toBe(0)
  })

  test("accepts wrapped memory fields without assuming raw strings", () => {
    const file = normalizeMemoryFile(`
entries:
  - id:
      content: memory-1
    created_at:
      content: 2026-05-20T08:00:00.000Z
    summary:
      content: 她终于肯抬眼看我了。
      access: self
    time:
      content: 灵历1003年三月初三，夜
    location:
      content: 竹舍门前
    scene_feeling:
      content: 心口发紧，却松了一口气
    observed_people:
      - content: 宋祈
      - 遐蝶
    self_observation:
      content: 我没有再逼近，只把伞往她那边倾了倾。
    others_observation:
      content: 她抬手擦了擦眼睛，却没再躲开。
`)

    expect(file.entries).toHaveLength(1)
    expect(file.entries[0].id).toBe("memory-1")
    expect(file.entries[0].summary).toBe("她终于肯抬眼看我了。")
    expect(file.entries[0].observed_people).toEqual(["宋祈", "遐蝶"])
    expect(formatMemoryEntry(file.entries[0])).toContain("地点=竹舍门前")
  })

  test("accepts non-string memory payloads without calling trim on objects", () => {
    const file = normalizeMemoryFile({
      content: {
        entries: [
          {
            id: { content: "memory-obj-1" },
            summary: { content: "她这次没有再躲开我的目光。" },
            location: { content: "竹舍檐下" },
            observed_people: [{ content: "宋祈" }, "遐蝶"],
          },
        ],
      },
    })

    expect(file.entries).toHaveLength(1)
    expect(file.entries[0].id).toBe("memory-obj-1")
    expect(file.entries[0].summary).toBe("她这次没有再躲开我的目光。")
    expect(file.entries[0].location).toBe("竹舍檐下")
    expect(file.entries[0].observed_people).toEqual(["宋祈", "遐蝶"])
  })

  test("infers character bindings from directory profile files", () => {
    const bindings = inferCharacterBindingsFromFiles([
      {
        relativePath: "characters/云梦泽-孟缘/profile.yaml",
        content: `
孟缘:
  name: 孟缘
  aliases: [树妖]
`,
      },
      {
        relativePath: "characters/遐蝶-Hidden/profile.yaml",
        content: `
遐蝶:
  name: 遐蝶
`,
      },
      {
        relativePath: "characters/遐蝶/profile.yaml",
        content: `
name: 遐蝶
aliases: [小蝶]
`,
      },
    ])

    expect(bindings["孟缘"]).toEqual({
      memoryPath: "characters/云梦泽-孟缘/memory.yaml",
    })
    expect(bindings["遐蝶"]).toEqual({
      memoryPath: "characters/遐蝶/memory.yaml",
    })
  })
})

describe("tool.embody bindings", () => {
  test("resolves character directory binding from profile.yaml", async () => {
    const dir = await tmpdir()
    const worldPath = dir.path
    await fs.mkdir(path.join(worldPath, "characters", "云梦泽-孟缘"), { recursive: true })
    await fs.writeFile(
      path.join(worldPath, "characters", "云梦泽-孟缘", "profile.yaml"),
      `
name: 孟缘
role: 云梦泽的大妖长老
`,
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fsSvc = yield* AppFileSystem.Service
        const binding = yield* ensureCharacterBinding({
          fs: fsSvc,
          worldPath,
          character: "孟缘",
        })
        return { binding }
      }).pipe(Effect.provide(AppFileSystem.defaultLayer)),
    )

    expect(result.binding).toEqual({
      memoryPath: "characters/云梦泽-孟缘/memory.yaml",
    })

    await dir[Symbol.asyncDispose]()
  })
})

test("resolves stable scene keys and fails open when runtime is malformed", () => {
  expect(
    resolveRuntimeSceneKey({
      runtime: {
        current_scene: {
          scene_id: "scene-bamboo-night",
          date: "1003-07-14",
          location: "竹舍",
        },
      },
      parentSessionID: "ses_parent",
      character: "孟缘",
    }),
  ).toBe("scene:scene-bamboo-night")

  expect(
    resolveRuntimeSceneKey({
      runtime: {
        current_scene: {
          date: "1003-07-14",
          location: "竹舍",
        },
      },
      storedScene: {
        key: "scene:internal-key",
        date: "1003-07-13",
        location: "前庭",
        ownerSessionID: "ses_parent",
      },
      parentSessionID: "ses_parent",
      character: "孟缘",
    }),
  ).toBe("scene:internal-key")

  expect(
    resolveRuntimeSceneKey({
      runtime: {
        current_scene: {
          date: "1003-07-14",
          location: "竹舍",
        },
      },
      parentSessionID: "ses_parent",
      character: "孟缘",
    }),
  ).toBe("legacy:1003-07-14|竹舍")

  expect(
    resolveRuntimeSceneKey({
      runtime: {
        current_scene: {
          date: "1003-07-15",
          location: "前庭",
        },
      },
      storedScene: {
        key: "scene:stale-key",
        date: "1003-07-14",
        location: "竹舍",
        ownerSessionID: "ses_parent",
      },
      parentSessionID: "ses_parent",
      character: "孟缘",
    }),
  ).toBe("scene:stale-key")

  expect(
    resolveRuntimeSceneKey({
      runtime: undefined,
      storedScene: {
        key: "scene:internal-key",
        date: "1003-07-14",
        location: "竹舍",
        ownerSessionID: "ses_parent",
      },
      parentSessionID: "ses_parent",
      character: "孟缘",
    }),
  ).toBe("scene:internal-key")

  expect(
    resolveRuntimeSceneKey({
      runtime: {
        current_scene: {
          date: "1003-07-14",
          location: "竹舍",
        },
      },
      storedScene: {
        key: "scene:previous-session",
        date: "1003-07-14",
        location: "竹舍",
        ownerSessionID: "ses_other",
      },
      parentSessionID: "ses_parent",
      character: "孟缘",
    }),
  ).toBe("session:ses_parent")

  expect(
    resolveRuntimeSceneKey({
      runtime: undefined,
      parentSessionID: "ses_parent",
      character: "孟缘",
    }),
  ).toBe("ephemeral:ses_parent:孟缘")
})

test("matches reusable roleplay sessions by character, scene key, and purpose", () => {
  const children = [
    {
      id: "ses_child_1",
      slug: "a",
      projectID: "proj_1",
      directory: "/tmp",
      title: "Character: 孟缘",
      version: "1",
      time: { created: 1, updated: 1 },
      roleplayCharacter: "孟缘",
      roleplaySceneKey: "scene:scene-bamboo-night",
      roleplayPurpose: "embody" as const,
    },
    {
      id: "ses_child_2",
      slug: "b",
      projectID: "proj_1",
      directory: "/tmp",
      title: "Character: 孟缘",
      version: "1",
      time: { created: 1, updated: 1 },
      roleplayCharacter: "孟缘",
      roleplaySceneKey: "scene:other-scene",
      roleplayPurpose: "embody" as const,
    },
  ] as unknown as Session.Info[]

  expect(
    matchReusableRoleplaySession({
      children,
      character: "孟缘",
      sceneKey: "scene:scene-bamboo-night",
      purpose: "embody",
    })?.id,
  ).toBe(SessionID.make("ses_child_1"))

  expect(
    matchReusableRoleplaySession({
      children,
      character: "孟缘",
      sceneKey: "scene:scene-bamboo-night",
      purpose: "memory_reflect",
    }),
  ).toBeUndefined()
})

test("embody sampling falls back to a fresh child session when continuity lookup fails", async () => {
  const fakeSessions: Session.Interface = {
    get: (id: SessionID) =>
      Effect.succeed({
        id,
        slug: "parent",
        projectID: "proj_1" as any,
        directory: "/tmp/world",
        title: "Director Session",
        version: "1",
        time: { created: 1, updated: 1 },
        permission: [],
      } as Session.Info),
    create: () =>
      Effect.succeed({
        id: SessionID.make("ses_fresh_character"),
        slug: "child",
        projectID: "proj_1" as any,
        directory: "/tmp/world",
        parentID: SessionID.make("ses_parent"),
        title: "Character: 孟缘",
        agent: "character",
        version: "1",
        time: { created: 1, updated: 1 },
        roleplayCharacter: "孟缘",
        roleplaySceneKey: "ephemeral:ses_parent:孟缘",
        roleplayPurpose: "embody",
      } as Session.Info),
    children: (_parentID: SessionID) => Effect.fail(new Error("children lookup exploded")),
  } as unknown as Session.Interface

  const fakeAgents: Agent.Interface = {
    get: (name: string) =>
      Effect.succeed(
        name === "character"
          ? ({
              name: "character",
              mode: "subagent",
              permission: [],
              options: {},
            } as unknown as Agent.Info)
          : undefined,
      ),
  } as unknown as Agent.Interface

  const fakeConfig: Config.Interface = {
    get: () =>
      Effect.succeed({
        model: "openai/gpt-5",
      } as any),
  } as unknown as Config.Interface

  const promptOps: TaskPromptOps = {
    cancel: () => Effect.void,
    resolvePromptParts: () => Effect.succeed([]),
    loop: () => Effect.die("unused"),
    prompt: (input) =>
      Effect.succeed({
        info: {
          id: MessageID.make("msg_character_reply"),
          sessionID: input.sessionID,
          role: "assistant",
          time: { created: 1, completed: 2 },
          providerID: "openai",
          modelID: "gpt-5",
          mode: "default",
          agent: "character",
          path: { cwd: "/tmp/world", root: "/tmp/world" },
          cost: 0,
          tokens: {
            input: 1,
            output: 1,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          finish: "stop",
        },
        parts: [
          {
            id: "part_character_reply",
            sessionID: input.sessionID,
            messageID: MessageID.make("msg_character_reply"),
            type: "text",
            text: '{"inner_thought":"test","speech":"","action_intent":"","outward_action":""}',
          },
        ],
      } as any),
  }

  const tool = await Effect.runPromise(
    Effect.gen(function* () {
      const info = yield* EmbodyTool
      return yield* info.init()
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          AppFileSystem.defaultLayer,
          GodOnlyFilter.defaultLayer,
          Truncate.defaultLayer,
          Layer.succeed(Session.Service, fakeSessions),
          Layer.succeed(Agent.Service, fakeAgents),
          Layer.succeed(Config.Service, fakeConfig),
          Layer.succeed(InstanceRef, {
            directory: "/tmp/world",
            worktree: "/tmp/world",
            project: { id: "proj_1", worktree: "/tmp/world", vcs: false },
          } as any),
        ),
      ),
    ),
  )

  const result = await Effect.runPromise(
    tool.execute(
      {
        character: "孟缘",
        sceneFacts: "门外有脚步声。",
        situationFrame: "夜里，有人停在门前。",
      },
      {
        sessionID: SessionID.make("ses_parent"),
        messageID: MessageID.make("msg_parent"),
        agent: "director",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      },
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          AppFileSystem.defaultLayer,
          GodOnlyFilter.defaultLayer,
          Truncate.defaultLayer,
          Layer.succeed(Session.Service, fakeSessions),
          Layer.succeed(Agent.Service, fakeAgents),
          Layer.succeed(Config.Service, fakeConfig),
          Layer.succeed(InstanceRef, {
            directory: "/tmp/world",
            worktree: "/tmp/world",
            project: { id: "proj_1", worktree: "/tmp/world", vcs: false },
          } as any),
        ),
      ),
    ),
  )

  expect(result.metadata.subagentSessionID).toBe(SessionID.make("ses_fresh_character"))
  expect(result.output).toContain('"inner_thought": "test"')
})
