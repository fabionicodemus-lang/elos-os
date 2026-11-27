import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  createEobraPackage, inspectEobraPackageManifest, inspectEobraPackagePart,
  MAX_PACKAGE_PART_BYTES, MAX_PACKAGE_BYTES, MAX_PACKAGE_PART_RECORDS,
} from "../../lib/eobra-import/package.mjs";
import { canonicalEobraJson, hashEobraValue } from "../../lib/eobra-import/snapshot.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const archive = (i, value = "evidência sintética") => ({ entity: "raw_archive", archiveType: "evidence", sourceId: `row-${i}`, sourceProjectId: null, parentSourceId: null, links: [], raw: { value }, normalized: { description: "Registro sintético" } });
const snapshot = (count = 1) => ({ format: "elos.eobra.snapshot.v1", source: { host: "synthetic.eobra.example", capturedAt: "2026-03-20T18:00:00Z", referenceDate: "2026-03-20" }, scope: { projectIds: [], allProjects: false }, archiveTypes: [{ key: "evidence", description: "Evidência sintética" }], coverage: [{ entity: "raw_archive", archiveType: "evidence", sourceProjectId: null, expectedCount: count, expectedPages: 1, collectedPages: [1], detailsExpected: 0, detailsCollected: [], complete: false, filters: { synthetic: true } }], records: Array.from({ length: count }, (_, i) => archive(i)) });
const descriptor = (bytes, count = 1) => ({ ordinal: 1, firstRecord: 1, recordCount: count, byteLength: bytes.length, sha256: hash(bytes), name: "part-000001.json" });

test("package is deterministic, flat, immutable by byte hash and lossless across reconstruction", () => {
  const input = snapshot(3);
  const result = createEobraPackage(input, { maxPartRecords: 2 });
  assert.deepEqual(result.parts.map(part => part.name), ["part-000001.json", "part-000002.json"]);
  assert.deepEqual(result.manifest.parts.map(part => [part.ordinal, part.firstRecord, part.recordCount]), [[1, 1, 2], [2, 3, 1]]);
  const rebuilt = { format: input.format, source: result.manifest.source, scope: result.manifest.scope, archiveTypes: result.manifest.archiveTypes, coverage: result.manifest.coverage, records: result.parts.flatMap(part => JSON.parse(part.text)) };
  assert.deepEqual(rebuilt, input);
  assert.equal(result.manifest.globalSnapshotHash, hashEobraValue(rebuilt));
  assert.equal(inspectEobraPackageManifest(result.manifestText).ok, true);
  for (const part of result.parts) {
    assert.equal(inspectEobraPackagePart(part.text, part.descriptor).ok, true);
    assert.equal(Buffer.byteLength(part.text), part.descriptor.byteLength);
    assert.equal(part.descriptor.sha256, hash(Buffer.from(part.text)));
  }
  const another = createEobraPackage({ records: input.records, coverage: input.coverage, archiveTypes: input.archiveTypes, scope: input.scope, source: input.source, format: input.format }, { maxPartRecords: 2 });
  assert.equal(another.manifestText, result.manifestText); assert.deepEqual(another.parts, result.parts);
});

test("default writer splits 501 records at 500 and preserves global offsets", () => {
  const bundle = createEobraPackage(snapshot(501));
  assert.equal(MAX_PACKAGE_PART_RECORDS, 500);
  assert.equal(bundle.parts.length, 2);
  assert.equal(bundle.parts[0].descriptor.recordCount, 500);
  assert.equal(bundle.parts[1].descriptor.firstRecord, 501);
  assert.equal(bundle.parts[1].descriptor.recordCount, 1);
});

test("byte packing counts UTF-8 bytes and JSON separators, not string characters", () => {
  const input = snapshot(3); input.records = input.records.map((row, i) => archive(i, "ç🙂".repeat(40)));
  const first = Buffer.byteLength(canonicalEobraJson(input.records[0]));
  const second = Buffer.byteLength(canonicalEobraJson(input.records[1]));
  const limit = first + second + 3;
  const bundle = createEobraPackage(input, { maxPartBytes: limit });
  assert.equal(bundle.parts.length, 2);
  assert.equal(bundle.parts[0].descriptor.byteLength, limit);
  assert.equal(bundle.parts[0].descriptor.recordCount, 2);
});

test("a single record above a part limit is rejected without truncation", () => {
  const input = snapshot(); input.records[0].raw.value = "x".repeat(MAX_PACKAGE_PART_BYTES);
  assert.throws(() => createEobraPackage(input), /excede uma parte/);
});

test("changed bytes, byte length and record count cannot pass a declared part", () => {
  const part = createEobraPackage(snapshot()).parts[0];
  assert.equal(inspectEobraPackagePart(`${part.text} `, part.descriptor).ok, false);
  const changed = part.text.replace("sintética", "sintetica");
  assert.equal(inspectEobraPackagePart(changed, part.descriptor).ok, false);
  assert.equal(inspectEobraPackagePart(part.text, { ...part.descriptor, recordCount: 2 }).ok, false);
  assert.equal(inspectEobraPackagePart(part.text, { ...part.descriptor, byteLength: part.descriptor.byteLength + 1 }).records, null);
});

test("BOM and invalid UTF-8 are rejected even if their exact hash was supplied", () => {
  const text = createEobraPackage(snapshot()).parts[0].text;
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
  const checkedBom = inspectEobraPackagePart(bom, descriptor(bom));
  assert.equal(checkedBom.ok, false); assert.match(checkedBom.errors.join(" "), /BOM/);
  const invalid = Buffer.from([0x5b, 0x22, 0xc3, 0x28, 0x22, 0x5d]);
  assert.match(inspectEobraPackagePart(invalid, descriptor(invalid)).errors.join(" "), /UTF-8/);
});

