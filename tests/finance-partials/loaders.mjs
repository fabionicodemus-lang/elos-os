import {compile} from '../financeiro/runtime.mjs';
import * as titles from '../../lib/finance-core/titles.mjs';
import * as core from '../../lib/finance-core/cashflow.mjs';
import * as coverage from '../../lib/finance-core/coverage.mjs';
import * as position from '../../lib/finance-core/ledger-position.mjs';
import * as due from '../../lib/finance-core/due.mjs';
import * as native from '../../lib/cost-vs-budget/native-allocation.mjs';
const pagination=compile('lib/supabase-pagination.ts');
export const {loadCashflow}=compile('lib/finance-core/cashflow-server.ts',{
 '@/lib/supabase-pagination':pagination,'./titles.mjs':titles,'./cashflow.mjs':core,
 './coverage.mjs':coverage,'./ledger-position.mjs':position,'./due.mjs':due});
const nativeTitles=compile('lib/cost-vs-budget/native-measurement-titles.ts',{
 '@/lib/finance-core/titles.mjs':titles,'@/lib/supabase-pagination':pagination,'./native-allocation.mjs':native});
export const {loadCostVsBudget}=compile('lib/cost-vs-budget/server.ts',{
 '@/lib/finance-core/titles.mjs':titles,'@/lib/supabase-pagination':pagination,'./native-measurement-titles':nativeTitles});
