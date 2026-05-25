import { describe, expect, it, vi } from "vitest";
import { ResourceNotFoundError } from "@chat-adapter/shared";
import { extractDownloadFileIds, resolveInboundAttachments } from "./attachments";
import { ChatworkClient } from "./client";

describe("attachments", () => {
  it("extracts download file IDs from Chatwork message bodies", () => {
    const body =
      "[info][title][dtext:file_uploaded][/title][download:1466244790]file.pdf (54 KB)[/download][/info]";

    expect(extractDownloadFileIds({ body })).toEqual([1466244790]);
  });

  it("resolves inbound attachments with download URLs", async () => {
    const getRoomFile = vi.fn().mockResolvedValue({
      account: { account_id: 123, name: "Alice" },
      download_url: "https://example.com/file.pdf",
      file_id: 1466244790,
      filename: "file.pdf",
      filesize: 1234,
      message_id: "m1",
      upload_time: 1,
    });
    const client = { getRoomFile } as unknown as ChatworkClient;

    const attachments = await resolveInboundAttachments({
      body: "[download:1466244790]file.pdf[/download]",
      client,
      roomId: 456,
    });

    expect(getRoomFile).toHaveBeenCalledWith({
      createDownloadUrl: true,
      fileId: 1466244790,
      roomId: 456,
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.name).toBe("file.pdf");
    expect(attachments[0]?.url).toBe("https://example.com/file.pdf");
  });
});
