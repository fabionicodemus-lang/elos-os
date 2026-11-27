import assert from 'node:assert/strict';
import test from 'node:test';
import { convertEobraCheckpoint, reconstructEobraCheckpoint } from '../../lib/eobra-import/checkpoint.mjs';

test('contact boundary whitespace does not block a valid person; malformed addresses remain blocked and raw evidence survives', () => {
  const data = { schema:'eobra.ui-checkpoint.v1', sourceHost:'synthetic.eobra.example', capturedAt:'2026-11-27T00:00:00Z', capturedOn:'2026-11-27', captures:{
    projects:[{id:'p1',name:'Synthetic'}],
    people:{headers:['Nome','E-mail','Status'], rows:[['c1','  valid@example.org  '],['c2','bad@exam ple.org']].map(([id,email])=>({id,class:'person',cells:[{value:'Synthetic '+id},{value:JSON.stringify([{title:email}])},{value:'Ativo'}]}))},
    personDetails:['c1','c2'].map(sourceId=>({sourceId,normalized:{roles:['client']}}))
  }};
  const out=convertEobraCheckpoint(data);
  const ok=out.snapshot.records.find(r=>r.entity==='person'&&r.sourceId==='c1');
  assert.equal(ok.normalized.email,'valid@example.org');
  assert.equal(ok.normalized.source_emails[0].title,'  valid@example.org  ');
  assert.ok(out.report.pendingDetails.find(r=>r.entity==='person'&&r.sourceId==='c2').fields.includes('email'));
  assert.deepEqual(reconstructEobraCheckpoint(out.snapshot),data);
});
