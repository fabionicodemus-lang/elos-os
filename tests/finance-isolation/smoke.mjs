import fs from 'node:fs';
import {stack} from './stack.mjs';
import {setup,storagePolicies} from './setup.mjs';
const root=process.env.FINANCE14_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa14-isolamento/evidencias';
fs.mkdirSync(root,{recursive:true});let service;
try{
 console.log('Iniciando Auth real');service=await stack(root);console.log('Instalando base financeira existente');
 const data=await setup(service.db,service.actors);console.log('Iniciando PostgREST e Storage reais');
 const http=await service.startHTTP();const policies=await storagePolicies(service.db);
 console.log(JSON.stringify({ready:true,images:service.images,companies:data,storage:policies}));
 fs.writeFileSync(root+'/smoke.json',JSON.stringify({ready:true,images:service.images,companies:data,storage:policies},null,2)+'\n');
 console.log('Iniciando Next real');console.log(await service.nextApp(http.gatewayURL));
}catch(e){console.error(service?service.redact(e.stack):e.message);process.exitCode=1;}
finally{if(service)await service.close();}
