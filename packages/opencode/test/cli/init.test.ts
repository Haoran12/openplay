import { describe, expect, test } from "bun:test"
import { generateOpenplayJson, generateRuntimeYaml } from "../../src/cli/cmd/init"

describe("cli.init runtime yaml", () => {
  test("writes a string provider/model for the director config", () => {
    const config = JSON.parse(generateOpenplayJson("1003-07-14"))

    expect(config.roleplay.worldPath).toBe(".")
    expect(config.agent.director.model).toBe("anthropic/claude-sonnet-4-20250514")
  })

  test("writes structured current scene fields without embedding scene_id", () => {
    const yaml = generateRuntimeYaml({
      currentDate: "1003-07-14",
      presentCharacters: ["孟缘", "宋祈"],
      currentScene: "云梦泽 建木府 主卧",
    })

    expect(yaml).toContain("current_scene:")
    expect(yaml).toContain("date: 1003-07-14")
    expect(yaml).toContain("location: 云梦泽 建木府 主卧")
    expect(yaml).not.toContain("scene_id:")
  })

  test("still initializes a fallback current scene block when current scene is empty", () => {
    const yaml = generateRuntimeYaml({
      currentDate: "1003-07-14",
      presentCharacters: [],
      currentScene: "",
    })

    expect(yaml).toContain("date: 1003-07-14")
    expect(yaml).toContain("location: null")
    expect(yaml).not.toContain("scene_id:")
  })
})
