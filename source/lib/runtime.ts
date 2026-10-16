import { getFiles, type FileStore } from "./files";

export type AppRuntime = {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  FILES?: FileStore;
};

export function runtime(): AppRuntime {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    FILES: getFiles(),
  };
}
