import { describe, expect, it } from "vitest";
import {
  hasToNotation,
  parseReplyNotation,
  renderReplyNotation,
} from "./notation";

describe("Chatwork notation", () => {
  it("renders reply notation", () => {
    expect(
      renderReplyNotation({ accountId: 123, messageId: "789", roomId: 456 })
    ).toBe("[rp aid=123 to=456-789]");
  });

  it("detects To notation", () => {
    expect(hasToNotation("[To:123] hello", 123)).toBe(true);
    expect(hasToNotation("[To:456] hello", 123)).toBe(false);
  });

  it("parses reply notation", () => {
    expect(parseReplyNotation("[rp aid=123 to=456-789] hello")).toEqual({
      accountId: 123,
      messageId: "789",
      roomId: 456,
    });
  });
});
