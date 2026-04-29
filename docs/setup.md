# Chatwork setup

This adapter receives Chatwork Webhook events and sends messages through the Chatwork REST API.

## Required values

Configure these values in your application:

```text
CHATWORK_API_TOKEN
CHATWORK_WEBHOOK_TOKEN
```

`CHATWORK_BOT_ACCOUNT_ID` is strongly recommended. If it is not provided, the adapter calls `GET /me` during initialization.

`CHATWORK_BOT_USER_NAME`, `CHATWORK_TREAT_ROOM_MESSAGES_AS_MENTIONS`, and `CHATWORK_SELF_UNREAD` are optional.

## Tokens

Chatwork API tokens and Webhook tokens are different values.

- `CHATWORK_API_TOKEN` is sent in the `x-chatworktoken` request header for REST API calls.
- `CHATWORK_WEBHOOK_TOKEN` is used only to verify Webhook signatures.

Never put the API token in a URL query string.

## Callback URL

Set your application's webhook endpoint in the Chatwork API management screen.

Chatwork Webhooks expect a fast response. The adapter verifies the signature, parses the payload, passes supported events to Chat SDK, and returns `200 OK`.

## Signature verification

The adapter verifies each callback before parsing the JSON body:

1. Base64-decode the Webhook token.
2. Read the raw request body.
3. Create an HMAC-SHA256 digest.
4. Base64 encode the digest.
5. Compare the result with `x-chatworkwebhooksignature`.

The `chatwork_webhook_signature` query parameter is also accepted as a fallback.

## Message routing

Chatwork does not expose Slack-style native thread resources. The adapter represents reply context using room and message IDs:

```text
chatwork:{base64url(roomId)}
chatwork:{base64url(roomId)}:{base64url(messageId)}
```

When a message ID is present, `postMessage()` tries to fetch the original message author and uses Chatwork reply notation:

```text
[rp aid={accountId} to={roomId}-{messageId}]
```

## Current feature scope

Supported:

- `mention_to_me` events.
- Opt-in `message_created` events.
- Text posting.
- Message edit/delete.
- Message and room fetching.

Not supported yet:

- OAuth2 token flow.
- Files and attachments.
- Full Chatwork notation conversion.
- Modals and ephemeral messages.
- Typing indicators.
- Reactions.
- Native streaming.
