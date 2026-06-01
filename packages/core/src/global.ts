import path from "path"
import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { Flag } from "./flag/flag"

const app = "openplay"
const legacyApp = "opencode"
const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)
const tmp = path.join(os.tmpdir(), app)

async function exists(target: string) {
  try {
    await fs.lstat(target)
    return true
  } catch {
    return false
  }
}

async function copyMissing(src: string, dst: string) {
  if (await exists(dst)) return
  if (!(await exists(src))) return
  await fs.mkdir(path.dirname(dst), { recursive: true })
  await fs.copyFile(src, dst)
}

async function mergeTree(src: string, dst: string, options?: { skip?: (name: string, src: string, dst: string) => boolean }) {
  if (!(await exists(src))) return
  const stat = await fs.lstat(src)
  if (stat.isSymbolicLink()) {
    if (await exists(dst)) return
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.symlink(await fs.readlink(src), dst)
    return
  }
  if (!stat.isDirectory()) {
    await copyMissing(src, dst)
    return
  }

  await fs.mkdir(dst, { recursive: true })
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const nextSrc = path.join(src, entry.name)
    const nextDst = path.join(dst, entry.name)
    if (options?.skip?.(entry.name, nextSrc, nextDst)) continue
    await mergeTree(nextSrc, nextDst, options)
  }
}

const paths = {
  get home() {
    return process.env.OPENCODE_TEST_HOME ?? os.homedir()
  },
  data,
  dataLegacy: path.join(xdgData!, legacyApp),
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  logLegacy: path.join(xdgData!, legacyApp, "log"),
  repos: path.join(data, "repos"),
  cache,
  cacheLegacy: path.join(xdgCache!, legacyApp),
  config,
  configLegacy: path.join(xdgConfig!, legacyApp),
  state,
  stateLegacy: path.join(xdgState!, legacyApp),
  tmp,
}

export const Path = paths

Flock.setGlobal({ state })

await (async () => {
  const dbSkip = /^opencode(?:-[a-zA-Z0-9._-]+)?\.db$/
  await mergeTree(paths.dataLegacy, paths.data, {
    skip: (name) => dbSkip.test(name),
  })
  await mergeTree(paths.cacheLegacy, paths.cache)
  await mergeTree(paths.stateLegacy, paths.state)
  await mergeTree(paths.configLegacy, paths.config, {
    skip: (name) => name === "opencode.json" || name === "opencode.jsonc",
  })
  await copyMissing(path.join(paths.configLegacy, "opencode.jsonc"), path.join(paths.config, "openplay.jsonc"))
  await copyMissing(path.join(paths.configLegacy, "opencode.json"), path.join(paths.config, "openplay.json"))

  if (await exists(path.join(paths.dataLegacy, "opencode.db"))) {
    await copyMissing(path.join(paths.dataLegacy, "opencode.db"), path.join(paths.data, "openplay.db"))
  }
  if (await exists(paths.dataLegacy)) {
    for (const entry of await fs.readdir(paths.dataLegacy)) {
      const match = /^opencode-(.+)\.db$/.exec(entry)
      if (!match) continue
      await copyMissing(path.join(paths.dataLegacy, entry), path.join(paths.data, `openplay-${match[1]}.db`))
    }
  }
})()

await Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.tmp, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
  fs.mkdir(Path.repos, { recursive: true }),
])

export class Service extends Context.Service<Service, Interface>()("@opencode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly dataLegacy: string
  readonly cache: string
  readonly cacheLegacy: string
  readonly config: string
  readonly configLegacy: string
  readonly state: string
  readonly stateLegacy: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
  readonly logLegacy: string
  readonly repos: string
}

export function make(input: Partial<Interface> = {}): Interface {
  return {
    home: Path.home,
    data: Path.data,
    dataLegacy: Path.dataLegacy,
    cache: Path.cache,
    cacheLegacy: Path.cacheLegacy,
    config: Flag.OPENCODE_CONFIG_DIR ?? Path.config,
    configLegacy: Path.configLegacy,
    state: Path.state,
    stateLegacy: Path.stateLegacy,
    tmp: Path.tmp,
    bin: Path.bin,
    log: Path.log,
    logLegacy: Path.logLegacy,
    repos: Path.repos,
    ...input,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const defaultLayer = layer

export const layerWith = (input: Partial<Interface>) =>
  Layer.effect(
    Service,
    Effect.sync(() => Service.of(make(input))),
  )

export * as Global from "./global"
