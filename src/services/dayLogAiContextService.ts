import type { AiContextPack, Asset, Block } from "../types";
import { buildAiContextPack } from "./aiContextService";

export const buildDayLogAiContext = (
  date: string,
  blocks: Block[],
  assets: Asset[],
): AiContextPack => buildAiContextPack(date, blocks, assets);
