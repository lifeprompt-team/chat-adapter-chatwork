import type { Attachment, Logger } from "chat";
import { MAX_FILE_BYTES } from "./blob";
import type { ChatworkClient } from "./client";

const DOWNLOAD_FILE_ID_PATTERN = /\[download:(\d+)\]/g;

export function extractDownloadFileIds(args: { body: string }): number[] {
  const fileIds: number[] = [];
  const seen = new Set<number>();

  for (const match of args.body.matchAll(DOWNLOAD_FILE_ID_PATTERN)) {
    const fileId = Number(match[1]);
    if (!Number.isInteger(fileId) || seen.has(fileId)) {
      continue;
    }
    seen.add(fileId);
    fileIds.push(fileId);
  }

  return fileIds;
}

async function downloadFileData(args: {
  fetchImpl: typeof fetch;
  fileId: number;
  maxBytes: number;
  url: string;
}): Promise<Buffer> {
  const response = await args.fetchImpl(args.url);
  if (!response.ok) {
    throw new Error(
      `Failed to download Chatwork file ${args.fileId}: HTTP ${response.status}`
    );
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > args.maxBytes) {
    throw new Error(
      `Chatwork file ${args.fileId} exceeds ${args.maxBytes} bytes`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > args.maxBytes) {
    throw new Error(
      `Chatwork file ${args.fileId} exceeds ${args.maxBytes} bytes`
    );
  }

  return buffer;
}

function buildLazyInboundAttachment(args: {
  client: ChatworkClient;
  fetchImpl: typeof fetch;
  fileId: number;
  logger?: Logger;
  maxDownloadBytes: number;
  roomId: number;
}): Attachment {
  const loadRoomFile = async () => {
    try {
      return await args.client.getRoomFile({
        createDownloadUrl: true,
        fileId: args.fileId,
        roomId: args.roomId,
      });
    } catch (error) {
      args.logger?.warn("Failed to resolve Chatwork inbound attachment", {
        error,
        fileId: args.fileId,
        roomId: args.roomId,
      });
      return null;
    }
  };

  return {
    fetchData: async () => {
      const file = await loadRoomFile();
      if (!file?.download_url) {
        throw new Error(
          `Chatwork file ${args.fileId} in room ${args.roomId} is unavailable`
        );
      }

      return downloadFileData({
        fetchImpl: args.fetchImpl,
        fileId: args.fileId,
        maxBytes: args.maxDownloadBytes,
        url: file.download_url,
      });
    },
    fetchMetadata: {
      chatworkFileId: String(args.fileId),
      chatworkRoomId: String(args.roomId),
    },
    name: `file-${args.fileId}`,
    type: "file",
  };
}

export async function resolveInboundAttachments(args: {
  body: string;
  client: ChatworkClient;
  fetch?: typeof fetch;
  logger?: Logger;
  maxDownloadBytes?: number;
  roomId: number;
}): Promise<Attachment[]> {
  const fileIds = extractDownloadFileIds({ body: args.body });
  if (fileIds.length === 0) {
    return [];
  }

  const fetchImpl = args.fetch ?? fetch;
  const maxDownloadBytes = args.maxDownloadBytes ?? MAX_FILE_BYTES;

  return fileIds.map((fileId) =>
    buildLazyInboundAttachment({
      client: args.client,
      fetchImpl,
      fileId,
      logger: args.logger,
      maxDownloadBytes,
      roomId: args.roomId,
    })
  );
}
