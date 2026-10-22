// SQL transport for the real loaders, under authenticated role/RLS in disposable PostgreSQL.
// This is not PostgREST/Auth/browser certification. select() returns source rows;
// embedded display-only joins are not emulated. Filters, paging and ordering execute in SQL.
import {sql,asUser} from '../financeiro/runtime.mjs';
export const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
export const json=o=>quote(JSON.stringify(o))+'::jsonb';
export const lastJson=s=>JSON.parse(s.split('\n').findLast(l=>l.startsWith('{')||l.startsWith('[')));
const ident=s=>{if(!/^[a-z_][a-z_0-9]*$/.test(s))throw Error('Identificador inválido');return '"'+s+'"';};
export function sqlClient(container,user){
 class Query{
  constructor(table){this.table=ident(table);this.filters=[];this.orders=[];this.offset=0;this.count=null;this.single=false;}
  select(){return this;}
  eq(k,v){this.filters.push(`${ident(k)}=${quote(v)}`);return this;}
  neq(k,v){this.filters.push(`${ident(k)}<>${quote(v)}`);return this;}
  gt(k,v){this.filters.push(`${ident(k)}>${quote(v)}`);return this;}
  in(k,values){this.filters.push(values.length?`${ident(k)} in (${values.map(quote).join(',')})`:'false');return this;}
  not(k,op,v){if(op!=='is'||v!==null)throw Error('Operador não suportado');this.filters.push(`${ident(k)} is not null`);return this;}
  order(k,options={}){this.orders.push(ident(k)+(options.ascending===false?' desc':' asc'));return this;}
  range(a,b){this.offset=a;this.count=b-a+1;return this;}
  limit(n){this.count=n;return this;}
  maybeSingle(){this.single=true;return this;}
  async run(){
   const query=`select * from public.${this.table} where ${this.filters.join(' and ')||'true'}${this.orders.length?' order by '+this.orders.join(','):''}${this.count===null?'':' limit '+this.count} offset ${this.offset}`;
   try{const rows=lastJson(await sql(container,asUser(user,`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (${query}) t`)));
    if(this.single&&rows.length>1)throw Error('Mais de uma linha');return {data:this.single?rows[0]??null:rows,error:null};
   }catch(e){return {data:null,error:{message:e.message}};}
  }
  then(resolve,reject){return this.run().then(resolve,reject);}
 }
 return {from:t=>new Query(t),rpc:async(name,args)=>{
  if(!['list_unassigned_obligations','finance_entity_scope'].includes(name))throw Error('RPC fora do contrato do adaptador');
  try{const call=name==='list_unassigned_obligations'?`list_unassigned_obligations(${quote(args.p_company)})`:`finance_entity_scope(${quote(args.p_company)},${quote(args.p_entity)},false)`;
   const out=await sql(container,asUser(user,`select to_jsonb(${call})`));
   return {data:JSON.parse(out.split('\n').findLast(l=>/^(true|false|\[|\{)/.test(l))),error:null};}
  catch(e){return {data:null,error:{message:e.message}};}
 }};
}
