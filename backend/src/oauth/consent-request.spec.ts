import { openConsentRequest, sealConsentRequest } from "./consent-request";

const request = {
  clientId: "c",
  redirectUri: "https://x/cb",
  codeChallenge: "ch",
  state: "st",
  scopes: ["schedule"],
};

describe("consent request", () => {
  it("round-trips", () => {
    expect(
      openConsentRequest(
        sealConsentRequest(request, "secret", 60_000),
        "secret",
      ),
    ).toEqual(request);
  });

  it("rejects expiry, another secret and tampering", () => {
    const token = sealConsentRequest(request, "secret", 1000, 0);
    expect(openConsentRequest(token, "secret", 5000)).toBeNull();
    expect(
      openConsentRequest(
        sealConsentRequest(request, "secret", 60_000),
        "other",
      ),
    ).toBeNull();
    const [payload, sig] = sealConsentRequest(request, "secret", 60_000).split(
      ".",
    );
    const forged = Buffer.from(
      JSON.stringify({
        r: { ...request, redirectUri: "https://evil/cb" },
        e: Date.now() + 60_000,
      }),
    ).toString("base64url");
    expect(openConsentRequest(`${forged}.${sig}`, "secret")).toBeNull();
    expect(openConsentRequest(`${payload}.bad`, "secret")).toBeNull();
    expect(openConsentRequest("junk", "secret")).toBeNull();
  });
});
