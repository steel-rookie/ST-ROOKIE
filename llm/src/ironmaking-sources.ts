import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface PublicSource {
  id: string;
  title: string;
  date: string;
  date_type: "발행일" | "발행연도" | "확인일";
  url: string;
  publisher: string;
  route: "고로" | "FINEX" | "비교";
  topics: string[];
  notes: string[];
}

const path = join(process.cwd(), "backend", "data", "ironmaking-sources.json");
const catalog = JSON.parse(readFileSync(path, "utf8")) as {
  notice: string;
  sources: PublicSource[];
};

export const sourceNotice = catalog.notice;
export const publicSources = catalog.sources;
const sourcesById = new Map(publicSources.map((source) => [source.id, source]));

export function getPublicSources(ids: string[]): PublicSource[] {
  return [...new Set(ids)].map((id) => sourcesById.get(id)).filter((source): source is PublicSource => Boolean(source));
}
