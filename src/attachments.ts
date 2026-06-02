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

function inferAttachmentType(args: {
  filename: string;
  mimeType?: string;
}): Attachment["type"] {
  const mimeType = args.mimeType?.toLowerCase() ?? "";
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  const extension = args.filename.split(".").pop()?.toLowerCase();
  if (extension && ["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) {
    return "image";
  }
  if (extension && ["mp4", "mov", "webm"].includes(extension)) {
    return "video";
  }
  if (extension && ["mp3", "wav", "m4a", "ogg", "aac", "flac"].includes(extension)) {
    return "audio";
  }

  return "file";
}

function inferMimeType(args: { filename: string }): string | undefined {
  const extension = args.filename.split(".").pop()?.toLowerCase();
  if (!extension) {
    return undefined;
  }

  const mimeByExtension: Record<string, string> = {
    aac: "audio/aac",
    flac: "audio/flac",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    m4a: "audio/mp4",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    ogg: "audio/ogg",
    pdf: "application/pdf",
    png: "image/png",
    wav: "audio/wav",
    webm: "video/webm",
    webp: "image/webp",
  };

  return mimeByExtension[extension];
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

async function resolveInboundAttachment(args: {
  client: ChatworkClient;
  fetchImpl: typeof fetch;
  fileId: number;
  logger?: Logger;
  maxDownloadBytes: number;
  roomId: number;
}): Promise<Attachment | null> {
  try {
    const file = await args.client.getRoomFile({
      createDownloadUrl: true,
      fileId: args.fileId,
      roomId: args.roomId,
    });
    const mimeType = inferMimeType({ filename: file.filename });
    const attachmentType = inferAttachmentType({
      filename: file.filename,
      mimeType,
    });

    const downloadUrl = file.download_url;

    return {
      fetchData: downloadUrl
        ? async () =>
            downloadFileData({
              fetchImpl: args.fetchImpl,
              fileId: args.fileId,
              maxBytes: args.maxDownloadBytes,
              url: downloadUrl,
            })
        : undefined,
      fetchMetadata: {
        chatworkFileId: String(file.file_id),
        chatworkRoomId: String(args.roomId),
      },
      mimeType,
      name: file.filename,
      size: file.filesize,
      type: attachmentType,
      url: file.download_url,
    };
  } catch (error) {
    args.logger?.warn("Failed to resolve Chatwork inbound attachment", {
      error,
      fileId: args.fileId,
      roomId: args.roomId,
    });
    return null;
  }
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

  const attachments = await Promise.all(
    fileIds.map((fileId) =>
      resolveInboundAttachment({
        client: args.client,
        fetchImpl,
        fileId,
        logger: args.logger,
        maxDownloadBytes,
        roomId: args.roomId,
      })
    )
  );

  return attachments.filter((attachment): attachment is Attachment => attachment !== null);
}
