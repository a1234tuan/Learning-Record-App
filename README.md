# 学习日志

本地优先的学习日志、复盘和间隔复习应用。它面向长期自学和备考场景，把每天的学习记录、图片、录音、附件、公式、OCR 文本、AI 问答和复习卡片沉淀成一个可搜索、可导出、可备份的个人知识库。

应用支持 Web/PWA 和 Android APK。默认没有账号系统，核心数据保存在本机 IndexedDB / Android WebView 存储中。

## 主要能力

- **学习日志**：按天记录学习内容，支持学科分类、收藏、搜索、回收站和统计。
- **富文本编辑器**：支持标题、加粗、引用、代码块、任务列表、有序/无序列表、公式、图片、录音和附件。
- **结构化内容块**：支持结构图、对照表、便签板、折叠块和三色高亮块。
- **混合复习**：把学习记录加入复习队列，默认作为“轻回看”低压力回访；可手动切换为“记忆卡”，使用 FSRS 四按钮调度。
- **录音资料库**：按学科整理日志中引用过的录音，支持搜索、重命名、播放、倍速和循环。
- **AI 问答**：以某一天或某条记录为上下文进行问答，支持本机会话历史和 OpenAI 兼容供应商。
- **知识导出**：导出学科 Markdown、知识库 JSON、纯文本 TXT 和完整备份 zip。
- **Android 原生能力**：支持 APK 打包、原生分享、原生文件选择、原生 HTTP、Android 流式备份和前台录音服务。

## 快速开始

推荐使用 Node.js 20+。

```powershell
cd D:\NoteProject
npm ci
npm run dev
```

开发服务默认地址通常是：

```text
http://localhost:5173/
```

生产构建：

```powershell
npm run build
npm run preview
```

运行测试：

```powershell
npm test
```

## Android APK

构建 debug APK：

```powershell
cd D:\NoteProject
npm run android:build:debug
```

输出路径：

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

通过 adb 安装：

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

也可以把 APK 发送到手机后手动安装。首次安装通常需要允许“安装未知来源应用”。

构建 release APK 前，需要先在 `android\keystore.properties` 配置本机 release 签名证书。该文件和 keystore 已被 `.gitignore` 排除，不要提交到仓库。构建正式 APK：

```powershell
cd D:\NoteProject
npm run android:build:release
```

输出路径：

```text
dev-dist\release\学习日志.apk
```

## 页面导航

桌面端侧栏主要入口：

- **今天**：查看今日记录、新建学习记录、进入收藏和今日 AI 问答。
- **日志**：按月份热力图回看日志，按日期展开当天记录，进入全局搜索。
- **分类**：按学科查看记录，并管理学科的新增、改名、归档、恢复和排序。
- **复习**：进行今日到期复习，管理所有复习卡片状态。
- **录音**：按学科文件夹查看所有录音资源。
- **AI问答**：进入 AI 聊天和历史会话。
- **统计**：查看学习记录、资源、复习和学科分布统计。
- **设置**：管理主题、字体、考试日期、备份提醒和 AI 设置等。

移动端底部主导航为：今天、日志、分类、复习、更多。录音、AI 工具、备份恢复、统计、设置、回收站等功能从“更多”进入。

## 记录编辑器

编辑器使用 TipTap，内容保存在记录的 `contentHtml` 中。当前支持：

- Markdown 风格正文和富文本编辑。
- 图片、录音、附件、公式等资源节点。
- 图片 OCR；OCR 文本会进入搜索、导出和 AI 上下文。
- 自动草稿；切页、返回、重启后可恢复未保存内容。
- 结构图、对照表、便签板、折叠块。
- 三色高亮块：浅绿色、浅黄色、浅粉色；块内内容可继续编辑并保留富文本能力。

高亮块保存为自定义 HTML：

```html
<record-highlight-block data-tone="green|yellow|pink">...</record-highlight-block>
```

结构块和高亮块会被统一解析为线性内容，因此能进入搜索、AI 上下文、Markdown 导出和备份预览。

## 复习功能

复习功能以学习记录为卡片来源，不引入独立题库 schema。核心行为：

- 任意记录可加入复习，默认类型为 **轻回看**。
- 记录详情的复习进度中可在 **轻回看 / 记忆卡** 之间切换；切换会把下次复习重置到明天，但保留历史复习日志。
- 复习页统一使用四个评分按钮：**忘记了、模糊、良好、轻松**，并显示预计下次出现时间。
- **轻回看** 适合长日志、复盘、总结和资料型笔记，调度更宽松：忘记了回到明天，模糊会压缩或小幅上调间隔，良好和轻松逐步拉长。
- **记忆卡** 适合定义、公式、易错点和问答型知识，使用 FSRS 调度，映射为 Again / Hard / Good / Easy；产品层仍按天复习，不使用分钟级短时步骤。
- 今日复习默认建议上限为 20 条；到期总数会完整显示，完成建议量后可以手动继续处理剩余内容。
- 当天同一条记录重复评分会被视为纠正今天的评分，只保留最后一次结果，不重复增加复习日志和统计次数。
- 卡片管理中可搜索、按学科、状态和复习类型筛选，查看下次复习、最近评分、累计次数、重置或移出队列。

当前混合复习系统的设计目标是：让日志类内容保持低压力回访，让真正原子化、需要记忆强化的内容才进入 Anki 式调度。系统不再因为连续几次“良好”自动标记已掌握，是否移出复习队列由用户手动决定。

## AI 与知识导出

AI 问答会使用当前日志或记录相关内容作为上下文，包括：

