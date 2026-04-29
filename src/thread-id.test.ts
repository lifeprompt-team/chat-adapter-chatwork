import { describe, expect, it } from "vitest";
import { decodeThreadId, encodeThreadId } from "./thread-id";

describe("thread IDs", () => {
  it("roundtrips a room thread", () => {
    const encoded = encodeThreadId({ roomId: 123456 });

    expect(encoded).toBe("chatwork:MTIzNDU2");
    expect(decodeThreadId(encoded)).toEqual({ roomId: 123456 });
  });

  it("roundtrips a reply thread", () => {
    const encoded = encodeThreadId({ messageId: "789:abc", roomId: 123456 });

    expect(encoded).toBe("chatwork:MTIzNDU2:Nzg5OmFiYw");
    expect(decodeThreadId(encoded)).toEqual({
      messageId: "789:abc",
      roomId: 123456,
    });
  });

  it("rejects invalid thread IDs", () => {
    expect(() => decodeThreadId("slack:MTIz")).toThrow();
    expect(() => decodeThreadId("chatwork:not-number")).toThrow();
  });
});
