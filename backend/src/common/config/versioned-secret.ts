/**
 * A secret stored as `<prefix>_V<n>`. `<prefix>_CURRENT_VERSION` picks the one
 * new writes use. Older versions stay readable until their var is removed.
 */
export interface VersionedSecret {
  current: number;
  values: Map<number, string>;
}

export function readVersionedSecret(
  get: (key: string) => string | undefined,
  prefix: string,
): VersionedSecret {
  const current = Number(get(`${prefix}_CURRENT_VERSION`) ?? 1);
  const values = new Map<number, string>();
  for (let version = 1; version <= current; version++) {
    const value = get(`${prefix}_V${version}`);
    if (value) values.set(version, value);
  }
  return { current, values };
}
