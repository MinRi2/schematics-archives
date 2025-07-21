import path from "path";
import type {SchematicMeta} from "./types";

interface PollingOptions<T> {
    interval?: number;
    retryOnError?: Boolean;
    finished: (result: T) => Boolean;
}

function startPolling<T>(
    request: () => Promise<T>,
    options: PollingOptions<T> = {
        interval: 1000,
        retryOnError: true,
        finished: () => true,
    }
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;

    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;

    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    const poll = async () => {
        try {
            const result = await request();
            if (options.finished(result)) {
                resolve(result);
                return;
            }

            timer = setTimeout(poll, options.interval);
        } catch (error) {
            if (options.retryOnError) {
                timer = setTimeout(poll, options.interval);
            } else {
                reject(error);
            }
        }
    };

    poll();

    return promise;
}

export {startPolling};

export class SchematicDataMap extends Map<string, SchematicData> {
    public static getKey(category: string, name: string) {
        return category + name;
    }

    public static getKeyMeta(meta: SchematicMeta) {
        return SchematicDataMap.getKey(meta.category, meta.name);
    }

    setData(param: SchematicData | SchematicData[]) {
        if (param instanceof Array) {
            if (param.length)
                param.forEach((meta) =>
                    this.set(SchematicDataMap.getKeyMeta(meta), meta)
                );
        } else if (param instanceof SchematicData) {
            this.set(SchematicDataMap.getKeyMeta(param), param);
        }
    }

    getData(category: string, name: string) {
        return this.get(SchematicDataMap.getKey(category, name));
    }

    hasData(category: string, name: string) {
        return this.has(SchematicDataMap.getKey(category, name));
    }

    deleteData(data: SchematicMeta) {
        return this.delete(SchematicDataMap.getKey(data.category, data.name));
    }
}

export class SchematicData implements SchematicMeta {
    public static SCHEMATIC_SUFFIX = ".msch";

    static copy(other: SchematicMeta) {
        const {category, name, author, base64} = other;
        return new SchematicData(category, name, author, base64);
    }

    constructor(
        public category: string,
        public name: string,
        public author: string,
        public base64: string
    ) {
        this.name = name.replaceAll("/", "-").replaceAll("\n", "-");
    }

    getFileName() {
        return this.name + SchematicData.SCHEMATIC_SUFFIX;
    }

    getFilePath(basePath: string) {
        return path.resolve(basePath, this.category, this.getFileName());
    }

    equals(other: SchematicMeta) {
        return (
            this.category === other.category &&
            this.name === other.name &&
            this.author == other.author &&
            this.base64 === other.base64
        );
    }
}
