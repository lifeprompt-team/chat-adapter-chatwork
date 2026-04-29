import { describe, expect, it, vi } from "vitest";
import type { ChatInstance, Logger, StateAdapter } from "chat";
import { ChatworkAdapter } from "./adapter";
import { createChatworkSignature } from "./signature";
import type { ChatworkWebhookPayload } from "./types";

const logger: Logger = {
  child: () => logger,
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

function createChat(processMessage = vi.fn()): ChatInstance {
  return {
    getLogger: () => logger,
    getState: () => ({}) as StateAdapter,
    getUserName: () => "chatwork-bot",
    handleIncomingMessage: vi.fn(),
    processAction: vi.fn(),
    processAppHomeOpened: vi.fn(),
    processAssistantContextChanged: vi.fn(),
    processAssistantThreadStarted: vi.fn(),
    processMemberJoinedChannel: vi.fn(),
    processMessage,
    processModalClose: vi.fn(),
    processModalSubmit: vi.fn(),
    processReaction: vi.fn(),
    processSlashCommand: vi.fn(),
  };
}

function createAdapter(config = {}) {
  return new ChatworkAdapter({
    apiToken: "api-token",
    botAccountId: 999,
    logger,
    webhookToken: Buffer.from("webhook-secret").toString("base64"),
    ...config,
  });
}

describe("ChatworkAdapter", () => {
  it("parses mention_to_me as a mention", () => {
    const adapter = createAdapter();
    const payload: ChatworkWebhookPayload = {
      webhook_event: {
        body: "[To:999] hello",
        from_account_id: 123,
        message_id: "m1",
        room_id: 456,
        send_time: 1498028125,
        to_account_id: 999,
        update_time: 0,
      },
      webhook_event_time: 1498028130,
      webhook_event_type: "mention_to_me",
      webhook_setting_id: "setting-1",
    };

    const message = adapter.parseMessage(payload);

    expect(message.id).toBe("m1");
    expect(message.isMention).toBe(true);
    expect(message.author.userId).toBe("123");
    expect(message.threadId).toBe(
      adapter.encodeThreadId({ messageId: "m1", roomId: 456 })
    );
  });

  it("does not treat room messages as mentions by default", () => {
    const adapter = createAdapter();
    const payload: ChatworkWebhookPayload = {
      webhook_event: {
        account_id: 123,
        body: "hello",
        message_id: "m1",
        room_id: 456,
        send_time: 1498028125,
        update_time: 0,
      },
      webhook_event_time: 1498028130,
      webhook_event_type: "message_created",
      webhook_setting_id: "setting-1",
    };

    expect(adapter.parseMessage(payload).isMention).toBe(false);
  });

  it("treats To notation as a mention", () => {
    const adapter = createAdapter();
    const payload: ChatworkWebhookPayload = {
      webhook_event: {
        account_id: 123,
        body: "[To:999] hello",
        message_id: "m1",
        room_id: 456,
        send_time: 1498028125,
        update_time: 0,
      },
      webhook_event_time: 1498028130,
      webhook_event_type: "message_created",
      webhook_setting_id: "setting-1",
    };

    expect(adapter.parseMessage(payload).isMention).toBe(true);
  });

  it("verifies webhook signatures and processes mentions", async () => {
    const processMessage = vi.fn();
    const adapter = createAdapter();
    await adapter.initialize(createChat(processMessage));

    const body = JSON.stringify({
      webhook_event: {
        body: "[To:999] hello",
        from_account_id: 123,
        message_id: "m1",
        room_id: 456,
        send_time: 1498028125,
        to_account_id: 999,
        update_time: 0,
      },
      webhook_event_time: 1498028130,
      webhook_event_type: "mention_to_me",
      webhook_setting_id: "setting-1",
    });

    const response = await adapter.handleWebhook(
      new Request("https://example.com/webhook", {
        body,
        headers: {
          "x-chatworkwebhooksignature": createChatworkSignature(
            body,
            Buffer.from("webhook-secret").toString("base64")
          ),
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid webhook signatures", async () => {
    const adapter = createAdapter();
    await adapter.initialize(createChat());

    const response = await adapter.handleWebhook(
      new Request("https://example.com/webhook", {
        body: "{}",
        headers: {
          "x-chatworkwebhooksignature": "bad",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
  });
});
