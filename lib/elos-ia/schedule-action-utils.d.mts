export type ScheduleMatchable={id:string;code:string;name:string;location?:string;locationCode?:string;serviceName?:string;serviceCode?:string};
export function normalizeScheduleTerm(value:unknown):string;
export function validScheduleDate(value:unknown):boolean;
export function matchScheduleActivity<T extends ScheduleMatchable>(request:unknown,location:unknown,activities:T[]):{
  match:T|null;reason:string|null;candidates:Array<{code:string;name:string;location:string|undefined}>;
};
export type ScheduleLatest={
  id:string;measurement_date:string;updated_at:string;progress_percent:number;
  current_start:string;current_finish:string;actual_start:string|null;actual_finish:string|null;
  actual_quantity:number;actual_cost:number;team_count:number|null;
};
export type ScheduleDraft={percentual:number|null;novo_inicio:string|null;novo_fim:string|null;observacoes:string|null};
export function planScheduleRow(item:ScheduleDraft,activity:{id:string;code:string;planned_start:string;planned_finish:string},latest:ScheduleLatest|null,measurementDate:string):{
 activityId:string;code:string;measurementDate:string;progressPercent:number;
 currentStart:string;currentFinish:string;actualStart:string|null;actualFinish:string|null;
 actualQuantity:number;actualCost:number;teamCount:number|null;notes:string;
 expectedLatestId:string|null;expectedLatestUpdatedAt:string|null;
 previousPercent:number;previousStart:string;previousFinish:string;
};
