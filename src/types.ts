import type {WorkSheet} from "node-xlsx";
import type {SchematicDataMap} from "./utils";

export interface ExportData {
    ret: number;
    msg: string;
    operationId: string;
}

export interface QueryData {
    status: "Processing" | "Done";
    progress: number;
    file_url?: string;
    file_name?: string;
    file_size?: number;
}

export interface ContextData {
    qqCookies: string;
    outPath: string;
    lastData: SchematicDataMap;
    data: SchematicDataMap;
}

export interface SchematicMeta {
    category: string;
    name: string;
    author: string;
    base64: string;
}

export interface SavedData {
    updateDate: number;
    schematics: number;
    data: SchematicMeta[];
}

export type ExcelSheetsData = Omit<WorkSheet, "options">[];
