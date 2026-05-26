import {
  extractFiles,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import {
  ConsoleLogger,
  Message,
  NotImplementedError,
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
  type UserInfo,
  type WebhookOptions,
} from "chat";
import { resolveInboundAttachments } from "./attachments";
import { ChatworkClient } from "./client";
import { ChatworkFormatConverter } from "./format-converter";
import { hasToNotation, parseReplyNotation, renderReplyNotation } from "./notation";
import {
  collectReplyChainForThreadAnchor,
  indexChatworkRoomMessagesById,
} from "./reply-chain";
import { decodeThreadId, encodeThreadId } from "./thread-id";
import type {
  ChatworkAdapterConfig,
  ChatworkContact,
  ChatworkMessageCreatedEvent,
  ChatworkMentionToMeEvent,
  ChatworkPostMessageResponse,
  ChatworkRoomMember,
  ChatworkRoomMessage,
  ChatworkThreadId,
  ChatworkWebhookPayload,
} from "./types";
import {
  UnauthorizedChatworkWebhookError,
  verifyChatworkWebhook,
} from "./webhook";

const MAX_BODY_LENGTH = 65535;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const CONTACTS_CACHE_TTL_MS = 60_000;
const ROOM_MEMBERS_CACHE_TTL_MS = 60_000;

export class ChatworkAdapter
  implements Adapter<ChatworkThreadId, unknown>
{
  readonly name = "chatwork";
  readonly userName: string;

  private botAccountId?: number;
  private chat: ChatInstance | null = null;
  private contactsCache: ChatworkContact[] | null = null;
  private contactsCacheExpiresAt = 0;
  private readonly roomMembersCacheById = new Map<
    number,
    { expiresAt: number; members: ChatworkRoomMember[] }
  >();
  private readonly client: ChatworkClient;
  private readonly config: ChatworkAdapterConfig;
  private logger: Logger;
  private readonly converter = new ChatworkFormatConverter();
  private readonly roomTypeById = new Map<number, string>();

  constructor(config: ChatworkAdapterConfig) {
    validateConfig(config);
    this.config = config;
    this.botAccountId = config.botAccountId;
    this.userName = config.userName ?? "chatwork-bot";
    this.logger = config.logger ?? new ConsoleLogger();
    this.client = new ChatworkClient({
      apiToken: config.apiToken,
      fetch: config.fetch,
    });
  }

  get botUserId(): string | undefined {
    return this.botAccountId ? String(this.botAccountId) : undefined;
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

  isDM(threadId: string): boolean {
    const decoded = this.decodeThreadId(threadId);
    const cachedType = this.roomTypeById.get(decoded.roomId);
    return cachedType === "direct";
  }

  async openDM(userId: string): Promise<string> {
    const accountId = Number(userId);
    if (!Number.isInteger(accountId)) {
      throw new ValidationError("chatwork", `Invalid Chatwork account ID: ${userId}`);
    }

    const contacts = await this.getContactsCached();
    const contact = contacts.find((entry) => entry.account_id === accountId);
    if (!contact?.room_id) {
      throw new ResourceNotFoundError(
        "chatwork",
        "Chatwork direct room",
        userId
      );
    }

    this.roomTypeById.set(contact.room_id, "direct");
    return encodeThreadId({ roomId: contact.room_id });
  }

  async getUser(userId: string): Promise<UserInfo | null> {
    const accountId = Number(userId);
    if (!Number.isInteger(accountId)) {
      return null;
    }

    const contacts = await this.getContactsCached();
    const contact = contacts.find((entry) => entry.account_id === accountId);
    if (!contact) {
      return null;
    }

    return {
      avatarUrl: contact.avatar_image_url,
      fullName: contact.name,
      isBot: false,
      userId: String(accountId),
      userName: contact.name,
    };
  }

  async onThreadSubscribe(threadId: string): Promise<void> {
    const decoded = this.decodeThreadId(threadId);
    this.logger.info(
      "Chatwork thread subscribed. Ensure room webhook (message_created) is configured for subscribed follow-ups.",
      {
        roomId: decoded.roomId,
        threadId,
      }
    );
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

    if (!(await this.shouldProcessPayload(payload))) {
      return new Response("OK", { status: 200 });
    }

    const message = await this.enrichInboundMessage(
      this.parseMessage(payload)
    );
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
      author: this.buildAuthor({
        accountId,
      }),
      formatted: this.converter.toAst(event.body),
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
    const decoded = this.decodeThreadId(threadId);
    const text = await this.renderOutgoingBody(decoded, message);

    if (files.length === 0) {
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

    let lastMessageId: string | undefined;

    for (const [index, file] of files.entries()) {
      validateUploadSize({ file });
      const uploadMessage = index === 0 && text.length > 0 ? text : undefined;
      if (uploadMessage) {
        validateBodyLength(uploadMessage);
      }

      const upload = await this.client.uploadRoomFile({
        file: toUploadBlob({ file }),
        filename: file.filename,
        message: uploadMessage,
        mimeType: file.mimeType,
        roomId: decoded.roomId,
      });

      const fileInfo = await this.client.getRoomFile({
        fileId: upload.file_id,
        roomId: decoded.roomId,
      });
      lastMessageId = fileInfo.message_id;
    }

    if (!lastMessageId) {
      throw new ValidationError("chatwork", "Chatwork file upload did not return a message ID");
    }

    return {
      id: lastMessageId,
      raw: { message_id: lastMessageId },
      threadId: this.encodeThreadId({
        messageId: lastMessageId,
        roomId: decoded.roomId,
      }),
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<ChatworkPostMessageResponse>> {
    const files = extractFiles(message);
    if (files.length > 0) {
      throw new ValidationError(
        "chatwork",
        "Chatwork does not support editing messages with file uploads"
      );
    }

    const decoded = this.decodeThreadId(threadId);
    const body = await this.renderOutgoingBody(decoded, message);
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

    return this.enrichInboundMessage(
      this.messageFromRoomMessage(raw, decoded.roomId)
    );
  }

  async fetchMessages(
    threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<ChatworkRoomMessage>> {
    const decoded = this.decodeThreadId(threadId);
    const roomMessages = await this.client.getRoomMessages(decoded.roomId);
    const selectedMessages =
      decoded.messageId === undefined
        ? roomMessages
        : collectReplyChainForThreadAnchor({
            anchorMessageId: decoded.messageId,
            messagesById: indexChatworkRoomMessagesById({ messages: roomMessages }),
            roomId: decoded.roomId,
          });

    return {
      messages: await Promise.all(
        selectedMessages.map(async (message) =>
          this.enrichInboundMessage(
            this.messageFromRoomMessage(message, decoded.roomId)
          )
        )
      ),
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const decoded = this.decodeThreadId(threadId);
    const room = await this.client.getRoom(decoded.roomId);
    if (room.type) {
      this.roomTypeById.set(decoded.roomId, room.type);
    }

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

  private async enrichInboundMessage<T>(
    message: Message<T>
  ): Promise<Message<T>> {
    const decoded = this.decodeThreadId(message.threadId);
    const attachments = await resolveInboundAttachments({
      body: message.text,
      client: this.client,
      roomId: decoded.roomId,
    });
    const author = await this.resolveAuthor({
      accountId: Number(message.author.userId),
      fallbackName: message.author.userName,
      roomId: decoded.roomId,
    });

    return new Message<T>({
      attachments,
      author,
      formatted: message.formatted,
      id: message.id,
      isMention: message.isMention,
      metadata: message.metadata,
      raw: message.raw,
      text: message.text,
      threadId: message.threadId,
    });
  }

  private async resolveAuthor(args: {
    accountId: number;
    fallbackName?: string;
    roomId: number;
  }): Promise<Message<unknown>["author"]> {
    if (!Number.isInteger(args.accountId)) {
      return {
        fullName: args.fallbackName ?? "unknown",
        isBot: "unknown",
        isMe: false,
        userId: String(args.accountId),
        userName: args.fallbackName ?? "unknown",
      };
    }

    const user = await this.getUser(String(args.accountId));
    if (user) {
      return {
        fullName: user.fullName,
        isBot: false,
        isMe: this.botAccountId === args.accountId,
        userId: String(args.accountId),
        userName: user.userName,
      };
    }

    const members = await this.getRoomMembersCached({ roomId: args.roomId });
    const member = members.find((entry) => entry.account_id === args.accountId);
    const displayName =
      member?.name ?? args.fallbackName ?? String(args.accountId);

    return {
      fullName: displayName,
      isBot: false,
      isMe: this.botAccountId === args.accountId,
      userId: String(args.accountId),
      userName: displayName,
    };
  }

  private buildAuthor(args: { accountId: number }): Message<unknown>["author"] {
    return {
      fullName: String(args.accountId),
      isBot: "unknown",
      isMe: this.botAccountId === args.accountId,
      userId: String(args.accountId),
      userName: String(args.accountId),
    };
  }

  private async getContactsCached(): Promise<ChatworkContact[]> {
    if (this.contactsCache && Date.now() < this.contactsCacheExpiresAt) {
      return this.contactsCache;
    }

    this.contactsCache = (await this.client.getContacts()) ?? [];
    this.contactsCacheExpiresAt = Date.now() + CONTACTS_CACHE_TTL_MS;
    return this.contactsCache;
  }

  private async getRoomMembersCached(args: {
    roomId: number;
  }): Promise<ChatworkRoomMember[]> {
    const cached = this.roomMembersCacheById.get(args.roomId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.members;
    }

    const members = (await this.client.getRoomMembers(args.roomId)) ?? [];
    this.roomMembersCacheById.set(args.roomId, {
      expiresAt: Date.now() + ROOM_MEMBERS_CACHE_TTL_MS,
      members,
    });
    return members;
  }

  private async isDirectRoom(roomId: number): Promise<boolean> {
    const cachedType = this.roomTypeById.get(roomId);
    if (cachedType) {
      return cachedType === "direct";
    }

    const room = await this.client.getRoom(roomId);
    if (room.type) {
      this.roomTypeById.set(roomId, room.type);
    }
    return room.type === "direct";
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

  private async shouldProcessPayload(
    payload: ChatworkWebhookPayload
  ): Promise<boolean> {
    const accountId = getAuthorAccountId(payload);
    if (this.botAccountId && accountId === this.botAccountId) {
      return false;
    }

    if (payload.webhook_event_type === "mention_to_me") {
      return true;
    }

    if (this.isMentionPayload(payload)) {
      return true;
    }

    if (parseReplyNotation(payload.webhook_event.body)) {
      return true;
    }

    if (payload.webhook_event_type === "message_created") {
      return this.isDirectRoom(payload.webhook_event.room_id);
    }

    return false;
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
      formatted: this.converter.toAst(raw.body),
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

function validateUploadSize(args: { file: { data: Blob | Buffer | ArrayBuffer; filename: string } }): void {
  const size = readUploadSize({ data: args.file.data });
  if (size > MAX_UPLOAD_BYTES) {
    throw new ValidationError(
      "chatwork",
      `Chatwork file uploads must be ${MAX_UPLOAD_BYTES} bytes or fewer`
    );
  }
}

function readUploadSize(args: { data: Blob | Buffer | ArrayBuffer }): number {
  if (Buffer.isBuffer(args.data)) {
    return args.data.byteLength;
  }
  if (args.data instanceof ArrayBuffer) {
    return args.data.byteLength;
  }
  return args.data.size;
}

function toUploadBlob(args: {
  file: { data: Blob | Buffer | ArrayBuffer; filename: string; mimeType?: string };
}): Blob | Buffer {
  if (args.file.data instanceof Buffer || args.file.data instanceof Blob) {
    return args.file.data;
  }
  return new Blob([toBlobPart({ data: args.file.data })], {
    type: args.file.mimeType ?? "application/octet-stream",
  });
}

function toBlobPart(args: { data: Blob | Buffer | ArrayBuffer }): BlobPart {
  if (args.data instanceof Blob) {
    return args.data;
  }
  if (Buffer.isBuffer(args.data)) {
    return Uint8Array.from(args.data);
  }
  return args.data;
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
