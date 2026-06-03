import { AuthenticationError, ValidationError } from "@chat-adapter/shared";
import { verifyChatworkSignature } from "./signature";
import type { ChatworkWebhookPayload } from "./types";

export interface VerifiedChatworkWebhook {
  payload: ChatworkWebhookPayload;
  rawBody: string;
}

export async function verifyChatworkWebhook(
  request: Request,
  webhookToken: string
): Promise<VerifiedChatworkWebhook> {
  const rawBody = await request.text();
  const url = new URL(request.url);
  const signature =
    request.headers.get("x-chatworkwebhooksignature") ??
    url.searchParams.get("chatwork_webhook_signature");

  if (!verifyChatworkSignature(rawBody, webhookToken, signature)) {
    throw new AuthenticationError(
      "chatwork",
      "Invalid Chatwork webhook signature"
    );
  }

  try {
    return {
      payload: JSON.parse(rawBody) as ChatworkWebhookPayload,
      rawBody,
    };
  } catch {
    throw new ValidationError("chatwork", "Invalid Chatwork webhook JSON");
  }
}
