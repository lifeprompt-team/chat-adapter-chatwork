import type { Logger } from "chat";

export interface ChatworkAdapterConfig {
  apiToken: string;
  botAccountId?: number;
  fetch?: typeof fetch;
  logger?: Logger;
  selfUnread?: boolean;
  treatRoomMessagesAsMentions?: boolean;
  userName?: string;
  webhookToken: string;
}

export interface ChatworkClientConfig {
  apiToken: string;
  fetch?: typeof fetch;
  maxRateLimitRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface ChatworkThreadId {
  messageId?: string;
  replyToAccountId?: number;
  roomId: number;
}

export type ChatworkWebhookEventType =
  | "message_created"
  | "message_updated"
  | "mention_to_me";

export interface ChatworkMessageCreatedEvent {
  account_id: number;
  body: string;
  message_id: string;
  room_id: number;
  send_time: number;
  update_time: number;
}

export type ChatworkMessageUpdatedEvent = ChatworkMessageCreatedEvent;

export interface ChatworkMentionToMeEvent {
  body: string;
  from_account_id: number;
  message_id: string;
  room_id: number;
  send_time: number;
  to_account_id: number;
  update_time: number;
}

export interface ChatworkWebhookPayload {
  webhook_event:
    | ChatworkMessageCreatedEvent
    | ChatworkMessageUpdatedEvent
    | ChatworkMentionToMeEvent;
  webhook_event_time: number;
  webhook_event_type: ChatworkWebhookEventType;
  webhook_setting_id: string;
}

export interface ChatworkAccount {
  account_id: number;
  avatar_image_url?: string;
  name: string;
}

export interface ChatworkRoom {
  icon_path?: string;
  name: string;
  room_id: number;
  type?: string;
}

export interface ChatworkRoomMessage {
  account: ChatworkAccount;
  body: string;
  message_id: string;
  send_time: number;
  update_time: number;
}

export interface ChatworkMe {
  account_id: number;
  avatar_image_url?: string;
  chatwork_id?: string;
  name: string;
}

export interface ChatworkPostMessageResponse {
  message_id: string;
}

export interface ChatworkContact {
  account_id: number;
  avatar_image_url?: string;
  chatwork_id?: string;
  department?: string;
  name: string;
  organization_id?: number;
  organization_name?: string;
  room_id: number;
}

export interface ChatworkRoomMember {
  account_id: number;
  avatar_image_url?: string;
  chatwork_id?: string;
  department?: string;
  name: string;
  organization_id?: number;
  organization_name?: string;
  role: string;
}

export interface ChatworkRoomFile {
  account: ChatworkAccount;
  download_url?: string;
  file_id: number;
  filename: string;
  filesize: number;
  message_id: string;
  upload_time: number;
}

export interface ChatworkUploadFileResponse {
  file_id: number;
}
