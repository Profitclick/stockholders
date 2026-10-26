export const MAX_EXPORT_ROWS = 500_000;
export const EXPORT_BATCH_SIZE = 1000;

export function exportLimit(value: number = MAX_EXPORT_ROWS): number {
  return Number.isFinite(value) ? Math.min(MAX_EXPORT_ROWS, Math.max(1, Math.floor(value))) : MAX_EXPORT_ROWS;
}

// Each page is serialized immediately, so CSV exports never retain all source rows.
export async function collectExportPages<T>(
  fetchPage: (offset: number, size: number) => Promise<T[]>,
  consume: (rows: T[], first: boolean) => void,
  requested = MAX_EXPORT_ROWS,
  progress?: (count: number) => void,
): Promise<number> {
  const limit = exportLimit(requested);
  let count = 0;
  while (count < limit) {
    const size = Math.min(EXPORT_BATCH_SIZE, limit - count);
    const rows = await fetchPage(count, size);
    if (rows.length > size) throw new Error("Eksporten returnerte flere rader enn forespurt.");
    if (rows.length === 0) break;
    consume(rows, count === 0);
    count += rows.length;
    progress?.(count);
    if (rows.length < size) break;
  }
  return count;
}