export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function readBlobSize(args: { data: Blob | Buffer | ArrayBuffer }): number {
  if (Buffer.isBuffer(args.data)) {
    return args.data.byteLength;
  }
  if (args.data instanceof ArrayBuffer) {
    return args.data.byteLength;
  }
  return args.data.size;
}

export function toBlobPart(args: { data: Blob | Buffer | ArrayBuffer }): BlobPart {
  if (args.data instanceof Blob) {
    return args.data;
  }
  if (Buffer.isBuffer(args.data)) {
    return Uint8Array.from(args.data);
  }
  return args.data;
}

export function toUploadBlob(args: {
  data: Blob | Buffer | ArrayBuffer;
  mimeType?: string;
}): Blob | Buffer {
  if (Buffer.isBuffer(args.data) || args.data instanceof Blob) {
    return args.data;
  }
  return new Blob([toBlobPart({ data: args.data })], {
    type: args.mimeType ?? "application/octet-stream",
  });
}
