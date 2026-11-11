import { describe, expect, it } from "vitest";
import { publicOrigin } from "./origin";

describe("publicOrigin", () => {
  const request = new Request("http://0.0.0.0:3000/api/github/setup?code=x");

  it("uses the configured public URL behind the proxy, not the container address", () => {
    expect(publicOrigin(request, { BETTER_AUTH_URL: "https://app.consyrium.com/" })).toBe("https://app.consyrium.com");
  });

  it("falls back to the request origin when nothing or something malformed is configured", () => {
    expect(publicOrigin(request, {})).toBe("http://0.0.0.0:3000");
    expect(publicOrigin(request, { BETTER_AUTH_URL: "not a url" })).toBe("http://0.0.0.0:3000");
  });
});
