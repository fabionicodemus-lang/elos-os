import { spawn } from "node:child_process";
const rounds=Math.max(1,Math.min(20,Number(process.env.KOPER_RESOLUTION_ROUNDS??8)||8));
const batch=String(Math.max(10,Math.min(50,Number(process.env.KOPER_RESOLUTION_INNER_BATCH??40)||40)));
const concurrency=String(Math.max(1,Math.min(6,Number(process.env.KOPER_RESOLUTION_INNER_CONCURRENCY??4)||4)));
console.log("KOPER_V2_MULTISESSION_START",JSON.stringify({rounds,batch,concurrency}));
let successes=0,failures=0;
for(let i=0;i<rounds;i++){
  const code=await new Promise<number>((resolve)=>{const child=spawn(process.execPath,["dist/resolve-native-payables-to-staging-v2.js"],{stdio:"inherit",env:{...process.env,KOPER_RESOLUTION_BATCH_SIZE:batch,KOPER_RESOLUTION_CONCURRENCY:concurrency}});child.on("exit",c=>resolve(c??1));child.on("error",()=>resolve(1));});
  if(code===0)successes++;else failures++;
  console.log("KOPER_V2_MULTISESSION_ROUND",JSON.stringify({round:i+1,code,successes,failures}));
}
console.log("KOPER_V2_MULTISESSION_DONE",JSON.stringify({rounds,successes,failures}));
await new Promise(r=>setTimeout(r,1200));
