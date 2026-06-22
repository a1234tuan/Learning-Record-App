import type { AiPromptPreset, AppSettings, Block, DayEntry } from "../types";
import { createBaseEntity, newId } from "../lib/entity";
import { nowISO, todayISO } from "../lib/date";
import { createDefaultSubjects } from "../lib/subjects";

export const DEFAULT_EXAM_DATE = "2026-12-27";

export const createDefaultAiPresets = (): AiPromptPreset[] => {
  const prompts = [
    {
      title: "5 道自测题",
      prompt: "请根据今天日志内容出 5 道自测题，先不要给答案，等我回答后再逐题讲解。",
    },
    {
      title: "随机抽问",
      prompt: "请从今天日志里随机抽取知识点问我，采用一问一答方式，不要一次问太多。",
    },
    {
      title: "薄弱点总结",
      prompt: "请根据今天日志总结我可能还不稳的知识点，并给出优先复习顺序。",
    },
    {
      title: "明日复习计划",
      prompt: "请根据今天日志生成明日复习计划，要求具体、可执行，并包含回顾问题。",
    },
  ];

  return prompts.map((item, order) => ({
    ...createBaseEntity(),
    ...item,
    order,
  }));
};

export const DEFAULT_SETTINGS: AppSettings = {
  id: "settings",
  examDate: DEFAULT_EXAM_DATE,
  theme: "system",
  accentColor: "#2f6f5e",
  backupReminderDays: 7,
  fontScale: 1,
  lineHeight: 1.7,
  subjects: createDefaultSubjects(),
  autoBackup: {
    enabled: false,
    debounceMs: 45_000,
  },
  ai: {
    providerName: "OpenAI Compatible",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    temperature: 0.7,
    maxTokens: 4096,
    memoryTurns: 12,
    presets: createDefaultAiPresets(),
  },
  schemaVersion: 3,
};

export const DEFAULT_TAGS = [
  "数学",
  "英语",
  "政治",
  "计组",
  "OS",
  "计网",
  "数据结构",
  "高数",
  "线代",
  "重点",
  "疑问",
  "突破",
  "瓶颈",
];

export const createDayEntry = (date = todayISO()): DayEntry => ({
  ...createBaseEntity(),
  date,
  title: `${date} 学习日志`,
  tags: [],
  pinned: false,
  favorite: false,
});

export const createTemplateBlocks = (date: string, existingCount = 0): Block[] => {
  const timestamp = nowISO();
  return [
    {
      id: newId(),
      createdAt: timestamp,
      updatedAt: timestamp,
      type: "record",
      date,
      order: existingCount,
      subject: "数据结构",
      title: `数据结构记录块${existingCount + 1}`,
      contentHtml:
        "<h2>今日学了什么</h2><p></p><h2>卡点疑问</h2><p></p><h2>明日计划</h2><p></p>",
      assets: [],
      formulas: [],
      mistakeRefs: [],
      favorite: false,
    },
  ];
};
