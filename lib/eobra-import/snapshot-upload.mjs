import { MAX_SNAPSHOT_PART_BYTES } from './snapshot-request.mjs';

const FORMAT = 'elos.eobra.snapshot.parts.v1';
const MAX_PARTS = 1000;
const MAX_RECORDS = 100000;
const MAX_RECORDS_PER_PART = 500;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const integer = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
const fail = message => { throw new Error(message); };

/** Transport checks only. Business data is validated by the preparation process. */
export async function inspectSnapshotBundleFiles(input) {
  const files = Array.from(input);
  if (files.length < 2 || files.length > MAX_PARTS + 1) fail('Selecione a pasta com manifest.json e até 1.000 partes da coleta.');
  const byName = new Map();
  const roots = new Set();
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || !integer(file.size, MAX_SNAPSHOT_PART_BYTES) || typeof file.arrayBuffer !== 'function') {
      fail('Cada arquivo da pasta deve ter conteúdo e no máximo 2 MiB.');
    }
    const relative = file.webkitRelativePath || file.name;
    const segments = relative.split('/');
    if (segments.length > 2 || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\')) || segments.at(-1) !== file.name) {
      fail('Selecione a pasta que contém diretamente o manifesto e as partes, sem subpastas.');
    }
    roots.add(segments.length === 2 ? segments[0] : '');
    if (roots.size > 1 || byName.has(file.name)) fail('A seleção contém pastas diferentes ou nomes de arquivo repetidos.');
    if (file.name !== 'manifest.json' && !/^part-\d{6}\.json$/.test(file.name)) fail('A pasta contém arquivos fora do pacote. Selecione a pasta com apenas manifest.json e suas partes.');
    byName.set(file.name, file);
  }
  const manifestFile = byName.get('manifest.json');
  if (!manifestFile) fail('O arquivo manifest.json não está na pasta selecionada.');
  let manifest;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await manifestFile.arrayBuffer());
    if (text.charCodeAt(0) === 0xfeff) fail('BOM');
    manifest = JSON.parse(text);
  } catch { fail('O manifesto deve ser um JSON UTF-8 válido, sem BOM.'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.format !== FORMAT || !integer(manifest.recordCount, MAX_RECORDS)
    || !Array.isArray(manifest.parts) || !integer(manifest.parts.length, MAX_PARTS)) fail('O manifesto da coleta em partes é inválido. Gere novamente o pacote.');
  const parts = [];
  let firstRecord = 1;
  let totalBytes = 0;
  for (let index = 0; index < manifest.parts.length; index++) {
    const descriptor = manifest.parts[index];
    const name = `part-${String(index + 1).padStart(6, '0')}.json`;
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor) || descriptor.ordinal !== index + 1 || descriptor.firstRecord !== firstRecord || descriptor.name !== name
      || !integer(descriptor.recordCount, MAX_RECORDS_PER_PART) || !integer(descriptor.byteLength, MAX_SNAPSHOT_PART_BYTES) || !/^[a-f0-9]{64}$/.test(descriptor.sha256 ?? '')) {
      fail(`A identificação ou os limites da parte ${index + 1} divergem do formato esperado.`);
    }
    const file = byName.get(name);
    if (!file || file.size !== descriptor.byteLength) fail(`A parte ${index + 1} está ausente ou tem tamanho diferente do manifesto.`);
    firstRecord += descriptor.recordCount;
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) fail('O conjunto de partes excede 200 MiB.');
    parts.push({ descriptor, file });
  }
  if (firstRecord - 1 !== manifest.recordCount) fail('A quantidade de registros das partes diverge do manifesto.');
  if (byName.size !== parts.length + 1) fail('A pasta contém partes que não constam no manifesto.');
  return { manifest, manifestFile, parts, totalBytes, folderName: [...roots][0] };
}

/** Hash one bounded file; no complete bundle or business records are decoded here. */
export async function snapshotUploadFileHash(file) {
  if (!integer(file?.size, MAX_SNAPSHOT_PART_BYTES)) fail('O arquivo deve ter conteúdo e no máximo 2 MiB.');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size || bytes.byteLength > MAX_SNAPSHOT_PART_BYTES) fail('O conteúdo do arquivo mudou desde a seleção.');
  const prefix = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 3));
  if (prefix.length === 3 && prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf) fail('As partes devem usar UTF-8 sem BOM.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function verifySnapshotBundlePart(file, descriptor) {
  if (!integer(file?.size, MAX_SNAPSHOT_PART_BYTES) || file.size !== descriptor?.byteLength) fail('O tamanho da parte difere do manifesto.');
  const sha256 = await snapshotUploadFileHash(file);
  if (sha256 !== descriptor.sha256) fail(`A parte ${descriptor.ordinal} está diferente do manifesto. Gere novamente o pacote antes de enviar.`);
}
