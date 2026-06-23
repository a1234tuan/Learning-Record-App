# 学习日志

一个本地优先的学习记录 App，支持 Web/PWA 和 Android APK 双端共用同一套 React 前端代码。

它的核心定位是：把每天的学习记录沉淀成本地知识库，再通过 OCR 和 AI 问答把日志变成可复盘、可自测、可追问的学习材料。

## 主要功能

- **日志记录**：按日期和学科创建记录块，支持文字、图片、录音、音频、附件和公式混排。
- **学科分类**：支持自定义学科、新增、重命名、归档隐藏和排序。
- **日期热力图**：按月份查看记录分布，快速定位最近学习状态。
- **收藏夹与回收站**：记录可收藏；删除后进入回收站，默认保留 30 天。
- **草稿防丢**：编辑未保存时会自动保留草稿，切走页面或 App 被杀后再次打开可恢复。
- **OCR 搜索**：图片 OCR 后可进入全文搜索，也可进入 AI 日志上下文。
- **AI 日志问答**：基于某一天日志开启多轮 AI 对话，可做自测题、知识点抽问、薄弱点总结等。
- **完整备份恢复**：Web 和 Android 通过完整 zip 备份互通，支持日志、资产、OCR 文本和草稿恢复。
- **AI 材料导出**：可导出 Markdown、JSON、TXT，用于喂给外部 AI 或后续知识库问答。

## AI 问答重点说明

### AI 问答入口

在日志页的每一天日志卡片右侧，可以点击 **AI 问答**。

点击后会：

1. 收集当天所有正式保存的日志记录。
2. 自动整理成 AI 可读的 Markdown 上下文。
3. 创建一个新的 AI 会话。
4. 跳转到独立聊天页面。

同一天日志可以开启多条不同对话。历史对话可在 AI 聊天页右上角历史入口中查看、切换或删除。

### AI 会拿到什么内容

AI 上下文按 `record.date` 收集当天日志，不受 `updatedAt` 修改时间影响。

会发送给 AI 的内容包括：

- 日期
- 学科
- 记录标题
- 正文纯文本
- 公式内容
- 已完成 OCR 的图片文字

不会发送给 AI 的内容包括：

- 原始图片文件
- 原始音频文件
- PDF、Word 等附件原文
- 未保存草稿
- 回收站记录
- AI 聊天记录之外的隐私数据

如果当天日志里有图片还没有 OCR，聊天页会提示这部分图片文字未参与问答。录音、音频和普通附件会被列为跳过内容。

### 多轮记忆

AI 请求会携带：

- 系统提示词
- 当天日志 Markdown 上下文
- 最近若干轮有效问答历史
- 当前用户输入

默认记忆最近 12 轮对话，用来支持苏格拉底式追问、连续自测、逐步讲解和基于前文的复盘。

### 预设提示词

AI 聊天页会显示预设提示词快捷入口。默认适合这些场景：

- 根据今天日志出自测题
- 随机抽问知识点
- 总结薄弱点
- 生成明日复习计划

你可以在 **更多 -> AI 设置** 中新增、编辑、删除和排序自己的提示词。点击预设后会填入输入框，仍可继续修改再发送。

### AI 接口配置

入口：

```text
更多 -> AI 设置
```

当前支持 OpenAI 兼容的 `chat/completions` 非流式接口。可配置：

- 供应商名称
- Base URL
- API Key
- Model
- Temperature
- Max Tokens
- 预设提示词

常见第三方 OpenAI 兼容服务，如 DeepSeek、硅基流动、智谱等，理论上都可以通过 Base URL + API Key + Model 配置接入。

示例格式：

```text
Base URL: https://api.example.com/v1
Model: deepseek-chat
API Key: sk-...
```

注意：不同供应商的模型名、鉴权方式和跨域策略可能不同，请以供应商控制台为准。

### Android 和 Web 的差异

Android 端优先通过原生 HTTP 桥接请求 AI 接口，更容易绕开 WebView/CORS 限制。

Web 端直接使用浏览器 `fetch` 调用接口。如果第三方服务不允许浏览器跨域请求，Web 端会失败。这种情况下可以：

- 优先在 Android App 中使用 AI。
- 配置一个允许跨域的代理 Base URL。
- 后续再接入自己的服务器代理。

### 隐私与备份规则

- API Key 只保存在本机，不进入完整 zip 备份。
- AI 聊天记录只保存在本机，不进入完整 zip 备份。
- 日志、图片、音频、附件、OCR 文本、学科设置和未保存草稿会进入完整 zip 备份。
- Markdown/JSON/TXT 的 AI 材料导出只用于阅读和问答，不用于恢复数据。

## OCR 与 AI 的关系

AI 不会直接读取原始图片。图片内容必须先经过 OCR，识别出的文字才会进入 AI 上下文。

图片 OCR 成功后：

- 图片卡片会显示 `OCR✅`
- OCR 文本可被全文搜索命中
- AI 问答会把 OCR 文本放入当天日志上下文

如果 OCR 失败、超时、返回空结果，或尚未执行 OCR，AI 聊天页会明确提示该图片没有参与问答。

当前 OCR 更推荐在 Android 端使用；Web 端可能受到浏览器 CORS 限制。

