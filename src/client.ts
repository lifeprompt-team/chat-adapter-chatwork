import { NetworkError } from "@chat-adapter/shared";
import { toBlobPart } from "./blob";
import { isAdapterRateLimitError, mapChatworkResponseError } from "./errors";
import type {
  ChatworkClientConfig,
  ChatworkContact,
  ChatworkMe,
  ChatworkPostMessageResponse,
  ChatworkRoom,
  ChatworkRoomFile,
  ChatworkRoomMember,
  ChatworkRoomMessage,
  ChatworkUploadFileResponse,
} from "./types";

const API_BASE_URL = "https://api.chatwork.com/v2";
const DEFAULT_MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 15;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export class ChatworkClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxRateLimitRetries: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly config: ChatworkClientConfig) {
    this.fetchImpl = config.fetch ?? fetch;
    this.maxRateLimitRetries =
      config.maxRateLimitRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES;
    this.sleep = config.sleep ?? defaultSleep;
  }

  async getMe(): Promise<ChatworkMe> {
    return this.requestJson<ChatworkMe>("/me");
  }

  async getContacts(): Promise<ChatworkContact[]> {
    return this.requestJson<ChatworkContact[]>("/contacts", undefined, true);
  }

  async getRoom(roomId: number): Promise<ChatworkRoom> {
    return this.requestJson<ChatworkRoom>(`/rooms/${roomId}`);
  }

  async getRoomMembers(roomId: number): Promise<ChatworkRoomMember[]> {
    return this.requestJson<ChatworkRoomMember[]>(`/rooms/${roomId}/members`);
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

  async getRoomFile(options: {
    createDownloadUrl?: boolean;
    fileId: number;
    roomId: number;
  }): Promise<ChatworkRoomFile> {
    const query = options.createDownloadUrl ? "?create_download_url=1" : "";
    return this.requestJson<ChatworkRoomFile>(
      `/rooms/${options.roomId}/files/${options.fileId}${query}`
    );
  }

  async uploadRoomFile(options: {
    file: Blob | Buffer;
    filename: string;
    message?: string;
    mimeType?: string;
    roomId: number;
  }): Promise<ChatworkUploadFileResponse> {
    const form = new FormData();
    const blob =
      options.file instanceof Blob
        ? options.file
        : new Blob([toBlobPart({ data: options.file })], {
            type: options.mimeType ?? "application/octet-stream",
          });
    form.append("file", blob, options.filename);
    if (options.message) {
      form.append("message", options.message);
    }

    return this.requestMultipart<ChatworkUploadFileResponse>(
      `/rooms/${options.roomId}/files`,
      {
        body: form,
        method: "POST",
      }
    );
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit = {},
    allowNoContent = false
  ): Promise<T> {
    return this.requestWithRateLimitRetry(async () => {
      let response: Response;

      try {
        response = await this.fetchImpl(`${API_BASE_URL}${path}`, {
          ...init,
          headers: {
            "x-chatworktoken": this.config.apiToken,
            ...(init.body
              ? { "Content-Type": "application/x-www-form-urlencoded" }
              : {}),
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

      return this.parseResponse<T>({ allowNoContent, path, response });
    });
  }

  private async requestMultipart<T>(
    path: string,
    init: RequestInit
  ): Promise<T> {
    return this.requestWithRateLimitRetry(async () => {
      let response: Response;

      try {
        response = await this.fetchImpl(`${API_BASE_URL}${path}`, {
          ...init,
          headers: {
            "x-chatworktoken": this.config.apiToken,
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

      return this.parseResponse<T>({ path, response });
    });
  }

  private async requestWithRateLimitRetry<T>(
    request: () => Promise<T>
  ): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await request();
      } catch (error) {
        if (!isAdapterRateLimitError(error) || attempt >= this.maxRateLimitRetries) {
          throw error;
        }

        attempt += 1;
        const retryAfterSeconds =
          error.retryAfter ?? DEFAULT_RATE_LIMIT_RETRY_SECONDS;
        await this.sleep(retryAfterSeconds * 1000);
      }
    }
  }

  private async parseResponse<T>(args: {
    allowNoContent?: boolean;
    path: string;
    response: Response;
  }): Promise<T> {
    if (args.response.status === 204 && args.allowNoContent) {
      return [] as T;
    }

    if (!args.response.ok) {
      throw await mapChatworkResponseError(args.response, args.path);
    }

    const text = await args.response.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }
}
