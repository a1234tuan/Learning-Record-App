# Learning Record App

一个本地优先的学习日志应用，支持 Web/PWA 和 Android APK。它的核心目标是把每天的学习记录沉淀成本地知识库，再通过 OCR、AI 问答、草稿恢复、备份恢复等能力，把日志变成可复盘、可自测、可追问的学习材料。

## 主要功能

- 按日期和学科记录学习内容，支持文字、公式、图片、音频、附件混排。
- 图片可进行 OCR，OCR 文本可进入搜索、导出和 AI 日志上下文。
- 日志页、分类页、搜索页、今天页和更多页都有运行期导航记忆。
- 记录支持收藏；删除前二次确认，删除后进入回收站并保留 30 天。
- 编辑未保存时自动保存草稿，切页、返回、切后台或重启后可恢复。
- 支持完整 zip 备份和导入恢复，用于 Android 与 Web 之间手动同步数据。
- 支持独立 AI 问答页面、多会话历史、本地聊天记录、OpenAI 兼容第三方模型接口。

## AI 问答

### 入口

在日志页的每日日志卡片右侧点击“AI 问答”，应用会自动收集当天正式保存的日志内容，创建一条新的 AI 会话，并进入独立聊天页面。

同一天日志可以开启多条不同对话。聊天页右上角有历史入口，可以查看、切换和删除本机保存的 AI 聊天记录。

### AI 会拿到什么内容

AI 日志上下文按 `record.date` 收集当天记录，不受 `updatedAt` 修改时间影响。

会发送给 AI 的内容包括：

- 日期
- 学科
- 记录标题
- 正文文本
- 公式内容
- 已完成 OCR 的图片文字
- 本轮用户输入
- 最近若干轮有效问答记忆

不会发送给 AI 的内容包括：

- 未保存草稿
- 回收站记录
- 原始音频文件
- PDF、Word 等普通附件原文
- API Key
- 本机 AI 聊天记录本身

如果当天日志里有图片未 OCR、OCR 失败或 OCR 返回空文本，聊天页会提示这些图片没有参与日志问答。音频和普通附件会作为跳过资源提示，不会直接进入 AI 上下文。

### 学习型默认 Prompt

内置 5 个通用学习教练 prompt，适合数学、英语、政治、计算机、专业课、读书笔记等场景：

- 白纸复述测试：让 AI 挑一个核心知识点，要求你脱离资料复述，再严格批改。
- 变形应用题：基于日志知识点改变条件、场景或问法，考察迁移能力。
- 盲区挖掘：找出看似懂了但容易有漏洞的点，并出陷阱题暴露盲区。
- 费曼讲解测试：让你向“完全没学过的人”讲解，AI 持续追问不清楚的地方。
- 我的理解对不对：你输入自己的理解，AI 按准确、含糊、错误、遗漏逐条判断。

可以在“更多 -> AI 设置”中新增、编辑、删除和排序预设 prompt。点击预设后只会填入输入框，发送前仍可继续修改。

### 多轮记忆

AI 请求默认携带最近 12 轮有效问答。较长会话会生成本机会话摘要，后续请求会同时携带会话摘要和最近对话，便于苏格拉底式追问、连续自测和逐步纠错。

失败或错误消息不会进入有效记忆。聊天记录完整保存在本机 IndexedDB，但不会进入完整 zip 备份。

### 图片问答

AI 问答输入区支持上传图片，可以只发图片，也可以图片加文字一起发送。

在“更多 -> AI 设置 -> 图片问答方式”中可以选择：

- 本地 OCR 后转文字：适合不支持图片输入的模型。发送前先调用已配置的 PaddleOCR，把识别结果整理为 Markdown 后发给 AI。
- 直接发送给 AI：适合支持视觉输入的模型。图片会作为消息内容发送给 OpenAI 兼容接口。
- 关闭图片发送：只保留文字问答。

Android 端“相册”按钮优先调用系统图库/照片选择器；如果设备不支持，会降级到旧的照片选择入口。Web 端受浏览器限制，只能打开普通文件选择器，无法强制默认进入某个相册应用。

### AI 供应商配置

入口：

```text
更多 -> AI 设置
```

当前支持 OpenAI 兼容的 `chat/completions` 非流式接口。可配置多个供应商档案，每个档案包含：

- 供应商名称
- Base URL
- 模型名
- Temperature
- Max Tokens
- 上下文记忆轮数
- API Key

内置模板包括：

