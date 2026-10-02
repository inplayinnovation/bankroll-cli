import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { remembering, satisfies, sdkIn, versionReport, type About } from '../src/versions';

const SDK = '@joinbankroll/sdk';

// An app's folder, as far as the SDK in it goes.
function project(parts: { wanted?: string; dev?: boolean; locked?: string; installed?: string; dogfood?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'bankroll-versions-'));
  const dependencies = parts.wanted ? { [SDK]: parts.wanted } : {};
  writeFileSync(join(dir, 'package.json'), JSON.stringify(parts.dev ? { devDependencies: dependencies } : { dependencies }));
  if (parts.locked) writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { [`node_modules/${SDK}`]: { version: parts.locked } } }));
  if (parts.installed) {
    const home = join(dir, 'node_modules', SDK);
    mkdirSync(join(home, 'dist'), { recursive: true });
    writeFileSync(join(home, 'package.json'), JSON.stringify({ name: SDK, version: parts.installed }));
    if (parts.dogfood) writeFileSync(join(home, 'dist', '.dogfood'), 'somewhere\n');
  }
  return dir;
}

const published = (versions: Record<string, string>) => async (name: string) => versions[name];
const nothingPublished = async () => undefined;

const about = (dir: string, more: Partial<About> = {}): About => ({ cli: '0.5.0', dir, local: false, latest: published({ [SDK]: '0.32.0', '@joinbankroll/cli': '0.5.0' }), ...more });

describe('satisfies', () => {
  it('reads the ranges npm writes by itself', () => {
    expect(satisfies('0.32.0', '0.32.0')).toBe(true);
    expect(satisfies('0.32.1', '0.32.0')).toBe(false);
    expect(satisfies('0.32.4', '~0.32.1')).toBe(true);
    expect(satisfies('0.33.0', '~0.32.1')).toBe(false);
    expect(satisfies('1.4.0', '^1.2.3')).toBe(true);
    expect(satisfies('1.2.2', '^1.2.3')).toBe(false);
    expect(satisfies('2.0.0', '^1.2.3')).toBe(false);
  });

  // The reason an app on ^0.4.0 never reaches 0.5.0 by itself.
  it('keeps a caret inside the minor before 1.0', () => {
    expect(satisfies('0.32.5', '^0.32.0')).toBe(true);
    expect(satisfies('0.33.0', '^0.32.0')).toBe(false);
    expect(satisfies('0.19.1', '^0.32.0')).toBe(false);
    expect(satisfies('0.0.3', '^0.0.3')).toBe(true);
    expect(satisfies('0.0.4', '^0.0.3')).toBe(false);
  });

  it('does not judge what is not a version range', () => {
    for (const range of ['latest', '*', 'file:../sdk', 'github:someone/sdk', 'workspace:*']) expect(satisfies('0.32.0', range)).toBeUndefined();
    expect(satisfies('not a version', '^0.32.0')).toBeUndefined();
  });
});

describe('sdkIn', () => {
  it('reads what a project asks for, what its lockfile settles on, and what is installed', () => {
    expect(sdkIn(project({ wanted: '^0.32.0', locked: '0.32.0', installed: '0.32.0' }))).toEqual({ wanted: '^0.32.0', locked: '0.32.0', installed: '0.32.0', local: false });
    expect(sdkIn(project({ wanted: '^0.32.0', dev: true }))).toEqual({ wanted: '^0.32.0', local: false });
  });

  it('knows nothing of a folder that is not a project, or does not use the SDK', () => {
    expect(sdkIn(join(tmpdir(), 'bankroll-versions-no-such-folder'))).toEqual({ local: false });
    expect(sdkIn(project())).toEqual({ local: false });
  });

  it("knows a build of someone's own: copied in by dogfood, or linked", () => {
    expect(sdkIn(project({ wanted: '^0.32.0', installed: '0.32.0', dogfood: true })).local).toBe(true);

    const checkout = mkdtempSync(join(tmpdir(), 'bankroll-sdk-checkout-'));
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: SDK, version: '0.33.0' }));
    const dir = project({ wanted: '^0.32.0' });
    mkdirSync(join(dir, 'node_modules', '@joinbankroll'), { recursive: true });
    symlinkSync(checkout, join(dir, 'node_modules', SDK));
    expect(sdkIn(dir)).toEqual({ wanted: '^0.32.0', installed: '0.33.0', local: true });
  });
});

