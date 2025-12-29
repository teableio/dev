# Teable Dev - Cloud Development Environment

一键创建云端开发环境，专为 Teable 开发者设计。

## 特性

- 🚀 **即时启动** - 预制镜像，60秒内启动完成
- 💪 **强大配置** - 8 vCPU, 32GB RAM (n2-standard-8)
- 🔐 **安全认证** - GitHub OAuth + 仓库权限校验
- 🔑 **自动 SSH** - 自动从 GitHub 获取公钥
- ⏰ **自动清理** - 无 SSH 连接 12 小时后自动销毁
- 🌏 **香港区域** - 低延迟访问

## 快速开始

### 前提条件

1. 拥有 `teableio/teable-ee` 仓库访问权限
2. GitHub 账号已添加 SSH 公钥

### 使用方法

1. 访问 https://dev.teable.ai
2. 点击 "Sign in with GitHub"
3. 点击 "Create Environment"
4. 等待约 60 秒
5. 使用 SSH 或 VS Code 连接

## 本地开发

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp env.example.txt .env.local
# 编辑 .env.local 填入实际值

# 启动开发服务器
pnpm dev
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret |
| `AUTH_SECRET` | NextAuth 密钥 (使用 `openssl rand -base64 32` 生成) |
| `AUTH_URL` | 应用 URL (如 `https://dev.teable.ai`) |
| `GCP_PROJECT_ID` | GCP 项目 ID |
| `GCP_ZONE` | GCP 区域 (默认 `asia-east2-a`) |
| `GCP_MACHINE_TYPE` | 机器类型 (默认 `n2-standard-8`) |
| `GCP_IMAGE_FAMILY` | 镜像家族 (默认 `teable-dev`) |

## 部署

### 部署到 Cloud Run

```bash
# 构建镜像
gcloud builds submit --tag gcr.io/PROJECT_ID/teable-dev

# 部署
gcloud run deploy teable-dev \
  --image gcr.io/PROJECT_ID/teable-dev \
  --region asia-east2 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "GITHUB_CLIENT_ID=xxx,GITHUB_CLIENT_SECRET=xxx,AUTH_SECRET=xxx,AUTH_URL=https://dev.teable.ai"
```

### 配置域名

1. 在 Cloud Run 控制台添加自定义域名
2. 配置 DNS CNAME 记录指向 Cloud Run

### 设置每日镜像构建

```bash
# 创建 Cloud Scheduler 任务
gcloud scheduler jobs create http teable-dev-image-build \
  --schedule="0 19 * * *" \
  --uri="https://cloudbuild.googleapis.com/v1/projects/PROJECT_ID/triggers/TRIGGER_ID:run" \
  --http-method=POST \
  --time-zone="Asia/Hong_Kong"
```

### 设置自动清理

```bash
# 部署清理函数
cd infra/cleanup-function
gcloud functions deploy teable-dev-cleanup \
  --gen2 \
  --runtime=python311 \
  --trigger-http \
  --entry-point=cleanup_handler \
  --region=asia-east2 \
  --set-env-vars "GCP_PROJECT_ID=teable-666,GCP_ZONE=asia-east2-a,IDLE_TIMEOUT_HOURS=12"

# 创建定时任务
gcloud scheduler jobs create http teable-dev-cleanup \
  --schedule="0 * * * *" \
  --uri="FUNCTION_URL" \
  --http-method=POST \
  --time-zone="Asia/Hong_Kong"
```

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户流程                                 │
├─────────────────────────────────────────────────────────────────┤
│   1. 访问 dev.teable.ai                                         │
│   2. GitHub OAuth 登录 (校验 teable-ee 权限)                    │
│   3. 点击创建环境                                                │
│   4. 自动获取 GitHub SSH 公钥                                   │
│   5. 创建 GCP VM (asia-east2, n2-standard-8)                    │
│   6. 返回连接信息 (SSH / VS Code)                               │
│   7. 无活动 12 小时后自动销毁                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         后台任务                                 │
├─────────────────────────────────────────────────────────────────┤
│   • 每日 03:00 HKT 构建新镜像 (Cloud Build)                     │
│   • 每小时检查并清理闲置环境 (Cloud Function)                   │
│   • 保留最近 7 天镜像                                           │
└─────────────────────────────────────────────────────────────────┘
```

## 成本估算

| 资源 | 费用 |
|------|------|
| Cloud Run | ~$5/月 |
| Cloud Build (每日) | ~$5/月 |
| Cloud Function | ~$1/月 |
| VM (n2-standard-8) | ~$0.40/小时 |
| 镜像存储 (50GB × 7) | ~$5/月 |

**固定成本**: ~$16/月  
**VM 成本**: 按使用时间计费

## License

Private - Teable Team Only
