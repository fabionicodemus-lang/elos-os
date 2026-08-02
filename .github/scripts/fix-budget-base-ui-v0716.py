from pathlib import Path

path = Path('.github/scripts/apply-budget-base-ui-v0716.py')
text = path.read_text(encoding='utf-8')
old = '''        '{canManage && budget.status !== \"archived\" ? (',
        '{canManage && budget.status !== \"archived\" && !budget.is_base ? (','''
new = '''        '{canManage && budget.status !== \"archived\" ? (\\n            <form action={archiveBudget}>',
        '{canManage && budget.status !== \"archived\" && !budget.is_base ? (\\n            <form action={archiveBudget}>','''
if text.count(old) != 1:
    raise RuntimeError(f'bloco do botão arquivar não localizado: {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
