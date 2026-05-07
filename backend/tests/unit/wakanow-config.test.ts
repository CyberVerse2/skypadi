import { describe, expect, it } from "vitest";
import { parseWakanowProxyUrls } from "../../src/integrations/wakanow/wakanow.config";

describe("parseWakanowProxyUrls", () => {
  it("normalizes Webshare proxy entries and removes duplicates", () => {
    expect(
      parseWakanowProxyUrls(
        [
          "31.59.20.176:6754:user:pass",
          "https://already.example:8443",
          "31.59.20.176:6754:user:pass",
        ].join("\n")
      )
    ).toEqual([
      "http://user:pass@31.59.20.176:6754",
      "https://already.example:8443",
    ]);
  });
});
