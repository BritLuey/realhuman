import type { DecisionRecord } from '@realhuman/vercel';
import { Redis } from '@upstash/redis';

/**
 * Decision storage for the demo.
 *
 * With an Upstash Redis database connected (Vercel Marketplace → Upstash for Redis), records are kept
 * for 30 days: the latest record per session for the page's "why" panel, plus an append-only log
 * that the evaluation tool exports. Without one, records only go to the function logs.
 */

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

export const redis = url && token ? new Redis({ url, token }) : null;

const TTL_SECONDS = 60 * 60 * 24 * 30;
const LOG_KEY = 'rh:log';
const LOG_LIMIT = 200_000;

export async function saveDecision(record: DecisionRecord): Promise<void> {
  if (!redis) return;
  const key = `rh:sid:${record.sid}`;
  const current = await redis.get<DecisionRecord>(key);
  const pipeline = redis.pipeline();
  if (!current || current.seq <= record.seq) pipeline.set(key, record, { ex: TTL_SECONDS });
  pipeline.rpush(LOG_KEY, JSON.stringify(record));
  pipeline.ltrim(LOG_KEY, -LOG_LIMIT, -1);
  pipeline.expire(LOG_KEY, TTL_SECONDS);
  await pipeline.exec();
}

export async function latestDecision(sid: string): Promise<DecisionRecord | null> {
  if (!redis) return null;
  return redis.get<DecisionRecord>(`rh:sid:${sid}`);
}

/** Every stored record, oldest first, in pages of 1 000. */
export async function* allDecisions(): AsyncGenerator<DecisionRecord> {
  if (!redis) return;
  const total = await redis.llen(LOG_KEY);
  for (let start = 0; start < total; start += 1000) {
    const page = await redis.lrange<DecisionRecord | string>(LOG_KEY, start, start + 999);
    for (const item of page)
      yield typeof item === 'string' ? (JSON.parse(item) as DecisionRecord) : item;
  }
}
