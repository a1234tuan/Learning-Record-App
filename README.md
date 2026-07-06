# 学习日志

一个本地优先的学习日志、复习回访与 AI 自测应用。

它不是单纯的闪卡软件，也不是通用协作文档。学习日志把“每天到底学了什么、哪里没懂、什么时候该回头看、如何用 AI 检查自己有没有真正掌握”放进同一条个人学习闭环里。

## 产品定位

学习日志面向长期自学、备考、课程复盘和个人知识沉淀场景：

- 用日志记录真实学习过程，而不是一开始就强迫拆成原子卡片。
- 用混合复习系统管理回看节奏，避免长笔记被高压闪卡化。
- 用 AI 基于自己的记录出题、追问、解释和挖盲点。
- 用 OCR、搜索、录音、附件和 Android 增量备份支撑长期资料积累。

## 核心亮点

- **学习记录为核心对象**：按学科和日期沉淀学习过程，支持收藏、回收站、统计和月份折叠浏览。
- **富编辑器**：支持文本、图片、录音、附件、公式、代码块、任务列表、高亮块、折叠块、结构图、对照表和便签板。
- **混合复习系统**：默认 `轻回看`，适合长日志、复盘和资料型笔记；可手动切换为 `记忆卡`，使用 FSRS 风格四按钮调度。
- **AI 学习助手**：围绕当前日志或记录进行问答、自测、讲解和盲点挖掘，支持 OpenAI-compatible API 供应商。
- **OCR + 搜索闭环**：图片 OCR 文本会进入全文搜索、AI 上下文、导出和备份。
- **录音资料库**：集中查看日志中引用过的录音，支持搜索、播放、倍速和循环。
- **Android 大资源备份**：支持自动备份文件夹仓库，资源独立保存，只同步新增或缺失资源，并保留最近 5 个快照。
- **本地优先**：没有账号系统，核心数据保存在本机；用户自行选择是否配置 AI、OCR 和备份。

## 功能概览

| 模块 | 能力 |
| --- | --- |
| 今天 | 创建今日学习记录，查看今日安排和快速入口 |
| 日志 | 按日期回看记录，进入全文搜索 |
| 分类 | 按学科管理记录，学科内按月份折叠显示，适合 400+ 记录规模 |
| 编辑器 | 富文本、结构化块、图片、录音、附件、公式、OCR |
| 复习 | `轻回看 / 记忆卡` 混合调度，四按钮评分，今日建议上限 |
| AI 问答 | 基于日志上下文进行问答、自测、解释和追问 |
| OCR | 图片文字识别，结果进入搜索、AI、导出和备份 |
| 录音 | 录音资源集中管理和回听 |
| 备份恢复 | 完整 ZIP 导出/导入，Android 增量文件夹仓库，旧仓库恢复 |
| 统计 | 学习记录、资源、复习和学科分布概览 |

## 与同类产品的差异

- **相比 Anki**：Anki 更适合高强度原子卡片记忆；学习日志更适合先保留完整学习过程，再把真正需要记忆的内容切换为记忆卡。
- **相比 RemNote**：RemNote 更强调笔记内闪卡和知识管理；学习日志更轻、更本地，更贴近日志、复盘和 Android 端个人使用。
- **相比 Obsidian / Logseq**：它们强在双链、图谱和开放插件生态；学习日志内置复习、AI、OCR、录音和备份，不要求用户自己搭插件系统。
- **相比 Notion**：Notion 强在团队文档、数据库和协作；学习日志专注个人自学闭环和本地数据掌控。
- **相比普通日记/备忘录**：学习日志不只记录，还能回看、搜索、OCR、AI 自测和间隔复习。

## 技术栈

- React 18
- TypeScript
- Vite
- Vitest + Testing Library
- Dexie / IndexedDB
- TipTap
- JSZip
- Capacitor Android
- Vite PWA
- ts-fsrs
- KaTeX / lowlight / highlight.js
- Lucide React
- Recharts

## 快速开始

推荐使用 Node.js 20+。

