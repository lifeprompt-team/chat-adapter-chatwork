import { describe, expect, it } from "vitest";

import {
  collectReplyChainForThreadAnchor,
  collectReplyChainFromMessages,
  DEFAULT_REPLY_CHAIN_MAX_DEPTH,
  indexChatworkRoomMessagesById,
  resolveReplyChainRootMessageId,
} from "./reply-chain";

import type { ChatworkRoomMessage } from "./types";

function createRoomMessage(args: {
  accountId: number;
  body: string;
  messageId: string;
}): ChatworkRoomMessage {
  return {
    account: {
      account_id: args.accountId,
      avatar_image_url: "",
      name: `user-${args.accountId}`,
    },
    body: args.body,
    message_id: args.messageId,
    send_time: 1_700_000_000,
    update_time: 0,
  };
}

describe("collectReplyChainFromMessages", () => {
  it("returns an empty list when the message has no reply notation", () => {
    const chain = collectReplyChainFromMessages({
      messageText: "hello",
      messagesById: new Map(),
      roomId: 456,
    });

    expect(chain).toEqual([]);
  });

  it("walks the reply chain from parent to root in chronological order", () => {
    const messages = [
      createRoomMessage({
        accountId: 1,
        body: "root message",
        messageId: "100",
      }),
      createRoomMessage({
        accountId: 2,
        body: "[rp aid=1 to=456-100] middle message",
        messageId: "200",
      }),
    ];

    const chain = collectReplyChainFromMessages({
      messageText: "[rp aid=2 to=456-200] current reply",
      messagesById: indexChatworkRoomMessagesById({ messages }),
      roomId: 456,
    });

    expect(chain.map((message) => message.message_id)).toEqual(["100", "200"]);
  });

  it("stops when a parent message is missing from the index", () => {
    const messages = [
      createRoomMessage({
        accountId: 2,
        body: "[rp aid=1 to=456-999] middle message",
        messageId: "200",
      }),
    ];

    const chain = collectReplyChainFromMessages({
      messageText: "[rp aid=2 to=456-200] current reply",
      messagesById: indexChatworkRoomMessagesById({ messages }),
      roomId: 456,
    });

    expect(chain.map((message) => message.message_id)).toEqual(["200"]);
  });

  it("respects maxDepth", () => {
    const messages = Array.from({ length: 5 }, (_, index) =>
      createRoomMessage({
        accountId: index + 1,
        body:
          index === 0
            ? "root"
            : `[rp aid=${index} to=456-${String(index)}00] message ${index}`,
        messageId: `${index + 1}00`,
      }),
    );

    const chain = collectReplyChainFromMessages({
      maxDepth: 2,
      messageText: "[rp aid=5 to=456-500] current",
      messagesById: indexChatworkRoomMessagesById({ messages }),
      roomId: 456,
    });

    expect(chain.map((message) => message.message_id)).toEqual(["400", "500"]);
  });

  it("uses the default max depth constant", () => {
    expect(DEFAULT_REPLY_CHAIN_MAX_DEPTH).toBe(30);
  });
});

describe("collectReplyChainForThreadAnchor", () => {
  it("walks ancestors from the anchor message id", () => {
    const messages = [
      createRoomMessage({
        accountId: 1,
        body: "root message",
        messageId: "100",
      }),
      createRoomMessage({
        accountId: 2,
        body: "[rp aid=1 to=456-100] middle message",
        messageId: "200",
      }),
      createRoomMessage({
        accountId: 2,
        body: "[rp aid=1 to=456-200] current reply",
        messageId: "300",
      }),
    ];

    const chain = collectReplyChainForThreadAnchor({
      anchorMessageId: "300",
      messagesById: indexChatworkRoomMessagesById({ messages }),
      roomId: 456,
    });

    expect(chain.map((message) => message.message_id)).toEqual(["100", "200"]);
  });
});

describe("resolveReplyChainRootMessageId", () => {
  it("returns the current message id when there is no reply notation", () => {
    expect(
      resolveReplyChainRootMessageId({
        messageId: "300",
        messageText: "hello",
        messagesById: new Map(),
        roomId: 456,
      })
    ).toBe("300");
  });

  it("returns the root message id for a nested reply chain", () => {
    const messages = [
      createRoomMessage({
        accountId: 1,
        body: "root message",
        messageId: "100",
      }),
      createRoomMessage({
        accountId: 2,
        body: "[rp aid=1 to=456-100] middle message",
        messageId: "200",
      }),
    ];

    expect(
      resolveReplyChainRootMessageId({
        messageId: "300",
        messageText: "[rp aid=2 to=456-200] current reply",
        messagesById: indexChatworkRoomMessagesById({ messages }),
        roomId: 456,
      })
    ).toBe("100");
  });

  it("ボット返信の自己参照 [rp] からも初回メンションまで遡れる", () => {
    const messages = [
      createRoomMessage({
        accountId: 1,
        body: "[To:999] hello",
        messageId: "2113948355263737856",
      }),
      createRoomMessage({
        accountId: 999,
        body: "[rp aid=999 to=437554432-2113948369201405952] bot reply",
        messageId: "2113948369201405952",
      }),
      createRoomMessage({
        accountId: 1,
        body: "[rp aid=999 to=437554432-2113948369201405952] follow up",
        messageId: "2113949814873141248",
      }),
    ];

    expect(
      resolveReplyChainRootMessageId({
        messageId: "2113949814873141248",
        messageText: messages[2]!.body,
        messagesById: indexChatworkRoomMessagesById({ messages }),
        roomId: 437554432,
      })
    ).toBe("2113948355263737856");
  });
});
