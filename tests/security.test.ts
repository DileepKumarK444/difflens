import { describe, expect, it } from "vitest";
import {
  hostnameOf,
  isAllowedHost,
  isAllowedOrigin,
  isValidCsrf,
  newCsrfToken,
} from "@/lib/security";

describe("host check", () => {
  it("allows loopback hosts with any port", () => {
    for (const h of ["127.0.0.1:4317", "localhost:4317", "[::1]:4317", "LOCALHOST"]) {
      expect(isAllowedHost(h)).toBe(true);
    }
  });
  it("rejects other hosts (DNS rebinding) and missing host", () => {
    for (const h of ["evil.com", "127.0.0.1.evil.com:4317", "192.168.1.5:4317", "0.0.0.0:4317", "", null]) {
      expect(isAllowedHost(h)).toBe(false);
    }
  });
  it("parses hostnames", () => {
    expect(hostnameOf("[::1]:80")).toBe("[::1]");
    expect(hostnameOf("localhost:3000")).toBe("localhost");
  });
});

describe("origin check", () => {
  it("accepts same-origin mutating requests", () => {
    expect(isAllowedOrigin("POST", "http://127.0.0.1:4317", "127.0.0.1:4317")).toBe(true);
  });
  it("rejects cross-origin and malformed origins", () => {
    expect(isAllowedOrigin("POST", "http://evil.com", "127.0.0.1:4317")).toBe(false);
    expect(isAllowedOrigin("GET", "http://localhost:4317", "127.0.0.1:4317")).toBe(false);
    expect(isAllowedOrigin("POST", "not a url", "127.0.0.1:4317")).toBe(false);
    expect(isAllowedOrigin("POST", "null", "127.0.0.1:4317")).toBe(false);
  });
  it("requires Origin on mutating requests but not on navigation", () => {
    expect(isAllowedOrigin("POST", null, "127.0.0.1:4317")).toBe(false);
    expect(isAllowedOrigin("DELETE", null, "127.0.0.1:4317")).toBe(false);
    expect(isAllowedOrigin("GET", null, "127.0.0.1:4317")).toBe(true);
  });
});

describe("csrf", () => {
  const token = newCsrfToken();
  it("generates long unique tokens", () => {
    expect(token.length).toBeGreaterThanOrEqual(64);
    expect(newCsrfToken()).not.toBe(token);
  });
  it("does not require a token for safe methods", () => {
    expect(isValidCsrf("GET", undefined, null)).toBe(true);
  });
  it("requires matching cookie and header for mutating methods", () => {
    expect(isValidCsrf("POST", token, token)).toBe(true);
    expect(isValidCsrf("POST", token, null)).toBe(false);
    expect(isValidCsrf("POST", undefined, token)).toBe(false);
    expect(isValidCsrf("PUT", token, token.slice(0, -1) + "x")).toBe(false);
    expect(isValidCsrf("POST", "short", "short")).toBe(false);
  });
});
