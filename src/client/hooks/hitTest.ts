export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function hitTestRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
