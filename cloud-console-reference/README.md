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

## 客户端配额与本地边界

- 普通同步只发布相对本机 ledger 发生变化的实体和复习事件；无本地变化且远端 revision 已见时不获取云端锁。
- 预计读取量超过客户端阈值时先确认；预计写入超过 5,000 次、Storage 对象超过 500 个或上传超过 100 MiB 时也先确认。
- 首次空设备恢复、旧协议迁移和显式选择本地版本解决冲突仍可能产生全量读写，应在账单报告中单独观察。
- 知识播客记录与音频、AI/OCR 密钥、完整 Prompt、Provider 原始响应和本机备份目录不上传 Firebase。
- 云端复习事件仍为追加历史；当前没有安全的远端压缩协议，不要手动批量删除事件文档。

## 本地 Emulator 验收

运行 `npm run test:firebase` 会使用 `demo-noteproject-stage9` 隔离项目启动 Firestore 与 Storage Emulator，不连接真实项目。测试覆盖用户命名空间隔离、有限增量写入、无变化重复同步零新增写入、中断恢复和客户端时钟偏移下按 revision 收敛。该测试证明协议行为，但不能替代 Firebase 控制台中的真实 reads/writes、Storage bytes 和账单核对。

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
