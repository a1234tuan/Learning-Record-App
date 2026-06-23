import type { AiPromptPreset, AppSettings, Block, DayEntry } from "../types";
import { createBaseEntity, newId } from "../lib/entity";
import { nowISO, todayISO } from "../lib/date";
import { createDefaultSubjects } from "../lib/subjects";

export const DEFAULT_EXAM_DATE = "2026-12-27";

const DEFAULT_AI_PROMPTS: Array<Pick<AiPromptPreset, "title" | "prompt">> = [
  {
    title: "白纸复述测试",
    prompt: `请扮演严格考官，基于今天的日志：
1. 从今天日志中挑出 1 个最核心的知识点（不要挑边缘的）。
2. 问我："请脱离任何资料，用自己的话告诉我：
   - 这个知识点解决什么问题？
   - 不用它之前，人们怎么做？
   - 它的核心机制是什么？
   - 它最容易踩的坑是什么？"
3. 我回答后，请逐条批改：
   - 哪些答对了
   - 哪些答错了
   - 哪些虽然没错但不准确/不完整
   - 哪些关键点我完全没提到
4. 最后给一个评级：A（真正理解）/ B（表层理解）/ C（只是记住名词）。
不要先夸我，直接开始出题。`,
  },
  {
    title: "变形应用题",
    prompt: `请基于今天日志中的知识点出 1 道"变形题"：
要求：
1. 题目必须基于一个具体业务场景，不要出概念背诵题。
2. 场景要和我日志中记录的例子"不一样"——换业务、换数据、换条件。
3. 不要给答案，等我作答。
4. 我作答后，请按"生产代码标准"批改：
   - 有没有错误
   - 有没有虽然能跑但不规范的地方
   - 如果你来写会怎么改，为什么
5. 评级标准：
   A = 可以投入生产
   B = 能跑但有隐患
   C = 基本错误
现在出题。`,
  },
  {
    title: "盲区挖掘",
    prompt: `请扮演资深面试官。基于今天日志的知识点：
1. 列出 3 个"初学者常以为自己会了，但实际有漏洞"的点。
2. 针对其中最容易踩坑的 1 个，出一道"陷阱题"——
   表面看简单，但藏着坑。
3. 不要标注坑在哪，让我自己找。
4. 我回答后：
   - 如果我没看出坑：告诉我坑在哪，并解释为什么我会漏掉
   - 如果我看出了坑但没完全：补充我遗漏的部分
   - 如果我看出了全部：出一道更难的
目标：暴露我的"未知的未知"。`,
  },
  {
    title: "费曼讲解测试",
    prompt: `请扮演一个"完全没学过这个知识点的初学者"。
1. 从今天日志中选一个知识点。
2. 让我向你讲解这个知识点，假装你完全不懂。
3. 在我讲解过程中，你要不断追问"为什么"、"那如果...怎么办"、
   "我还是不懂 XX 是什么"。
4. 不要客气，听不懂就说听不懂。
5. 讲解结束后，告诉我：
   - 我哪些地方讲得清楚
   - 我哪些地方讲得含糊（说明我自己也没真懂）
   - 我有没有用"术语解释术语"的偷懒行为
目标：检验我是真懂还是假懂。`,
  },
  {
    title: "我的理解对不对",
    prompt: `我会告诉你"我对今天某个知识点的理解"。
请你不要默认我说得对。请按以下方式判断：
1. 我的理解中"完全正确"的部分是哪些
2. "看似对但不准确"的部分是哪些
3. "完全错误"的部分是哪些
4. "我没提到但很关键"的部分是哪些
5. 基于我的理解，预测我在实际应用中可能会犯什么错
请等我输入"我的理解是：XXX"后再开始。
不要替我组织表达，要逐字针对我说出来的内容评判。`,
  },
];

export const createDefaultAiPresets = (): AiPromptPreset[] =>
  DEFAULT_AI_PROMPTS.map((item, order) => ({
    ...createBaseEntity(),
    ...item,
    order,
  }));

export const isLegacyDefaultAiPresetSet = (presets: AiPromptPreset[] | undefined): boolean => {
  if (!presets || presets.length !== 4) {
    return false;
  }
  const titles = presets.map((preset) => preset.title);
  return (
    titles.some((title) => title.includes("自测") || title.includes("5")) &&
    titles.some((title) => title.includes("随机") || title.includes("抽问")) &&
    titles.some((title) => title.includes("薄弱") || title.includes("总结")) &&
    titles.some((title) => title.includes("明日") || title.includes("计划"))
  );
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
    providerName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
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
