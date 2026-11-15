/** Round tick values covering [min, max]; non-negative data never gets a negative axis. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const floor = min >= 0 ? 0 : -Infinity;
  if (min === max) {
    const d = Math.abs(min) * 0.1 || 1;
    min = Math.max(floor, min - d);
    max += d;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out.filter((v) => v >= floor);
}
