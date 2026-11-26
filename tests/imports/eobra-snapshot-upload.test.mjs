import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { inspectSnapshotBundleFiles, snapshotUploadFileHash, verifySnapshotBundlePart } from '../../lib/eobra-import/snapshot-upload.mjs';
import { MAX_SNAPSHOT_PART_BYTES } from '../../lib/eobra-import/snapshot-request.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function file(name, text, root = 'synthetic') {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  return { name, size: bytes.byteLength, webkitRelativePath: `${root}/${name}`, arrayBuffer: async () => bytes.slice().buffer };
}
function bundle(texts = ['[{"synthetic":true}]']) {
  const parts = texts.map((text, index) => {
    const name = `part-${String(index + 1).padStart(6, '0')}.json`;
    const bytes = new TextEncoder().encode(text);
    return { file: file(name, bytes), descriptor: { ordinal: index + 1, firstRecord: index + 1, recordCount: 1, byteLength: bytes.byteLength, sha256: hash(bytes), name } };
  });
  const manifest = { format: 'elos.eobra.snapshot.parts.v1', recordCount: texts.length, parts: parts.map(part => part.descriptor) };
  return { manifest, parts, files: () => [file('manifest.json', JSON.stringify(manifest)), ...parts.map(part => part.file)] };
}

test('folder selection validates the manifest and names without decoding any part', async () => {
  const source = bundle(['[{"id":"one"}]', '[{"id":"two"}]']);
  let reads = 0;
  for (const part of source.parts) {
    const read = part.file.arrayBuffer;
    part.file.arrayBuffer = async () => { reads++;return read(); };
  }
  const inspected = await inspectSnapshotBundleFiles(source.files().reverse());
  assert.equal(inspected.parts.length, 2);
  assert.equal(inspected.totalBytes, source.parts.reduce((sum, part) => sum + part.file.size, 0));
  assert.equal(inspected.folderName, 'synthetic');
  assert.equal(reads, 0);
  await verifySnapshotBundlePart(inspected.parts[0].file, inspected.parts[0].descriptor);
  assert.equal(reads, 1);
});

test('missing, duplicate, nested, foreign and undeclared files cannot be uploaded', async () => {
  const source = bundle(['[{}]', '[{}]']);
  const valid = source.files();
  const scenarios = [
    valid.slice(1), valid.slice(0, 2), [...valid, valid[1]],
    [valid[0], { ...valid[1], webkitRelativePath: `synthetic/parts/${valid[1].name}` }, valid[2]],
    [valid[0], { ...valid[1], webkitRelativePath: `other/${valid[1].name}` }, valid[2]],
    [...valid, file('part-000003.json', '[{}]')], [...valid, file('notes.json', '{}')],
    [valid[0], { ...valid[1], webkitRelativePath: `../${valid[1].name}` }, valid[2]],
  ];
  for (const files of scenarios) await assert.rejects(inspectSnapshotBundleFiles(files));
});

test('manifest validates ordinal, record range, count, exact bytes and sha256 shape', async () => {
  const mutations = [
    source => { source.manifest.format = 'unknown'; },
    source => { source.manifest.recordCount = 0; },
    source => { source.manifest.recordCount = 100001; },
    source => { source.manifest.recordCount = 2; },
    source => { source.manifest.parts[0].ordinal = 2; },
    source => { source.manifest.parts[0].firstRecord = 0; },
    source => { source.manifest.parts[0].name = 'part-999999.json'; },
    source => { source.manifest.parts[0].recordCount = 501; },
    source => { source.manifest.parts[0].sha256 = 'A'.repeat(64); },
    source => { source.manifest.parts[0].byteLength++; },
    source => { source.manifest.parts[0].byteLength = MAX_SNAPSHOT_PART_BYTES + 1; },
  ];
  for (const mutate of mutations) { const source = bundle();mutate(source);await assert.rejects(inspectSnapshotBundleFiles(source.files())); }
});

test('UTF-8, BOM, empty and oversized manifest are rejected before business inspection', async () => {
  const source = bundle();
  for (const manifest of [file('manifest.json', '{'), file('manifest.json', new Uint8Array([0xff])), file('manifest.json', '\ufeff' + JSON.stringify(source.manifest)), file('manifest.json', ''), { ...source.files()[0], size: MAX_SNAPSHOT_PART_BYTES + 1 }]) {
    await assert.rejects(inspectSnapshotBundleFiles([manifest, source.parts[0].file]));
  }
});

test('200 MiB cumulative limit is checked from file sizes without allocating the bundle', async () => {
  const parts = Array.from({ length: 101 }, (_, index) => {
    const name = `part-${String(index + 1).padStart(6, '0')}.json`;
    return { name, size: MAX_SNAPSHOT_PART_BYTES, webkitRelativePath: `synthetic/${name}`, arrayBuffer: async () => { throw new Error('Parts must not be read during manifest checks'); } };
  });
  const manifest = { format: 'elos.eobra.snapshot.parts.v1', recordCount: parts.length, parts: parts.map((part, index) => ({ ordinal: index + 1, firstRecord: index + 1, recordCount: 1, byteLength: part.size, sha256: 'a'.repeat(64), name: part.name })) };
  await assert.rejects(inspectSnapshotBundleFiles([file('manifest.json', JSON.stringify(manifest)), ...parts]), /200 MiB/);
});

test('one-file hash uses exact bytes and detects same-size tampering or changed content', async () => {
  const source = bundle(['[{"a":1}]']);
  const { file: original, descriptor } = source.parts[0];
  assert.equal(await snapshotUploadFileHash(original), descriptor.sha256);
  await verifySnapshotBundlePart(original, descriptor);
  await assert.rejects(verifySnapshotBundlePart(file(original.name, '[{"a":2}]'), descriptor), /diferente/);
  await assert.rejects(verifySnapshotBundlePart({ ...original, arrayBuffer: async () => new Uint8Array([1]).buffer }, descriptor), /mudou/);
  const bom = file(original.name, '\ufeff[{}]');
  await assert.rejects(snapshotUploadFileHash(bom), /BOM/);
});
