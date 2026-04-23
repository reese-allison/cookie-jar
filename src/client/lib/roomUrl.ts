import { isValidRoomCode } from "@shared/validation";

export function parseCodeFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  const candidate = segments[0].toUpperCase();
  return isValidRoomCode(candidate) ? candidate : null;
}

export function pathForRoom(code: string | null): string {
  return code ? `/${code}` : "/";
}
