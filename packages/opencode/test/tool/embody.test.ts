import { describe, expect, test } from "bun:test"
import { buildCharacterSelfKnowledge } from "@/tool/embody"
import { filterL2View, type ForbiddenSet } from "@/tool/god-only-filter"

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
})
