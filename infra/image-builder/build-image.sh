#!/bin/bash
# Build Teable Dev Environment Image
# This script creates a GCP image with all dependencies pre-installed
#
# Usage:
#   GITHUB_TOKEN=ghp_xxx ./build-image.sh
#
# The GITHUB_TOKEN should have read access to teableio/teable-ee repository.
# You can create one at: https://github.com/settings/tokens
# Required scope: repo (for private repos)

set -e

PROJECT_ID="${GCP_PROJECT_ID:-teable-666}"
ZONE="${GCP_ZONE:-asia-east2-a}"
IMAGE_FAMILY="teable-dev"
SOURCE_IMAGE_FAMILY="ubuntu-2404-lts-amd64"
SOURCE_IMAGE_PROJECT="ubuntu-os-cloud"
INSTANCE_NAME="image-builder-$(date +%s)"
DATE_TAG=$(date +%Y%m%d-%H%M)
IMAGE_NAME="${IMAGE_FAMILY}-${DATE_TAG}"

# Check for GitHub token
if [ -z "$GITHUB_TOKEN" ]; then
  echo "WARNING: GITHUB_TOKEN not set!"
  echo "The image will be built with public teable repo instead of teable-ee."
  echo ""
  echo "To build with teable-ee, run:"
  echo "  GITHUB_TOKEN=ghp_xxx ./build-image.sh"
  echo ""
  read -p "Continue without token? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo "=== Building Teable Dev Image ==="
echo "Project: $PROJECT_ID"
echo "Zone: $ZONE"
echo "Image Name: $IMAGE_NAME"
echo "GitHub Token: ${GITHUB_TOKEN:+[PROVIDED]}"
echo ""

# Build metadata arguments
METADATA_ARGS="--metadata-from-file=startup-script=setup-image.sh"
if [ -n "$GITHUB_TOKEN" ]; then
  METADATA_ARGS="$METADATA_ARGS --metadata=github-token=$GITHUB_TOKEN"
fi

# Create a temporary instance
echo ""
echo "=== Creating temporary build instance ==="
gcloud compute instances create "$INSTANCE_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --machine-type="n2-standard-4" \
  --image-family="$SOURCE_IMAGE_FAMILY" \
  --image-project="$SOURCE_IMAGE_PROJECT" \
  --boot-disk-size=100GB \
  --boot-disk-type=pd-ssd \
  $METADATA_ARGS \
  --scopes=cloud-platform \
  --quiet

# Wait for the instance to be ready
echo ""
echo "=== Waiting for instance to start ==="
sleep 30

# Wait for setup to complete (check for marker file)
echo ""
echo "=== Waiting for setup to complete (this may take 10-15 minutes) ==="
MAX_WAIT=1200  # 20 minutes
WAITED=0
SSH_READY=false

# SSH options for non-interactive connections
SSH_OPTS="--ssh-flag=-o --ssh-flag=StrictHostKeyChecking=no --ssh-flag=-o --ssh-flag=UserKnownHostsFile=/dev/null --ssh-flag=-o --ssh-flag=LogLevel=ERROR"

# First wait for SSH to be ready (try both direct and IAP tunnel)
echo "Waiting for SSH to be ready..."
while [[ $WAITED -lt 300 ]]; do
  # Try direct SSH first, then IAP tunnel
  if gcloud compute ssh "$INSTANCE_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --command="echo 'SSH OK'" \
    $SSH_OPTS \
    --quiet 2>/dev/null || \
     gcloud compute ssh "$INSTANCE_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --tunnel-through-iap \
    --command="echo 'SSH OK'" \
    $SSH_OPTS \
    --quiet 2>/dev/null; then
    echo "SSH is ready!"
    SSH_READY=true
    break
  fi
  echo "  Waiting for SSH... ($WAITED seconds)"
  sleep 15
  WAITED=$((WAITED + 15))
done

if [[ "$SSH_READY" != "true" ]]; then
  echo "ERROR: SSH not ready after 5 minutes!"
  echo "Checking instance status..."
  gcloud compute instances describe "$INSTANCE_NAME" --project="$PROJECT_ID" --zone="$ZONE" --format="yaml(status,networkInterfaces[0].accessConfigs[0].natIP)"
  echo ""
  echo "Checking serial port output for errors..."
  gcloud compute instances get-serial-port-output "$INSTANCE_NAME" --project="$PROJECT_ID" --zone="$ZONE" 2>/dev/null | tail -50
  gcloud compute instances delete "$INSTANCE_NAME" --project="$PROJECT_ID" --zone="$ZONE" --quiet
  exit 1
