import {
  extractFiles,
  ValidationError,
} from "@chat-adapter/shared";
import {
  ConsoleLogger,
  Message,
  NotImplementedError,
  parseMarkdown,
  type Adapter,
  type AdapterPostableMessage,
  type ChatInstance,
  type EmojiValue,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  type Logger,
  type RawMessage,
  type ThreadInfo,
  type WebhookOptions,
} from "chat";
import { ChatworkClient } from "./client";
import { ChatworkFormatConverter } from "./format-converter";
import { hasToNotation, renderReplyNotation } from "./notation";
import { decodeThreadId, encodeThreadId } from "./thread-id";
import type {
  ChatworkAdapterConfig,
  ChatworkMessageCreatedEvent,
  ChatworkMentionToMeEvent,
  ChatworkPostMessageResponse,
  ChatworkRoomMessage,
  ChatworkThreadId,
  ChatworkWebhookPayload,
} from "./types";
import {
  UnauthorizedChatworkWebhookError,
  verifyChatworkWebhook,
} from "./webhook";

const MAX_BODY_LENGTH = 65535;

export class ChatworkAdapter
  implements Adapter<ChatworkThreadId, unknown>
{
  readonly name = "chatwork";
  readonly userName: string;

  private botAccountId?: number;
  private chat: ChatInstance | null = null;
  private readonly client: ChatworkClient;
  private readonly config: ChatworkAdapterConfig;
  private logger: Logger;
  private readonly converter = new ChatworkFormatConverter();

  constructor(config: ChatworkAdapterConfig) {
    validateConfig(config);
    this.config = config;
    this.botAccountId = config.botAccountId;
    this.userName = config.userName ?? "chatwork-bot";
    this.logger = config.logger ?? new ConsoleLogger();
    this.client = new ChatworkClient({ apiToken: config.apiToken });
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger("chatwork");

    if (!this.botAccountId) {
      const me = await this.client.getMe();
      this.botAccountId = me.account_id;
    }
  }

  encodeThreadId(data: ChatworkThreadId): string {
    return encodeThreadId(data);
  }

  decodeThreadId(threadId: string): ChatworkThreadId {
    return decodeThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    return String(this.decodeThreadId(threadId).roomId);
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    let verified;

    try {
      verified = await verifyChatworkWebhook(
        request,
        this.config.webhookToken
      );
    } catch (error) {
      if (error instanceof UnauthorizedChatworkWebhookError) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (error instanceof ValidationError) {
        return new Response(error.message, { status: 400 });
      }

      throw error;
    }

    const payload = verified.payload;

    if (payload.webhook_event_type === "message_updated") {
      this.logger.debug("Ignoring Chatwork message_updated event");
      return new Response("OK", { status: 200 });
    }

    if (!this.shouldProcessPayload(payload)) {
      return new Response("OK", { status: 200 });
    }

    const message = this.parseMessage(payload);
    this.requireChat().processMessage(this, message.threadId, message, options);

    return new Response("OK", { status: 200 });
  }

  parseMessage(raw: unknown): Message<unknown> {
    if (!isChatworkWebhookPayload(raw)) {
      throw new ValidationError("chatwork", "Expected Chatwork webhook payload");
    }

    const event = raw.webhook_event;
    const accountId = getAuthorAccountId(raw);
    const threadId = this.encodeThreadId({
      messageId: event.message_id,
      replyToAccountId: accountId,
      roomId: event.room_id,
    });

    return new Message<unknown>({
      attachments: [],
      author: {
        fullName: String(accountId),
        isBot: "unknown",
        isMe: false,
        userId: String(accountId),
        userName: String(accountId),
      },
      formatted: parseMarkdown(event.body),
      id: event.message_id,
      isMention: this.isMentionPayload(raw),
      metadata: {
        dateSent: new Date(event.send_time * 1000),
        edited: event.update_time !== 0,
        editedAt:
          event.update_time !== 0
            ? new Date(event.update_time * 1000)
            : undefined,
      },
      raw,
      text: event.body,
      threadId,
    });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<ChatworkPostMessageResponse>> {
    const files = extractFiles(message);
    if (files.length > 0) {
      throw new ValidationError(
        "chatwork",
        "Chatwork file uploads are not supported yet"
      );
    }

    const decoded = this.decodeThreadId(threadId);
    const text = await this.renderOutgoingBody(decoded, message);
    validateBodyLength(text);

    const raw = await this.client.postRoomMessage({
      body: text,
      roomId: decoded.roomId,
      selfUnread: this.config.selfUnread,
    });

    return {
      id: raw.message_id,
      raw,
      threadId: this.encodeThreadId({
        messageId: raw.message_id,
        roomId: decoded.roomId,
      }),
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<ChatworkPostMessageResponse>> {
    const decoded = this.decodeThreadId(threadId);
    const body = this.converter.renderPostable(message);
    validateBodyLength(body);

    const raw = await this.client.editRoomMessage({
      body,
      messageId,
      roomId: decoded.roomId,
    });

    return {
      id: raw.message_id ?? messageId,
      raw,
      threadId,
    };
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const decoded = this.decodeThreadId(threadId);
    await this.client.deleteRoomMessage({
      messageId,
      roomId: decoded.roomId,
    });
  }

  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<ChatworkRoomMessage> | null> {
    const decoded = this.decodeThreadId(threadId);
    const raw = await this.client.getRoomMessage({
      messageId,
      roomId: decoded.roomId,
    });

    return this.messageFromRoomMessage(raw, decoded.roomId);
  }

  async fetchMessages(
    threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<ChatworkRoomMessage>> {
    const decoded = this.decodeThreadId(threadId);
    const messages = await this.client.getRoomMessages(decoded.roomId);

    return {
      messages: messages.map((message) =>
        this.messageFromRoomMessage(message, decoded.roomId)
      ),
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const decoded = this.decodeThreadId(threadId);
    const room = await this.client.getRoom(decoded.roomId);

    return {
      channelId: String(decoded.roomId),
      channelName: room.name,
      id: threadId,
      isDM: room.type === "direct",
      metadata: {
        chatwork: room,
      },
    };
  }

  renderFormatted(content: FormattedContent): string {
    return this.converter.fromAst(content);
  }

  async startTyping(): Promise<void> {
    throw new NotImplementedError(
      "Chatwork typing indicators are not supported",
      "startTyping"
    );
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      "Chatwork reactions are not supported",
      "addReaction"
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      "Chatwork reactions are not supported",
      "removeReaction"
    );
  }

  private async renderOutgoingBody(
    thread: ChatworkThreadId,
    message: AdapterPostableMessage
  ): Promise<string> {
    const body = this.converter.renderPostable(message);
    if (!thread.messageId) {
      return body;
    }

    const accountId = await this.resolveReplyToAccountId(thread);
    if (!accountId) {
      this.logger.warn("Could not resolve Chatwork reply target account ID", {
        messageId: thread.messageId,
        roomId: thread.roomId,
      });
      return body;
    }

    return `${renderReplyNotation({
      accountId,
      messageId: thread.messageId,
      roomId: thread.roomId,
    })}\n${body}`;
  }

  private async resolveReplyToAccountId(
    thread: ChatworkThreadId
  ): Promise<number | undefined> {
    if (thread.replyToAccountId) {
      return thread.replyToAccountId;
    }

    if (!thread.messageId) {
      return undefined;
    }

    try {
      const message = await this.client.getRoomMessage({
        messageId: thread.messageId,
        roomId: thread.roomId,
      });
      return message.account.account_id;
    } catch (error) {
      this.logger.warn("Failed to fetch Chatwork reply source message", error);
      return undefined;
    }
  }

  private shouldProcessPayload(payload: ChatworkWebhookPayload): boolean {
    const accountId = getAuthorAccountId(payload);
    if (this.botAccountId && accountId === this.botAccountId) {
      return false;
    }

    return payload.webhook_event_type === "mention_to_me"
      ? true
      : this.isMentionPayload(payload);
  }

  private isMentionPayload(payload: ChatworkWebhookPayload): boolean {
    if (payload.webhook_event_type === "mention_to_me") {
      return true;
    }

    if (this.config.treatRoomMessagesAsMentions === true) {
      return true;
    }

    return Boolean(
      this.botAccountId &&
        hasToNotation(payload.webhook_event.body, this.botAccountId)
    );
  }

  private messageFromRoomMessage(
    raw: ChatworkRoomMessage,
    roomId: number
  ): Message<ChatworkRoomMessage> {
    return new Message<ChatworkRoomMessage>({
      attachments: [],
      author: {
        fullName: raw.account.name,
        isBot: "unknown",
        isMe: this.botAccountId === raw.account.account_id,
        userId: String(raw.account.account_id),
        userName: raw.account.name,
      },
      formatted: parseMarkdown(raw.body),
      id: raw.message_id,
      isMention: Boolean(
        this.botAccountId && hasToNotation(raw.body, this.botAccountId)
      ),
      metadata: {
        dateSent: new Date(raw.send_time * 1000),
        edited: raw.update_time !== 0,
        editedAt:
          raw.update_time !== 0
            ? new Date(raw.update_time * 1000)
            : undefined,
      },
      raw,
      text: raw.body,
      threadId: this.encodeThreadId({
        messageId: raw.message_id,
        replyToAccountId: raw.account.account_id,
        roomId,
      }),
    });
  }

  private requireChat(): ChatInstance {
    if (!this.chat) {
      throw new ValidationError("chatwork", "ChatworkAdapter is not initialized");
    }

    return this.chat;
  }
}

function validateConfig(config: ChatworkAdapterConfig): void {
  if (!config.apiToken) {
    throw new ValidationError("chatwork", "apiToken is required");
  }

  if (!config.webhookToken) {
    throw new ValidationError("chatwork", "webhookToken is required");
  }
}

function validateBodyLength(body: string): void {
  if (body.length === 0) {
    throw new ValidationError("chatwork", "Chatwork message body is required");
  }

  if (body.length > MAX_BODY_LENGTH) {
    throw new ValidationError(
      "chatwork",
      `Chatwork message body must be ${MAX_BODY_LENGTH} characters or fewer`
    );
  }
}

function getAuthorAccountId(payload: ChatworkWebhookPayload): number {
  return payload.webhook_event_type === "mention_to_me"
    ? (payload.webhook_event as ChatworkMentionToMeEvent).from_account_id
    : (payload.webhook_event as ChatworkMessageCreatedEvent).account_id;
}

function isChatworkWebhookPayload(value: unknown): value is ChatworkWebhookPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "webhook_event_type" in value &&
    "webhook_event" in value &&
    typeof value.webhook_event === "object" &&
    value.webhook_event !== null &&
    "message_id" in value.webhook_event &&
    typeof value.webhook_event.message_id === "string" &&
    "room_id" in value.webhook_event &&
    typeof value.webhook_event.room_id === "number" &&
    "body" in value.webhook_event &&
    typeof value.webhook_event.body === "string" &&
    "send_time" in value.webhook_event &&
    typeof value.webhook_event.send_time === "number" &&
    "update_time" in value.webhook_event &&
    typeof value.webhook_event.update_time === "number"
  );
}
