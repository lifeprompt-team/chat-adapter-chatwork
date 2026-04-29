import {
  AdapterError,
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";

const ADAPTER_NAME = "chatwork";

export async function mapChatworkResponseError(
  response: Response,
  resourceId?: string
): Promise<AdapterError> {
  const message = await readErrorMessage(response);

  switch (response.status) {
    case 400:
      return new ValidationError(ADAPTER_NAME, message);
    case 401:
      return new AuthenticationError(ADAPTER_NAME, message);
    case 403:
      return new PermissionError(ADAPTER_NAME, "call Chatwork API");
    case 404:
      return new ResourceNotFoundError(
        ADAPTER_NAME,
        "Chatwork resource",
        resourceId
      );
    case 429:
      return new AdapterRateLimitError(
        ADAPTER_NAME,
        parseRetryAfter(response, message)
      );
    default:
      if (response.status >= 500) {
        return new NetworkError(ADAPTER_NAME, message);
      }
      return new AdapterError(message, ADAPTER_NAME, String(response.status));
  }
}

function parseRetryAfter(
  response: Response,
  message: string
): number | undefined {
  if (message.includes("Rate limit for message posting per room exceeded")) {
    return 10;
  }

  const reset = response.headers.get("x-ratelimit-reset");
  if (!reset) {
    return undefined;
  }

  const resetSeconds = Number(reset);
  if (!Number.isFinite(resetSeconds)) {
    return undefined;
  }

  return Math.max(0, resetSeconds - Math.floor(Date.now() / 1000));
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) {
      return response.statusText || `HTTP ${response.status}`;
    }

    const parsed = JSON.parse(text) as { errors?: unknown };
    if (Array.isArray(parsed.errors)) {
      return parsed.errors.map(String).join("; ");
    }

    return text;
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}
