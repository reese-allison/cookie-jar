import { ROOM_CODE_CHARS, ROOM_CODE_LENGTH } from "./constants";

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((char) => ROOM_CODE_CHARS.includes(char));
}

export function isValidNoteText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 500;
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function generateRoomCode(): string {
  const array = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(array);
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[array[i] % ROOM_CODE_CHARS.length];
  }
  return code;
}

export function isValidDisplayName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 30;
}
