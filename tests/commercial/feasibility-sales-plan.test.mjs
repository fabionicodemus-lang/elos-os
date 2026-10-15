import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateFeasibility } from "../../lib/commercial/feasibility.mjs";

const study = {
  apartment_cost_m2:2500, design_cost_m2:100,
  land_cash_amount:1_000_000, iptu_amount:0, onerous_grant_amount:0, other_land_amount:0,
  commission_pct:6, tax_rate_pct:4, contingency_pct:5,
  marketing_amount:100_000, central_office_amount:100_000, financial_cost_amount:0,
  preconstruction_months:6, construction_duration_months:30,
  sales_start_offset_months:-3, sales_velocity_units_month:2,
  entry_pct:10, during_construction_pct:40, keys_pct:20, post_keys_pct:30, post_keys_months:24,
  discount_rate_annual_pct:15,
};
const units = [{ name:"Tipo", quantity:50, private_area_m2:70, sale_price_m2:10_000, barter_units:0 }];

function phase(id, key, start, target, velocity, appreciation, entry=10, monthly=80, keys=10, installments=100, sort=10) {
  return {
    id, name:key, phase_key:key, start_offset_months:start, target_units_pct:target,
    units_per_month:velocity, price_appreciation_pct:appreciation,
    entry_pct:entry, monthly_pct:monthly, keys_pct:keys, monthly_installments:installments, sort_order:sort,
  };
}

test("plano em cinco fases aplica valorização progressiva ao VGV", () => {
  const legacy = calculateFeasibility(study, units);
  const phased = calculateFeasibility(study, units, { salesVelocities:[
    phase("1","prelaunch",-6,20,5,0,10,80,10,100,10),
    phase("2","launch",-3,20,5,5,10,80,10,90,20),
    phase("3","construction_start",0,20,5,5,15,75,10,80,30),
    phase("4","mid_construction",15,20,5,5,20,70,10,60,40),
    phase("5","ready",30,20,5,5,30,60,10,36,50),
  ]});

  assert.equal(phased.sales_velocity_phases, 5);
  assert.ok(phased.available_vgv > legacy.available_vgv);
  assert.ok(phased.sales_price_multiplier_avg > 1);
  const sold = phased.cashflow.reduce((sum,row) => sum + row.sales, 0);
  const receipts = phased.cashflow.reduce((sum,row) => sum + row.receipts, 0);
  assert.ok(Math.abs(sold - phased.available_vgv) < 0.01);
  assert.ok(Math.abs(receipts - phased.available_vgv) < 0.01);
});

test("condição da fase distribui saldo nas parcelas mensais informadas", () => {
  const phased = calculateFeasibility(study, units, { salesVelocities:[
    phase("1","prelaunch",-6,100,50,0,10,80,10,100,10),
    phase("2","launch",-3,0,5,0,10,80,10,90,20),
    phase("3","construction_start",0,0,5,0,10,80,10,80,30),
    phase("4","mid_construction",15,0,5,0,10,80,10,60,40),
    phase("5","ready",30,0,5,0,10,80,10,36,50),
  ]});

  assert.ok(phased.cashflow.length >= 100);
  const receipts = phased.cashflow.reduce((sum,row) => sum + row.receipts, 0);
  assert.ok(Math.abs(receipts - phased.available_vgv) < 0.01);
});

test("meta que não cabe na janela carrega estoque para a fase seguinte sem perder unidades", () => {
  const phased = calculateFeasibility(study, units, { salesVelocities:[
    phase("1","prelaunch",-6,60,1,0,10,80,10,24,10),
    phase("2","launch",-3,10,10,5,10,80,10,24,20),
    phase("3","construction_start",0,10,10,5,10,80,10,24,30),
    phase("4","mid_construction",15,10,10,5,10,80,10,24,40),
    phase("5","ready",30,10,10,5,10,80,10,24,50),
  ]});

  const soldValue = phased.cashflow.reduce((sum,row) => sum + row.sales, 0);
  assert.ok(Math.abs(soldValue - phased.available_vgv) < 0.01);
  assert.ok(phased.sales_end_month >= phased.sales_start_month);
});
