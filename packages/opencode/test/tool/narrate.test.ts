import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import * as ConfigRoleplay from "@/config/roleplay"
import { ModelID, ProviderID } from "@/provider/schema"
import { Session } from "@/session/session"
import type { SessionPrompt } from "@/session/prompt"
import { MessageID, PartID, SessionID } from "@/session/schema"
import {
  buildNarrateSystemPrompt,
  formatCharacterSamplesSection,
  NarrateTool,
} from "@/tool/narrate"
import type { TaskPromptOps } from "@/tool/task"
import { Truncate } from "@/tool/truncate"

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

function reply(input: SessionPrompt.PromptInput, text: string) {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant" as const,
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "director",
      agent: input.agent ?? "director",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop" as const,
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text" as const,
        text,
      },
    ],
  }
}

function fakeAgent(name: string) {
  return {
    name,
    mode: "primary",
    permission: [],
    options: {},
  } as unknown as Agent.Info
}

function buildTool(options?: {
  config?: Partial<Config.Info>
  sessionModel?: { id: string; providerID: string }
  sessionAgent?: string
}) {
  const fakeSessions: Session.Interface = {
    get: (id: SessionID) =>
      Effect.succeed({
        id,
        slug: "director-session",
        projectID: "proj_1" as any,
        directory: "/tmp/world",
        title: "Director Session",
        agent: options?.sessionAgent ?? "director",
        model: options?.sessionModel
          ? {
              id: ModelID.make(options.sessionModel.id),
              providerID: ProviderID.make(options.sessionModel.providerID),
            }
          : undefined,
        version: "1",
        time: { created: 1, updated: 1 },
        permission: [],
      } as Session.Info),
  } as unknown as Session.Interface

  const fakeAgents: Agent.Interface = {
    get: (name: string) => Effect.succeed(fakeAgent(name)),
  } as unknown as Agent.Interface

  const fakeConfig: Config.Interface = {
    get: () =>
      Effect.succeed({
        model: "anthropic/claude-sonnet-4-20250514",
        ...options?.config,
      } as Config.Info),
  } as unknown as Config.Interface

  return Effect.gen(function* () {
    const info = yield* NarrateTool
    return yield* info.init()
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Truncate.defaultLayer,
        Layer.succeed(Session.Service, fakeSessions),
        Layer.succeed(Agent.Service, fakeAgents),
        Layer.succeed(Config.Service, fakeConfig),
      ),
    ),
  )
}

function promptOps(input: {
  text?: string
  onPrompt?: (value: SessionPrompt.PromptInput) => void
  fail?: boolean
}): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: () => Effect.succeed([]),
    loop: () => Effect.die("unused"),
    prompt: (value) =>
      Effect.sync(() => {
        input.onPrompt?.(value)
        if (input.fail) throw new Error("provider timeout")
        return reply(value, input.text ?? "夜风穿过竹影，檐下静了一瞬。")
      }),
  }
}

