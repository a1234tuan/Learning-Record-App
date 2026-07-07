# 开源发布与仓库收尾指南

这份文档用于把当前项目整理成适合公开到 GitHub 的仓库。它重点解决三个问题：

- 当前工作树如何保持干净。
- 以前提交过 APK、ZIP、IDE 缓存或签名产物时，如何处理历史。
- 远程仓库已经有内容或不干净时，如何安全发布。

## 当前仓库体检结论

本地当前 HEAD 的情况：

- 当前跟踪文件中没有 APK、AAB、keystore、JKS、ZIP 备份包。
- `.gitignore` 已忽略 `dist/`、`dev-dist/`、Android build 输出、APK 和签名文件。
- Git 历史中出现过 `Learning-Record-App-v0.1.0-debug-apk.zip`。
- Git 历史中出现过 `.idea/caches/deviceStreaming.xml`。

这意味着：当前版本看起来已经比较干净，但如果直接公开完整历史，历史里的安装包和 IDE 缓存仍然会被别人拉到。

## 推荐发布方式

如果这个项目还没有外部贡献者、issue、release 或别人依赖的 commit，最推荐使用“干净首发历史”：

1. 在 GitHub 新建一个全新的空仓库。
2. 本地基于当前代码创建一个全新的 orphan 分支。
3. 只提交当前干净文件。
4. 推送为远程 `main`。
5. 以后 APK 只放到 GitHub Releases，不提交到 Git。

示例命令：

```powershell
git status --short

git switch --orphan public-main
git add .
git commit -m "Initial open-source release"

git remote set-url origin git@github.com:<your-name>/<your-repo>.git
git push -u origin public-main:main
```

确认 GitHub 新仓库正常后，可以把本地分支切到 `main`：

```powershell
git branch -M main
git push -u origin main
```

这种方式最干净，也最容易解释：公开仓库从一个“开源初始版本”开始，旧的私有开发历史不进入公开仓库。

## 如果必须复用旧远程仓库

如果你要继续使用现有远程仓库，并且想清除历史里的 APK、ZIP、IDE 缓存或签名文件，可以用 `git filter-repo` 重写历史。

重写前请先备份：

```powershell
git status --short
git branch backup-before-open-source
git tag backup-before-open-source
```

安装 `git-filter-repo` 后，可以清理常见产物：

```powershell
git filter-repo `
  --path-glob "*.apk" `
  --path-glob "*.aab" `
  --path-glob "*.zip" `
  --path-glob "*.jks" `
  --path-glob "*.keystore" `
  --path-glob "*.p12" `
  --path-glob "*.pem" `
  --path-glob ".idea/*" `
  --path-glob "dist/*" `
  --path-glob "dev-dist/*" `
  --path-glob "android/app/build/*" `
  --invert-paths
```

然后检查历史最大文件：

```powershell
git rev-list --objects --all |
  ForEach-Object {
    $parts = $_ -split " ", 2
    $sha = $parts[0]
    $path = if ($parts.Count -gt 1) { $parts[1] } else { "" }
    $size = [int64](git cat-file -s $sha 2>$null)
    [PSCustomObject]@{ Size = $size; Sha = $sha; Path = $path }
  } |
  Sort-Object Size -Descending |
  Select-Object -First 30 |
  Format-Table -AutoSize
```

历史重写后需要强制推送：

```powershell
git push --force-with-lease origin main
```

注意：历史重写会改变 commit hash。其他已经 clone 过旧仓库的人需要重新 clone，不能继续基于旧历史正常协作。

## 远程仓库“不干净”的处理策略

如果远程仓库里有旧 README、旧安装包、错误分支或不相关内容，有三种处理方式：

### 方案 A：新建仓库

最推荐。优点是没有历史包袱，也不会误删远程内容。

适合：

- 远程历史混乱。
- 之前传过安装包、签名产物或私人文件。
- 不需要保留旧 issue、star、release。

### 方案 B：保留远程，但开新默认分支

创建 `main` 或 `public-main`，把它设置为 GitHub 默认分支。旧分支保留但不作为公开入口。

适合：

- 想保留旧历史作为参考。
- 不想马上 force push。
- 但仍要提醒：旧分支如果公开，历史文件仍然可见。

### 方案 C：重写旧远程历史

用 `git filter-repo` 清理后 `--force-with-lease` 推送。

适合：

- 确定要复用旧仓库地址。
- 可以接受所有人重新 clone。
- 已确认没有需要保留的旧 commit hash。

## APK 和 release 文件如何管理

不要把 APK、AAB、ZIP 安装包提交到 Git。

推荐流程：

1. 构建 debug/release 包。
2. 计算 SHA256。
3. 在 GitHub Releases 创建版本。
4. 把 APK 作为 release asset 上传。
5. Release notes 写清楚版本、变更、安装说明和校验值。

示例：

```powershell
Get-FileHash .\dev-dist\release\学习日志.apk -Algorithm SHA256
```

## 签名文件和密钥

永远不要提交：

- `android/keystore.properties`
- `*.jks`
- `*.keystore`
- `*.p12`
- `*.pem`
- `.env`
- API Key、OCR Token、AI Token

如果这些内容曾经提交到公开远程，即使后来删除，也应该视为泄露：

- 立即重置 API Key / Token。
- 更换 release keystore 时，要注意 Android 已安装用户无法直接升级到新签名包。
- 用历史重写移除文件，但不要把“重写历史”当成密钥已经安全的唯一手段。

## 开源前检查清单

- [ ] `git status --short` 干净。
- [ ] `npm run test` 通过。
- [ ] `npm run build` 通过。
- [ ] Android debug/release 构建通过。
- [ ] 当前跟踪文件中没有 APK、AAB、ZIP、keystore、JKS、`.env`。
- [ ] Git 历史已决定：新仓库干净首发，或 filter-repo 重写。
- [ ] 已添加 `LICENSE`。
- [ ] README 中没有本机绝对路径、私人账号、API Key、Token。
- [ ] GitHub Releases 用于发布安装包。
- [ ] GitHub 默认分支设置为 `main`。
- [ ] GitHub 仓库描述、topics、release notes 已整理。

## 建议的 GitHub topics

```text
learning-journal
spaced-repetition
fsrs
react
typescript
vite
capacitor
android
indexeddb
ocr
ai-notes
local-first
```

## 建议的项目简介

```text
本地优先的学习日志、复习回访与 AI 自测应用，支持富编辑器、混合复习、OCR、搜索、录音和 Android 增量备份。
```

英文版：

```text
A local-first study journal for learning logs, hybrid spaced review, AI self-testing, OCR search, recordings, and Android incremental backup.
```
