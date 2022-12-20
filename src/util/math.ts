export function lerp(start: number, end: number, amount: number): number {
  return (1-amount)*start+amount*end;
}

export function clamp(num: number, min: number, max: number): number {
  return Math.min(Math.max(num, min), max);
}