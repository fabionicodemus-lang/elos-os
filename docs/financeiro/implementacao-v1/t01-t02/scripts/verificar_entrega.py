"""Verifica integridade da entrega documental, sem validar financeiramente o app."""
from pathlib import Path
import hashlib
import json
import re

import openpyxl

root = Path(__file__).resolve().parent.parent
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
manifest = json.loads((root / "manifesto-entrega.json").read_text())
for name, expected in manifest["files_sha256"].items():
    assert digest(root / name) == expected, name

parameters = json.loads((root / "parametros.json").read_text())
assert {row["id"] for row in parameters["decisions"]} == {f"D{n:02}" for n in range(1, 15)}
for row in parameters["decisions"]:
    assert row["operational_value"] is None and row["approved_by"] is None
    assert row["effective_from"] is None and row["financial_acceptance"] == "Pendente"
    assert row["affected_tasks"] and row["related_case_ids"]

findings = json.loads((root / "matriz-diagnostico.json").read_text())
assert {row["id"] for row in findings} == {f"E{n:02}" for n in range(1, 20)}
assert all(row["classification"] in "abcd" and row["reexecution_recipe"] for row in findings)
probes = json.loads((root / "evidencias/sondas.json").read_text())
assert len(probes["probes"]) == 9 and all(p["diagnostic_reproduced"] for p in probes["probes"])
assert probes["package_cases_certified"] == []
for file in root.glob("*.md"):
    for target in re.findall(r"\]\(([^)]+)\)", file.read_text()):
        if not target.startswith("http"):
            assert (file.parent / target.split("#")[0]).exists(), (file, target)

context = json.loads((root / "evidencias/contexto.json").read_text())
original_path = Path(next(s["path"] for s in context["sources"] if s["name"].endswith(".xlsx")))
board_check = json.loads((root / "evidencias/verificacao-quadro.json").read_text())
assert digest(original_path) == board_check["original_sha256"]
original = openpyxl.load_workbook(original_path)
updated = openpyxl.load_workbook(root / "Elos_OS_Quadro_Implementacao_v1_T01_T02.xlsx")
allowed = set(board_check["modified_cells"])
for sheet in original:
    for row in sheet:
        for cell in row:
            if f"{sheet.title}!{cell.coordinate}" not in allowed:
                assert updated[sheet.title][cell.coordinate].value == cell.value, (sheet.title, cell.coordinate)
for row in [11, 12]:
    assert updated["Acompanhamento"][f"F{row}"].value == "Em validação"
    assert updated["Acompanhamento"][f"J{row}"].value == "Pendente"
assert updated["Acompanhamento"]["N12"].value == "Pendente"
print("Integridade documental: hashes, 19 achados, 14 parâmetros, 9 sondas, links e quadro conferidos.")
print("Expected e aceites preservados. Esta verificação não certifica CTs, dados reais ou conclusão financeira.")
