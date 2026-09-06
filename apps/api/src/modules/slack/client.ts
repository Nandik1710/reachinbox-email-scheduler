import { env } from "../../config/env.js";
import type { SlackOAuthClient, SlackOAuthResult } from "./types.js";

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { id?: string; name?: string };
  incoming_webhook?: { channel_id?: string; channel?: string };
  scope?: string;
}

const slackRequest = async <T>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const payload = (await response.json()) as T;
  if (!response.ok) throw new Error(`Slack request failed with HTTP ${response.status}.`);
  return payload;
};

export const createSlackOAuthClient = (): SlackOAuthClient => ({
  authorizationUrl(state) {
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", env.SLACK_CLIENT_ID ?? "");
    url.searchParams.set("scope", "chat:write,channels:read,groups:read,incoming-webhook");
    url.searchParams.set("redirect_uri", env.SLACK_REDIRECT_URI);
    url.searchParams.set("state", state);
    return url.toString();
  },

  async exchangeCode(code): Promise<SlackOAuthResult> {
    const payload = await slackRequest<SlackOAuthResponse>(
      "https://slack.com/api/oauth.v2.access",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.SLACK_CLIENT_ID ?? "",
          client_secret: env.SLACK_CLIENT_SECRET ?? "",
          code,
          redirect_uri: env.SLACK_REDIRECT_URI,
        }),
      },
    );
    if (!payload.ok || !payload.access_token || !payload.team?.id) {
      throw new Error(`Slack OAuth exchange failed${payload.error ? `: ${payload.error}` : "."}`);
    }
    return {
      accessToken: payload.access_token,
      teamId: payload.team.id,
      teamName: payload.team.name ?? null,
      channelId: payload.incoming_webhook?.channel_id ?? null,
      channelName: payload.incoming_webhook?.channel ?? null,
      scope: payload.scope ?? null,
    };
  },

  async postMessage(input) {
    const payload = await slackRequest<{ ok: boolean; error?: string }>(
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel: input.channelId, text: input.text }),
      },
    );
    if (!payload.ok)
      throw new Error(`Slack message failed${payload.error ? `: ${payload.error}` : "."}`);
  },
});
