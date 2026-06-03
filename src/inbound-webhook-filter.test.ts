import { describe, expect, it, vi } from "vitest";
import {
  getWebhookAuthorAccountId,
  isWebhookMentionPayload,
  shouldProcessInboundWebhook,
} from "./inbound-webhook-filter";
import type { ChatworkWebhookPayload } from "./types";

describe("inbound webhook filter", () => {
  it("ignores messages from the bot account", async () => {
    const payload: ChatworkWebhookPayload = {
      webhook_event: {
        account_id: 999,
        body: "self message",
        message_id: "m1",
        room_id: 456,
        send_time: 1,
        update_time: 0,
      },
      webhook_event_time: 2,
      webhook_event_type: "message_created",
      webhook_setting_id: "setting-1",
    };

    await expect(
      shouldProcessInboundWebhook({
        botAccountId: 999,
        isDirectRoom: vi.fn(),
        payload,
      })
    ).resolves.toBe(false);
  });

  it("accepts mention_to_me events", async () => {
    const payload: ChatworkWebhookPayload = {
      webhook_event: {
        body: "hello",
        from_account_id: 123,
        message_id: "m1",
        room_id: 456,
        send_time: 1,
        to_account_id: 999,
        update_time: 0,
      },
      webhook_event_time: 2,
      webhook_event_type: "mention_to_me",
      webhook_setting_id: "setting-1",
    };

    await expect(
      shouldProcessInboundWebhook({
        botAccountId: 999,
        isDirectRoom: vi.fn(),
        payload,
      })
    ).resolves.toBe(true);
  });

  it("accepts reply notation in group rooms when the parent message is from the bot", async () => {
    const payload: ChatworkWebhookPayload = {
      webhook_event: {
        account_id: 123,
        body: "[rp aid=123 to=456-m1]\nanswer",
        message_id: "m2",
        room_id: 456,
        send_time: 1,
        update_time: 0,
      },
      webhook_event_time: 2,
      webhook_event_type: "message_created",
      webhook_setting_id: "setting-1",
    };

    await expect(
      shouldProcessInboundWebhook({
        botAccountId: 999,
        isDirectRoom: vi.fn().mockResolvedValue(false),
        isReplyParentAuthoredByBot: vi.fn().mockResolvedValue(true),
        payload,
      })
    ).resolves.toBe(true);
  });

  it("ignores reply notation in group rooms when the parent message is not from the bot", async () => {
    const payload: ChatworkWebhookPayload = {
      webhook_event: {
        account_id: 123,
        body: "[rp aid=123 to=456-m1]\nanswer",
        message_id: "m2",
        room_id: 456,
        send_time: 1,
        update_time: 0,
      },
      webhook_event_time: 2,
      webhook_event_type: "message_created",
      webhook_setting_id: "setting-1",
    };

    await expect(
      shouldProcessInboundWebhook({
        botAccountId: 999,
        isDirectRoom: vi.fn().mockResolvedValue(false),
        isReplyParentAuthoredByBot: vi.fn().mockResolvedValue(false),
        payload,
      })
    ).resolves.toBe(false);
  });

  it("accepts direct room message_created events", async () => {
    const payload: ChatworkWebhookPayload = {
      webhook_event: {
        account_id: 123,
        body: "follow-up",
        message_id: "m2",
        room_id: 456,
        send_time: 1,
        update_time: 0,
      },
      webhook_event_time: 2,
      webhook_event_type: "message_created",
      webhook_setting_id: "setting-1",
    };
    const isDirectRoom = vi.fn().mockResolvedValue(true);

    await expect(
      shouldProcessInboundWebhook({
        botAccountId: 999,
        isDirectRoom,
        payload,
      })
    ).resolves.toBe(true);
    expect(isDirectRoom).toHaveBeenCalledWith(456);
  });

  it("reads mention_to_me author account id", () => {
    const payload: ChatworkWebhookPayload = {
      webhook_event: {
        body: "hello",
        from_account_id: 123,
        message_id: "m1",
        room_id: 456,
        send_time: 1,
        to_account_id: 999,
        update_time: 0,
      },
      webhook_event_time: 2,
      webhook_event_type: "mention_to_me",
      webhook_setting_id: "setting-1",
    };

    expect(getWebhookAuthorAccountId(payload)).toBe(123);
  });

  it("treats To notation as a mention", () => {
    const payload: ChatworkWebhookPayload = {
      webhook_event: {
        account_id: 123,
        body: "[To:999] hello",
        message_id: "m1",
        room_id: 456,
        send_time: 1,
        update_time: 0,
      },
      webhook_event_time: 2,
      webhook_event_type: "message_created",
      webhook_setting_id: "setting-1",
    };

    expect(
      isWebhookMentionPayload({
        botAccountId: 999,
        payload,
      })
    ).toBe(true);
  });
});
