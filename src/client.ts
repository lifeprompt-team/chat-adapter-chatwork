import { NetworkError } from "@chat-adapter/shared";
import { mapChatworkResponseError } from "./errors";
import type {
  ChatworkClientConfig,
  ChatworkMe,
  ChatworkPostMessageResponse,
  ChatworkRoom,
  ChatworkRoomMessage,
} from "./types";

const API_BASE_URL = "https://api.chatwork.com/v2";

export class ChatworkClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ChatworkClientConfig) {
    this.fetchImpl = config.fetch ?? fetch;
  }

  async getMe(): Promise<ChatworkMe> {
    return this.requestJson<ChatworkMe>("/me");
  }

  async getRoom(roomId: number): Promise<ChatworkRoom> {
    return this.requestJson<ChatworkRoom>(`/rooms/${roomId}`);
  }

  async postRoomMessage(options: {
    body: string;
    roomId: number;
    selfUnread?: boolean;
  }): Promise<ChatworkPostMessageResponse> {
    const form = new URLSearchParams();
    form.set("body", options.body);
    form.set("self_unread", options.selfUnread ? "1" : "0");

    return this.requestJson<ChatworkPostMessageResponse>(
      `/rooms/${options.roomId}/messages`,
      {
        body: form,
        method: "POST",
      }
    );
  }

  async editRoomMessage(options: {
    body: string;
    messageId: string;
    roomId: number;
  }): Promise<ChatworkPostMessageResponse> {
    const form = new URLSearchParams();
    form.set("body", options.body);

    return this.requestJson<ChatworkPostMessageResponse>(
      `/rooms/${options.roomId}/messages/${encodeURIComponent(
        options.messageId
      )}`,
      {
        body: form,
        method: "PUT",
      }
    );
  }

  async deleteRoomMessage(options: {
    messageId: string;
    roomId: number;
  }): Promise<void> {
    await this.requestJson<unknown>(
      `/rooms/${options.roomId}/messages/${encodeURIComponent(
        options.messageId
      )}`,
      {
        method: "DELETE",
      }
    );
  }

  async getRoomMessage(options: {
    messageId: string;
    roomId: number;
  }): Promise<ChatworkRoomMessage> {
    return this.requestJson<ChatworkRoomMessage>(
      `/rooms/${options.roomId}/messages/${encodeURIComponent(
        options.messageId
      )}`
    );
  }

  async getRoomMessages(roomId: number): Promise<ChatworkRoomMessage[]> {
    return this.requestJson<ChatworkRoomMessage[]>(
      `/rooms/${roomId}/messages?force=1`,
      undefined,
      true
    );
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit = {},
    allowNoContent = false
  ): Promise<T> {
    let response: Response;

    try {
      response = await this.fetchImpl(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
          "x-chatworktoken": this.config.apiToken,
          ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      throw new NetworkError(
        "chatwork",
        "Failed to call Chatwork API",
        error instanceof Error ? error : undefined
      );
    }

    if (response.status === 204 && allowNoContent) {
      return [] as T;
    }

    if (!response.ok) {
      throw await mapChatworkResponseError(response, path);
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }
}