fi

# Helper function to run SSH command (tries direct first, then IAP)
run_ssh() {
  gcloud compute ssh "$INSTANCE_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --command="$1" \
    $SSH_OPTS \
    --quiet 2>/dev/null || \
  gcloud compute ssh "$INSTANCE_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --tunnel-through-iap \
    --command="$1" \
    $SSH_OPTS \
    --quiet 2>/dev/null
}

# Now wait for setup to complete
WAITED=0
while [[ $WAITED -lt $MAX_WAIT ]]; do
  # Check if setup is complete
  if run_ssh "test -f /tmp/setup-complete"; then
    echo ""
    echo "Setup complete!"
    break
  fi
  
  # Show progress every 60 seconds
  if [[ $((WAITED % 60)) -eq 0 ]] && [[ $WAITED -gt 0 ]]; then
    echo ""
    echo "[$WAITED seconds] Checking setup progress..."
    run_ssh "tail -5 /var/log/image-setup.log 2>/dev/null || echo 'Log not ready'" || echo "(unable to read log)"
  else
    echo -n "."
  fi
  
  sleep 30
  WAITED=$((WAITED + 30))
done

if [[ $WAITED -ge $MAX_WAIT ]]; then
  echo ""
  echo "ERROR: Setup timed out after $MAX_WAIT seconds!"
  echo ""
  echo "Last setup log entries:"
  run_ssh "tail -30 /var/log/image-setup.log 2>/dev/null || echo 'No log available'" || echo "(unable to read log)"
  echo ""
  echo "Cleaning up..."
  gcloud compute instances delete "$INSTANCE_NAME" --project="$PROJECT_ID" --zone="$ZONE" --quiet
  exit 1
fi

# Get commit info from the instance
echo ""
echo "=== Getting commit info ==="
COMMIT_INFO=$(run_ssh "cat /home/developer/.image-info 2>/dev/null || echo 'COMMIT_SHA=unknown'" || echo "COMMIT_SHA=unknown")

# Parse commit info
COMMIT_SHA=$(echo "$COMMIT_INFO" | grep "COMMIT_SHA=" | cut -d'=' -f2)
COMMIT_MSG=$(echo "$COMMIT_INFO" | grep "COMMIT_MSG=" | cut -d'=' -f2-)
COMMIT_AUTHOR=$(echo "$COMMIT_INFO" | grep "COMMIT_AUTHOR=" | cut -d'=' -f2-)

echo "Commit: $COMMIT_SHA - $COMMIT_MSG ($COMMIT_AUTHOR)"

# Remove sensitive metadata before creating image
if [ -n "$GITHUB_TOKEN" ]; then
  echo ""
  echo "=== Removing sensitive metadata ==="
  gcloud compute instances remove-metadata "$INSTANCE_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --keys=github-token \
    --quiet || true
fi

# Stop the instance
echo ""
echo "=== Stopping instance ==="
gcloud compute instances stop "$INSTANCE_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --quiet

# Wait for instance to stop
sleep 30

# Create image from the instance with commit info in description
echo ""
echo "=== Creating image ==="
IMAGE_DESCRIPTION="commit:${COMMIT_SHA}|msg:${COMMIT_MSG}|author:${COMMIT_AUTHOR}|built:$(date -Iseconds)"
gcloud compute images create "$IMAGE_NAME" \
  --project="$PROJECT_ID" \
  --source-disk="$INSTANCE_NAME" \
  --source-disk-zone="$ZONE" \
  --family="$IMAGE_FAMILY" \
  --description="$IMAGE_DESCRIPTION" \
  --quiet

# Delete the temporary instance
echo ""
echo "=== Cleaning up ==="
gcloud compute instances delete "$INSTANCE_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --quiet

# Delete old images (keep only last 7)
echo ""
echo "=== Cleaning up old images ==="
OLD_IMAGES=$(gcloud compute images list \
  --project="$PROJECT_ID" \
  --filter="family:$IMAGE_FAMILY" \
  --sort-by="~creationTimestamp" \
  --format="value(name)" | tail -n +8)

for img in $OLD_IMAGES; do
  echo "Deleting old image: $img"
  gcloud compute images delete "$img" --project="$PROJECT_ID" --quiet
done

echo ""
echo "=== Done! ==="
echo "Image created: $IMAGE_NAME"
echo "Family: $IMAGE_FAMILY"

