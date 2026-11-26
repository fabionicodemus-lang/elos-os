import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSnapshotBundlePath, assertSnapshotPartPath, assertSnapshotPath, MAX_SNAPSHOT_CONTROL_BYTES, parseSnapshotProjectMap, readSnapshotControl, snapshotRequiredPermissions, snapshotStorageBucket, SNAPSHOT_BUCKET, SNAPSHOT_BUNDLE_BUCKET } from '../../lib/eobra-import/snapshot-request.mjs';

const company = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const upload = '33333333-3333-4333-8333-333333333333';
const request = (body, headers = {}) => new Request('https://example.test/api/imports/eobra/snapshot/inspect', {
  method: 'POST', headers: { Origin: 'https://example.test', 'Content-Type': 'application/json', ...headers }, body,
});

test('bundle paths remain scoped and use flat declared part names', () => {
  const manifest = `${company}/${user}/${upload}/manifest.json`;
  assert.equal(assertSnapshotPath(manifest, company, user), manifest);
  assert.equal(assertSnapshotBundlePath(manifest, company, user), manifest);
  assert.equal(snapshotStorageBucket(manifest), SNAPSHOT_BUNDLE_BUCKET);
  assert.equal(snapshotStorageBucket(`${company}/${user}/${upload}.json`), SNAPSHOT_BUCKET);
  for (const name of ['part-000001.json', 'part-000999.json', 'part-001000.json']) {
    assert.equal(assertSnapshotPartPath(manifest, name, company, user), `${company}/${user}/${upload}/${name}`);
  }
  for (const name of ['../part-000001.json', 'parts/part-000001.json', 'part-000000.json', 'part-001001.json', 'part-1.json', 'part-000001.json?x=1', 'manifest.json', 'https://another.test/part-000001.json']) {
    assert.throws(() => assertSnapshotPartPath(manifest, name, company, user), /inválido/);
  }
  for (const invalid of [manifest + '?x=1', manifest.replace('/manifest.json', '/../manifest.json'), manifest.replace('/manifest.json', '/parts/manifest.json')]) {
    assert.throws(() => assertSnapshotBundlePath(invalid, company), /escopo/);
    assert.throws(() => snapshotStorageBucket(invalid), /inválido/);
  }
});

test('persisted bundle can be scoped by company after run authorization while stage requires its uploader', () => {
  const manifest = `${company}/${user}/${upload}/manifest.json`;
  assert.equal(assertSnapshotBundlePath(manifest, company), manifest);
  assert.throws(() => assertSnapshotPath(manifest, company, upload), /pertence/);
  assert.throws(() => assertSnapshotBundlePath(manifest, company, upload), /escopo/);
  assert.throws(() => assertSnapshotBundlePath(manifest, user), /escopo/);
  assert.throws(() => assertSnapshotBundlePath(`${company}/not-a-user/${upload}/manifest.json`, company), /escopo/);
});

test('snapshot upload identity requires both active company and authenticated uploader', () => {
  const path = `${company}/${user}/${upload}.json`;
  assert.equal(assertSnapshotPath(path, company, user), path);
  for (const invalid of [`${user}/${company}/${upload}.json`, `${company}/${user}/../${upload}.json`, `${company}/${user}/${upload}.json?x=1`, `${company}/${user}/ar.json`, `https://bucket.test/${path}`]) {
    assert.throws(() => assertSnapshotPath(invalid, company, user), /pertence/);
  }
});

test('control request rejects cross-origin and unsupported content before parsing JSON', async () => {
  await assert.rejects(readSnapshotControl(request('{', { Origin: 'https://another.test' })), /Origem/);
  await assert.rejects(readSnapshotControl(request('{}', { 'Content-Type': 'text/plain' })), /formulário/);
  await assert.rejects(readSnapshotControl(request('[]')), /inválida/);
  await assert.rejects(readSnapshotControl(request('{')), /inválida/);
});

test('control request enforces a byte bound without trusting Content-Length', async () => {
  await assert.rejects(readSnapshotControl(request(JSON.stringify({ value: 'x'.repeat(MAX_SNAPSHOT_CONTROL_BYTES) }))), /limite/);
  await assert.rejects(readSnapshotControl(request('{}', { 'Content-Length': String(MAX_SNAPSHOT_CONTROL_BYTES + 1) })), /limite/);
  assert.deepEqual(await readSnapshotControl(request(JSON.stringify({ company_id: company }))), { company_id: company });
});

test('project mapping preserves missing bindings but rejects an unknown source, bad target and merged projects', () => {
  assert.deepEqual(parseSnapshotProjectMap({}, ['project-a']), {});
  assert.deepEqual(parseSnapshotProjectMap({ 'project-a': company }, ['project-a']), { 'project-a': company });
  assert.throws(() => parseSnapshotProjectMap({ 'project-b': company }, ['project-a']), /inválido/);
  assert.throws(() => parseSnapshotProjectMap({ 'project-a': 'fake' }, ['project-a']), /inválido/);
  assert.throws(() => parseSnapshotProjectMap({ a: company, b: company }, ['a', 'b']), /distinta/);
});

test('raw archives cannot launder native financial or personal permissions', () => {
  const permissions = snapshotRequiredPermissions([{ entity: 'raw_archive' }]);
  for (const permission of ['admin.company.manage', 'projects.manage', 'clients.manage', 'suppliers.manage', 'sales.manage', 'receivables.manage', 'payables.manage', 'finance.bank_accounts.manage']) assert.ok(permissions.includes(permission));
  assert.ok(snapshotRequiredPermissions([{ entity: 'person', normalized: { roles: ['other'] } }]).includes('clients.manage'));
  assert.ok(snapshotRequiredPermissions([{ entity: 'person', normalized: { roles: ['other'] } }]).includes('suppliers.manage'));
  assert.doesNotThrow(() => snapshotRequiredPermissions([{ entity: 'person', normalized: { roles: { invalid: true } } }]));
});
