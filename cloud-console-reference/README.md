# Google Cloud 对照入口

App 云同步实际使用的项目 ID：`study-journal-408-9f31`。

不要在 `learning-record-tts` 项目中核对 App 的同步费用或用量。

## 建议截图顺序

1. [账单概览](https://console.cloud.google.com/billing?project=study-journal-408-9f31)
   - 确认账单账户、免费试用状态、赠金余额与到期日。
2. [账单报告](https://console.cloud.google.com/billing/reports?project=study-journal-408-9f31)
   - 服务筛选：Cloud Firestore、Cloud Storage。
3. [Firebase Firestore](https://console.firebase.google.com/project/study-journal-408-9f31/firestore)
   - 查看数据库、文档读取/写入及存储用量。
4. [Firebase Storage](https://console.firebase.google.com/project/study-journal-408-9f31/storage)
   - 查看桶内文件、存储量和下载相关用量。
5. [启用的 API](https://console.cloud.google.com/apis/dashboard?project=study-journal-408-9f31)
   - 确认没有额外启用 Compute Engine、Cloud Run 或 Cloud Functions。

## 当前同步涉及的云产品

- Firebase Authentication：Google 登录。
- Cloud Firestore：同步实体、修订、冲突状态和恢复快照。
- Cloud Storage：媒体、超大文本与旧版 ZIP 恢复点。

同步不使用虚拟机、Cloud Run、Cloud Functions、Hosting 或后台定时任务。

## 安全规则部署

项目根目录包含 `firestore.rules` 和 `storage.rules`。每次修改规则后需手动部署：

```bash
npm install -g firebase-tools
firebase login
firebase use study-journal-408-9f31
firebase deploy --only firestore:rules,storage
```

规则逻辑：只有 `request.auth.uid == userId` 的用户才能读写 `users/{userId}/` 下的所有数据。
未登录用户或其他用户均无法访问。

**注意**：`android/app/google-services.json` 已加入 `.gitignore`，不提交到版本库。
部署新环境时需从 Firebase 控制台重新下载该文件。
