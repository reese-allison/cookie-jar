import { describe, expect, it } from "vitest";
import { sniffMime } from "../../../src/server/storage/sniff";

const buf = (...bytes: number[]) => Buffer.from(bytes);
const ascii = (s: string, ...tail: number[]) => Buffer.concat([Buffer.from(s), Buffer.from(tail)]);

describe("sniffMime", () => {
  it("identifies PNG", () => {
    expect(sniffMime(buf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe("image/png");
  });

  it("identifies JPEG", () => {
    expect(sniffMime(buf(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  });

  it("identifies GIF87a and GIF89a", () => {
    expect(sniffMime(Buffer.from("GIF87a"))).toBe("image/gif");
    expect(sniffMime(Buffer.from("GIF89a"))).toBe("image/gif");
  });

  it("identifies WebP by RIFF...WEBP", () => {
    // RIFF <4 bytes size> WEBP
    const header = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WEBP"),
    ]);
    expect(sniffMime(header)).toBe("image/webp");
  });

  it("identifies WAV by RIFF...WAVE", () => {
    const header = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WAVE"),
    ]);
    expect(sniffMime(header)).toBe("audio/wav");
  });

  it("identifies MP3 by ID3 and frame sync", () => {
    expect(sniffMime(ascii("ID3", 0x04, 0x00))).toBe("audio/mpeg");
    expect(sniffMime(buf(0xff, 0xfb, 0x90))).toBe("audio/mpeg");
  });

  it("identifies OGG", () => {
    expect(sniffMime(Buffer.from("OggS\0"))).toBe("audio/ogg");
  });

  it("identifies WebM/EBML", () => {
    expect(sniffMime(buf(0x1a, 0x45, 0xdf, 0xa3))).toBe("audio/webm");
  });

  it("rejects HTML disguised as PNG", () => {
    // This is the attack: a real HTML/JS file sent with Content-Type: image/png
    const html = Buffer.from("<!DOCTYPE html><script>alert(1)</script>");
    expect(sniffMime(html)).toBeNull();
  });

  it("rejects raw SVG (explicitly disallowed)", () => {
    expect(sniffMime(Buffer.from("<svg xmlns"))).toBeNull();
  });

  it("returns null for random bytes", () => {
    expect(sniffMime(buf(0x00, 0x01, 0x02, 0x03))).toBeNull();
  });

  it("returns null for buffers shorter than any signature", () => {
    expect(sniffMime(buf())).toBeNull();
    expect(sniffMime(buf(0x89))).toBeNull();
  });
});
