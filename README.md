# 学习日志

一个本地优先的学习记录应用，支持 Web/PWA 与 Android APK 双端共用同一套 React 前端代码。它适合长期记录学习日志、按学科管理笔记、保存图片/音频/附件、做 OCR 检索，并把当天日志整理成 AI 问答上下文。

## 功能概览

- **今天**：打开即进入当天学习工作台，可选择学科新建记录。
- **日志**：按月份热力图和最近日志浏览，支持按日期、学科下钻查看。
- **分类**：支持自定义学科、新增、重命名、归档隐藏和排序。
- **记录编辑**：线性文档式编辑，支持文字、图片、音频、录音、附件和公式混排。
- **资源管理**：图片缩略图和灯箱预览，附件/音频下载，音频播放与倍速。
- **OCR**：Android 端可对图片自动/手动 OCR，OCR 文本进入搜索和 AI 问答上下文。
- **搜索**：全文搜索记录标题、正文、公式、资源标题、文件名和图片 OCR 文本。
- **收藏夹与回收站**：记录可星标收藏；删除先进入回收站，30 天后自动清理。
- **备份恢复**：完整 zip 备份可在 Web 与 Android 之间互相导入恢复。
- **AI 问答**：可基于某一天日志开启多轮 AI 对话，支持 OpenAI 兼容接口配置。
- **AI 材料导出**：可导出按学科 Markdown、知识库 JSON、纯文本 TXT，方便喂给 AI 复习。

## 技术栈

- React + TypeScript + Vite
- Dexie / IndexedDB 本地数据库
- TipTap 富文本编辑器
- JSZip 完整备份与恢复
- Vite PWA 离线缓存
- Capacitor Android 打包

## Web 端使用

### 安装依赖

```powershell
cd D:\NoteProject
npm.cmd install
```

### 开发模式运行

```powershell
cd D:\NoteProject
npm.cmd run dev
```

浏览器打开终端显示的地址，通常是：

```text
http://localhost:5173/
```

如果想让同一局域网手机浏览器访问电脑上的 Web 端：

```powershell
npm.cmd run dev -- --host 0.0.0.0
```

然后在手机浏览器打开：

```text
http://电脑局域网IP:5173/
```

Windows 防火墙可能会拦截端口，需要允许 Node/Vite 访问网络。

### 生产构建和预览

```powershell
npm.cmd run build
npm.cmd run preview
```

`npm.cmd run build` 会生成 `dist/`，并生成 PWA 的 `manifest.webmanifest` 和 Service Worker。

## Android 端使用

### 构建 debug APK

项目使用 Capacitor Android。当前脚本默认使用：

```text
C:\Program Files\Java\jdk-21
```

如本机 JDK 路径不同，请修改：

```text
scripts/android-debug-build.ps1
```

构建命令：

```powershell
cd D:\NoteProject
npm.cmd run android:build:debug
```

APK 输出路径：

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

### 安装到安卓手机

可以用数据线和 adb 安装：

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

也可以把 APK 发到手机后手动安装。首次安装可能需要在 Android 系统里允许“安装未知来源应用”。

### Android 数据说明

Android 端数据保存在 App WebView 的 IndexedDB 中。卸载 App、清除应用数据、部分手机管家深度清理，都可能删除本地数据。因此请定期导出完整备份。

## 数据存储

当前版本是本地优先，不依赖服务器、不需要账号。

- 日志、学科、设置、AI 聊天记录等结构化数据保存在 IndexedDB。
- 图片、音频、附件以 Blob 形式保存在本地数据库。
- AI API Key 仅保存在本机，不会进入完整备份。
- AI 聊天记录也只保存在本机，不进入完整备份。

## 备份、恢复与原始数据同步

当前没有实时云同步。Web 与 Android 之间的数据同步方式是 **完整 zip 备份互通**。

### 完整备份

入口：

```text
更多 → 完整备份
```

Web 端会下载一个 zip 文件。Android 端会写入本机文档目录并调起系统分享/保存面板。

完整备份 zip 包含：

- `manifest.json`：备份格式、版本、导出时间和数量统计。
- `data.json`：日志、学科、设置、OCR 元数据等结构化数据。
- `entries/`：按日期导出的 Markdown 日志。
- `assets/`：图片、音频、附件原始文件。

完整备份是唯一可恢复格式。

### 导入恢复

入口：

```text
更多 → 导入恢复 → 从 zip 导入
```

导入会覆盖当前本地数据，导入前建议先导出一份完整备份。导入成功后会显示导入了多少条日志、覆盖多少天、资源数量、回收站记录数量和备份版本。

如果文件格式不支持、zip 损坏、缺少 `data.json`、备份版本不兼容或 JSON 损坏，应用会显示明确失败原因，并且不会覆盖当前数据。

### 手机和电脑之间同步的推荐流程

从 Android 同步到 Web：

1. Android 打开 `更多 → 完整备份`。
2. 将 zip 分享到微信、网盘、数据线或电脑文件夹。
3. 电脑 Web 端打开 `更多 → 导入恢复`。
4. 选择这个 zip，等待恢复完成。

从 Web 同步到 Android：

1. Web 端打开 `更多 → 完整备份`，下载 zip。
2. 把 zip 发送到手机。
3. Android 打开 `更多 → 导入恢复`。
4. 选择 zip，等待恢复完成。

注意：这是覆盖式恢复，不是合并同步。两端同时独立编辑后再互相导入，后导入的一端会覆盖当前本地数据。重要数据请先备份。

## AI 材料导出

入口：

```text
更多 → AI 材料导出
```

支持三种格式：

- **按学科 Markdown**：生成 `subjects/学科.md`，适合直接给 AI 做复习问答。
- **知识库 JSON**：结构化导出记录 id、日期、学科、标题、正文、公式、资源标题和 OCR 文本。
- **纯文本 TXT**：生成一个总文本，适合快速复制给 AI。

这些格式只用于阅读、问答和复习出题，不能用于恢复数据。恢复数据请使用完整 zip 备份。

## OCR 与搜索

图片 OCR 主要面向 Android 端。Web 端直接调用 OCR 服务可能受到浏览器 CORS 限制。

OCR 成功后：

- 图片卡片会显示 `OCR✅`。
- OCR 文本会进入全文搜索。
- AI 问答构造当天日志上下文时，会把已完成 OCR 的图片文字加入上下文。

未 OCR 或 OCR 失败的图片不会把原图上传给 AI，只会提示未参与问答。

## AI 问答配置

入口：

```text
更多 → AI 设置
```

支持 OpenAI 兼容接口配置：

- Provider 名称
- Base URL
- API Key
- Model
- Temperature
- Max Tokens
- 预设提示词

API Key 仅保存在本机，不进入完整备份，也不会被导入恢复覆盖。

Web 端直连第三方 AI 接口可能遇到 CORS 限制；Android 端通过原生 HTTP 桥接更可靠。

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

## 开发注意事项

- `dist/`、`android/app/build/`、`*.apk`、日志文件不会提交到仓库。
- 当前 `applicationId/appId` 保持为 `com.noteproject.study408`，用于兼容已有安装数据。
- 当前没有服务器和账号系统，云同步尚未启用。
- 如果后续接云同步，建议先做“云端 latest zip 备份”，再逐步升级到结构化增量同步。

## 当前限制

- 多端同步是手动 zip 备份互通，不是实时云同步。
- 导入是覆盖式恢复，不做冲突合并。
- Android APK 是 debug 构建，不是应用商店发布版。
- OCR Token 当前适合个人本机使用，公开分发前应改为服务器代理或用户本地配置。
