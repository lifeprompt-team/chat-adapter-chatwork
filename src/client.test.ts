import { describe, expect, it, vi } from "vitest";
import { AuthenticationError, ValidationError } from "@chat-adapter/shared";
import { ChatworkClient } from "./client";

describe("ChatworkClient", () => {
  it("posts room messages with form body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message_id: "m1" }), { status: 200 })
    );
    const client = new ChatworkClient({
      apiToken: "token",
      fetch: fetchMock,
    });

    await client.postRoomMessage({
      body: "hello",
      roomId: 123,
      selfUnread: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.chatwork.com/v2/rooms/123/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
          "x-chatworktoken": "token",
        }),
      })
    );

    const init = fetchMock.mock.calls[0][1];
    expect(String(init.body)).toBe("body=hello&self_unread=0");
  });

  it("edits room messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message_id: "m1" }), { status: 200 })
    );
    const client = new ChatworkClient({
      apiToken: "token",
      fetch: fetchMock,
    });

    await client.editRoomMessage({
      body: "updated",
      messageId: "m1",
      roomId: 123,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.chatwork.com/v2/rooms/123/messages/m1",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("deletes room messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    const client = new ChatworkClient({
      apiToken: "token",
      fetch: fetchMock,
    });

    await client.deleteRoomMessage({ messageId: "m1", roomId: 123 });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.chatwork.com/v2/rooms/123/messages/m1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("maps 400 responses to validation errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: ["bad request"] }), { status: 400 })
    );
    const client = new ChatworkClient({
      apiToken: "token",
      fetch: fetchMock,
    });

    await expect(
      client.postRoomMessage({ body: "hello", roomId: 123 })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps 401 responses to authentication errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: ["invalid token"] }), { status: 401 })
    );
    const client = new ChatworkClient({
      apiToken: "token",
      fetch: fetchMock,
    });

    await expect(
      client.postRoomMessage({ body: "hello", roomId: 123 })
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