function ctx(ops?: TaskPromptOps) {
  return {
    sessionID: SessionID.make("ses_director"),
    messageID: MessageID.make("msg_director"),
    agent: "director",
    abort: new AbortController().signal,
    extra: ops ? { promptOps: ops } : undefined,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

describe("tool.narrate", () => {
  test("reads roleplay narrateModel and generates narrative from structured input", async () => {
    const tool = await Effect.runPromise(
      buildTool({
        config: {
          roleplay: {
            narrateModel: "openai/gpt-5-mini",
          } as ConfigRoleplay.Info,
        },
        sessionModel: { providerID: "anthropic", id: "claude-sonnet-4-20250514" },
      }),
    )

    let seen: SessionPrompt.PromptInput | undefined
    const result = await Effect.runPromise(
      tool.execute(
        {
          scene: {
            time: "灵历一零零三年七月十四日，夜半",
            location: "襄陵县竹舍",
            environment: "竹影摇晃，檐角还有未散的雨气。",
          },
          characterSamples: [
            {
              name: "孟缘",
              speech: "既已到了，何不进来说话？",
              outwardAction: "抬眼望向门扉，指尖在案沿轻轻一叩。",
              innerThought: "门外来人来得比预料更快。",
            },
          ],
          outcomes: "门外之人停步，屋内气氛由静转紧，场面将进入对话。",
          perspective: "第三人称客观",
        },
        ctx(promptOps({ onPrompt: (value) => (seen = value), text: "门外脚步一顿，竹舍里烛影轻摇。" })),
      ),
    )

    expect(result.output).toBe("门外脚步一顿，竹舍里烛影轻摇。")
    expect(result.metadata.source).toBe("generated")
    expect(seen?.model).toEqual({
      providerID: ProviderID.make("openai"),
      modelID: ModelID.make("gpt-5-mini"),
    })
    expect(seen?.agent).toBe("director")
    expect(seen?.tools).toEqual({ "*": false })
    expect(seen?.system).toContain("只描写可见、可闻、可感的外部行为与对话")
  })

  test("falls back to direct content when llm generation fails", async () => {
    const tool = await Effect.runPromise(buildTool())
    const result = await Effect.runPromise(
      tool.execute(
        {
          scene: {
            time: "夜里",
            location: "竹舍门前",
          },
          outcomes: "两人之间的气氛骤然紧绷。",
          content: "夜色压在檐下，话未出口，气息先紧了起来。",
        },
        ctx(promptOps({ fail: true })),
      ),
    )

    expect(result.output).toBe("夜色压在檐下，话未出口，气息先紧了起来。")
    expect(result.metadata.source).toBe("fallback")
  })

  test("accepts yaml-like scene and characterSamples blocks from director tool calls", async () => {
    const tool = await Effect.runPromise(buildTool())

    let seen: SessionPrompt.PromptInput | undefined
    const result = await Effect.runPromise(
      tool.execute(
        {
          scene: `time: 1003-07-14 申时（约15:45）
location: 襄陵县城西北-吴宅主宅内院厅堂
environment: 盛夏午后，日光斜照入堂，院外蝉鸣阵阵。室内较凉爽，有草药气息和淡淡檀香。吴家护卫守卫宅院。`,
          characterSamples: `- name: 吴执
  speech: 好了，都去准备吧。
  outwardAction: 缓缓站起身，手按在腰间铁令上。
- name: 吴钺
  speech: 是。三日之内，两处渡口阵法加固完毕。
  outwardAction: 起身抱拳行礼，随即垂首告退`,
          outcomes: "厅堂内的会面结束，各方开始各自行动。",
          perspective: "第三人称客观",
          style: "沉稳凝练，收尾氛围",
        },
        ctx(promptOps({ onPrompt: (value) => (seen = value), text: "众人领命散去，厅中余香未散。" })),
      ),
    )

    expect(result.output).toBe("众人领命散去，厅中余香未散。")
    expect(seen?.system).toContain("- 时间: 1003-07-14 申时（约15:45）")
    expect(seen?.system).toContain("人物: 吴执")
    expect(seen?.system).toContain("人物: 吴钺")
    expect(seen?.system).toContain("说话: 好了，都去准备吧。")
  })

  test("rejects missing input", async () => {
    const tool = await Effect.runPromise(buildTool())
    await expect(Effect.runPromise(tool.execute({} as never, ctx()))).rejects.toThrow(
      "narrate requires at least one of scene, characterSamples, outcomes, or content",
    )
  })

  test("rejects limited or first-person perspective without povCharacter", async () => {
    const tool = await Effect.runPromise(buildTool())
    await expect(
      Effect.runPromise(
        tool.execute(
          {
            content: "我望着门外那道影子，没有立刻出声。",
            perspective: "第一人称",
          },
          ctx(),
        ),
      ),
    ).rejects.toThrow("narrate requires povCharacter when perspective is 第一人称")
  })

  test("filters inner thoughts by selected perspective", () => {
    const section = formatCharacterSamplesSection(
      [
        {
          name: "孟缘",
          speech: "进来。",
          outwardAction: "微微抬手。",
          innerThought: "她想先看看来人的态度。",
        },
        {
          name: "宋祈",
          speech: "我只是来看看你。",
          outwardAction: "停在门外，没有立刻跨过门槛。",
          innerThought: "先试探她的反应。",
        },
      ],
      "第三人称限知",
      "孟缘",
    )

    expect(section).toContain("人物: 孟缘")
    expect(section).toContain("内心: 她想先看看来人的态度。")
    expect(section).not.toContain("内心: 先试探她的反应。")
  })

  test("builds narrate system prompt with pov and style guidance", () => {
    const prompt = buildNarrateSystemPrompt({
      scene: {
        time: "灵历一零零三年七月十四日，夜半",
        location: "襄陵县竹舍",
      },
      characterSamples: [
        {
          name: "孟缘",
          speech: "你终于来了。",
          outwardAction: "抬起眼看向门口。",
          innerThought: "她并不想让对方看出自己方才失神。",
        },
      ],
      outcomes: "门外之人推门而入，正式对话开始。",
      additionalNotes: "重点写出门内门外对峙的停顿感。",
      style: "克制、压低声势、以动作细节推进",
      perspective: "第一人称",
      povCharacter: "孟缘",
    })

    expect(prompt).toContain("以 孟缘 的第一人称叙述")
    expect(prompt).toContain("### 补充说明")
    expect(prompt).toContain("### 额外风格提示")
    expect(prompt).toContain("内心: 她并不想让对方看出自己方才失神。")
  })

  test("roleplay config schema accepts narrateModel", () => {
    const decoded = Schema.decodeUnknownSync(ConfigRoleplay.Info)({
      narrateModel: "openai/gpt-5-mini",
    })

    expect(decoded.narrateModel).toBe("openai/gpt-5-mini")
  })
})