test("part record shape and safe JSON constraints are checked before staging", () => {
  for (const body of [JSON.stringify({ records: [archive(1)] }), JSON.stringify([null]), JSON.stringify([{ ...archive(1), sourceId: 42 }]), JSON.stringify([{ ...archive(1), raw: [] }]), JSON.stringify([{ ...archive(1), links: Array(2001).fill({}) }]), JSON.stringify([{ ...archive(1), raw: { bad: Number.MAX_SAFE_INTEGER + 1 } }])]) {
    const bytes = Buffer.from(body);
    assert.equal(inspectEobraPackagePart(bytes, descriptor(bytes)).ok, false);
  }
  const excess = Buffer.from(JSON.stringify(Array.from({ length: 501 }, (_, i) => archive(i))));
  assert.equal(inspectEobraPackagePart(excess, descriptor(excess, 500)).ok, false);
});

test("part size is bounded before parsing or hash trust", () => {
  const body = Buffer.alloc(MAX_PACKAGE_PART_BYTES + 1, 0x20);
  const metadata = { ...descriptor(Buffer.from("[]")), byteLength: MAX_PACKAGE_PART_BYTES };
  assert.match(inspectEobraPackagePart(body, metadata).errors.join(" "), /2 MiB/);
});

test("manifest refuses paths, URLs, duplicate files, skipped ordinals and overlapping ranges", () => {
  const original = createEobraPackage(snapshot(3), { maxPartRecords: 1 }).manifest;
  const variants = [
    m => { m.parts[0].name = "../part-000001.json"; },
    m => { m.parts[0].name = "parts/part-000001.json"; },
    m => { m.parts[0].name = "https://example.test/part-000001.json"; },
    m => { m.parts[1].name = m.parts[0].name; },
    m => { m.parts[1].ordinal = 3; },
    m => { m.parts[1].firstRecord = 1; },
    m => { m.parts[1].firstRecord = 8; },
    m => { m.parts[0].sha256 = "a".repeat(63); },
    m => { m.parts[0].sha256 = "A".repeat(64); },
    m => { m.parts[0].byteLength = MAX_PACKAGE_PART_BYTES + 1; },
    m => { m.parts[0].recordCount = 501; },
  ];
  for (const mutate of variants) {
    const m = structuredClone(original); mutate(m);
    const result = inspectEobraPackageManifest(m);
    assert.equal(result.ok, false, JSON.stringify(m.parts)); assert.equal(result.manifest, null);
  }
});

test("manifest enforces total bytes, count sum, 100k rows and bounded metadata", () => {
  const m = createEobraPackage(snapshot()).manifest;
  const excessBytes = structuredClone(m);
  excessBytes.recordCount = 101;
  excessBytes.parts = Array.from({ length: 101 }, (_, index) => ({ ordinal: index + 1, firstRecord: index + 1, recordCount: 1, byteLength: MAX_PACKAGE_PART_BYTES, sha256: "a".repeat(64), name: `part-${String(index + 1).padStart(6, "0")}.json` }));
  assert.ok(101 * MAX_PACKAGE_PART_BYTES > MAX_PACKAGE_BYTES);
  assert.match(inspectEobraPackageManifest(excessBytes).errors.join(" "), /200 MiB/);
  assert.equal(inspectEobraPackageManifest({ ...m, recordCount: 100001 }).ok, false);
  assert.equal(inspectEobraPackageManifest({ ...m, recordCount: 2 }).ok, false);
  assert.equal(inspectEobraPackageManifest({ ...m, parts: Array(1001).fill(m.parts[0]) }).ok, false);
  assert.match(inspectEobraPackageManifest({ ...m, source: { ...m.source, oversized: "x".repeat(MAX_PACKAGE_PART_BYTES) } }).errors.join(" "), /2 MiB/);
});

test("manifest validates source, scope and coverage shape but does not claim business completeness", () => {
  const m = createEobraPackage(snapshot()).manifest;
  assert.equal(inspectEobraPackageManifest(m).ok, true);
  for (const mutate of [
    m => { m.source.host = "https://wrong.example/"; },
    m => { m.source.capturedAt = "2026-03-20"; },
    m => { m.scope.allProjects = "yes"; },
    m => { m.scope.projectIds = ["same", "same"]; },
    m => { m.coverage[0].complete = true; m.coverage[0].expectedCount = null; },
    m => { m.coverage[0].collectedPages = [1, 1]; },
    m => { m.coverage[0].detailsCollected = ["same", "same"]; },
    m => { m.coverage[0].archiveType = "unknown"; },
    m => { m.coverage.push(m.coverage[0]); },
  ]) {
    const changed = structuredClone(m); mutate(changed);
    assert.equal(inspectEobraPackageManifest(changed).ok, false);
  }
  assert.equal(Object.hasOwn(inspectEobraPackageManifest(m), "complete"), false);
});

test("invalid empty package, options and formats fail before any output is written", () => {
  assert.throws(() => createEobraPackage(snapshot(0)), /1 a 100/);
  assert.throws(() => createEobraPackage(snapshot(), { maxPartRecords: 501 }), /Limites/);
  assert.throws(() => createEobraPackage(snapshot(), { maxPartBytes: MAX_PACKAGE_PART_BYTES + 1 }), /Limites/);
  const m = createEobraPackage(snapshot()).manifest;
  assert.equal(inspectEobraPackageManifest({ ...m, format: "unknown" }).ok, false);
  assert.equal(inspectEobraPackageManifest("not JSON").ok, false);
});
