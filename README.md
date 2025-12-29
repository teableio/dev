# Teable Dev - Cloud Development Environment

One-click cloud development environment for Teable developers.

## Features

- 🚀 **Instant Start** - Pre-built image, ready in 60 seconds
- 💪 **Powerful Config** - 8 vCPU, 32GB RAM (n2-standard-8)
- 🔐 **Secure Auth** - GitHub OAuth + repository access verification
- 🔑 **Auto SSH** - Automatically fetches SSH keys from GitHub
- ⏰ **Auto Cleanup** - Destroys after 12 hours of no SSH connections
- 🌏 **Hong Kong Region** - Low latency access

## Quick Start

### Prerequisites

1. Access to `teableio/teable-ee` repository
2. SSH public key added to your GitHub account

### Usage

1. Visit https://dev.teable.ai
2. Click "Sign in with GitHub"
3. Click "Create Environment"
4. Wait ~60 seconds
5. Connect via SSH or VS Code/Cursor

## Local Development

```bash
# Install dependencies
pnpm install

# Configure environment variables
cp env.example.txt .env.local
# Edit .env.local with actual values

# Start development server
pnpm dev
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret |
| `AUTH_SECRET` | NextAuth secret (generate with `openssl rand -base64 32`) |
| `AUTH_URL` | Application URL (e.g., `https://dev.teable.ai`) |
| `GCP_PROJECT_ID` | GCP Project ID |
| `GCP_ZONE` | GCP Zone (default: `asia-east2-a`) |
| `GCP_MACHINE_TYPE` | Machine type (default: `n2-standard-8`) |
| `GCP_IMAGE_FAMILY` | Image family (default: `teable-dev`) |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | GCP service account credentials JSON |

## Deployment

### Deploy to Vercel

This project is configured for Vercel deployment. Set the environment variables in your Vercel project settings.

### Configure Domain

1. Add custom domain in Vercel dashboard
2. Configure DNS records as instructed

### Daily Image Builds

Image builds are automated via GitHub Actions (`.github/workflows/build-image.yml`):
- Triggered daily at 03:00 HKT (19:00 UTC)
- Can be manually triggered from Actions tab

### Auto Cleanup

```bash
# Deploy cleanup function
cd infra/cleanup-function
gcloud functions deploy teable-dev-cleanup \
  --gen2 \
  --runtime=python311 \
  --trigger-http \
  --entry-point=cleanup_handler \
  --region=asia-east2 \
  --set-env-vars "GCP_PROJECT_ID=xxx,GCP_ZONE=asia-east2-a,IDLE_TIMEOUT_HOURS=12"

# Create scheduled job
gcloud scheduler jobs create http teable-dev-cleanup \
  --schedule="0 * * * *" \
  --uri="FUNCTION_URL" \
  --http-method=POST \
  --time-zone="Asia/Hong_Kong"
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Flow                               │
├─────────────────────────────────────────────────────────────────┤
│   1. Visit dev.teable.ai                                        │
│   2. GitHub OAuth login (verify teable-ee access)               │
│   3. Click create environment                                   │
│   4. Auto-fetch GitHub SSH public keys                          │
│   5. Create GCP VM (asia-east2, n2-standard-8)                  │
│   6. Return connection info (SSH / VS Code / Cursor)            │
│   7. Auto-destroy after 12 hours of inactivity                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      Background Tasks                           │
├─────────────────────────────────────────────────────────────────┤
│   • Daily 03:00 HKT image build (GitHub Actions)                │
│   • Hourly check and cleanup idle environments (Cloud Function) │
│   • Retain last 7 days of images                                │
└─────────────────────────────────────────────────────────────────┘
```

## Cost Estimate

| Resource | Cost |
|----------|------|
| Vercel | Free tier |
| Cloud Function | ~$1/month |
| VM (n2-standard-8) | ~$0.40/hour |
| Image storage (50GB × 7) | ~$5/month |

**Fixed cost**: ~$6/month  
**VM cost**: Pay per use

## License

MIT
