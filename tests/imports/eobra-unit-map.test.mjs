import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_UNIT_MAP_BYTES, parseSnapshotUnitMap, parseUnitMapPageQuery, readSnapshotUnitMapRequest, unitMapRequiredPermissions, unitMapSearchPattern } from '../../lib/eobra-import/unit-map.mjs';

const company = '11111111-1111-4111-8111-111111111111';
const run = '22222222-2222-4222-8222-222222222222';
const unit = 'abcdefab-1234-4234-8234-abcdefabcdef';
const hash = 'a'.repeat(64);
const reuse = { action: 'reuse', unit_id: unit, expected_identity_hash: hash };
const control = map => ({ company_id: company, run_id: run, confirm_units: true, unit_map: map });
const request = (body, headers = {}) => new Request('https://example.test/api/imports/eobra/snapshot/unit-map', { method: 'POST', headers: { Origin: 'https://example.test', 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('unit-only legacy runs need their actual native scope while parts keep every required permission', () => {
  const minimal = ['admin.company.manage', 'projects.manage', 'sales.manage'];
  assert.deepEqual(unitMapRequiredPermissions(minimal), minimal);
  assert.ok(!unitMapRequiredPermissions(minimal).includes('finance.bank_accounts.manage'));
  const full = [...minimal, 'clients.manage', 'suppliers.manage', 'receivables.manage', 'payables.manage', 'finance.bank_accounts.manage'];
  assert.deepEqual(unitMapRequiredPermissions(full), [...full].sort());
  for (const invalid of [null, {}, [''], [12], [' projects.manage']]) assert.throws(() => unitMapRequiredPermissions(invalid), /permissões/);
});

test('unit decisions preserve exact source identity and require an explicit action for every expected unit', () => {
  const map = { 'unit-101': reuse, 'unit-101-returned': { action: 'create' } };
  assert.deepEqual(parseSnapshotUnitMap(map, 2), map);
  assert.throws(() => parseSnapshotUnitMap(map, 3), /cada unidade/);
  assert.throws(() => parseSnapshotUnitMap({ 'unit-101': null }, 1), /inválido/);
  assert.throws(() => parseSnapshotUnitMap({ 'unit-101': {} }, 1), /novamente/);
  assert.throws(() => parseSnapshotUnitMap({ 'unit-101': { action: 'auto' } }, 1), /novamente/);
  assert.deepEqual(parseSnapshotUnitMap({}, 0), {});
});

test('reuse requires the identity hash shown to the reviewer and rejects duplicate native targets', () => {
  assert.throws(() => parseSnapshotUnitMap({ a: { action: 'reuse', unit_id: unit } }), /novamente/);
  assert.throws(() => parseSnapshotUnitMap({ a: { ...reuse, expected_identity_hash: 'b' } }), /novamente/);
  assert.throws(() => parseSnapshotUnitMap({ a: { ...reuse, expected_identity_hash: hash.toUpperCase() } }), /novamente/);
  assert.throws(() => parseSnapshotUnitMap({ a: reuse, b: { ...reuse, unit_id: unit.toUpperCase() } }), /mesmo cadastro/);
  assert.equal(parseSnapshotUnitMap({ a: { ...reuse, unit_id: unit.toUpperCase() } }).a.unit_id, unit);
});

test('decisions reject hidden mutations, bad IDs and malformed JSON shapes', () => {
  for (const map of [null, [], 'a', { a: { action: 'create', unit_id: unit } }, { a: { ...reuse, code: 'replacement' } }, { a: { ...reuse, unit_id: 'not-a-uuid' } }, { ' a': reuse }, { 'a\n': reuse }, { ['a'.repeat(513)]: reuse }]) {
    assert.throws(() => parseSnapshotUnitMap(map));
  }
  const exoticId = JSON.parse('{"__proto__":{"action":"create"}}');
  const normalized = parseSnapshotUnitMap(exoticId, 1);
  assert.equal(Object.hasOwn(normalized, '__proto__'), true);
  assert.deepEqual(normalized.__proto__, { action: 'create' });
  assert.equal(Object.getPrototypeOf(normalized), Object.prototype);
});

test('confirmation requires the exact control contract and explicit review', async () => {
  assert.deepEqual(await readSnapshotUnitMapRequest(request(control({ a: reuse }))), control({ a: reuse }));
  for (const value of [[], null, { ...control({ a: reuse }), confirm_units: false }, { ...control({ a: reuse }), project_id: company }, { ...control({ a: reuse }), run_id: 'fake' }, { ...control({ a: reuse }), run_id: [run] }, { ...control({ a: reuse }), company_id: [company] }, { ...control({ a: reuse }), company_id: null }]) {
    await assert.rejects(readSnapshotUnitMapRequest(request(value)));
  }
  await assert.rejects(readSnapshotUnitMapRequest(request('{')), /inválido/);
  await assert.rejects(readSnapshotUnitMapRequest(request(control({ a: reuse }), { Origin: 'https://another.test' })), /Origem/);
  await assert.rejects(readSnapshotUnitMapRequest(request(control({ a: reuse }), { 'Content-Type': 'text/plain' })), /formulário/);
});

test('confirmation bounds actual streamed bytes and rejects a forged Content-Length', async () => {
  await assert.rejects(readSnapshotUnitMapRequest(request('{}', { 'Content-Length': String(MAX_UNIT_MAP_BYTES + 1) })), /3 MiB/);
  // The character count fits, but its UTF-8 representation exceeds the byte limit.
  await assert.rejects(readSnapshotUnitMapRequest(request(JSON.stringify({ extra: 'é'.repeat(Math.ceil(MAX_UNIT_MAP_BYTES / 2)) }))), /3 MiB/);
});

test('pagination validates tenant/run/project and does not pass user-controlled LIKE wildcards', () => {
  const base = { company_id: company, run_id: run };
  assert.deepEqual(parseUnitMapPageQuery(new URLSearchParams(base)), { mode: 'source', companyId: company, runId: run, projectId: null, page: 1, search: '' });
  assert.equal(parseUnitMapPageQuery(new URLSearchParams({ ...base, mode: 'options', project_id: unit, page: '2' })).page, 2);
  for (const input of [{ page: '0' }, { page: '-1' }, { page: '1e2' }, { page: '2001' }, { mode: 'all' }, { mode: 'options' }, { project_id: '../project' }, { company_id: 'fake' }, { search: 'x'.repeat(121) }, { search: 'a\0b' }]) {
    assert.throws(() => parseUnitMapPageQuery(new URLSearchParams({ ...base, ...input })), /inválida/);
  }
  assert.equal(unitMapSearchPattern('A_10%\\2'), '%A\\_10\\%\\\\2%');
});
