import { describe, expect, it } from "bun:test";
import { isValidAddress } from "../../src/utils";

describe("isValidAddress", () => {
  it("accepts valid addresses", () => {
    expect(isValidAddress("agent@example.com")).toBe(true);
    expect(isValidAddress("service.team@domain.co.uk")).toBe(true);
  });

  it("rejects invalid addresses", () => {
    expect(isValidAddress("")).toBe(false);
    expect(isValidAddress("no-at-symbol")).toBe(false);
    expect(isValidAddress("@example.com")).toBe(false);
    expect(isValidAddress("user@")).toBe(false);
    expect(isValidAddress("user@example")).toBe(false);
  });
});
