import { ValidationError } from "@chat-adapter/shared";
import type { ChatworkThreadId } from "./types";

const ADAPTER_NAME = "chatwork";

export function encodeThreadId(data: ChatworkThreadId): string {
  const roomId = encodeSegment(String(data.roomId));
  if (!data.messageId) {
    return `${ADAPTER_NAME}:${roomId}`;
  }

  return `${ADAPTER_NAME}:${roomId}:${encodeSegment(data.messageId)}`;
}

export function decodeThreadId(threadId: string): ChatworkThreadId {
  const [adapter, encodedRoomId, encodedMessageId, ...rest] =
    threadId.split(":");

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

  return encodedMessageId
    ? { messageId: decodeSegment(encodedMessageId), roomId }
    : { roomId };
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
