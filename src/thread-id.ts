import { ValidationError } from "@chat-adapter/shared";
import type { ChatworkThreadId } from "./types";

const ADAPTER_NAME = "chatwork";

export function encodeThreadId(data: ChatworkThreadId): string {
  const encodedRoomId = encodeSegment(String(data.roomId));
  if (!data.messageId) {
    return `${ADAPTER_NAME}:${encodedRoomId}`;
  }

  const encodedMessageId = encodeSegment(data.messageId);
  if (data.replyToAccountId === undefined) {
    return `${ADAPTER_NAME}:${encodedRoomId}:${encodedMessageId}`;
  }

  return `${ADAPTER_NAME}:${encodedRoomId}:${encodedMessageId}:${encodeSegment(String(data.replyToAccountId))}`;
}

export function decodeThreadId(threadId: string): ChatworkThreadId {
  const [
    adapter,
    encodedRoomId,
    encodedMessageId,
    encodedReplyToAccountId,
    ...rest
  ] = threadId.split(":");

  if (adapter !== ADAPTER_NAME || !encodedRoomId || rest.length > 0) {
    throw new ValidationError(
      ADAPTER_NAME,
      `Invalid Chatwork thread ID: ${threadId}`
    );
  }

  const roomId = Number(decodeSegment(encodedRoomId));
  if (!Number.isInteger(roomId)) {
    throw new ValidationError(
      ADAPTER_NAME,
      `Invalid Chatwork room ID in thread ID: ${threadId}`
    );
  }

  const decoded: ChatworkThreadId = { roomId };

  if (encodedMessageId) {
    decoded.messageId = decodeSegment(encodedMessageId);
  }

  if (encodedReplyToAccountId) {
    const replyToAccountId = Number(decodeSegment(encodedReplyToAccountId));
    if (!Number.isInteger(replyToAccountId)) {
      throw new ValidationError(
        ADAPTER_NAME,
        `Invalid Chatwork reply target account ID in thread ID: ${threadId}`
      );
    }
    decoded.replyToAccountId = replyToAccountId;
  }

  return decoded;
}

function encodeSegment(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeSegment(value: string): string {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch (error) {
    throw new ValidationError(
      ADAPTER_NAME,
      `Invalid base64url thread segment: ${String(error)}`
    );
  }
}
