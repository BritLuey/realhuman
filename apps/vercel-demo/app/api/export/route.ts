import { timingSafeEqual } from 'node:crypto';
import { allDecisions, redis } from '../../../lib/store';

/**
 * Exports stored decision records as NDJSON for the evaluation tool.
 *
 *   curl -H "authorization: Bearer $DEMO_ADMIN_TOKEN" "https://<demo>/api/export?run=pilot-1" > records.ndjson
 *
 * Protected by the DEMO_ADMIN_TOKEN environment variable; disabled when it isn't set.
 */
export async function GET(request: Request): Promise<Response> {
  const expected = process.env.DEMO_ADMIN_TOKEN;
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || expected.length < 16 || !given || !sameSecret(given, expected)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!redis) return Response.json({ error: 'no_store' }, { status: 501 });

  const run = new URL(request.url).searchParams.get('run');
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const record of allDecisions()) {
        if (run && record.context.run !== run) continue;
        controller.enqueue(encoder.encode(`${JSON.stringify(record)}\n`));
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  });
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
