import { describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { ensureSessionWorldColumns } from "@/storage/db"

describe("ensureSessionWorldColumns", () => {
  test("adds missing world columns to an existing session table", () => {
    const sqlite = new BunDatabase(":memory:")
    sqlite.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        directory TEXT NOT NULL,
        title TEXT NOT NULL,
        version TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      );
    `)

    const db = drizzle({ client: sqlite })
    ensureSessionWorldColumns(db)

    const columns = sqlite
      .query("PRAGMA table_info(session)")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(columns).toContain("world_id")
    expect(columns).toContain("world_path")
  })

  test("is idempotent when world columns already exist", () => {
    const sqlite = new BunDatabase(":memory:")
    sqlite.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        directory TEXT NOT NULL,
        title TEXT NOT NULL,
        version TEXT NOT NULL,
        world_id TEXT,
        world_path TEXT,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      );
    `)

    const db = drizzle({ client: sqlite })

    expect(() => ensureSessionWorldColumns(db)).not.toThrow()
    expect(() => ensureSessionWorldColumns(db)).not.toThrow()
  })
})