- 日期、学科、记录标题。
- 正文纯文本。
- 结构图、对照表、便签板、折叠块和高亮块中的文本。
- 公式内容。
- 图片 OCR 文本。
- 用户当前问题和必要的最近对话记忆。

不会发送：

- API Key。
- 未保存草稿。
- 回收站记录。
- 原始音频文件。
- 普通附件原文。
- 本机 AI 聊天记录数据库本身。

知识导出支持：

- **学科 Markdown**：保留结构块和高亮块的可读 Markdown 表达。
- **知识库 JSON**：包含结构化记录文本、公式、资源描述和 OCR 文本。
- **纯文本 TXT**：适合直接喂给不支持 Markdown 的工具。
- **完整备份 zip**：用于恢复应用数据，不只是给 AI 阅读。

## OCR 设置

OCR 是全局图片文字识别能力，不只用于 AI 图片问答，也用于把图片中的文字写入资源元数据，进入本地全文检索、导出和备份。

- 入口：**更多 → OCR 设置**。
- 在该页面填写你自己的 PaddleOCR / AI Studio Token。
- Token 只保存在本机，不会内置到 APK，也不会进入完整备份。
- 未配置 Token 时，新图片 OCR 会提示先配置；已识别出的历史 OCR 文本仍可继续搜索。
- AI 工具中的“本地 OCR 后转文字”会复用这里的 OCR 配置，不再单独保存 OCR Token。

## 备份与恢复

完整备份 zip 包含：

- 日志和记录。
- 学科设置和应用设置。
- 图片、音频、附件等资源 Blob。
- OCR 元数据。
- 草稿。
- 回收站记录。
- 复习状态、复习日志和复习统计。

不会包含：

- API Key。
- AI 聊天记录。

导入恢复是覆盖式恢复，不做冲突合并。恢复前请确认当前数据已经备份。

Android 端支持原生流式备份，适合生成较大的 zip。自动备份会写入绑定目录中的 `study-journal-latest.zip`，并在写入后核验文件是否真实存在且大小大于 0；只有核验通过才会更新最近备份时间。备份包中的 `entries/*.md` 也会包含记录正文，方便不恢复数据时快速预览内容。

## 数据与隐私

这是一个本地优先应用。主要数据保存在本机：

- Web/PWA：浏览器 IndexedDB 和站点存储。
- Android：App WebView 存储和本机文件/缓存。

清除浏览器站点数据、清除 Android 应用数据或卸载 App，都可能删除本地知识库。请定期导出完整 zip 备份，或在 Android 端配置自动备份。

AI API Key 只保存在本机，不会进入完整备份。AI 请求会发送必要上下文到你配置的模型供应商，请根据供应商隐私政策自行判断是否启用。

## Android 与 Web 差异

- Android 端使用 Capacitor 打包，支持原生 HTTP、原生分享、原生文件选择和流式 zip 备份。
- Android 端录音使用前台服务，开始录音后可在息屏、回桌面或切换 App 时继续录音。
- Web/PWA 端受浏览器权限、后台策略和 CORS 限制，不承诺后台持续录音。
- Web 端 AI/OCR 请求可能受第三方接口 CORS 限制；Android 端会更稳定。

## 常用命令

```powershell
# 安装依赖
npm ci

# 启动 Web 开发服务
npm run dev

# 运行测试
npm test

# 构建 Web/PWA
npm run build

# 预览生产构建
npm run preview

# 同步 Web 构建到 Android
npm run android:sync

# 打开 Android Studio
npm run android:open

# 构建 Android debug APK
npm run android:build:debug

# 构建 Android release APK
npm run android:build:release
```

## 技术栈

- React 18
- TypeScript
- Vite
- Vitest + Testing Library
- Dexie / IndexedDB
- TipTap
- JSZip
- Vite PWA
- Capacitor Android
- Lucide React
- Recharts
- KaTeX / lowlight / highlight.js

## 目录概览

```text
src/
  components/   通用组件、编辑器节点、卡片和 UI 基础组件
  db/           Dexie 数据库和默认数据
  hooks/        应用数据 Hook
  lib/          日期、Markdown、复习算法、内容解析等纯逻辑
  pages/        今天、日志、分类、复习、AI、设置等页面
  services/     备份、AI、OCR、存储、Android 原生桥接等服务
  styles/       主题、布局、页面和组件样式
android/        Capacitor Android 工程
scripts/        Android 打包等辅助脚本
docs/           项目文档和记录
```

## 当前限制

- 暂无实时云同步；跨设备依赖完整备份 zip 或自动备份文件。
- 导入恢复是覆盖式恢复，不做多端冲突合并。
- release APK 使用本机 release keystore 签名；请妥善保存 keystore 和密码，否则后续无法升级同一应用。
- AI 看图能力取决于所选模型和中转接口是否真正支持视觉输入。
- OCR、AI 和 Android 后台录音等能力受设备权限、系统版本和供应商接口影响。

## 开发注意

- 当前 Android `appId/applicationId` 保持为 `com.noteproject.study408`，用于兼容已安装版本的数据。
- 不要提交真实 API Key、OCR Token 或其他密钥。
- `dist/`、`android/app/build/`、`*.apk` 等构建产物不应提交。
- 修改编辑器自定义节点时，需要同步检查搜索、AI 上下文、Markdown 导出、完整备份、Android 流式备份和导入恢复链路。
- 修改复习逻辑时，需要重点验证“当天已评分不再出现”“同日重复评分最后一次生效但不重复计数”“轻回看和记忆卡切换保留历史日志”“复习队列不触发页面抖动”等不变量。
