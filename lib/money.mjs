// Decimal textual -> centavos inteiros. Não usa multiplicação binária por 100.
function rational(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'number' && !Number.isFinite(value))) throw new TypeError('Valor monetário inválido');
  const text=String(value).trim();
  if(text.length>200)throw new RangeError('Precisão fora do limite');
  const match=/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if(!match)throw new TypeError('Decimal inválido');
  const exponent=Number(match[4]??0)-(match[3]?.length??0);
  if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>1000)throw new RangeError('Expoente fora do limite');
  const coefficient=BigInt(match[2]+(match[3]??''))*(match[1]==='-'?-1n:1n);
  return exponent>=0?[coefficient*10n**BigInt(exponent),1n]:[coefficient,10n**BigInt(-exponent)];
}
function safe(value) {
  if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER))throw new RangeError('Centavos fora do intervalo seguro');
  return Number(value);
}
export function decimalToCents(value,{rounding}={}) {
  if(value===null||value===undefined)return null;
  if(rounding!=='half-away-from-zero')throw new TypeError('Informe a convenção de arredondamento');
  let [n,d]=rational(value);n*=100n;
  const negative=n<0n;if(negative)n=-n;
  const rounded=n/d+((n%d)*2n>=d?1n:0n);
  return safe(negative?-rounded:rounded);
}
export function allocateCents(totalCents,rows) {
  if(!Number.isSafeInteger(totalCents)||totalCents<0)throw new RangeError('Total inválido');
  const weights=rows.map(r=>rational(r.weight));
  if(weights.some(([n])=>n<0n))throw new RangeError('Peso negativo');
  const common=weights.reduce((max,[,d])=>d>max?d:max,1n);
  const units=weights.map(([n,d])=>n*(common/d));
  const sum=units.reduce((a,b)=>a+b,0n);
  if(sum===0n)return rows.map(()=>0);
  const numerators=units.map(w=>w*BigInt(totalCents));
  const values=numerators.map(n=>n/sum);
  let remaining=BigInt(totalCents)-values.reduce((a,b)=>a+b,0n);
  const order=rows.map((r,i)=>({i,key:String(r.id??String(i).padStart(12,'0')),remainder:numerators[i]%sum}));
  order.sort((a,b)=>a.remainder===b.remainder?(a.key<b.key?-1:a.key>b.key?1:a.i-b.i):(a.remainder>b.remainder?-1:1));
  for(const row of order){if(remaining===0n)break;values[row.i]++;remaining--;}
  return values.map(safe);
}
