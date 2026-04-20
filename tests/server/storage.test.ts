import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildStorageFromEnv, createLocalDiskStorage } from "../../src/server/storage";
import { createS3Storage } from "../../src/server/storage/S3Storage";

describe("LocalDiskStorage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cj-storage-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the body and returns a prefixed URL", async () => {
    const storage = createLocalDiskStorage(dir);
    const url = await storage.put("abc.png", Buffer.from("hello"), "image/png");
    expect(url).toBe("/uploads/abc.png");
    expect(readFileSync(join(dir, "abc.png"), "utf-8")).toBe("hello");
  });

  it("honors a custom URL prefix", async () => {
    const storage = createLocalDiskStorage(dir, "/my-assets");
    const url = await storage.put("x.gif", Buffer.from(""), "image/gif");
    expect(url).toBe("/my-assets/x.gif");
  });
});

describe("S3Storage", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
  });

  it("sends PutObject with bucket, key, body, content type", async () => {
    const storage = createS3Storage(
      {
        bucket: "my-bucket",
        region: "auto",
        endpoint: "https://acct.r2.cloudflarestorage.com",
        accessKeyId: "k",
        secretAccessKey: "s",
      },
      new S3Client({}),
    );
    const url = await storage.put("img/1.png", Buffer.from("payload"), "image/png");
    const call = s3Mock.commandCalls(PutObjectCommand)[0];
    expect(call.args[0].input.Bucket).toBe("my-bucket");
    expect(call.args[0].input.Key).toBe("img/1.png");
    expect(call.args[0].input.ContentType).toBe("image/png");
    expect(call.args[0].input.CacheControl).toContain("immutable");
    expect(url).toBe("https://acct.r2.cloudflarestorage.com/my-bucket/img/1.png");
  });

  it("uses publicUrlBase when provided (custom CDN domain)", async () => {
    const storage = createS3Storage(
      {
        bucket: "my-bucket",
        region: "auto",
        accessKeyId: "k",
        secretAccessKey: "s",
        publicUrlBase: "https://cdn.example.com",
      },
      new S3Client({}),
    );
    const url = await storage.put("x.png", Buffer.from("x"), "image/png");
    expect(url).toBe("https://cdn.example.com/x.png");
  });
});

describe("buildStorageFromEnv", () => {
  it("defaults to local disk when STORAGE_BACKEND unset", async () => {
    const storage = buildStorageFromEnv({ UPLOAD_DIR: tmpdir() });
    // put + URL shape is enough — we already tested the backend above
    const url = await storage.put("env-test.png", Buffer.from(""), "image/png");
    expect(url).toMatch(/^\/uploads\/env-test\.png$/);
  });

  it("throws when STORAGE_BACKEND=s3 but credentials missing", () => {
    expect(() => buildStorageFromEnv({ STORAGE_BACKEND: "s3" })).toThrow(/S3_BUCKET/);
  });

  it("builds an S3 storage when env is complete", () => {
    const storage = buildStorageFromEnv({
      STORAGE_BACKEND: "s3",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
      S3_ENDPOINT: "https://foo.r2.cloudflarestorage.com",
      S3_PUBLIC_URL_BASE: "https://cdn.example.com",
    });
    expect(storage).toBeDefined();
  });
});
