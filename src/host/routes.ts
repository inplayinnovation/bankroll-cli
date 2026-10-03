// The host on the simulator's own origin: the paths its page calls.
//
//   GET  /api/host                 which Bankroll app the host imitates, and whether a chain is up
//   GET  /api/host/people          everyone, and who the app is shown to
//   POST /api/host/people          a new person: { username, age, balanceCents }
//   POST /api/host/people/select   { id }: show the app to this person
//   GET  /api/host/treasury?app=   where the app is paid, and what that holds
//   POST /api/host/call            { app, feature, input }: a call from the app, relayed
//   POST /api/host/decide          { sheet, approve, input }: the developer answered a sheet
//
// Every path answers this computer's pages alone: a request that names an
// origin from anywhere else is refused, so a page on the web cannot have the
// host make payments, pretend or not.
import type { IncomingMessage, ServerResponse } from 'node:http';

import { type Host, HOST_VERSION } from './host';

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d+)?$/i;
const BODY_LIMIT = 64 * 1024;

export const HOST_PATH = '/api/host';

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) reject(new Error('the request is too large'));
      else chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const parsed: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        resolve(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {});
      } catch {
        reject(new Error('the request is not JSON'));
      }
    });
    request.on('error', reject);
  });
}

/** Answers one request under /api/host. */
export async function handleHostRequest(host: Host, request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && !LOCAL_ORIGIN.test(origin)) {
    send(response, 403, { error: 'the host answers pages on this computer only' });
    return;
  }
  const method = request.method ?? 'GET';
  const path = pathname.slice(HOST_PATH.length) || '/';
  try {
    if (method === 'GET' && path === '/') {
      const treasury = await host.treasuryReport();
      send(response, 200, { version: HOST_VERSION, chain: treasury.chain });
      return;
    }
    if (method === 'GET' && path === '/people') {
      send(response, 200, host.listPeople());
      return;
    }
    if (method === 'POST' && path === '/people') {
      const body = await readBody(request);
      try {
        send(response, 201, { person: await host.createPerson(body) });
      } catch (error) {
        send(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (method === 'POST' && path === '/people/select') {
      const { id } = await readBody(request);
      if (typeof id !== 'string') {
        send(response, 400, { error: 'id must name a person' });
        return;
      }
      try {
        send(response, 200, host.selectPerson(id));
      } catch (error) {
        send(response, 404, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (method === 'GET' && path === '/treasury') {
      const app = new URL(request.url ?? '/', 'http://localhost').searchParams.get('app');
      send(response, 200, await host.treasuryReport(app && LOCAL_ORIGIN.test(app) ? app : undefined));
      return;
    }
    if (method === 'POST' && path === '/call') {
      const { app, feature, input } = await readBody(request);
      if (typeof app !== 'string' || !LOCAL_ORIGIN.test(app) || typeof feature !== 'string') {
        send(response, 400, { error: 'a call names the app, on this computer, and the feature' });
        return;
      }
      send(response, 200, await host.call(app, feature, input));
      return;
    }
    if (method === 'POST' && path === '/decide') {
      const { sheet, approve, input } = await readBody(request);
      if (typeof sheet !== 'string') {
        send(response, 400, { error: 'a decision names the sheet' });
        return;
      }
      send(response, 200, await host.decide(sheet, approve === true, input));
      return;
    }
    send(response, 404, { error: `nothing at ${pathname}` });
  } catch (error) {
    send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}
