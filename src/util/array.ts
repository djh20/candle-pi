export function arraysEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;

  for (var i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function getArrayAverage(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}