# Teable Dev - Cloud Development Environment

One-click cloud development environment for Teable developers.

## Features

- 🚀 **Instant Start** - Pre-built image, ready in 60 seconds
- 💪 **Powerful Config** - 8 vCPU, 32GB RAM (c3-standard-8)
- 🔐 **Secure Auth** - GitHub OAuth + repository access verification
- 🔑 **Auto SSH** - Automatically fetches SSH keys from GitHub
- ⏰ **Auto Cleanup** - Destroys after 12 hours of no SSH connections

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

```text
┌─────────────────────────────────────────────────────────────────┐
│                         User Flow                               │
├─────────────────────────────────────────────────────────────────┤
│   1. Visit dev.teable.ai                                        │
│   2. GitHub OAuth login (verify teable-ee access)               │
│   3. Click create environment                                   │
│   4. Auto-fetch GitHub SSH public keys                          │
│   5. Create GCP VM (asia-east2, c3-standard-8)                  │
│   6. Return connection info (SSH / VS Code / Cursor)            │
│   7. Auto-destroy after 12 hours of inactivity                  │
└─────────────────────────────────────────────────────────────────┘
```