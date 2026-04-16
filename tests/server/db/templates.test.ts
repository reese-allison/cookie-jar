import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as noteQueries from "../../../src/server/db/queries/notes";
import * as userQueries from "../../../src/server/db/queries/users";

let pool: pg.Pool;
let templateOwnerId: string;
let cloneOwnerId: string;

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
  });
  const owner = await userQueries.createUser(pool, {
    displayName: "Template Owner",
    email: "template-owner@example.com",
  });
  templateOwnerId = owner.id;

  const cloner = await userQueries.createUser(pool, {
    displayName: "Cloner",
    email: "cloner@example.com",
  });
  cloneOwnerId = cloner.id;
});

beforeEach(async () => {
  await pool.query("DELETE FROM jars WHERE owner_id IN ($1, $2)", [templateOwnerId, cloneOwnerId]);
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [templateOwnerId, cloneOwnerId]);
  await pool.end();
});

describe("jar templates", () => {
  it("creates a template jar", async () => {
    const jar = await jarQueries.createJar(pool, {
      ownerId: templateOwnerId,
      name: "Writing Prompts",
      isTemplate: true,
      isPublic: true,
    });

    expect(jar.isTemplate).toBe(true);
    expect(jar.isPublic).toBe(true);
  });

  it("lists only template jars", async () => {
    await jarQueries.createJar(pool, {
      ownerId: templateOwnerId,
      name: "Template Jar",
      isTemplate: true,
    });
    await jarQueries.createJar(pool, {
      ownerId: templateOwnerId,
      name: "Regular Jar",
    });

    const templates = await jarQueries.listTemplates(pool);
    const names = templates.map((t) => t.name);
    expect(names).toContain("Template Jar");
    expect(names).not.toContain("Regular Jar");
  });
});

describe("jar cloning", () => {
  it("clones a jar with all its notes", async () => {
    const source = await jarQueries.createJar(pool, {
      ownerId: templateOwnerId,
      name: "Date Night Ideas",
      isTemplate: true,
      config: {
        noteVisibility: "open",
        pullVisibility: "shared",
        sealedRevealCount: 1,
        showAuthors: false,
        showPulledBy: true,
      },
    });

    await noteQueries.createNote(pool, {
      jarId: source.id,
      text: "Picnic in the park",
      style: "sticky",
    });
    await noteQueries.createNote(pool, {
      jarId: source.id,
      text: "Cook a new recipe",
      style: "sticky",
    });
    await noteQueries.createNote(pool, {
      jarId: source.id,
      text: "Movie marathon",
      style: "sticky",
    });

    const cloned = await jarQueries.cloneJar(pool, source.id, cloneOwnerId);

    expect(cloned).not.toBeNull();
    expect(cloned?.name).toBe("Date Night Ideas");
    expect(cloned?.ownerId).toBe(cloneOwnerId);
    expect(cloned?.isTemplate).toBe(false);

    const notes = await noteQueries.listNotesByJar(pool, cloned?.id);
    expect(notes).toHaveLength(3);
    expect(notes.every((n) => n.state === "in_jar")).toBe(true);
  });

  it("does not clone discarded notes", async () => {
    const source = await jarQueries.createJar(pool, {
      ownerId: templateOwnerId,
      name: "Source Jar",
      isTemplate: true,
    });

    const _keep = await noteQueries.createNote(pool, {
      jarId: source.id,
      text: "Keep",
      style: "sticky",
    });
    const discard = await noteQueries.createNote(pool, {
      jarId: source.id,
      text: "Discard",
      style: "sticky",
    });
    await noteQueries.updateNoteState(pool, discard.id, "discarded");

    const cloned = await jarQueries.cloneJar(pool, source.id, cloneOwnerId);
    const notes = await noteQueries.listNotesByJar(pool, cloned?.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe("Keep");
  });

  it("returns null when cloning non-existent jar", async () => {
    const result = await jarQueries.cloneJar(
      pool,
      "00000000-0000-0000-0000-000000000000",
      cloneOwnerId,
    );
    expect(result).toBeNull();
  });
});
