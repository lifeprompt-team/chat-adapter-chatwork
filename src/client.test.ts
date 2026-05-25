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

  it("loads contacts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            account_id: 123,
            name: "Alice",
            room_id: 789,
          },
        ]),
        { status: 200 }
      )
    );
    const client = new ChatworkClient({
      apiToken: "token",
      fetch: fetchMock,
    });

    await expect(client.getContacts()).resolves.toEqual([
      {
        account_id: 123,
        name: "Alice",
        room_id: 789,
      },
    ]);
  });

  it("returns an empty array when contacts respond with 204", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new ChatworkClient({
      apiToken: "token",
      fetch: fetchMock,
    });

    await expect(client.getContacts()).resolves.toEqual([]);
  });

  it("uploads room files with multipart form data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ file_id: 42 }), { status: 200 })
    );
    const client = new ChatworkClient({
      apiToken: "token",
      fetch: fetchMock,
    });

    await client.uploadRoomFile({
      file: Buffer.from("hello"),
      filename: "hello.txt",
      message: "attached",
      roomId: 123,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.chatwork.com/v2/rooms/123/files",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-chatworktoken": "token",
        }),
      })
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
  });

  it("loads room files with optional download URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          account: { account_id: 123, name: "Alice" },
          download_url: "https://example.com/file",
          file_id: 42,
          filename: "file.txt",
          filesize: 10,
          message_id: "m1",
          upload_time: 1,
        }),
        { status: 200 }
      )
    );
    const client = new ChatworkClient({
      apiToken: "token",
      fetch: fetchMock,
    });

    await expect(
      client.getRoomFile({
        createDownloadUrl: true,
        fileId: 42,
        roomId: 123,
      })
    ).resolves.toMatchObject({
      download_url: "https://example.com/file",
      file_id: 42,
    });
  });
});
