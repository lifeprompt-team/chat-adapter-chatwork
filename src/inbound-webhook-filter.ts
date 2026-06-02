import { hasToNotation, parseReplyNotation } from "./notation";
import type {
  ChatworkMessageCreatedEvent,
  ChatworkMentionToMeEvent,
  ChatworkWebhookPayload,
} from "./types";

export function getWebhookAuthorAccountId(
  payload: ChatworkWebhookPayload
): number {
  return payload.webhook_event_type === "mention_to_me"
    ? (payload.webhook_event as ChatworkMentionToMeEvent).from_account_id
    : (payload.webhook_event as ChatworkMessageCreatedEvent).account_id;
}

export function isWebhookMentionPayload(args: {
  botAccountId?: number;
  payload: ChatworkWebhookPayload;
  treatRoomMessagesAsMentions?: boolean;
}): boolean {
  if (args.payload.webhook_event_type === "mention_to_me") {
    return true;
  }

  if (args.treatRoomMessagesAsMentions === true) {
    return true;
  }

  return Boolean(
    args.botAccountId &&
      hasToNotation(args.payload.webhook_event.body, args.botAccountId)
  );
}

export async function shouldProcessInboundWebhook(args: {
  botAccountId?: number;
  isDirectRoom: (roomId: number) => Promise<boolean>;
  payload: ChatworkWebhookPayload;
  treatRoomMessagesAsMentions?: boolean;
}): Promise<boolean> {
  const accountId = getWebhookAuthorAccountId(args.payload);
  if (args.botAccountId && accountId === args.botAccountId) {
    return false;
  }

  if (args.payload.webhook_event_type === "mention_to_me") {
    return true;
  }

  if (
    isWebhookMentionPayload({
      botAccountId: args.botAccountId,
      payload: args.payload,
      treatRoomMessagesAsMentions: args.treatRoomMessagesAsMentions,
    })
  ) {
    return true;
  }

  if (parseReplyNotation(args.payload.webhook_event.body)) {
    return true;
  }

  if (args.payload.webhook_event_type === "message_created") {
    return args.isDirectRoom(args.payload.webhook_event.room_id);
  }

  return false;
}
