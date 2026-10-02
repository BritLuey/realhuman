import { latestDecision, redis } from '../../../lib/store';

/**
 * The latest decision for one session, so the demo page can explain its own score.
 * Session ids are random and unguessable, so this only reveals your own record.
 */
export async function GET(request: Request): Promise<Response> {
  const sid = new URL(request.url).searchParams.get('sid') ?? '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(sid))
    return Response.json({ error: 'bad_sid' }, { status: 400 });
  if (!redis) return Response.json({ error: 'no_store' }, { status: 501 });
  const record = await latestDecision(sid);
  if (!record) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json(record, { headers: { 'cache-control': 'no-store' } });
}
