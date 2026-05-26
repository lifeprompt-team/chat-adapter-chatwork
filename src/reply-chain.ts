import { parseReplyNotation } from "./notation";

import type { ChatworkRoomMessage } from "./types";

export const DEFAULT_REPLY_CHAIN_MAX_DEPTH = 30;

export function indexChatworkRoomMessagesById(args: {
  messages: readonly ChatworkRoomMessage[];
}): Map<string, ChatworkRoomMessage> {
  const byId = new Map<string, ChatworkRoomMessage>();
  for (const message of args.messages) {
    byId.set(message.message_id, message);
  }
  return byId;
}

export function collectReplyChainFromMessages(args: {
  maxDepth?: number;
  messageText: string;
  messagesById: ReadonlyMap<string, ChatworkRoomMessage>;
  roomId: number;
}): ChatworkRoomMessage[] {
  const replyNotation = parseReplyNotation(args.messageText);
  if (!replyNotation || replyNotation.roomId !== args.roomId) {
    return [];
  }

  const maxDepth = args.maxDepth ?? DEFAULT_REPLY_CHAIN_MAX_DEPTH;
  const chain: ChatworkRoomMessage[] = [];
  let nextMessageId: string | undefined = replyNotation.messageId;

  while (nextMessageId && chain.length < maxDepth) {
    const message = args.messagesById.get(nextMessageId);
    if (!message) {
      break;
    }

    chain.unshift(message);

    const parentNotation = parseReplyNotation(message.body);
    nextMessageId =
      parentNotation && parentNotation.roomId === args.roomId
        ? parentNotation.messageId
        : undefined;
  }

  return chain;
}

export function collectReplyChainForThreadAnchor(args: {
  anchorMessageId: string;
  maxDepth?: number;
  messagesById: ReadonlyMap<string, ChatworkRoomMessage>;
  roomId: number;
}): ChatworkRoomMessage[] {
  const anchorMessage = args.messagesById.get(args.anchorMessageId);
  if (!anchorMessage) {
    return [];
  }

  return collectReplyChainFromMessages({
    maxDepth: args.maxDepth,
    messageText: anchorMessage.body,
    messagesById: args.messagesById,
    roomId: args.roomId,
  });
}
