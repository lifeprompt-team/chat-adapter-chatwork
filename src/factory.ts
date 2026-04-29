import { ValidationError } from "@chat-adapter/shared";
import type { Logger } from "chat";
import { ChatworkAdapter } from "./adapter";
import type { ChatworkAdapterConfig } from "./types";

export function createChatworkAdapter(
  config: Partial<ChatworkAdapterConfig> & { logger?: Logger } = {}
): ChatworkAdapter {
  const apiToken = config.apiToken ?? process.env.CHATWORK_API_TOKEN;
  const webhookToken =
    config.webhookToken ?? process.env.CHATWORK_WEBHOOK_TOKEN;
  const botAccountId =
    config.botAccountId ?? parseOptionalNumber(process.env.CHATWORK_BOT_ACCOUNT_ID);
  const userName =
    config.userName ?? process.env.CHATWORK_BOT_USER_NAME ?? "chatwork-bot";

  if (!apiToken) {
    throw new ValidationError(
      "chatwork",
      "Chatwork API token is required. Pass apiToken or set CHATWORK_API_TOKEN."
    );
  }

  if (!webhookToken) {
    throw new ValidationError(
      "chatwork",
      "Chatwork Webhook token is required. Pass webhookToken or set CHATWORK_WEBHOOK_TOKEN."
    );
  }

  return new ChatworkAdapter({
    apiToken,
    botAccountId,
    logger: config.logger,
    selfUnread:
      config.selfUnread ?? parseBoolean(process.env.CHATWORK_SELF_UNREAD),
    treatRoomMessagesAsMentions:
      config.treatRoomMessagesAsMentions ??
      parseBoolean(process.env.CHATWORK_TREAT_ROOM_MESSAGES_AS_MENTIONS),
    userName,
    webhookToken,
  });
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === "1" || value.toLowerCase() === "true";
}
