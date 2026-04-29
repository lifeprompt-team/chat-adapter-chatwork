import { createHmac, timingSafeEqual } from "node:crypto";

export function createChatworkSignature(
  rawBody: string,
  webhookToken: string
): string {
  const secret = Buffer.from(webhookToken, "base64");
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

export function verifyChatworkSignature(
  rawBody: string,
  webhookToken: string,
  signature: string | null
): boolean {
  if (!signature) {
    return false;
  }

  const expected = createChatworkSignature(rawBody, webhookToken);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, signatureBuffer);
}
