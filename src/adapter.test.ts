import { describe, expect, it, vi } from "vitest";
import { ResourceNotFoundError } from "@chat-adapter/shared";
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

function createFetchMock(handlers: Record<string, () => Response | Promise<Response>>) {
  const entries = Object.entries(handlers).sort(
    (left, right) => right[0].length - left[0].length
  );

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, handler] of entries) {
      if (url.includes(pattern)) {
        return handler();
      }
    }
    return new Response(JSON.stringify({ errors: [`Unhandled fetch: ${url}`] }), {
      status: 500,
    });
  });
}

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

function createAdapter(config: Record<string, unknown> = {}) {
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
      adapter.encodeThreadId({
        messageId: "m1",
        replyToAccountId: 123,
        roomId: 456,
      })
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
    const fetch = createFetchMock({
      "/contacts": () =>
        new Response(
          JSON.stringify([{ account_id: 123, name: "Alice", room_id: 456 }]),
          { status: 200 }
        ),
    });
    const adapter = createAdapter({ fetch });
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

  it("processes direct room message_created events", async () => {
    const processMessage = vi.fn();
    const fetch = createFetchMock({
      "/contacts": () =>
        new Response(
          JSON.stringify([{ account_id: 123, name: "Alice", room_id: 456 }]),
          { status: 200 }
        ),
      "/rooms/456": () =>
        new Response(
          JSON.stringify({ name: "Alice", room_id: 456, type: "direct" }),
          { status: 200 }
        ),
    });
    const adapter = createAdapter({ fetch });
    await adapter.initialize(createChat(processMessage));

    const body = JSON.stringify({
      webhook_event: {
        account_id: 123,
        body: "follow-up",
        message_id: "m2",
        room_id: 456,
        send_time: 1498028125,
        update_time: 0,
      },
      webhook_event_time: 1498028130,
      webhook_event_type: "message_created",
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
    expect(processMessage.mock.calls[0]?.[2]?.author.fullName).toBe("Alice");
  });

  it("processes reply notation in group rooms", async () => {
    const processMessage = vi.fn();
    const fetch = createFetchMock({
      "/contacts": () =>
        new Response(
          JSON.stringify([{ account_id: 123, name: "Alice", room_id: 456 }]),
          { status: 200 }
        ),
      "/rooms/456": () =>
        new Response(
          JSON.stringify({ name: "Group", room_id: 456, type: "group" }),
          { status: 200 }
        ),
    });
    const adapter = createAdapter({ fetch });
    await adapter.initialize(createChat(processMessage));

    const body = JSON.stringify({
      webhook_event: {
        account_id: 123,
        body: "[rp aid=999 to=456-m1]\nanswer",
        message_id: "m2",
        room_id: 456,
        send_time: 1498028125,
        update_time: 0,
      },
      webhook_event_time: 1498028130,
      webhook_event_type: "message_created",
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

  it("opens a direct room from account ID", async () => {
    const fetch = createFetchMock({
      "/contacts": () =>
        new Response(
          JSON.stringify([{ account_id: 123, name: "Alice", room_id: 456 }]),
          { status: 200 }
        ),
    });
    const adapter = createAdapter({ fetch });

    await expect(adapter.openDM("123")).resolves.toBe(
      adapter.encodeThreadId({ roomId: 456 })
    );
  });

  it("throws when direct room is not found", async () => {
    const fetch = createFetchMock({
      "/contacts": () => new Response(JSON.stringify([]), { status: 200 }),
    });
    const adapter = createAdapter({ fetch });

    await expect(adapter.openDM("123")).rejects.toBeInstanceOf(
      ResourceNotFoundError
    );
  });

  it("returns null from getUser when contacts respond with 204", async () => {
    const fetch = createFetchMock({
      "/contacts": () => new Response(null, { status: 204 }),
    });
    const adapter = createAdapter({ fetch });

    await expect(adapter.getUser("123")).resolves.toBeNull();
  });

  it("resolves group room authors from room members when not in contacts", async () => {
    const processMessage = vi.fn();
    const fetch = createFetchMock({
      "/contacts": () => new Response(null, { status: 204 }),
      "/rooms/456/members": () =>
        new Response(
          JSON.stringify([
            { account_id: 123, name: "Bob", role: "member" },
            { account_id: 999, name: "Bot", role: "admin" },
          ]),
          { status: 200 }
        ),
      "/rooms/456": () =>
        new Response(
          JSON.stringify({ name: "Group", room_id: 456, type: "group" }),
          { status: 200 }
        ),
    });
    const adapter = createAdapter({ fetch });
    await adapter.initialize(createChat(processMessage));

    const body = JSON.stringify({
      webhook_event: {
        account_id: 123,
        body: "[rp aid=999 to=456-m1]\nanswer",
        message_id: "m2",
        room_id: 456,
        send_time: 1498028125,
        update_time: 0,
      },
      webhook_event_time: 1498028130,
      webhook_event_type: "message_created",
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
    expect(processMessage.mock.calls[0]?.[2]?.author.fullName).toBe("Bob");
  });

  it("uploads files through postMessage", async () => {
    const fetch = createFetchMock({
      "/rooms/456/files/42": () =>
        new Response(
          JSON.stringify({
            account: { account_id: 999, name: "Bot" },
            file_id: 42,
            filename: "hello.txt",
            filesize: 5,
            message_id: "m-upload",
            upload_time: 1,
          }),
          { status: 200 }
        ),
      "/rooms/456/files": () =>
        new Response(JSON.stringify({ file_id: 42 }), { status: 200 }),
    });
    const adapter = createAdapter({ fetch });

    const result = await adapter.postMessage(
      adapter.encodeThreadId({ roomId: 456 }),
      {
        files: [{ data: Buffer.from("hello"), filename: "hello.txt" }],
        markdown: "attached",
      }
    );

    expect(result.id).toBe("m-upload");
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
