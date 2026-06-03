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

  it("normalizes inbound thread id to the reply-chain root for follow-up messages", async () => {
    const processMessage = vi.fn();
    const fetch = createFetchMock({
      "/contacts": () =>
        new Response(
          JSON.stringify([{ account_id: 123, name: "Alice", room_id: 456 }]),
          { status: 200 }
        ),
      "/rooms/456/messages/200": () =>
        new Response(
          JSON.stringify({
            account: { account_id: 999, avatar_image_url: "", name: "Bot" },
            body: "[rp aid=999 to=456-100] bot reply",
            message_id: "200",
            send_time: 2,
            update_time: 0,
          }),
          { status: 200 }
        ),
      "/rooms/456/messages?force=1": () =>
        new Response(
          JSON.stringify([
            {
              account: { account_id: 1, name: "Alice" },
              body: "[To:999] hello",
              message_id: "100",
              send_time: 1,
              update_time: 0,
            },
            {
              account: { account_id: 999, name: "Bot" },
              body: "[rp aid=999 to=456-100] bot reply",
              message_id: "200",
              send_time: 2,
              update_time: 0,
            },
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
        body: "[rp aid=123 to=456-200] follow-up",
        message_id: "300",
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
    const [, threadId] = processMessage.mock.calls[0] ?? [];
    expect(threadId).toBe(
      adapter.encodeThreadId({
        messageId: "100",
        replyToAccountId: 123,
        roomId: 456,
      })
    );
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
      "/rooms/456/messages/m1": () =>
        new Response(
          JSON.stringify({
            account: { account_id: 999, avatar_image_url: "", name: "Bot" },
            body: "bot message",
            message_id: "m1",
            send_time: 1,
            update_time: 0,
          }),
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
        body: "[rp aid=123 to=456-m1]\nanswer",
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
    expect(adapter.isDM(adapter.encodeThreadId({ roomId: 456 }))).toBe(true);
  });

  it("returns false from isDM before room type is cached", () => {
    const adapter = createAdapter();

    expect(adapter.isDM(adapter.encodeThreadId({ roomId: 456 }))).toBe(false);
  });

  it("returns true from isDM when contacts cache contains the room", async () => {
    const fetch = createFetchMock({
      "/contacts": () =>
        new Response(
          JSON.stringify([{ account_id: 123, name: "Alice", room_id: 456 }]),
          { status: 200 }
        ),
    });
    const adapter = createAdapter({ fetch });

    await adapter.getUser("123");

    expect(adapter.isDM(adapter.encodeThreadId({ roomId: 456 }))).toBe(true);
  });

  it("ignores webhook events from the bot account", async () => {
    const processMessage = vi.fn();
    const fetch = createFetchMock({
      "/contacts": () => new Response(JSON.stringify([]), { status: 200 }),
    });
    const adapter = createAdapter({ fetch });
    await adapter.initialize(createChat(processMessage));

    const body = JSON.stringify({
      webhook_event: {
        account_id: 999,
        body: "self message",
        message_id: "m1",
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
    expect(processMessage).not.toHaveBeenCalled();
  });

  it("posts without reply notation when reply target cannot be resolved", async () => {
    let postedBody = "";
    const fetch = createFetchMock({
      "/rooms/456/messages/m1": () =>
        new Response(JSON.stringify({ errors: ["not found"] }), { status: 404 }),
      "/rooms/456/messages": () =>
        new Response(JSON.stringify({ message_id: "bot-1" }), {
          status: 200,
        }),
    });
    const fetchWithCapture = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/rooms/456/messages") && !url.includes("/messages/m1")) {
        const body = init?.body;
        if (body instanceof URLSearchParams) {
          postedBody = body.get("body") ?? "";
        }
      }
      return fetch(input, init);
    });
    const adapter = createAdapter({ fetch: fetchWithCapture });

    const result = await adapter.postMessage(
      adapter.encodeThreadId({ messageId: "m1", roomId: 456 }),
      { markdown: "reply" }
    );

    expect(result.id).toBe("bot-1");
    expect(postedBody).toBe("reply");
    expect(postedBody).not.toContain("[rp ");
  });

  it("postMessage の threadId は返信先アンカーを維持する", async () => {
    const fetch = createFetchMock({
      "/rooms/456/messages": () =>
        new Response(JSON.stringify({ message_id: "bot-1" }), { status: 200 }),
    });
    const adapter = createAdapter({ fetch, botAccountId: 999 });
    const inboundThreadId = adapter.encodeThreadId({
      messageId: "user-1",
      replyToAccountId: 123,
      roomId: 456,
    });

    const result = await adapter.postMessage(inboundThreadId, {
      markdown: "hello",
    });

    expect(result.id).toBe("bot-1");
    expect(result.threadId).toBe(inboundThreadId);
  });

  it("rejects outbound files over 5MB", async () => {
    const adapter = createAdapter();

    await expect(
      adapter.postMessage(adapter.encodeThreadId({ roomId: 456 }), {
        files: [
          {
            data: Buffer.alloc(5 * 1024 * 1024 + 1),
            filename: "large.bin",
          },
        ],
        markdown: "attached",
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("5"),
    });
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
      "/rooms/456/messages/m1": () =>
        new Response(
          JSON.stringify({
            account: { account_id: 999, avatar_image_url: "", name: "Bot" },
            body: "bot message",
            message_id: "m1",
            send_time: 1,
            update_time: 0,
          }),
          { status: 200 }
        ),
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
        body: "[rp aid=123 to=456-m1]\nanswer",
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

  it("resolves uploaded file metadata only for the last file in a multi-file post", async () => {
    let uploadCount = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/rooms/456/files/42")) {
        throw new Error("getRoomFile should not be called for the first upload");
      }
      if (url.includes("/rooms/456/files/43") && method === "GET") {
        return new Response(
          JSON.stringify({
            account: { account_id: 999, name: "Bot" },
            file_id: 43,
            filename: "second.txt",
            filesize: 6,
            message_id: "m-second",
            upload_time: 2,
          }),
          { status: 200 }
        );
      }
      if (url.includes("/rooms/456/files") && method === "POST") {
        uploadCount += 1;
        return new Response(
          JSON.stringify({ file_id: uploadCount === 1 ? 42 : 43 }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ errors: [`Unhandled fetch: ${url}`] }), {
        status: 500,
      });
    });
    const adapter = createAdapter({ fetch });

    const result = await adapter.postMessage(
      adapter.encodeThreadId({ roomId: 456 }),
      {
        files: [
          { data: Buffer.from("one"), filename: "one.txt" },
          { data: Buffer.from("two"), filename: "two.txt" },
        ],
        markdown: "attached",
      }
    );

    expect(result.id).toBe("m-second");
    expect(
      fetch.mock.calls.filter(([request]) =>
        String(request).includes("/rooms/456/files/43")
      )
    ).toHaveLength(1);
  });

  it("keeps uploaded files successful when uploaded file metadata is unavailable", async () => {
    const fetch = createFetchMock({
      "/rooms/456/files/42": () =>
        new Response(JSON.stringify({ errors: ["not found"] }), { status: 404 }),
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

    expect(result.id).toBe("file:42");
    expect(result.threadId).toBe(adapter.encodeThreadId({ roomId: 456 }));
  });

  it("fetchMessages returns reply-chain ancestors when thread id includes message id", async () => {
    const fetch = createFetchMock({
      "/rooms/456/members": () =>
        new Response(
          JSON.stringify([
            { account_id: 1, name: "Alice", role: "member" },
            { account_id: 2, name: "Bob", role: "member" },
          ]),
          { status: 200 }
        ),
      "/rooms/456/messages?force=1": () =>
        new Response(
          JSON.stringify([
            {
              account: { account_id: 1, name: "Alice" },
              body: "root message",
              message_id: "100",
              send_time: 1,
              update_time: 0,
            },
            {
              account: { account_id: 2, name: "Bob" },
              body: "[rp aid=1 to=456-100] middle message",
              message_id: "200",
              send_time: 2,
              update_time: 0,
            },
            {
              account: { account_id: 2, name: "Bob" },
              body: "[rp aid=1 to=456-200] current reply",
              message_id: "300",
              send_time: 3,
              update_time: 0,
            },
          ]),
          { status: 200 }
        ),
      "/contacts": () => new Response(JSON.stringify([]), { status: 200 }),
    });
    const adapter = createAdapter({ fetch });

    const result = await adapter.fetchMessages(
      adapter.encodeThreadId({ messageId: "300", roomId: 456 })
    );

    expect(result.messages.map((message) => message.id)).toEqual(["100", "200"]);
  });

  it("fetchMessages returns room messages when thread id is room-only", async () => {
    const fetch = createFetchMock({
      "/rooms/456/members": () =>
        new Response(
          JSON.stringify([{ account_id: 1, name: "Alice", role: "member" }]),
          { status: 200 }
        ),
      "/rooms/456/messages?force=1": () =>
        new Response(
          JSON.stringify([
            {
              account: { account_id: 1, name: "Alice" },
              body: "hello",
              message_id: "100",
              send_time: 1,
              update_time: 0,
            },
          ]),
          { status: 200 }
        ),
      "/contacts": () => new Response(JSON.stringify([]), { status: 200 }),
    });
    const adapter = createAdapter({ fetch });

    const result = await adapter.fetchMessages(
      adapter.encodeThreadId({ roomId: 456 })
    );

    expect(result.messages.map((message) => message.id)).toEqual(["100"]);
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
