import { Redis } from "ioredis";

import { env } from "../config/env.js";

export const HOUR_MS = 60 * 60 * 1_000;
const STATE_TTL_MS = 2 * HOUR_MS;

// The two keys are updated in one Redis script. A reservation consumes a slot
// before SMTP is called, which is conservative across worker crashes.
export const SENDER_THROTTLE_LUA = `
local now = tonumber(ARGV[1])
local minDelay = tonumber(ARGV[2])
local hourlyLimit = tonumber(ARGV[3])
local hourMs = 3600000
local windowStart = math.floor(now / hourMs) * hourMs
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local lastSentAt = tonumber(redis.call('GET', KEYS[2]) or '-1')

if count >= hourlyLimit then
  return { 0, windowStart + hourMs, count, windowStart, 0 }
end

local nextByDelay = now
if lastSentAt >= 0 then nextByDelay = lastSentAt + minDelay end
if now < nextByDelay then
  return { 0, nextByDelay, count, windowStart, 0 }
end

count = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ${STATE_TTL_MS})
redis.call('SET', KEYS[2], now, 'PX', ${STATE_TTL_MS})
local reached = 0
if count == hourlyLimit then reached = 1 end
return { 1, now, count, windowStart, reached }
`;

export interface SenderThrottleInput {
  senderId: string;
  now: Date;
  minDelayMs: number;
  hourlyLimit: number;
}

export interface SenderThrottleResult {
  allowed: boolean;
  nextAvailableAt: Date;
  count: number;
  windowStart: Date;
  reachedHourlyLimit: boolean;
}

export interface SenderThrottle {
  reserve(input: SenderThrottleInput): Promise<SenderThrottleResult>;
}

const keyFor = (senderId: string, windowStart: number): [string, string] => [
  `sender-throttle:${env.EMAIL_QUEUE_NAME}:${senderId}:hour:${windowStart}`,
  `sender-throttle:${env.EMAIL_QUEUE_NAME}:${senderId}:last`,
];

const toResult = (raw: unknown): SenderThrottleResult => {
  if (!Array.isArray(raw) || raw.length < 5)
    throw new Error("Redis returned an invalid throttle result.");
  const values = raw.map((value) => Number(value));
  return {
    allowed: values[0] === 1,
    nextAvailableAt: new Date(values[1] as number),
    count: values[2] as number,
    windowStart: new Date(values[3] as number),
    reachedHourlyLimit: values[4] === 1,
  };
};

export class RedisSenderThrottle implements SenderThrottle {
  constructor(private readonly redis: Redis) {}

  async reserve(input: SenderThrottleInput): Promise<SenderThrottleResult> {
    const windowStart = Math.floor(input.now.getTime() / HOUR_MS) * HOUR_MS;
    const [hourKey, lastKey] = keyFor(input.senderId, windowStart);
    const raw = await this.redis.eval(
      SENDER_THROTTLE_LUA,
      2,
      hourKey,
      lastKey,
      String(input.now.getTime()),
      String(input.minDelayMs),
      String(input.hourlyLimit),
    );
    return toResult(raw);
  }
}

/** A deterministic equivalent used by unit tests without depending on a live Redis daemon. */
export class InMemorySenderThrottle implements SenderThrottle {
  private readonly state = new Map<string, { count: number; lastSentAt: number }>();

  async reserve(input: SenderThrottleInput): Promise<SenderThrottleResult> {
    const now = input.now.getTime();
    const windowStartMs = Math.floor(now / HOUR_MS) * HOUR_MS;
    const stateKey = `${input.senderId}:${windowStartMs}`;
    const state = this.state.get(stateKey) ?? { count: 0, lastSentAt: -1 };
    if (state.count >= input.hourlyLimit) {
      return {
        allowed: false,
        nextAvailableAt: new Date(windowStartMs + HOUR_MS),
        count: state.count,
        windowStart: new Date(windowStartMs),
        reachedHourlyLimit: false,
      };
    }
    const nextByDelay = state.lastSentAt < 0 ? now : state.lastSentAt + input.minDelayMs;
    if (now < nextByDelay) {
      return {
        allowed: false,
        nextAvailableAt: new Date(nextByDelay),
        count: state.count,
        windowStart: new Date(windowStartMs),
        reachedHourlyLimit: false,
      };
    }
    state.count += 1;
    state.lastSentAt = now;
    this.state.set(stateKey, state);
    return {
      allowed: true,
      nextAvailableAt: new Date(now),
      count: state.count,
      windowStart: new Date(windowStartMs),
      reachedHourlyLimit: state.count === input.hourlyLimit,
    };
  }
}

export const effectiveSenderLimits = (input: {
  campaignDelayMs: number;
  campaignHourlyLimit: number;
}): { minDelayMs: number; hourlyLimit: number } => ({
  minDelayMs: Math.max(env.MIN_DELAY_BETWEEN_EMAILS_MS, input.campaignDelayMs),
  hourlyLimit: Math.min(env.MAX_EMAILS_PER_HOUR_PER_SENDER, input.campaignHourlyLimit),
});
