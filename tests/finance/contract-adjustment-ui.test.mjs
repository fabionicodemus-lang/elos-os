import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';

function load(path, modules) {
  const code = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react') return React;
    assert.ok(modules[name], `Unmocked dependency ${name}`); return modules[name];
  }, Date, Intl, Map });
  return exports;
}
const noAction = async () => {};
test('contract form defaults to preserving existing installments and exposes two independent phases', () => {
  const { ContractAdjustmentForm } = load('components/contract-adjustment-form.tsx', { '@/app/comercial/vendas/adjustment-actions': { saveContractAdjustments: noAction } });
  const props = { saleId: 'sale-test', saleDate: '2026-09-01', policy: null, indices: [{ id: 'cub', code: 'CUB-SC', name: 'Teste' }], canApply: false };
  const html = renderToStaticMarkup(React.createElement(ContractAdjustmentForm, props));
  assert.match(html, /name="pre_index_id"/); assert.match(html, /name="post_index_id"/);
  assert.match(html, /value="false" selected="">Preservar todas/);
  assert.doesNotMatch(html, /Aplicar também às parcelas abertas/);
  assert.match(html, /name="reason" required="" minLength="5"/);
  assert.match(html, /após|Após/);
  const authorized = renderToStaticMarkup(React.createElement(ContractAdjustmentForm, { ...props, canApply: true }));
  assert.match(authorized, /Aplicar também às parcelas abertas elegíveis/);
  assert.match(authorized, /value="false" selected="">Preservar todas/);
});
test('project page has independent defaults and preserves existing budgets by default', async () => {
  const fake = { projects: { id: 'project', name: 'Obra de teste' }, project_adjustment_settings: null, correction_indices: [], engineering_budgets: [], adjustment_policy_events: [] };
  const from = table => { let q; q = new Proxy({}, { get: (_, key) => key === 'then' ? resolve => Promise.resolve({ data: fake[table], error: null }).then(resolve) : () => q }); return q; };
  const { default: Page } = load('app/empreendimentos/[projectId]/reajustes/page.tsx', {
    'next/link': { __esModule: true, default: ({ children, prefetch: _prefetch, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { notFound: () => { throw Error('Not found'); } },
    '@/components/app-shell': { AppShell: ({ children }) => React.createElement('main', null, children) },
    '@/lib/workspace': { requireCompanyPermission: async () => ({ supabase: { from, rpc: async () => ({ data: true }) }, company: { name: 'Teste' }, companyId: 'company' }) },
    './actions': { saveProjectAdjustments: noAction },
  });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ projectId: 'project' }), searchParams: Promise.resolve({}) }));
  assert.match(html, /name="budget_enabled"/); assert.match(html, /name="installments_enabled"/);
  assert.match(html, /value="false" selected="">Não, preservar configurações atuais/);
  assert.match(html, /contratos existentes são preservadas/);
});
