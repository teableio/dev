#!/bin/bash
# Setup script for Teable Dev Environment Image
# This runs inside the VM during image creation

set -e
exec > >(tee /var/log/image-setup.log) 2>&1

echo "=== Starting Teable Dev Image Setup ==="
echo "Date: $(date)"

export DEBIAN_FRONTEND=noninteractive

# Update system
echo ""
echo "=== Updating system packages ==="
apt-get update
apt-get upgrade -y

# Install essential tools
echo ""
echo "=== Installing essential tools ==="
apt-get install -y \
  curl \
  wget \
  git \
  vim \
  htop \
  tmux \
  jq \
  unzip \
  build-essential \
  ca-certificates \
  gnupg \
  lsb-release \
  software-properties-common

# Install Docker
echo ""
echo "=== Installing Docker ==="
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Install Node.js 22
echo ""
echo "=== Installing Node.js 22 ==="
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Enable corepack and install pnpm
echo ""
echo "=== Setting up pnpm ==="
corepack enable
corepack prepare pnpm@latest --activate

# Create developer user and group
echo ""
echo "=== Creating developer user and group ==="
groupadd developer 2>/dev/null || true
useradd -m -s /bin/bash -g developer developer || true
usermod -aG docker developer
usermod -aG sudo developer
usermod -aG developer developer
echo "developer ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Clone teable-ee repository
echo ""
echo "=== Cloning teable-ee repository ==="
cd /home/developer

# Check if GITHUB_TOKEN is available (from instance metadata)
GITHUB_TOKEN=$(curl -s "http://metadata.google.internal/computeMetadata/v1/instance/attributes/github-token" -H "Metadata-Flavor: Google" 2>/dev/null || echo "")

if [ -n "$GITHUB_TOKEN" ]; then
  echo "Using GitHub token for authentication"
  sudo -u developer git clone --depth 1 -b develop "https://${GITHUB_TOKEN}@github.com/teableio/teable-ee.git" workspace
  # Remove token from git remote for security
  cd workspace
  sudo -u developer git remote set-url origin https://github.com/teableio/teable-ee.git
  cd /home/developer
else
  echo "WARNING: No GitHub token found. Trying SSH key or falling back to public repo."
  sudo -u developer git clone --depth 1 -b develop git@github.com:teableio/teable-ee.git workspace || \
  sudo -u developer git clone --depth 1 -b develop https://github.com/teableio/teable-ee.git workspace || {
    echo "Failed to clone teable-ee (private repo). Cloning teable instead."
    sudo -u developer git clone --depth 1 -b develop https://github.com/teableio/teable.git workspace
  }
fi

# Install dependencies
echo ""
echo "=== Installing project dependencies ==="
cd /home/developer/workspace
sudo -u developer bash -c 'export HOME=/home/developer && pnpm install --frozen-lockfile' || {
  echo "pnpm install with frozen lockfile failed, trying without..."
  sudo -u developer bash -c 'export HOME=/home/developer && pnpm install'
}

# Set correct ownership and permissions
chown -R developer:developer /home/developer

# Make workspace accessible to all users (they will login with their GitHub username)
chmod 755 /home/developer
chmod -R a+rX /home/developer/workspace
# Allow group write access so any user in developer group can modify files
chmod -R g+w /home/developer/workspace

# Configure git safe.directory for all users (prevents "dubious ownership" errors)
# This is needed because workspace is owned by developer but accessed by other users
# Must be done BEFORE any git commands that access the workspace
git config --system --add safe.directory /home/developer/workspace
git config --system --add safe.directory '*'

# Save commit info for image description
cd /home/developer/workspace
COMMIT_SHA=$(git rev-parse --short HEAD)
COMMIT_MSG=$(git log -1 --pretty=format:'%s' | head -c 100)
COMMIT_AUTHOR=$(git log -1 --pretty=format:'%an')
echo "COMMIT_SHA=$COMMIT_SHA" > /home/developer/.image-info
echo "COMMIT_MSG=$COMMIT_MSG" >> /home/developer/.image-info
echo "COMMIT_AUTHOR=$COMMIT_AUTHOR" >> /home/developer/.image-info
echo "BUILD_DATE=$(date -Iseconds)" >> /home/developer/.image-info

# Also output to console/serial for CI to read
echo ""
echo "=== COMMIT INFO ==="
echo "COMMIT_SHA=$COMMIT_SHA"
echo "COMMIT_MSG=$COMMIT_MSG"
echo "COMMIT_AUTHOR=$COMMIT_AUTHOR"
echo "==================="

# Pre-pull common Docker images
echo ""
echo "=== Pre-pulling Docker images ==="
docker pull postgres:15 || true
docker pull redis:7 || true

# Install Playwright dependencies (for testing)
echo ""
echo "=== Installing Playwright dependencies ==="
sudo -u developer bash -c 'cd /home/developer/workspace && npx playwright install-deps' || true
sudo -u developer bash -c 'cd /home/developer/workspace && npx playwright install' || true

# Configure SSH
echo ""
echo "=== Configuring SSH ==="
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config

# Generate fixed SSH host keys for the image
# This ensures all instances from this image have the same host keys
# so users won't get "HOST IDENTIFICATION HAS CHANGED" errors
echo ""
echo "=== Generating fixed SSH host keys ==="

# Remove any existing host keys
rm -f /etc/ssh/ssh_host_*

# Generate new host keys with fixed seed (using image build time as comment)
ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N "" -C "teable-dev-image-$(date +%Y%m%d)"
ssh-keygen -t ecdsa -b 256 -f /etc/ssh/ssh_host_ecdsa_key -N "" -C "teable-dev-image-$(date +%Y%m%d)"
ssh-keygen -t rsa -b 4096 -f /etc/ssh/ssh_host_rsa_key -N "" -C "teable-dev-image-$(date +%Y%m%d)"

# Set correct permissions
chmod 600 /etc/ssh/ssh_host_*_key
chmod 644 /etc/ssh/ssh_host_*_key.pub

# Prevent host keys from being regenerated on boot
# Ubuntu/Debian uses ssh.service which calls ssh-keygen if keys are missing
# Since we already have keys, this won't run, but let's be explicit
systemctl disable ssh-keygen-host-keys.service 2>/dev/null || true

# Display the host key fingerprints for reference
echo "SSH host key fingerprints (save these for verification):"
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub
ssh-keygen -lf /etc/ssh/ssh_host_rsa_key.pub

# Clean up
echo ""
echo "=== Cleaning up ==="
apt-get clean
apt-get autoremove -y
rm -rf /var/lib/apt/lists/*
rm -rf /tmp/*

# Create marker file
touch /tmp/setup-complete

echo ""
echo "=== Setup Complete ==="
echo "Date: $(date)"

