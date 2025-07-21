import {readFile, rm} from "fs/promises";
import path from "path";
import XLSX from "node-xlsx";
import {SchematicData, SchematicDataMap, startPolling} from "./utils";

import blacklist from "../blacklist.json";
import type {
    ContextData,
    ExcelSheetsData,
    ExportData,
    QueryData,
    SavedData,
} from "./types";

const context: ContextData = {
    outPath: "./schematics",
    qqCookies: Bun.env["QQ_DOC_COOKIES"]!,
    lastData: new SchematicDataMap(),
    data: new SchematicDataMap(),
};

const DOC_ID = "300000000%24AaAsqrinCIuL";

run();

async function run() {
    context.outPath = path.resolve(context.outPath);

    const {outPath, lastData, data} = context;

    const savedDataPath = path.join(outPath, "data.json");
    const savedData = await readData(savedDataPath);
    if (savedData) {
        lastData.setData(
            savedData.data.map((meta) => SchematicData.copy(meta))
        );
        await retainValidData(outPath, lastData);
    }

    const excelSheetsData = await readExcel();
    if (excelSheetsData === undefined) {
        console.error("Failed to parse excel data.");
        return;
    }
    data.setData(await parseExcelData(excelSheetsData));

    await genSchematics(outPath, data, lastData);
    await deleteOldSchematics(outPath, data, lastData);
    if (anyChange(data, lastData)) await saveData(savedDataPath, data);
}

async function fetchSchematicsExcel() {
    let resp = await fetch("https://docs.qq.com/v1/export/export_office", {
        headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            cookie: context.qqCookies,
        },
        body: `exportType=0&switches=%7B%22embedFonts%22%3Afalse%7D&docId=${DOC_ID}`,
        method: "POST",
    });

    let json: ExportData = (await resp.json()) as ExportData;
    if (json.ret != 0) {
        throw new Error(json.msg);
    }

    let operationId = json.operationId;
    const data = await startPolling(
        async () => {
            const resp = await fetch(
                `https://docs.qq.com/v1/export/query_progress?operationId=${operationId}`,
                {
                    headers: {
                        cookie: context.qqCookies,
                    },
                    method: "GET",
                }
            );

            return (await resp.json()) as QueryData;
        },
        {
            finished(result) {
                return result.status == "Done";
            },
        }
    );

    return await (await fetch(data.file_url!)).arrayBuffer();
}

async function readExcel() {
    let buffer: Buffer;
    if (Bun.env.NODE_ENV === "local") {
        buffer = await readFile(path.resolve("Mindustry 蓝图档案馆.xlsx"));
    } else {
        if (!context.qqCookies || context.qqCookies == "") {
            console.error("No QQ_DOC_COOKIES!");
            return;
        }

        try {
            const arrayBuffer = await fetchSchematicsExcel();
            buffer = Buffer.from(arrayBuffer);
        } catch (error) {
            console.error(error);
            console.error(
                "Failed to fetch schematics excel. Please check your QQ_DOC_COOKIES."
            );
            return;
        }
    }

    const excelSheetsData: ExcelSheetsData = XLSX.parse(buffer, {
        type: "buffer",
        cellHTML: false,
    });

    return excelSheetsData;
}

async function parseExcelData(excelSheetsData: ExcelSheetsData) {
    const schematicsData: SchematicData[] = [];

    excelSheetsData.forEach((workSheet) => {
        const {name: category, data} = workSheet;

        const sheetData = data as string[][];
        const base64Index = autoDetectBase64Column(sheetData);

        if (base64Index == -1) {
            console.error(
                "Skipping: Schematic base64 code not found in sheet",
                category
            );
            return;
        }

        sheetData.forEach((rowData, index) => {
            if (index == 0) return; // skip title

            const [author, name] = rowData;
            const base64Raw = rowData[base64Index];

            if (!name || !base64Raw || base64Raw.length == 0) {
                return;
            }

            const base64 = base64Raw.replace(/\s/g, "");
            if (!isValidBase64(base64)) {
                console.error("Invalid schematic", name);
                return;
            }

            // schematics causing buffer mismatch will be listed.
            if (
                blacklist.schematics.findIndex((s) => s === name) !== -1 ||
                (author &&
                    blacklist.authors.findIndex((a) => a === author) !== -1)
            ) {
                console.log("Detect blacklist schematic:", name);
                return;
            }

            schematicsData.push(
                new SchematicData(category, name, author ?? "unknown", base64)
            );
        });
    });

    return schematicsData;

    function autoDetectBase64Column(data: string[][]): number {
        const byTitle = data[0]?.findIndex((str) => str === "蓝图代码");
        if (byTitle) return byTitle;

        const byContent = data[1]?.findIndex((str) => isValidBase64(str));
        return byContent ?? -1;
    }

    function isValidBase64(str: string): boolean {
        return str.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(str);
    }
}

async function genSchematics(
    fromPath: string,
    dataMap: SchematicDataMap,
    lastDataMap: SchematicDataMap
) {
    let count = 0;
    await Promise.all(
        Array.from(dataMap.values()).map(async (data) => {
            if (lastDataMap.getData(data.category, data.name)?.equals(data)) {
                return;
            }
            const {base64} = data;
            const fileName = data.getFileName();
            const filePath = data.getFilePath(fromPath);

            const buffer = Buffer.from(base64, "base64");
            const file = await Bun.file(filePath);

            await Bun.write(file, buffer);

            count++;
            console.log("Save schematic", fileName);
        })
    );

    console.log("All schematics saved to", context.outPath);
    console.log("Total schematics:", dataMap.size);
    console.log("Saved schematics:", count);
}

async function retainValidData(basePath: string, data: SchematicDataMap) {
    await Promise.all(
        Array.from(data.values()).map(async (schematicData) => {
            const file = await Bun.file(schematicData.getFilePath(basePath));
            if (!(await file.exists())) {
                data.deleteData(schematicData);
            }
        })
    );
}

async function deleteOldSchematics(
    fromPath: string,
    dataMap: SchematicDataMap,
    lastDataMap: SchematicDataMap
) {
    await Promise.all(
        Array.from(lastDataMap.entries()).map(async (entry) => {
            const [key, item] = entry;

            if (dataMap.has(key)) {
                return;
            }

            const filePath = item.getFilePath(fromPath);

            try {
                await rm(filePath, {force: true, recursive: true});
                console.log("Remove schematic", filePath);
            } catch (error) {
                console.error("Failed to remove schematic", filePath, error);
            }
        })
    );
}

async function readData(fromPath: string): Promise<SavedData | null> {
    const file = await Bun.file(fromPath);

    if (!(await file.exists())) {
        return null;
    }

    const data: SavedData = await file.json();
    return data;
}

async function saveData(outPath: string, data: SchematicDataMap) {
    const dataObject: SavedData = {
        updateDate: +Date.now(),
        schematics: data.size,
        data: Array.from(data.values()),
    };

    await Bun.write(outPath, JSON.stringify(dataObject));
}

function anyChange(data: SchematicDataMap, oldData: SchematicDataMap) {
    if (data.size != oldData.size) return true;

    const keys = Array.from(data.keys());
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!;

        const other = oldData.get(key);
        if (!other) return true;

        const schematicData = data.get(key)!;
        if (!schematicData.equals(other)) {
            return true;
        }
    }

    return false;
}
