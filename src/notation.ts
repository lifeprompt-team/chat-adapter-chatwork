export function renderReplyNotation(options: {
  accountId: number;
  messageId: string;
  roomId: number;
}): string {
  return `[rp aid=${options.accountId} to=${options.roomId}-${options.messageId}]`;
}

export function renderToNotation(accountId: number): string {
  return `[To:${accountId}]`;
}

export function hasToNotation(body: string, accountId: number): boolean {
  return body.includes(renderToNotation(accountId));
}

export interface ChatworkReplyNotation {
  accountId: number;
  messageId: string;
  roomId: number;
}

export function parseReplyNotation(body: string): ChatworkReplyNotation | null {
  const match = body.match(/\[rp aid=(\d+) to=(\d+)-([^\]]+)\]/);
  if (!match) {
    return null;
  }

  return {
    accountId: Number(match[1]),
    roomId: Number(match[2]),
    messageId: match[3],
  };
}