## 数据与备份

当前版本是本地优先应用，没有服务器账号和云同步。

数据主要保存在本机 IndexedDB / WebView 存储中：

- 日志记录
- 学科配置
- 图片、音频、附件 Blob
- OCR 文本
- 回收站
- 收藏夹
- 未保存草稿
- AI 设置和聊天记录

重要提醒：卸载 App、清除应用数据、清理浏览器站点数据，可能删除本地数据。请定期导出完整备份。

### 完整备份

入口：

```text
更多 -> 完整备份
```

完整备份会生成 zip 文件，是唯一可恢复格式。zip 内包含：

- `manifest.json`：备份格式、版本、导出时间和数量统计
- `data.json`：日志、学科、设置、OCR 元数据、草稿等结构化数据
- `entries/`：按日期导出的 Markdown 日志
- `assets/`：图片、音频、附件原始文件

Android 端会调起系统分享/保存面板；Web 端会直接下载 zip。

### 导入恢复

入口：

```text
更多 -> 导入恢复
```

导入只接受完整 zip 备份。导入是覆盖式恢复，会替换当前本地数据，建议导入前先导出一份当前备份。

导入成功后会显示：

- 导入了多少条日志
- 覆盖多少天
- 图片/音频/附件数量
- 回收站记录数量
- 备份版本

如果文件不是 zip、zip 损坏、缺少 `data.json`、JSON 损坏或格式不兼容，页面会显示失败原因，并且不会覆盖当前数据。

### Web 与 Android 手动同步

当前没有实时云同步。双端同步方式是完整 zip 互通。

Android 同步到 Web：

1. Android 打开 `更多 -> 完整备份`。
2. 把 zip 发送到电脑。
3. Web 打开 `更多 -> 导入恢复`。
4. 选择 zip 并恢复。

Web 同步到 Android：

1. Web 打开 `更多 -> 完整备份` 下载 zip。
2. 把 zip 发送到手机。
3. Android 打开 `更多 -> 导入恢复`。
4. 选择 zip 并恢复。

注意：这是覆盖式同步，不是冲突合并。两端同时独立编辑后再互相导入，后导入的一端会覆盖当前数据。

## AI 材料导出

入口：

```text
更多 -> AI 材料导出
```

支持三种格式：

- **按学科 Markdown**：生成 `subjects/学科.md`，适合直接喂给 AI 做复习问答。
- **知识库 JSON**：结构化包含记录 id、日期、学科、标题、正文、公式、资源标题和 OCR 文本，适合后续接本地知识库问答。
- **纯文本 TXT**：生成一个总文本，适合快速复制给 AI。

这些格式不包含原始 Blob，不承担恢复职责。恢复数据请使用完整 zip 备份。

## Web 端运行

安装依赖：

```powershell
cd D:\NoteProject
npm.cmd install
```

启动开发服务：

```powershell
npm.cmd run dev
```

浏览器打开终端显示的地址，通常是：

```text
http://localhost:5173/
```

如果要让同一局域网手机访问电脑上的 Web 端：

```powershell
npm.cmd run dev -- --host 0.0.0.0
```

然后在手机浏览器打开：

```text
http://电脑局域网IP:5173/
```

生产构建：

```powershell
npm.cmd run build
npm.cmd run preview
```

## Android APK 构建

构建 debug APK：

```powershell
cd D:\NoteProject
npm.cmd run android:build:debug
```

APK 输出路径：

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

安装到手机：

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

也可以把 APK 发送到手机后手动安装。首次安装可能需要允许“安装未知来源应用”。

## 常用命令

```powershell
# 启动 Web 开发服务
npm.cmd run dev

# 运行测试
npm.cmd test

# 构建 Web/PWA
npm.cmd run build

# 预览生产构建
npm.cmd run preview

# 同步 Web 构建到 Android
npm.cmd run android:sync

# 打开 Android Studio
npm.cmd run android:open

# 构建 Android debug APK
npm.cmd run android:build:debug
```

## 技术栈

- React + TypeScript + Vite
- Dexie / IndexedDB
- TipTap 富文本编辑器
- JSZip 备份恢复
- Vite PWA
- Capacitor Android
- OpenAI 兼容 AI 接口
- PaddleOCR 图片文字识别

## 当前限制

- 暂无实时云同步，双端同步依赖完整 zip 备份导入。
- 导入是覆盖式恢复，不做冲突合并。
- Web 端 AI/OCR 可能受到第三方接口 CORS 限制。
- Android APK 当前是 debug 构建，适合个人安装测试，不是应用商店发布版。
- OCR Token 当前适合个人本机使用，公开分发前建议改成服务器代理或用户本地配置。
- AI 不会读取原始图片、音频和 PDF，只使用日志文本、公式和图片 OCR 文本。

## 开发注意

- 当前 `appId/applicationId` 仍保持 `com.noteproject.study408`，用于兼容已安装版本的数据。
- `dist/`、`android/app/build/`、`*.apk` 不应提交到仓库。
- API Key 和 AI 聊天记录不进入完整备份，也不应提交到仓库。
- 如果后续接云同步，建议先实现“云端 latest zip 备份”，再逐步升级为结构化增量同步。
