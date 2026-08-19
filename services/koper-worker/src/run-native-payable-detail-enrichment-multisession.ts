import { spawn } from "node:child_process";
const rounds=Math.max(1,Math.min(120,Number(process.env.KOPER_DETAIL_ROUNDS??110)||110));
const batch=Math.max(1,Math.min(150,Number(process.env.KOPER_DETAIL_BATCH_SIZE??40)||40));
console.log("KOPER_DETAIL_MULTISESSION_START",JSON.stringify({rounds,batch}));
let successes=0,failures=0;
for(let round=1;round<=rounds;round++){
 console.log("KOPER_DETAIL_MULTISESSION_ROUND_START",JSON.stringify({round}));
 const code=await new Promise<number>(resolve=>{const child=spawn(process.execPath,["dist/stage-native-payable-detail-enrichment.js"],{stdio:"inherit",env:{...process.env,KOPER_DETAIL_BATCH_SIZE:String(batch)}});child.on("exit",c=>resolve(c??1));child.on("error",()=>resolve(1));});
 if(code===0)successes++;else{failures++;await new Promise(r=>setTimeout(r,2500));}
 console.log("KOPER_DETAIL_MULTISESSION_ROUND_DONE",JSON.stringify({round,code,successes,failures}));
}
console.log("KOPER_DETAIL_MULTISESSION_DONE",JSON.stringify({rounds,successes,failures}));
process.exitCode=failures===rounds?1:0;