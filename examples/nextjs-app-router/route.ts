import { Chat } from "chat";
import { createChatworkAdapter } from "chat-adapter-chatwork";

const chatwork = createChatworkAdapter({
  apiToken: process.env.CHATWORK_API_TOKEN!,
  webhookToken: process.env.CHATWORK_WEBHOOK_TOKEN!,
  botAccountId: Number(process.env.CHATWORK_BOT_ACCOUNT_ID!),
});

const chat = new Chat({
  adapters: [chatwork],
});

export async function POST(request: Request) {
  return chatwork.handleWebhook(request, {
    waitUntil: (task) => task.catch(console.error),
  });
}
