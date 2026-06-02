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
    const fetch = vi.fn();

    const attachments = await resolveInboundAttachments({
      body: "[download:1466244790]file.pdf[/download]",
      client,
      fetch,
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

  it("logs and skips attachments that fail to resolve", async () => {
    const getRoomFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("missing file"))
      .mockResolvedValueOnce({
        account: { account_id: 123, name: "Alice" },
        download_url: "https://example.com/ok.pdf",
        file_id: 2,
        filename: "ok.pdf",
        filesize: 10,
        message_id: "m2",
        upload_time: 1,
      });
    const client = { getRoomFile } as unknown as ChatworkClient;
    const logger = {
      warn: vi.fn(),
    };

    const attachments = await resolveInboundAttachments({
      body: "[download:1]bad.pdf[/download][download:2]ok.pdf[/download]",
      client,
      logger: logger as never,
      roomId: 456,
    });

    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.name).toBe("ok.pdf");
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("rejects downloads larger than the configured limit", async () => {
    const getRoomFile = vi.fn().mockResolvedValue({
      account: { account_id: 123, name: "Alice" },
      download_url: "https://example.com/large.pdf",
      file_id: 1,
      filename: "large.pdf",
      filesize: 10,
      message_id: "m1",
      upload_time: 1,
    });
    const client = { getRoomFile } as unknown as ChatworkClient;
    const fetch = vi.fn().mockResolvedValue(
      new Response(Buffer.alloc(1024), {
        headers: { "content-length": "1024" },
        status: 200,
      })
    );

    const attachments = await resolveInboundAttachments({
      body: "[download:1]large.pdf[/download]",
      client,
      fetch,
      logger: { warn: vi.fn() } as never,
      maxDownloadBytes: 512,
      roomId: 456,
    });

    expect(attachments).toHaveLength(1);
    await expect(attachments[0]?.fetchData?.()).rejects.toThrow(/512 bytes/);
  });
});