- DeepSeek：`https://api.deepseek.com`
- NVIDIA：`https://integrate.api.nvidia.com/v1`
- 阿里云百炼：`https://dashscope.aliyuncs.com/compatible-mode/v1`
- 自定义中转 API：用于 VectorEngine、硅基流动或其他 OpenAI 兼容代理

API Key 只保存在本机 `aiSecrets`，不会写入 README、代码、完整备份或导出文件。请不要把真实 Key 提交到仓库。

### Android 与 Web 的差异

Android 端优先通过原生 HTTP 桥接请求 AI 接口，更容易避开 WebView/CORS 限制。

Web 端使用浏览器 `fetch` 直连接口。如果供应商不允许浏览器跨域请求，Web 端会失败。这时可以：

- 优先在 Android App 中使用 AI；
- 配置支持 CORS 的中转 Base URL；
- 后续自行接入服务器代理。

## OCR

图片 OCR 成功后：

- 图片块会显示简洁 OCR 状态。
- OCR 文本可以被搜索命中。
- AI 日志问答会把 OCR 文本加入当天上下文。
- 完整 zip 备份会包含 OCR 文本和相关元数据。

如果 OCR 上游返回空文本，会显示明确失败原因，不再静默当成“只是图片文件”。倒置、拍照不正的手写笔记会优先启用方向分类和文档纠偏参数。

AI 不会自动读取日志中的原始图片文件；日志图片必须先 OCR，OCR 文本才会进入日志问答上下文。AI 聊天输入区临时上传的图片则按“本地 OCR 后转文字”或“直接发送给 AI”设置处理。

## 数据与隐私

应用是本地优先，没有账号系统和实时云同步。主要数据保存在本机 IndexedDB / Android WebView 存储中：

- 日志记录
- 学科设置
- 图片、音频、附件 Blob
- OCR 文本
- 收藏记录
- 回收站记录
- 未保存草稿
- AI 非敏感设置
- 本机 AI 聊天记录

重要提醒：卸载 App、清除应用数据、清理浏览器站点数据，都可能删除本地数据。请定期导出完整 zip 备份。

## 完整备份与恢复

### 导出完整备份

入口：

```text
更多 -> 完整备份
```

完整备份会生成 zip 文件，这是当前唯一可导入恢复的数据格式。zip 内包含：

- `manifest.json`：备份格式、版本、导出时间和数量统计。
- `data.json`：日志、学科、设置、OCR 元数据、草稿、回收站等结构化数据。
- `entries/`：按日期导出的 Markdown 日志。
- `assets/`：图片、音频、附件原始文件。

API Key 和 AI 聊天记录不进入完整备份。

### 导入恢复

入口：

```text
更多 -> 导入恢复
```

导入只接受完整备份 zip。导入是覆盖式恢复，会替换当前本地数据，建议导入前先导出一份当前备份。

导入成功后会显示：

- 导入了多少条日志
- 覆盖了多少天
- 图片、音频、附件资源数量
- 回收站记录数量
- 备份版本

如果文件不是 zip、zip 损坏、缺少 `data.json`、JSON 损坏或格式不兼容，页面会显示失败原因，并且不会覆盖当前数据。

### Android 与 Web 手动同步

当前没有实时云同步。Android 和 Web 之间通过完整 zip 手动同步。

Android 同步到 Web：

1. Android 打开“更多 -> 完整备份”。
2. 把 zip 发送到电脑。
3. Web 打开“更多 -> 导入恢复”。
4. 选择 zip 并恢复。

Web 同步到 Android：

1. Web 打开“更多 -> 完整备份”下载 zip。
2. 把 zip 发送到手机。
3. Android 打开“更多 -> 导入恢复”。
4. 选择 zip 并恢复。

注意：这是覆盖式同步，不是冲突合并。两端同时独立编辑后再互相导入，后导入的一端会覆盖当前数据。

## Web 端使用

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

## Android APK 使用

构建 debug APK：

```powershell
cd D:\NoteProject
npm.cmd run android:build:debug
```

APK 输出路径：

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

通过 adb 安装：

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
- 当前 APK 是 debug 构建，适合个人安装测试，不是应用商店发布版。
- AI 直接看图能力取决于所选模型和中转接口是否真正支持视觉输入。
- 聊天记录和 API Key 只保存在本机，不进入完整备份。

## 开发注意

- 当前 `appId/applicationId` 保持为 `com.noteproject.study408`，用于兼容已安装版本的数据。
- `dist/`、`android/app/build/`、`*.apk` 不应提交到仓库。
- 不要把真实 API Key、OCR Token 或其他密钥提交到仓库。
- 如果后续接入云同步，建议先实现“云端 latest zip 备份”，再逐步升级为结构化增量同步。
