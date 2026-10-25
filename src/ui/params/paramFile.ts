// .param file read/write. Accepts Mission Planner (NAME,VALUE), MAVProxy (NAME VALUE)
// and QGroundControl (sys comp NAME VALUE type, tab-separated) formats.

export interface ParsedParamFile { values: Map<string, number>; skipped: number }

export function parseParamFile(text: string): ParsedParamFile {
  const values = new Map<string, number>();
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const parts = line.split(/[\s,]+/).filter(Boolean);
    let name: string | undefined, value: string | undefined;
    if (parts.length >= 5 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) [, , name, value] = parts; // QGC
    else [name, value] = parts;
    const v = Number(value);
    if (!name || !/^[A-Z0-9_]{1,16}$/i.test(name) || value === undefined || !Number.isFinite(v)) { skipped++; continue; }
    values.set(name.toUpperCase(), v);
  }
  return { values, skipped };
}

export function writeParamFile(entries: [string, string][], header: string[]): string {
  const sorted = [...entries].sort((a, b) => a[0].localeCompare(b[0]));
  return [...header.map((l) => `# ${l}`), ...sorted.map(([n, v]) => `${n},${v}`)].join('\n') + '\n';
}
