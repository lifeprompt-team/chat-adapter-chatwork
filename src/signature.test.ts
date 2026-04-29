import { describe, expect, it } from "vitest";
import {
  createChatworkSignature,
  verifyChatworkSignature,
} from "./signature";

describe("Chatwork webhook signatures", () => {
  it("verifies a valid signature", () => {
    const token = Buffer.from("webhook-secret").toString("base64");
    const rawBody = '{"webhook_event_type":"mention_to_me"}';
    const signature = createChatworkSignature(rawBody, token);

    expect(verifyChatworkSignature(rawBody, token, signature)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const token = Buffer.from("webhook-secret").toString("base64");
    const rawBody = '{"webhook_event_type":"mention_to_me"}';
    const signature = createChatworkSignature(rawBody, token);

    expect(verifyChatworkSignature(`${rawBody}\n`, token, signature)).toBe(
      false
    );
  });
});
