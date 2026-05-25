import type { Attachment } from "chat";
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

export async function resolveInboundAttachments(args: {
  body: string;
  client: ChatworkClient;
  roomId: number;
}): Promise<Attachment[]> {
  const fileIds = extractDownloadFileIds({ body: args.body });
  if (fileIds.length === 0) {
    return [];
  }

  const attachments: Attachment[] = [];

  for (const fileId of fileIds) {
    try {
      const file = await args.client.getRoomFile({
        createDownloadUrl: true,
        fileId,
        roomId: args.roomId,
      });
      const mimeType = inferMimeType({ filename: file.filename });
      const attachmentType = inferAttachmentType({
        filename: file.filename,
        mimeType,
      });

      attachments.push({
        fetchData: file.download_url
          ? async () => {
              const response = await fetch(file.download_url!);
              if (!response.ok) {
                throw new Error(
                  `Failed to download Chatwork file ${fileId}: HTTP ${response.status}`
                );
              }
              const buffer = Buffer.from(await response.arrayBuffer());
              return buffer;
            }
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
      });
    } catch {
      continue;
    }
  }

  return attachments;
}
