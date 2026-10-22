// Independent expected matrix, derived from the declared fixture configuration
// and pinned repository defaults. Never infer expected from has_company_permission.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=process.env.FINANCE14_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa14-isolamento/evidencias';
const expected={
 admin:['payables.view','payables.manage','receivables.view','receivables.manage','finance.bank_accounts.view','cashflow.view','execution.contracts.view','execution.contracts.manage'],
 finance:['payables.view','payables.manage','receivables.view','receivables.manage','finance.bank_accounts.view','cashflow.view','execution.contracts.view'],
 viewer:['payables.view','receivables.view','finance.bank_accounts.view','execution.contracts.view'],
 engineering:['execution.contracts.view','execution.contracts.manage'],
};
const measured=JSON.parse(fs.readFileSync(root+'/permissoes.json'));
assert.equal(measured.length,64);
const rows=measured.map(r=>({...r,expected_own:expected[r.identity.profile].includes(r.permission),passed:r.observed_own===expected[r.identity.profile].includes(r.permission)&&r.observed_foreign===false,
 source_refs:['tests/financeiro/runtime.mjs:bootstrap existing finance/viewer grants','20260722_0001_multitenancy.sql:bootstrap_company defaults','20260728_0038_execution_service_contracts.sql:profile contract grants','20260810_0081_owner_admin_full_access.sql:has_company_permission','tests/cashflow/setup.mjs:existing fixture cashflow grants'],
 business_acceptance:'Não é matriz nominal aprovada para empresas reais. Engenharia não recebe permissões bancárias/AP/AR por inferência.'}));
fs.writeFileSync(root+'/matriz-permissoes.json',JSON.stringify(rows,null,2)+'\n');
assert.ok(rows.every(r=>r.passed),JSON.stringify(rows.filter(r=>!r.passed)));
console.log('64 comparações de permissões próprias/estrangeiras conformes com a matriz independente da fixture.');
