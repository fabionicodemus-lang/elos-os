export type ImportField = [string,string,string];
export type ImportRow = Record<string,string|number|null>;
export type FeasibilityImport = {study:ImportRow;reported:ImportRow;unit_types:ImportRow[];construction_areas:ImportRow[];observations:{label:string;value:string;source:string}[];warnings:string[]};
export const studyFields:ImportField[]; export const reportedFields:ImportField[]; export const unitFields:ImportField[]; export const areaFields:ImportField[];
export function normalizeFeasibilityImport(input:unknown):FeasibilityImport;
export function feasibilityImportWarnings(input:FeasibilityImport):string[];

export function isFeasibilityImportRequest(question:unknown,names?:string[]):boolean;
