/** Clipboard stub for component tests: records the last copied string. */
export const copied: string[] = [];

export async function setStringAsync(value: string): Promise<boolean> {
  copied.push(value);
  return true;
}
