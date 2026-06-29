import { Binary } from "@openplay-ai/core/util/binary"
import { base64Encode } from "@openplay-ai/core/util/encode"
import type { Session } from "@openplay-ai/sdk/v2/client"

export function upsertSession(list: Session[], info: Session) {
  const result = Binary.search(list, info.id, (item) => item.id)
  const next = [...list]
  if (result.found) {
    next[result.index] = info
    return next
  }
  next.splice(result.index, 0, info)
  return next
}

type EnsureSessionInput = {
  currentSessionID?: string
  directory: string
  createSession: () => Promise<Session | undefined>
  onCreated: (session: Session) => void
  promoteSession: (directory: string, sessionID: string) => void
  handoffTabs?: (directorySlug: string, sessionID: string) => void
  navigate: (href: string) => void
}

export async function ensureSession(input: EnsureSessionInput) {
  if (input.currentSessionID) return input.currentSessionID

  const created = await input.createSession()
  if (!created) return

  input.onCreated(created)
  input.promoteSession(input.directory, created.id)

  const directorySlug = base64Encode(input.directory)
  input.handoffTabs?.(directorySlug, created.id)
  input.navigate(`/${directorySlug}/session/${created.id}`)

  return created.id
}
