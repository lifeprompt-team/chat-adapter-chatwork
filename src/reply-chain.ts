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

export function readReplyParentMessageId(args: {
  body: string;
  roomId: number;
  selfMessageId?: string;
}): string | undefined {
  const replyNotation = parseReplyNotation(args.body);
  if (!replyNotation || replyNotation.roomId !== args.roomId) {
    return undefined;
  }
  if (args.selfMessageId && replyNotation.messageId === args.selfMessageId) {
    return undefined;
  }
  return replyNotation.messageId;
}

export function readMessageIdBeforeBySendTime(args: {
  anchorMessageId: string;
  messages: readonly ChatworkRoomMessage[];
}): string | undefined {
  const sorted = [...args.messages].sort((left, right) => left.send_time - right.send_time);
  const anchorIndex = sorted.findIndex(
    (message) => message.message_id === args.anchorMessageId
  );
  if (anchorIndex <= 0) {
    return undefined;
  }
  return sorted[anchorIndex - 1]!.message_id;
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
    if (chain.some((entry) => entry.message_id === message.message_id)) {
      break;
    }

    chain.unshift(message);

    nextMessageId = readReplyParentMessageId({
      body: message.body,
      roomId: args.roomId,
      selfMessageId: message.message_id,
    });
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

type ResolveReplyChainRootMessageIdArgs = {
  maxDepth?: number;
  messageId: string;
  messageText: string;
  messagesById: ReadonlyMap<string, ChatworkRoomMessage>;
  recursionDepth: number;
  roomId: number;
};

function resolveReplyChainRootMessageIdInternal(
  args: ResolveReplyChainRootMessageIdArgs
): string {
  const maxDepth = args.maxDepth ?? DEFAULT_REPLY_CHAIN_MAX_DEPTH;
  if (args.recursionDepth >= maxDepth) {
    return args.messageId;
  }

  const chain = collectReplyChainFromMessages({
    maxDepth: args.maxDepth,
    messageText: args.messageText,
    messagesById: args.messagesById,
    roomId: args.roomId,
  });
  if (chain.length === 0) {
    return args.messageId;
  }

  let rootId = chain[0]!.message_id;
  const rootMessage = args.messagesById.get(rootId);
  if (!rootMessage) {
    return rootId;
  }

  const brokenSelfReply =
    readReplyParentMessageId({
      body: rootMessage.body,
      roomId: args.roomId,
      selfMessageId: rootMessage.message_id,
    }) === undefined &&
    parseReplyNotation(rootMessage.body) !== null;

  if (!brokenSelfReply) {
    return rootId;
  }

  const priorMessageId = readMessageIdBeforeBySendTime({
    anchorMessageId: rootId,
    messages: [...args.messagesById.values()],
  });
  if (!priorMessageId) {
    return rootId;
  }

  const priorMessage = args.messagesById.get(priorMessageId);
  if (!priorMessage) {
    return rootId;
  }

  return resolveReplyChainRootMessageIdInternal({
    maxDepth: args.maxDepth,
    messageId: priorMessageId,
    messageText: priorMessage.body,
    messagesById: args.messagesById,
    recursionDepth: args.recursionDepth + 1,
    roomId: args.roomId,
  });
}

/** 返信チェーンのルート message_id。`[rp]` が無い場合は messageId をそのまま返す。 */
export function resolveReplyChainRootMessageId(args: {
  maxDepth?: number;
  messageId: string;
  messageText: string;
  messagesById: ReadonlyMap<string, ChatworkRoomMessage>;
  roomId: number;
}): string {
  return resolveReplyChainRootMessageIdInternal({
    maxDepth: args.maxDepth,
    messageId: args.messageId,
    messageText: args.messageText,
    messagesById: args.messagesById,
    recursionDepth: 0,
    roomId: args.roomId,
  });
}
