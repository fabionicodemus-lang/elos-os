// Shared extraction/review contract. Blank values remain unknown, never zero.
export const studyFields = [
 ['name','Nome do estudo','text'],['code','Código','text'],['city','Cidade','text'],['state','UF','text'],
 ['tax_regime','Regime tributário','text'],['project_type','Tipo de empreendimento','text'],['construction_start_date','Início da obra','date'],['construction_duration_months','Duração da obra (meses)','integer'],
 ['apartment_cost_m2','Custo dos apartamentos (R$/m²)','number'],['design_cost_m2','Projetos (R$/m²)','number'],
 ['land_cash_amount','Terreno em dinheiro (R$)','number'],['iptu_amount','IPTU (R$)','number'],['onerous_grant_amount','Outorga (R$)','number'],['other_land_amount','Outros custos do terreno (R$)','number'],
 ['commission_pct','Comissão (%)','number'],['tax_rate_pct','Tributos sobre vendas (%)','number'],['marketing_amount','Marketing (R$)','number'],['central_office_amount','Administração central (R$)','number'],['financial_cost_amount','Custo financeiro (R$)','number'],['contingency_pct','Contingência (%)','number'],
 ['preconstruction_months','Pré-obra (meses)','integer'],['sales_start_offset_months','Início das vendas (meses relativos à obra)','integer'],['sales_velocity_units_month','Velocidade de vendas (unidades/mês)','number'],
 ['entry_pct','Entrada (%)','number'],['during_construction_pct','Durante a obra (%)','number'],['keys_pct','Chaves (%)','number'],['post_keys_pct','Pós-chaves (%)','number'],['post_keys_months','Pós-chaves (meses)','integer'],['discount_rate_annual_pct','Taxa de desconto anual (%)','number'],
 ['vgv_cub_index_name','Índice CUB-base do VGV','text'],['vgv_cub_reference_month','Competência CUB do VGV','date'],['vgv_cub_base_value','CUB-base do VGV (R$)','number'],['cost_cub_index_name','Índice CUB-base dos custos','text'],['cost_cub_reference_month','Competência CUB dos custos','date'],['cost_cub_base_value','CUB-base dos custos (R$)','number'],['notes','Observações do estudo','text'],
];
export const reportedFields=[['reference_date','Data do documento','date'],['vgv','VGV declarado (R$)','number'],['total_cost','Custo total declarado (R$)','number'],['profit','Lucro declarado (R$)','number'],['margin_pct','Margem declarada (%)','number'],['total_units','Unidades declaradas','integer']];
export const unitFields=[['name','Tipologia','text'],['quantity','Quantidade','integer'],['private_area_m2','Área privativa por unidade (m²)','number'],['sale_price_m2','Preço de venda (R$/m²)','number'],['barter_units','Unidades de permuta','integer'],['source','Página / referência','text']];
export const areaFields=[['name','Área / serviço','text'],['area_m2','Área construída (m²)','number'],['cost_m2','Custo (R$/m²)','number'],['source','Página / referência','text']];
const record=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
function value(v,type,label){
 if(v==null||v==='')return null;
 if(type==='text')return String(v).trim().slice(0,4000)||null;
 if(type==='date'){const s=String(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw Error(`Data inválida: ${label}.`);return s;}
 const raw=typeof v==='string'?v.trim().replace(/\s/g,''):v;
 const n=Number(typeof raw==='string'&&raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw);
 if(!Number.isFinite(n)||Math.abs(n)>1e12||type==='integer'&&!Number.isInteger(n))throw Error(`Número inválido: ${label}.`);
 return n;
}
function fields(input,defs){const r=record(input);return Object.fromEntries(defs.map(([k,label,type])=>[k,value(r[k],type,label)]));}
export function normalizeFeasibilityImport(input){
 const p=record(input);const list=(key,defs)=>{if(p[key]!=null&&!Array.isArray(p[key]))throw Error(`Lista inválida: ${key}.`);if((p[key]?.length??0)>150)throw Error('Limite de 150 linhas por grupo.');return (p[key]??[]).map(r=>fields(r,defs));};
 const study=fields(p.study,studyFields);
 if(study.state)study.state=study.state.toUpperCase();
 if(study.tax_regime&&!['ret','common'].includes(study.tax_regime))throw Error('Regime tributário inválido.');
 if(study.project_type&&!['residential','commercial','mixed','land','industrial','other'].includes(study.project_type))throw Error('Tipo de empreendimento inválido.');
 for(const [k,v] of Object.entries(study)){if(typeof v==='number'&&v<0&&!['sales_start_offset_months','discount_rate_annual_pct'].includes(k))throw Error(`Valor negativo inválido: ${k}.`);if(k.endsWith('_pct')&&k!=='discount_rate_annual_pct'&&v!=null&&v>100)throw Error(`Percentual inválido: ${k}.`);}
 return {study,reported:fields(p.reported,reportedFields),unit_types:list('unit_types',unitFields),construction_areas:list('construction_areas',areaFields),observations:(Array.isArray(p.observations)?p.observations:[]).slice(0,150).map(r=>({label:String(r?.label??'').slice(0,300),value:String(r?.value??'').slice(0,4000),source:String(r?.source??'').slice(0,300)})),warnings:(Array.isArray(p.warnings)?p.warnings:[]).slice(0,50).map(v=>String(v).slice(0,1000))};
}
export function feasibilityImportWarnings(p){
 const warnings=[...p.warnings];const payment=['entry_pct','during_construction_pct','keys_pct','post_keys_pct'].map(k=>p.study[k]);
 if(payment.some(v=>v==null))warnings.push('Forma de recebimento incompleta: permanecerá como pendência; não será inferida do cadastro atual.');
 else if(Math.abs(payment.reduce((a,b)=>a+b,0)-100)>0.0001)warnings.push('Os percentuais de recebimento não somam 100%; corrija antes de confirmar.');
 if(p.unit_types.some(r=>!r.name||!r.quantity||!r.private_area_m2||!r.sale_price_m2||r.barter_units==null))warnings.push('Tipologias incompletas ficam preservadas na memória da importação até complementação.');
 if(p.construction_areas.some(r=>!r.name||r.area_m2==null||r.cost_m2==null))warnings.push('Áreas/custos incompletos ficam preservados na memória da importação.');
 if(p.reported.vgv!=null&&p.reported.total_cost!=null&&p.reported.profit!=null&&Math.abs(p.reported.vgv-p.reported.total_cost-p.reported.profit)>1)warnings.push('VGV menos custo total difere do lucro declarado. Confira a base do VGV, permutas e custos do documento.');
 if(p.reported.total_units!=null&&p.unit_types.length&&p.unit_types.every(r=>r.quantity!=null)&&p.unit_types.reduce((n,r)=>n+r.quantity,0)!==p.reported.total_units)warnings.push('A soma das quantidades das tipologias difere do total de unidades declarado.');
 if(!p.unit_types.length)warnings.push('O documento ainda não possui tipologias estruturadas para a simulação.');
 return [...new Set(warnings)];
}

export function isFeasibilityImportRequest(question,names=[]){
 const q=String(question??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const docs=names.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return names.length>0&&/viabilidade/.test(q+' '+docs)&&/\b(lanc|import|cadastr|registr|prepar|preench)/.test(q);
}
