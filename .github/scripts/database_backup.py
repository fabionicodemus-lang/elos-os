"""Backup/ensaio de restauração; não admite destino de restauração remoto."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone


def run(args, *, data=None, output=None, operation=None):
    result = subprocess.run(args, input=data, stdout=output or subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f"{operation or Path(args[0]).name}: operação falhou (código {result.returncode}); argumentos e credenciais omitidos")
    return result.stdout


def client(program):
    container = os.environ.get("PG_DOCKER_CONTAINER")
    if container:
        if not re.fullmatch(r"elos-finance-test-\d+", container):
            raise ValueError("Contêiner fora da base de validação")
        label = run(["docker", "inspect", "--format", '{{index .Config.Labels "elos.finance.validation"}}', container]).decode().strip()
        if label != "true":
            raise ValueError("Rótulo de ambiente descartável ausente")
        return ["docker", "exec", "-i", container, program]
    return ["docker", "run", "--rm", "-i", "--network", "host", "-e", "PGSSLMODE", "-e", "PGCONNECT_TIMEOUT", "-e", "PGPASSWORD", "postgres:17", program]


def psql(database, text):
    return run(client("psql") + ["-XqAt", "-v", "ON_ERROR_STOP=1", "-d", database], data=text.encode()).decode().strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def gpg(args):
    # A senha é transmitida em pipe, nunca nos argumentos/logs do processo.
    if os.environ.get("GNUPGHOME"):
        Path(os.environ["GNUPGHOME"]).mkdir(mode=0o700, parents=True, exist_ok=True)
    run(["gpg", "--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-fd", "0", *args],
        data=(os.environ["BACKUP_PASSPHRASE"] + "\n").encode())


def backup(folder):
    database = os.environ["SUPABASE_DB_URL"]
    holder = subprocess.Popen(client("psql") + ["-XqAt", "-v", "ON_ERROR_STOP=1", "-d", database],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        holder.stdin.write(b"begin isolation level repeatable read read only; select pg_export_snapshot();\n")
        holder.stdin.flush()
        snapshot = holder.stdout.readline().decode().strip()
        if not re.fullmatch(r"[0-9A-Fa-f-]+", snapshot):
            raise RuntimeError("Não foi possível exportar o snapshot consistente")
        with tempfile.TemporaryDirectory(prefix="elos-backup-") as tmp:
            dump = Path(tmp) / "database.dump"
            with dump.open("wb") as handle:
                run(client("pg_dump") + ["-Fc", "--no-owner", "--snapshot", snapshot, "-d", database], output=handle, operation="pg_dump")
            # Contagem e dump compartilham o MESMO snapshot, inclusive sob escritas concorrentes.
            tables = json.loads(psql(database, f"""begin isolation level repeatable read read only;
                set transaction snapshot '{snapshot}';
                select coalesce(json_agg(x order by x.schema,x.name),'[]'::json) from (
                select n.nspname as schema,c.relname as name,
                ((xpath('/row/n/text()',query_to_xml(format('select count(*) n from %I.%I',n.nspname,c.relname),false,true,'')))[1]::text)::bigint as count
                from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and c.relkind in('r','p')) x; commit;"""))
            if not tables:
                raise RuntimeError("Backup sem tabelas: recusa certificação vazia")
            roles = json.loads(psql(database, "select coalesce(json_agg(rolname),'[]') from pg_roles where rolname not like 'pg_%'"))
            archive = "elos-os-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".dump.gpg"
            gpg(["--symmetric", "--cipher-algo", "AES256", "--output", str(folder / archive), str(dump)])
            manifest = {"version": 2, "archive": archive, "archive_sha256": digest(folder / archive),
                        "dump_sha256": digest(dump), "snapshot": snapshot, "tables": tables, "role_names": roles,
                        "limitations": "Restauração de teste recria papéis ausentes NOLOGIN; não certifica serviço Auth, extensões externas ou privilégios de login de produção."}
            (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
            print(f"Backup criptografado e snapshot consistente: {len(tables)} tabelas; arquivo {archive}")
    finally:
        if holder.poll() is None:
            try:
                holder.stdin.write(b"rollback;\n"); holder.stdin.flush(); holder.stdin.close()
                holder.wait(timeout=10)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                holder.kill(); holder.wait()


def restore(folder):
    manifest = json.loads((folder / "manifest.json").read_text())
    if manifest.get("version") != 2 or not manifest.get("tables"):
        raise ValueError("Manifesto ausente, antigo ou vazio; não certificar restauração")
    archive = manifest["archive"]
    if not re.fullmatch(r"elos-os-[0-9TZ]+\.dump\.gpg", archive):
        raise ValueError("Nome de arquivo inválido")
    if digest(folder / archive) != manifest["archive_sha256"]:
        raise ValueError("Checksum do backup divergente")
    # Nunca aceita URL externa ou banco existente como destino.
    name = os.environ.get("RESTORE_TEST_DB", "elos_restore_fixture")
    if not re.fullmatch(r"elos_restore_[a-z_]+", name):
        raise ValueError("Banco de restauração precisa ser descartável (elos_restore_*)")
    os.environ["PGPASSWORD"] = "postgres"  # somente serviço local descartável do workflow
    # Serviço PostgreSQL local descartável; não é uma rota para servidor externo.
    admin = "postgresql://postgres@localhost:5432/postgres?sslmode=disable"
    target = "postgresql://postgres@localhost:5432/" + name + "?sslmode=disable"
    if psql(admin, f"select count(*) from pg_database where datname='{name}'") != "0":
        raise ValueError("Destino já existe; nenhuma restauração ou exclusão executada")
    for role in manifest["role_names"]:
        quoted = '"' + role.replace('"', '""') + '"'
        literal = role.replace("'", "''")
        if psql(admin, f"select count(*) from pg_roles where rolname='{literal}'") == "0":
            psql(admin, f"create role {quoted} nologin")
    with tempfile.TemporaryDirectory(prefix="elos-restore-") as tmp:
        dump = Path(tmp) / "restore.dump"
        gpg(["--decrypt", "--output", str(dump), str(folder / archive)])
        if digest(dump) != manifest["dump_sha256"]:
            raise ValueError("Checksum do dump descriptografado divergente")
        psql(admin, f'create database "{name}"')
        # --exit-on-error e transação única: nenhuma falha é absorvida por || true.
        run(client("pg_restore") + ["--exit-on-error", "--single-transaction", "--no-owner", "-d", target], data=dump.read_bytes(), operation="pg_restore")
    for table in manifest["tables"]:
        schema = '"' + table["schema"].replace('"', '""') + '"'
        relation = '"' + table["name"].replace('"', '""') + '"'
        count = psql(target, f"select count(*) from {schema}.{relation}")
        if count != str(table["count"]):
            raise RuntimeError("Contagem restaurada divergente; restauração não certificada")
    print(f"Restauração verificada: {len(manifest['tables'])} tabelas; destino local {name}; nenhum erro ignorado")


if __name__ == "__main__":
    try:
        if not os.environ.get("BACKUP_PASSPHRASE"):
            raise ValueError("BACKUP_PASSPHRASE ausente")
        os.environ.setdefault("PGSSLMODE", "require")
        os.environ.setdefault("PGCONNECT_TIMEOUT", "10")
        folder = Path(os.environ.get("BACKUP_OUT_DIR", "backup")).resolve()
        folder.mkdir(parents=True, exist_ok=True)
        (backup if sys.argv[1] == "backup" else restore)(folder)
    except (KeyError, ValueError, RuntimeError, OSError) as error:
        print(f"FALHA: {error}", file=sys.stderr)
        sys.exit(1)
