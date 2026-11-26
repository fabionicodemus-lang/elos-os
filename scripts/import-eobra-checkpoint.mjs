#!/usr/bin/env node
import { readFile, writeFile, mkdir, realpath, stat, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertEobraCheckpoint, formatEobraCheckpointReview } from "../lib/eobra-import/checkpoint.mjs";
import { MAX_SNAPSHOT_BYTES } from "../lib/eobra-import/snapshot.mjs";
import { createEobraPackage } from "../lib/eobra-import/package.mjs";

const usage = `Uso: node scripts/import-eobra-checkpoint.mjs --input CHECKPOINT [--input COMPLEMENTO] (--out SNAPSHOT | --bundle PASTA) --report REVISAO [--markdown REVISAO.md]
Opções: --captured-at TIMESTAMP --reference-date AAAA-MM-DD --all-projects --require-complete --overwrite
O comando somente lê arquivos e produz uma revisão. Saídas precisam estar fora do repositório.
`;

function parseArguments(args) {
  const result = { inputs: [] };
  const values = new Map([["--input", "input"], ["--out", "out"], ["--bundle", "bundle"], ["--report", "report"], ["--markdown", "markdown"], ["--captured-at", "capturedAt"], ["--reference-date", "referenceDate"]]);
  const flags = new Map([["--all-projects", "allProjects"], ["--require-complete", "requireComplete"], ["--overwrite", "overwrite"]]);
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (flags.has(argument)) { result[flags.get(argument)] = true; continue; }
    const key = values.get(argument);
    if (!key || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Argumento inválido: ${argument}.`);
    if (key === "input") result.inputs.push(path.resolve(args[++i]));
    else {
      if (result[key] !== undefined) throw new Error(`Argumento repetido: ${argument}.`);
      result[key] = args[++i];
    }
  }
  if (!result.inputs.length || (!result.out && !result.bundle) || !result.report) throw new Error("Informe --input, --out ou --bundle, e --report.");
  if (result.out && result.bundle) throw new Error("Escolha --out ou --bundle, não ambos.");
  return result;
}

async function resolvedDestination(destination) {
  const absolute = path.resolve(destination);
  try {
    if ((await lstat(absolute)).isSymbolicLink()) throw new Error("Uma saída não pode ser um link simbólico existente.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  let current = path.dirname(absolute);
  const suffix = [path.basename(absolute)];
  while (true) {
    try { return path.join(await realpath(current), ...suffix); }
    catch (error) {
      if (error.code !== "ENOENT" || current === path.dirname(current)) throw error;
      suffix.unshift(path.basename(current)); current = path.dirname(current);
    }
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage); return; }
  const repository = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const inputs = await Promise.all(args.inputs.map(input => realpath(input)));
  const inputStats = await Promise.all(inputs.map(input => stat(input)));
  const outputs = await Promise.all([args.out, args.report, args.markdown].filter(Boolean).map(resolvedDestination));
  const bundleDirectory = args.bundle ? await resolvedDestination(args.bundle) : null;
  if (new Set(outputs).size !== outputs.length) throw new Error("Saídas devem usar arquivos diferentes.");
  for (const output of [...outputs, ...(bundleDirectory ? [bundleDirectory] : [])]) {
    const relative = path.relative(repository, output);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Dados de origem e revisões privadas não podem ser gravados dentro do repositório.");
    if (inputs.includes(output)) throw new Error("Uma saída não pode substituir o checkpoint de entrada.");
  }
  if (bundleDirectory) {
    for (const output of outputs) {
      const relative = path.relative(bundleDirectory, output);
      if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Relatórios devem ficar fora da pasta de partes imutáveis.");
    }
    try { await stat(bundleDirectory); throw new Error("A pasta de bundle já existe; escolha uma nova pasta para preservar suas partes imutáveis."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  for (const output of outputs) {
    try {
      const existing = await stat(output);
      if (!existing.isFile()) throw new Error("Destino existente não é um arquivo regular.");
      if (inputStats.some(input => input.dev === existing.dev && input.ino === existing.ino)) throw new Error("Uma saída não pode substituir o checkpoint de entrada.");
      if (!args.overwrite) throw new Error("Uma saída já existe; use outro nome ou --overwrite explicitamente.");
      if (inputs.includes(await realpath(output))) throw new Error("Uma saída não pode apontar ao checkpoint de entrada.");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const documents = [];
  for (const input of inputs) {
    const metadata = await stat(input);
    if (!metadata.isFile() || metadata.size > MAX_SNAPSHOT_BYTES) throw new Error("Checkpoint precisa ser um arquivo JSON de até 200 MiB.");
    const parsed = JSON.parse(await readFile(input, "utf8"));
    documents.push(parsed);
  }
  const converted = convertEobraCheckpoint(documents.length === 1 ? documents[0] : documents, {
    ...(args.capturedAt ? { capturedAt: args.capturedAt } : {}),
    ...(args.referenceDate ? { referenceDate: args.referenceDate } : {}),
    ...(args.allProjects ? { allProjects: true } : {}),
  });
  const bundle = bundleDirectory ? createEobraPackage(converted.snapshot) : null;
  const bodies = [...(args.out ? [JSON.stringify(converted.snapshot)] : []), JSON.stringify(converted.report, null, 2)];
  if (args.markdown) bodies.push(formatEobraCheckpointReview(converted.report));
  if (args.out && Buffer.byteLength(bodies[0], "utf8") > MAX_SNAPSHOT_BYTES) throw new Error("Pacote excede 200 MiB. Preserve a evidência e revise o escopo; nenhum arquivo foi gravado.");
  if (bundle) {
    await mkdir(path.dirname(bundleDirectory), { recursive: true, mode: 0o700 });
    await mkdir(bundleDirectory, { mode: 0o700 });
    for (const part of bundle.parts) await writeFile(path.join(bundleDirectory, part.name), part.text, { flag: "wx", mode: 0o600 });
    // A manifest is installed only after every immutable part was written successfully.
    await writeFile(path.join(bundleDirectory, "manifest.json"), bundle.manifestText, { flag: "wx", mode: 0o600 });
  }
  for (let i = 0; i < outputs.length; i++) {
    await mkdir(path.dirname(outputs[i]), { recursive: true, mode: 0o700 });
    await writeFile(outputs[i], bodies[i], { flag: args.overwrite ? "w" : "wx", mode: 0o600 });
  }
  process.stdout.write(JSON.stringify({ candidates: converted.report.candidates, nativeRecords: converted.report.nativeRecords, pendingRecords: converted.report.pendingRecords, snapshotValid: converted.inspection.ok, complete: converted.report.complete, lossless: converted.report.preserved.lossless, outputs: outputs.length + (bundle ? bundle.parts.length + 1 : 0), ...(bundle ? { bundleParts: bundle.parts.length } : {}) }) + "\n");
  if (args.requireComplete && !converted.report.complete) process.exitCode = 2;
}

main().catch(error => { process.stderr.write(`Conversão interrompida: ${error.message}\n`); process.exitCode = 1; });
