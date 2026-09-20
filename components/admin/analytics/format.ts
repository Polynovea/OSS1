export function fmtSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function fmtNum(n: number): string {
  return n.toLocaleString("en-IN");
}

export function fmtGa4Date(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) return yyyymmdd;
  const y = yyyymmdd.slice(0, 4), m = yyyymmdd.slice(4, 6), d = yyyymmdd.slice(6, 8);
  return new Date(`${y}-${m}-${d}`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