```powershell
npm ci
npm run dev
```

默认开发地址通常为：

```text
http://localhost:5173/
```

运行测试：

```powershell
npm run test
```

生产构建：

```powershell
npm run build
npm run preview
```

## Android 构建

构建 debug APK：

```powershell
npm run android:build:debug
```

构建 release APK：

```powershell
npm run android:build:release
```

release 构建需要在本机配置签名文件。请不要提交 keystore、`keystore.properties`、API Key、OCR Token 或任何私密配置。

## 数据与隐私

学习日志是本地优先应用：

- Web/PWA 数据主要保存在浏览器 IndexedDB 和站点存储中。
- Android 数据主要保存在 App WebView 存储和本机文件/缓存中。
- AI API Key 和 OCR Token 只保存在本机，不会进入完整备份。
- AI 请求会把必要上下文发送给用户配置的模型供应商。
- 清除浏览器站点数据、清除 Android 应用数据或卸载 App，可能删除本地库。

请定期导出完整备份，或在 Android 端配置自动备份文件夹仓库。

## 备份策略

项目提供两类备份：

- **完整 ZIP 导出/导入**：适合迁移、归档和小到中等规模数据恢复。
- **Android 增量文件夹仓库**：适合长期大资源量使用。仓库目录为 `study-journal-backup/`，资源保存在 `assets/`，快照保存在 `snapshots/`，`manifest.json` 指向最新快照。

Android 自动备份当前策略：

- 打开 App 后同步一次。
- 编辑、删除、OCR、复习评分等普通数据变动不会立即自动同步。
- 用户可以手动点击“立即同步”推送当前本地数据到仓库。
- 从旧仓库恢复需要使用“从自动备份文件夹恢复”，不会在绑定文件夹时自动拉取。

## 项目结构

```text
src/
  components/   通用组件、编辑器节点和 UI 组件
  db/           Dexie 数据库、默认设置和迁移
  hooks/        应用数据 Hook
  lib/          日期、搜索、Markdown、复习算法、内容解析等纯逻辑
  pages/        今天、日志、分类、复习、AI、设置等页面
  services/     存储、AI、OCR、备份、Android 原生桥接等服务
  styles/       主题、布局、页面和组件样式
android/        Capacitor Android 工程
scripts/        Android 打包辅助脚本
docs/           项目文档
```

## 常用命令

```powershell
# 安装依赖
npm ci

# 启动开发服务
npm run dev

# 运行测试
npm run test

# 构建 Web/PWA
npm run build

# 同步 Web 构建到 Android
npm run android:sync

# 打开 Android Studio
npm run android:open

# 构建 Android debug APK
npm run android:build:debug

# 构建 Android release APK
npm run android:build:release
```

## 开发注意

- `dist/`、`dev-dist/`、`android/app/build/`、`*.apk`、`*.aab`、`*.jks`、`*.keystore` 不应提交。
- 修改编辑器自定义节点时，需要同步检查搜索、AI 上下文、Markdown 导出、备份和恢复链路。
- 修改复习逻辑时，需要重点验证轻回看、记忆卡、同日重复评分、切换类型和复习队列稳定性。
- 修改备份逻辑时，需要区分“导出/导入 ZIP”和“Android 自动备份文件夹仓库”，避免互相牵连。
- 发布 APK 请使用 GitHub Releases，不要把安装包提交到 Git 历史。

## 当前限制

- 暂无账号系统和实时云同步。
- 导入恢复是覆盖式恢复，不做多端冲突合并。
- Android 自动备份保留最近 5 个快照，但当前界面不提供选择历史快照回退。
- AI 看图、长上下文和输出质量取决于模型供应商与 API 兼容性。
- 单个超大资源文件仍可能受 Android WebView、IndexedDB、Blob 和设备内存限制。

## 开源状态

开源前请先确认许可证。推荐在仓库根目录添加 `LICENSE` 文件，例如 MIT、Apache-2.0 或 GPL 系列之一。没有许可证时，即使代码公开，也不等于其他人可以自由使用、修改和分发。

