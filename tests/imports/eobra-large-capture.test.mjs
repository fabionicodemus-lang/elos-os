import test from 'node:test';
import assert from 'node:assert/strict';
import { convertEobraCheckpoint, reconstructEobraCheckpoint } from '../../lib/eobra-import/checkpoint.mjs';
import { createEobraPackage, inspectEobraPackagePart } from '../../lib/eobra-import/package.mjs';

test('large array capture fits multipart and reconstructs every original byte of JSON values', () => {
  const checkpoint = { schema: 'eobra.ui-checkpoint.v1', sourceHost: 'fixture.eobra.com.br', capturedAt: '2026-11-27T00:00:00Z', capturedOn: '2026-11-27', captures: { auditEvidence: Array.from({ length:60 }, (_,i) => ({ id:String(i), text:'á🏗'.repeat(14000) })) } };
  const converted = convertEobraCheckpoint(checkpoint, { capturedAt:'2026-11-27T00:00:00Z',referenceDate:'2026-11-27' });
  assert.deepEqual(reconstructEobraCheckpoint(converted.snapshot),checkpoint);
  const pack = createEobraPackage(converted.snapshot);
  assert.ok(pack.parts.length > 1);
  for(const part of pack.parts) assert.equal(inspectEobraPackagePart(part.text,part.descriptor).ok,true);
  assert.equal(converted.report.preserved.lossless,true);
});
