import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateSharedAmount, buildMeasurementPreview, matchUniqueCandidate } from "./action-utils.mjs";

test("match identifica item único por código ou descrição e recusa ambiguidade", () => {
  const rows = [
    { id:"1", code:"MAT-001", name:"Cimento CP II 50kg" },
    { id:"2", code:"MAT-002", name:"Argamassa ACIII" },
  ];
  assert.equal(matchUniqueCandidate("MAT-001", rows, row => [row.code,row.name]).match?.id, "1");
  assert.equal(matchUniqueCandidate("argamassa aciii", rows, row => [row.code,row.name]).match?.id, "2");
  const ambiguous = matchUniqueCandidate("cimento", [...rows,{id:"3",code:"MAT-003",name:"Cimento CP V 50kg"}], row => [row.code,row.name]);
  assert.equal(ambiguous.reason, "ambiguous");
  assert.equal(ambiguous.match, null);
});

test("rateio de frete preserva exatamente o total", () => {
  const parts = allocateSharedAmount(123.45, [100,200,300]);
  assert.equal(parts.length, 3);
  assert.equal(Math.round(parts.reduce((sum,value)=>sum+value,0)*100)/100, 123.45);
  assert.ok(parts[2] > parts[1] && parts[1] > parts[0]);
});

test("preview de medição calcula retenções e bloqueia estouro", () => {
  const result = buildMeasurementPreview({
    contract:{ current_value:10000, measured_value:7000, retention_percent:5, guarantee_percent:2 },
    items:[{ id:"i1", contracted_quantity:10, measured_quantity:8, current_quantity:3, unit_price:1000 }],
    taxWithholding:100,
    otherDiscount:50,
  });
  assert.equal(result.gross, 3000);
  assert.equal(result.contractualRetention, 150);
  assert.equal(result.guaranteeRetention, 60);
  assert.equal(result.deductions, 360);
  assert.equal(result.net, 2640);
  assert.equal(result.overContract, true);
  assert.equal(result.overItem, true);
});

test("preview de medição mantém operação normal sem estouro", () => {
  const result = buildMeasurementPreview({
    contract:{ current_value:20000, measured_value:5000, retention_percent:5, guarantee_percent:0 },
    items:[{ id:"i1", contracted_quantity:20, measured_quantity:5, current_quantity:2, unit_price:500 }],
  });
  assert.equal(result.gross, 1000);
  assert.equal(result.net, 950);
  assert.equal(result.overContract, false);
});