describe('versionReport', () => {
  const OWN = { open: true, own: true };

  it('says the CLI alone when no app is open', async () => {
    expect(await versionReport(about(project({ wanted: '^0.32.0', installed: '0.32.0' })), { open: false, own: false })).toEqual({ cli: { version: '0.5.0', latest: '0.5.0', behind: false, local: false } });
  });

  it('says the SDK the running app has installed, and that all is well', async () => {
    const report = await versionReport(about(project({ wanted: '^0.32.0', locked: '0.32.0', installed: '0.32.0' })), OWN);
    expect(report.sdk).toEqual({ version: '0.32.0', latest: '0.32.0', behind: false, local: false, installed: '0.32.0', wanted: '^0.32.0', locked: '0.32.0', stale: false });
  });

  it('prefers the version the app says it runs to the one installed', async () => {
    const report = await versionReport(about(project({ wanted: '^0.32.0', installed: '0.32.0' })), { ...OWN, reported: '0.32.4' });
    expect(report.sdk).toMatchObject({ version: '0.32.4', installed: '0.32.0' });
  });

  it('says when a later release is out, of the SDK and of the CLI', async () => {
    const latest = published({ [SDK]: '0.33.0', '@joinbankroll/cli': '0.6.0' });
    const report = await versionReport(about(project({ wanted: '^0.32.0', locked: '0.32.0', installed: '0.32.0' }), { latest }), OWN);
    expect(report.cli).toEqual({ version: '0.5.0', latest: '0.6.0', behind: true, local: false });
    expect(report.sdk).toMatchObject({ version: '0.32.0', latest: '0.33.0', behind: true, stale: false });
  });

  // What a pull with no install after it leaves behind.
  it('says when what is installed is not what the project asks for', async () => {
    const byLock = await versionReport(about(project({ wanted: '^0.32.0', locked: '0.32.0', installed: '0.19.1' })), OWN);
    expect(byLock.sdk).toMatchObject({ version: '0.19.1', installed: '0.19.1', locked: '0.32.0', stale: true });

    const byRange = await versionReport(about(project({ wanted: '^0.32.0', installed: '0.19.1' })), OWN);
    expect(byRange.sdk?.stale).toBe(true);

    const missing = await versionReport(about(project({ wanted: '^0.32.0', locked: '0.32.0' })), OWN);
    expect(missing.sdk).toEqual({ latest: '0.32.0', behind: false, local: false, wanted: '^0.32.0', locked: '0.32.0', stale: true });

    const unjudged = await versionReport(about(project({ wanted: 'file:../sdk', installed: '0.19.1' })), OWN);
    expect(unjudged.sdk?.stale).toBe(false);
  });

  it("says a local build is one, and neither behind nor stale: it is someone's own", async () => {
    const latest = published({ [SDK]: '0.34.0', '@joinbankroll/cli': '0.6.0' });
    const dir = project({ wanted: '^0.32.0', locked: '0.32.0', installed: '0.31.0', dogfood: true });
    const report = await versionReport(about(dir, { local: true, latest }), { ...OWN, reported: '0.33.0' });
    expect(report.cli).toEqual({ version: '0.5.0', latest: '0.6.0', behind: false, local: true });
    expect(report.sdk).toMatchObject({ version: '0.33.0', latest: '0.34.0', behind: false, local: true, stale: false });
  });

  it('knows an app opened by its address only by what it says of itself', async () => {
    const dir = project({ wanted: '^0.32.0', locked: '0.32.0', installed: '0.19.1' });
    const latest = published({ [SDK]: '0.33.0', '@joinbankroll/cli': '0.5.0' });
    expect((await versionReport(about(dir, { latest }), { open: true, own: false, reported: '0.32.0' })).sdk).toEqual({ version: '0.32.0', latest: '0.33.0', behind: true, local: false, stale: false });
    // And one that says nothing is not known at all.
    expect((await versionReport(about(dir, { latest }), { open: true, own: false })).sdk).toEqual({ latest: '0.33.0', behind: false, local: false, stale: false });
  });

  it('says what it can when the registry cannot be asked', async () => {
    const report = await versionReport(about(project({ wanted: '^0.32.0', installed: '0.32.0' }), { latest: nothingPublished }), OWN);
    expect(report).toEqual({ cli: { version: '0.5.0', behind: false, local: false }, sdk: { version: '0.32.0', behind: false, local: false, installed: '0.32.0', wanted: '^0.32.0', stale: false } });
  });
});

describe('remembering', () => {
  it('keeps an answer for a while, and asks again after a silence', async () => {
    const answers = [undefined, '0.5.0', '0.6.0'];
    let asked = 0;
    const latest = remembering(async () => answers[asked++]);
    expect(await latest('a')).toBeUndefined();
    expect(await latest('a')).toBe('0.5.0');
    expect(await latest('a')).toBe('0.5.0');
    expect(asked).toBe(2);

    let again = 0;
    const forgetful = remembering(async () => `0.${again++}.0`, 0);
    await forgetful('a');
    await forgetful('a');
    expect(again).toBe(2);
  });
});
