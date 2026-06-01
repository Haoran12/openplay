export * as CharacterSession from "./character-session"

import { Effect } from "effect"
import { Session } from "@/session/session"
import type * as Tool from "./tool"

export function parseCharacterSessionTitle(title: string): string | undefined {
  const match = title.match(/^Character:\s*(.+)$/)
  const character = match?.[1]?.trim()
  return character ? character : undefined
}

export const resolveCurrentCharacter = Effect.fn("CharacterSession.resolveCurrentCharacter")(function* (ctx: Pick<
  Tool.Context,
  "sessionID" | "roleplayCharacter"
>) {
  if (ctx.roleplayCharacter && ctx.roleplayCharacter !== "character") {
    return ctx.roleplayCharacter
  }
  const sessions = yield* Session.Service
  const session = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
  return parseCharacterSessionTitle(session.title)
})
