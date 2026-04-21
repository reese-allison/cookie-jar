/**
 * Magic-byte identifier for the small set of MIME types the upload route
 * accepts. Multer gives us a client-supplied `Content-Type` which is trivial
 * to spoof — we re-derive the real type from the file header before writing.
 *
 * Kept inline rather than pulling in `file-type` because we only accept eight
 * concrete types and the signatures are short, stable, and well-known.
 *
 * Returns the canonical MIME string, or null if the buffer doesn't match any
 * allowed type.
 */
export type AllowedMime =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"
  | "audio/mpeg"
  | "audio/wav"
  | "audio/ogg"
  | "audio/webm";

function startsWith(buf: Buffer, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
}

function startsWithAscii(buf: Buffer, ascii: string, offset = 0): boolean {
  if (buf.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (buf[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

export function sniffMime(buf: Buffer): AllowedMime | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // JPEG: FF D8 FF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // GIF87a / GIF89a
  if (startsWithAscii(buf, "GIF87a") || startsWithAscii(buf, "GIF89a")) return "image/gif";
  // WebP: RIFF....WEBP
  if (startsWithAscii(buf, "RIFF") && startsWithAscii(buf, "WEBP", 8)) return "image/webp";
  // WAV: RIFF....WAVE
  if (startsWithAscii(buf, "RIFF") && startsWithAscii(buf, "WAVE", 8)) return "audio/wav";
  // MP3: ID3 tag header, or MPEG frame sync (0xFF 0xFB / 0xFA / 0xF3 / 0xF2)
  if (startsWithAscii(buf, "ID3")) return "audio/mpeg";
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";
  // OGG: "OggS"
  if (startsWithAscii(buf, "OggS")) return "audio/ogg";
  // WebM/Matroska EBML: 1A 45 DF A3. Browsers serve WebM audio/video
  // both out of .webm, and our ALLOWED_TYPES only lists audio/webm — so
  // we intentionally conflate here; downstream consumers treat the byte
  // stream the same.
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm";
  return null;
}
