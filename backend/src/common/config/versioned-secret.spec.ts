import { readVersionedSecret } from "./versioned-secret";

const env = (vars: Record<string, string>) => (key: string) => vars[key];

describe("readVersionedSecret", () => {
  it("defaults to version 1 and reads every version up to the current one", () => {
    const secret = readVersionedSecret(
      env({ API_TOKEN_PEPPER_V1: "one", API_TOKEN_PEPPER_V2: "two" }),
      "API_TOKEN_PEPPER",
    );
    expect(secret.current).toBe(1);
    expect([...secret.values]).toEqual([[1, "one"]]);
  });

  it("keeps older versions readable after the current one moves on", () => {
    const secret = readVersionedSecret(
      env({
        API_TOKEN_PEPPER_CURRENT_VERSION: "2",
        API_TOKEN_PEPPER_V1: "one",
        API_TOKEN_PEPPER_V2: "two",
      }),
      "API_TOKEN_PEPPER",
    );
    expect(secret.current).toBe(2);
    expect([...secret.values]).toEqual([
      [1, "one"],
      [2, "two"],
    ]);
  });

  it("omits a removed version and reports a missing current one", () => {
    const secret = readVersionedSecret(
      env({
        API_TOKEN_PEPPER_CURRENT_VERSION: "3",
        API_TOKEN_PEPPER_V2: "two",
      }),
      "API_TOKEN_PEPPER",
    );
    expect(secret.values.has(secret.current)).toBe(false);
    expect([...secret.values]).toEqual([[2, "two"]]);
  });
});
