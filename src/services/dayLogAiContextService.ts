import type { AiContextPack, Asset, Block } from "../types";
import { buildAiContextPack, buildAiContextPackAsync } from "./aiContextService";

export const buildDayLogAiContext = (
  date: string,
  blocks: Block[],
  assets: Asset[],
): AiContextPack => buildAiContextPack(date, blocks, assets);

export const buildDayLogAiContextAsync = (
  date: string,
  blocks: Block[],
  assets: Asset[],
  signal?: AbortSignal,
): Promise<AiContextPack> => buildAiContextPackAsync(date, blocks, assets, "", signal);
