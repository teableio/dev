# AGENTS.md

This file provides guidance for AI coding agents working on the Teable Dev project.

## Project Overview

Teable Dev is a one-click cloud development environment platform for Teable developers. It creates and manages GCP Compute Engine instances with pre-built images, providing instant development environments.

**Key Features:**
- GitHub OAuth authentication with repository access verification
- GCP VM lifecycle management (create, stop, resume, delete)
- Automatic SSH key fetching from GitHub
- Snapshot-based environment persistence
- Auto-cleanup after 12 hours of inactivity

**Tech Stack:**
- Next.js 15.5 with App Router
- TypeScript (strict mode)
- TailwindCSS 4
- NextAuth 5 (beta) for authentication
- Google Cloud Compute API
- pnpm 10.26+ as package manager

## Setup Commands

```bash
# Install dependencies
pnpm install

# Configure environment (copy and edit .env.local)
cp env.example.txt .env.local

# Start development server (port 3000)
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Run linting
pnpm lint
```

## Code Style

- TypeScript strict mode enabled
- Use `@/*` path alias for imports from `src/` directory
- React Server Components by default, use `"use client"` when needed
- Use `lucide-react` for icons
- Follow Next.js App Router conventions
- Comments in English
- No semicolons (follows project prettier/eslint config)
- Prefer functional components and hooks

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── auth/          # NextAuth.js handlers
│   │   └── environment/   # Environment management API
│   ├── dashboard/         # Protected dashboard page
│   ├── error/             # Error page
│   ├── unauthorized/      # Access denied page
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Landing page
│   └── globals.css        # Global styles (TailwindCSS 4)
├── components/            # React components
│   └── environment-panel.tsx  # Main dashboard component
├── lib/                   # Utility libraries
│   ├── gcp.ts             # GCP Compute Engine integration
│   └── machine-configs.ts # VM machine type configurations
├── auth.ts                # NextAuth configuration
└── middleware.ts          # Route protection middleware

infra/                     # Infrastructure scripts
├── cleanup-function/      # Python Cloud Function for auto-cleanup
└── image-builder/         # Scripts to build base GCP images
```

## Key Files

| File | Purpose |
|------|---------|
| `src/auth.ts` | GitHub OAuth config, repo access verification, session management |
| `src/lib/gcp.ts` | All GCP operations: create/stop/delete VMs, snapshots, metadata |
| `src/lib/machine-configs.ts` | VM machine types with fallback order (C4 → C3 → N2) |
| `src/middleware.ts` | Protects `/dashboard` and `/api/*` routes |
| `src/components/environment-panel.tsx` | Client component for environment management UI |
| `infra/image-builder/build-image.sh` | Builds pre-configured GCP images |
| `infra/cleanup-function/main.py` | Cloud Function for auto-cleanup of idle VMs |

## Environment Variables

Required environment variables (see `env.example.txt`):

```
GITHUB_CLIENT_ID          # GitHub OAuth App client ID
GITHUB_CLIENT_SECRET      # GitHub OAuth App client secret
AUTH_SECRET               # NextAuth secret (generate with: openssl rand -base64 32)
AUTH_URL                  # Application URL (e.g., https://dev.teable.ai)
GCP_PROJECT_ID            # GCP project ID
GCP_ZONE                  # GCP zone (e.g., asia-southeast1-a)
GCP_MACHINE_TYPE          # Default machine type
GCP_IMAGE_FAMILY          # GCP image family name
```

Optional:
```
GOOGLE_APPLICATION_CREDENTIALS_JSON  # GCP service account JSON (for non-GCP environments)
```

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/[...nextauth]` | * | NextAuth.js handler |
| `/api/environment` | GET | Get user's environment status |
| `/api/environment` | POST | Create new environment |
| `/api/environment` | DELETE | Delete environment |
| `/api/environment?action=stop` | POST | Stop (snapshot) environment |
| `/api/environment?action=start` | POST | Start stopped environment |

## GCP Integration

The app manages GCP Compute Engine instances with the following workflow:

1. **Create**: Provisions VM from family image or user's snapshot
2. **Stop**: Creates snapshot and deletes VM (saves costs, preserves data)
3. **Start**: Creates new VM from user's snapshot
4. **Delete**: Removes both VM and snapshot permanently

Machine types are tried in fallback order when quota is exceeded:
1. `c4-standard-8` (8 vCPU, 30GB) - requires hyperdisk-balanced
2. `c3-standard-8` (8 vCPU, 32GB) - uses pd-ssd
3. `n2-standard-8` (8 vCPU, 32GB) - uses pd-ssd
4. `n2-standard-4` (4 vCPU, 16GB) - uses pd-ssd

## Authentication Flow

1. User clicks "Sign in with GitHub"
2. OAuth redirects to GitHub with scopes: `read:user`, `read:org`, `repo`
3. On callback, `checkRepoAccess()` verifies access to `teableio/teable-ee`
4. If no access → redirect to `/unauthorized`
5. If access → session created with `accessToken` and `username`
6. Protected routes check session via middleware

## UI/UX Guidelines

- Dark theme with slate color palette
- Gradient backgrounds with ambient blur effects
- Emerald/cyan accent colors
- Use `lucide-react` icons consistently
- Responsive design with max-width containers
- Loading states with spinners and disabled buttons
- Toast-style notifications (where applicable)

## Testing

Currently no automated tests. When adding tests:

- Use Vitest for unit tests
- Use Playwright for E2E tests
- Mock GCP API calls in tests
- Test authentication flows with mock sessions

## Common Tasks

### Adding a new API endpoint

1. Create route file in `src/app/api/<endpoint>/route.ts`
2. Import `auth` from `@/auth` for session access
3. Use `NextResponse.json()` for responses
4. Middleware auto-protects `/api/*` routes

### Adding a new machine type

1. Add config to `MACHINE_CONFIGS` array in `src/lib/machine-configs.ts`
2. Specify correct `diskType` (hyperdisk-balanced for C4, pd-ssd for others)
3. Update any UI that displays machine types

### Modifying VM startup script

1. Edit `getStartupScript()` function in `src/lib/gcp.ts`
2. Script runs as root on VM boot
3. Sets up SSH keys, git credentials, and starts services

## Security Considerations

- GitHub tokens are stored in session, not persisted to database
- GCP credentials via service account or `GOOGLE_APPLICATION_CREDENTIALS_JSON`
- User's GitHub SSH keys are fetched at VM creation time
- VMs are labeled with `purpose: dev-env` for identification
- Sensitive metadata (github-token) is removed before creating images

## Infrastructure

### Building a new base image

```bash
cd infra/image-builder
GITHUB_TOKEN=ghp_xxx ./build-image.sh
```

This creates an Ubuntu 24.04 image with:
- Docker, pnpm, Node.js
- Teable-ee repository cloned
- All dependencies pre-installed
- Ready for instant development

### Cleanup Function

Located in `infra/cleanup-function/`, runs as a Cloud Function to auto-delete VMs inactive for 12+ hours (no SSH connections).

