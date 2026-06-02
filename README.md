# chat-adapter-chatwork

Chatwork adapter for [Chat SDK](https://chat-sdk.dev/).

Receive Chatwork Webhook events and send Chatwork messages from Chat SDK handlers.

> Alpha: this package is ready for early testing, but it has not yet been verified against every Chatwork Webhook and REST API response shape.

## Install

```sh
npm install chat chat-adapter-chatwork
```

## Usage

```ts
import { Chat } from "chat";
import { createChatworkAdapter } from "chat-adapter-chatwork";

const chatwork = createChatworkAdapter({
  apiToken: process.env.CHATWORK_API_TOKEN!,
  webhookToken: process.env.CHATWORK_WEBHOOK_TOKEN!,
  botAccountId: Number(process.env.CHATWORK_BOT_ACCOUNT_ID!),
});

const chat = new Chat({
  adapters: { chatwork },
});
```

## Next.js App Router webhook

```ts
export async function POST(request: Request) {
  return chatwork.handleWebhook(request, {
    waitUntil: (task) => task.catch(console.error),
  });
}
```

The adapter verifies `x-chatworkwebhooksignature` before parsing JSON. The signature check uses the raw request body.

## Environment variables

`createChatworkAdapter()` can read:

```text
CHATWORK_API_TOKEN
CHATWORK_WEBHOOK_TOKEN
CHATWORK_BOT_ACCOUNT_ID
CHATWORK_BOT_USER_NAME
CHATWORK_TREAT_ROOM_MESSAGES_AS_MENTIONS
CHATWORK_SELF_UNREAD
```

See [docs/setup.md](docs/setup.md) for Chatwork Webhook and token details.

## Supported

- Webhook signature verification.
- `mention_to_me` events.
- `message_created` events with opt-in room message processing.
- Direct room follow-up messages for subscribed threads.
- Reply notation for thread replies using `[rp aid=... to=roomId-messageId]`.
- `openDM()` via `GET /contacts`.
- `getUser()` via cached contacts.
- Inbound file attachments parsed from `[download:fileId]` message bodies.
- Outbound file uploads via `POST /rooms/{room_id}/files` (5MB limit).
- `postMessage()`.
- `editMessage()`.
- `deleteMessage()`.
- `fetchMessage()`.
- `fetchMessages()` returns reply-chain ancestors when the thread ID includes a message ID, otherwise the latest room messages.
- `fetchThread()` using room metadata.
- Stable thread ID encode/decode.
- Basic HTTP error mapping.
- Outbound Markdown to Chatwork notation ([info], [code], [hr], links, lists, tables).
- Inbound Chatwork notation preprocessing into Markdown AST.

## Not supported yet

- OAuth2 token flow.
- Modals and ephemeral messages.
- Typing indicators.
- Reactions.
- Native streaming.

## Thread IDs

Thread IDs represent a Chatwork room and, optionally, the message being replied to.

```text
chatwork:{base64url(roomId)}
chatwork:{base64url(roomId)}:{base64url(messageId)}
chatwork:{base64url(roomId)}:{base64url(messageId)}:{base64url(replyToAccountId)}
```

When a thread ID includes a message ID, `postMessage()` prefixes the outgoing body with Chatwork reply notation. If `replyToAccountId` is present in the thread ID, the adapter skips the extra `getRoomMessage()` lookup.

`isDM()` returns `true` after `openDM()`, `fetchThread()`, a cached room lookup, or when the room ID matches a cached contacts entry. Before that, it returns `false`.

## fetchMessages

- Room-only thread IDs return the latest room messages from Chatwork.
- Message-scoped thread IDs return reply-chain **ancestors only** (the anchor message itself is excluded).
- Results depend on Chatwork `GET /rooms/{room_id}/messages` window size. Missing parents yield a shorter chain.

## Attachments

Inbound downloads and outbound uploads both enforce a 5MB limit per file. When multiple files are posted in one call, only the first file carries the message caption; additional files upload without text.

## Message behavior

- `mention_to_me` events are treated as mentions.
- `message_created` events are not treated as mentions by default.
- `message_created` events containing `[To:{botAccountId}]` are treated as mentions.
- `message_created` events in direct rooms are forwarded to Chat SDK for subscribed-thread follow-ups.
- `message_created` events containing reply notation (`[rp aid=...]`) are forwarded for pending-style replies.
- Set `treatRoomMessagesAsMentions: true` if your bot should process all room messages.
- Events from the bot account are ignored when `botAccountId` is configured.
- Outbound bodies over 65,535 characters throw `ValidationError`.
- Outbound files over 5MB throw `ValidationError`.
- Outbound bold, italic, and strikethrough markers are stripped because Chatwork has no equivalent syntax.
- Heading-only lines are sent as plain text; headings with body content use `[info][title]`.

## Subscribed threads and webhooks

Chat SDK uses `thread.subscribe()` for follow-up handling. For direct rooms and pending replies, configure Chatwork room webhooks with `message_created` on the relevant room IDs. The adapter logs a reminder from `onThreadSubscribe()`.

## Development

This package depends on Chat SDK primitives:

- `chat` is a peer dependency.
- `@chat-adapter/shared` provides shared adapter errors and helpers.
- Chatwork-specific API and webhook behavior lives in this package.

```sh
pnpm install
pnpm test
pnpm build
```

## License

MIT
