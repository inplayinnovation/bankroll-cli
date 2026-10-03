import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { Host } from '../src/host/host';
import { People } from '../src/host/people';
import { loadTreasury } from '../src/host/treasury';
import { listenLocally, simulatorHandler } from '../src/simulator';

const APP = 'http://localhost:3000';
const SIMULATOR = 'http://localhost:4100';
const jwt = (claims: unknown) => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

const closing: (() => void)[] = [];
afterEach(() => {
  while (closing.length) closing.pop()!();
});

async function serving(): Promise<{ at: string; host: Host }> {
  const dir = mkdtempSync(join(tmpdir(), 'bankroll-host-routes-'));
  const host = new Host({
    people: new People(join(dir, 'people.json')),
    treasury: loadTreasury(join(dir, 'treasury.json')),
    ledger: null,
    chainProblem: 'no chain in this test',
    fetchImpl: (async () => new Response(jwt({ name: 'Golden Sun', capabilities: { session: true } }), { status: 200 })) as typeof fetch,
  });
  const server = await listenLocally(simulatorHandler({ root: null, app: `${APP}/app`, host }), 0);
  closing.push(server.close);
  return { at: `http://127.0.0.1:${server.port}`, host };
}

const post = (url: string, body: unknown, origin = SIMULATOR) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });

describe('/api/host', () => {
  it('says which Bankroll app it imitates, and whether there is a chain', async () => {
    const { at } = await serving();
    expect(await (await fetch(`${at}/api/host`)).json()).toEqual({ version: '5', chain: { ready: false, reason: 'no chain in this test' } });
  });

  it('answers pages on this computer only', async () => {
    const { at } = await serving();
    const refused = await post(`${at}/api/host/call`, { app: APP, feature: 'bankroll:haptics' }, 'https://evil.example');
    expect(refused.status).toBe(403);
    // A page served on another local port, as the simulator's own dev server is.
    expect((await post(`${at}/api/host/call`, { app: APP, feature: 'bankroll:haptics' }, 'http://localhost:4300')).status).toBe(200);
    // A call for an app that is not on this computer is not relayed.
    expect((await post(`${at}/api/host/call`, { app: 'https://game.example', feature: 'bankroll:haptics' })).status).toBe(400);
  });

  it('relays a call, shows a sheet, and takes the decision', async () => {
    const { at } = await serving();
    const asked = (await (await post(`${at}/api/host/call`, { app: APP, feature: 'bankroll:session' })).json()) as { done: boolean; sheet: { id: string; kind: string } };
    expect(asked).toMatchObject({ done: false, sheet: { kind: 'consent', app: { origin: APP, name: 'Golden Sun' } } });
    const decided = (await (await post(`${at}/api/host/decide`, { sheet: asked.sheet.id, approve: true })).json()) as { done: boolean; ok: boolean; value: string };
    expect(decided).toMatchObject({ done: true, ok: true });
    expect(decided.value.split('.')).toHaveLength(3);
    expect((await post(`${at}/api/host/decide`, { approve: true })).status).toBe(400);
    expect(await (await post(`${at}/api/host/decide`, { sheet: 'gone', approve: true })).json()).toMatchObject({ done: true, ok: false });
  });

  it('lists, makes and chooses people', async () => {
    const { at } = await serving();
    const listed = (await (await fetch(`${at}/api/host/people`)).json()) as { people: { id: string; username: string }[]; current: string };
    expect(listed.people.map((person) => person.username)).toEqual(['tester']);
    expect(listed.current).toBe(listed.people[0]!.id);

    const made = await post(`${at}/api/host/people`, { username: 'alice', age: 25, balanceCents: 500 });
    expect(made.status).toBe(201);
    const { person } = (await made.json()) as { person: { id: string; username: string; secretKey?: string } };
    expect(person).toMatchObject({ username: 'alice' });
    expect(person.secretKey).toBeUndefined();
    expect((await post(`${at}/api/host/people`, { username: '!!' })).status).toBe(400);

    const chosen = (await (await post(`${at}/api/host/people/select`, { id: person.id })).json()) as { current: string };
    expect(chosen.current).toBe(person.id);
    expect((await post(`${at}/api/host/people/select`, { id: 'nobody' })).status).toBe(404);
    expect((await post(`${at}/api/host/people/select`, {})).status).toBe(400);

    const changed = await post(`${at}/api/host/people/update`, { id: person.id, username: 'alicia', balanceCents: 1 });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ person: { username: 'alicia', balanceCents: 1 } });
    expect((await post(`${at}/api/host/people/update`, { id: person.id, age: 999 })).status).toBe(400);
    expect((await post(`${at}/api/host/people/update`, { id: 'nobody' })).status).toBe(404);
    expect((await post(`${at}/api/host/people/update`, {})).status).toBe(400);

    const gone = await post(`${at}/api/host/people/remove`, { id: person.id });
    expect(gone.status).toBe(200);
    expect(((await gone.json()) as { people: { username: string }[] }).people.map((p) => p.username)).toEqual(['tester']);
    expect((await post(`${at}/api/host/people/remove`, { id: listed.current })).status).toBe(400);
    expect((await post(`${at}/api/host/people/remove`, { id: 'nobody' })).status).toBe(404);
  });

  it('reports the treasury, for the open app', async () => {
    const { at, host } = await serving();
    const report = (await (await fetch(`${at}/api/host/treasury?app=${encodeURIComponent(APP)}`)).json()) as { address: string; ours: boolean; balanceCents: null };
    expect(report).toEqual({ address: (await host.treasuryReport()).address, ours: true, balanceCents: null, chain: { ready: false, reason: 'no chain in this test' } });
  });

  it('is not there without a host', async () => {
    const server = await listenLocally(simulatorHandler({ root: null, app: `${APP}/app` }), 0);
    closing.push(server.close);
    expect((await fetch(`http://127.0.0.1:${server.port}/api/host`)).status).toBe(404);
    expect((await post(`http://127.0.0.1:${server.port}/api/host/call`, {})).status).toBe(405);
  });
});
