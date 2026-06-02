import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@chat-adapter/shared";
import { createChatworkAdapter } from "./factory";

describe("createChatworkAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("reads credentials from environment variables", () => {
    process.env.CHATWORK_API_TOKEN = "api-token";
    process.env.CHATWORK_WEBHOOK_TOKEN = "webhook-token";
    process.env.CHATWORK_BOT_ACCOUNT_ID = "123";

    const adapter = createChatworkAdapter();

    expect(adapter.botUserId).toBe("123");
  });

  it("throws when api token is missing", () => {
    delete process.env.CHATWORK_API_TOKEN;
    process.env.CHATWORK_WEBHOOK_TOKEN = "webhook-token";

    expect(() => createChatworkAdapter()).toThrow(ValidationError);
  });

  it("throws when webhook token is missing", () => {
    process.env.CHATWORK_API_TOKEN = "api-token";
    delete process.env.CHATWORK_WEBHOOK_TOKEN;

    expect(() => createChatworkAdapter()).toThrow(ValidationError);
  });

  it("passes fetch through to the adapter client", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    const adapter = createChatworkAdapter({
      apiToken: "api-token",
      fetch,
      webhookToken: "webhook-token",
    });

    await adapter.getUser("123");

    expect(fetch).toHaveBeenCalled();
  });
});
