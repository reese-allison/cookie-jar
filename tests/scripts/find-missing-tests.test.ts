import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findMissing } from "../../scripts/find-missing-tests.mjs";

let root: string;
let srcRoot: string;
let testRoot: string;

function write(path: string, content = "") {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cj-find-missing-"));
  srcRoot = join(root, "src");
  testRoot = join(root, "tests");
  mkdirSync(srcRoot, { recursive: true });
  mkdirSync(testRoot, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("findMissing", () => {
  it("returns empty when every source file has a mirrored test", () => {
    write("src/components/Foo.tsx");
    write("tests/components/Foo.test.tsx");
    expect(findMissing(srcRoot, testRoot)).toEqual([]);
  });

  it("flags source files without any mirrored test", () => {
    write("src/components/Foo.tsx");
    write("src/components/Bar.tsx");
    write("tests/components/Foo.test.tsx");
    const missing = findMissing(srcRoot, testRoot);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("Bar.tsx");
  });

  it("accepts descriptor-suffixed test files (Foo.starPlacement.test.tsx)", () => {
    write("src/components/RoomView.tsx");
    write("tests/components/RoomView.starPlacement.test.tsx");
    expect(findMissing(srcRoot, testRoot)).toEqual([]);
  });

  it("does not match unrelated stems with shared prefix", () => {
    write("src/components/Auth.tsx");
    write("tests/components/AuthHeader.test.tsx");
    const missing = findMissing(srcRoot, testRoot);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("Auth.tsx");
  });

  it("recurses into subdirectories", () => {
    write("src/components/nested/Deep.tsx");
    write("tests/components/nested/Deep.test.tsx");
    write("src/components/nested/Other.tsx");
    const missing = findMissing(srcRoot, testRoot);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("Other.tsx");
  });

  it("ignores .d.ts and existing test files in the source tree", () => {
    write("src/components/Foo.tsx");
    write("src/components/Foo.test.tsx");
    write("src/components/types.d.ts");
    write("tests/components/Foo.test.tsx");
    expect(findMissing(srcRoot, testRoot)).toEqual([]);
  });

  it("treats a missing mirrored test directory as no coverage", () => {
    write("src/components/Foo.tsx");
    const missing = findMissing(srcRoot, testRoot);
    expect(missing).toHaveLength(1);
  });
});
