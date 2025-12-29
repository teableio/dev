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
  --machine-type="c4-standard-4" \
  --image-family="$SOURCE_IMAGE_FAMILY" \
  --image-project="$SOURCE_IMAGE_PROJECT" \
  --boot-disk-size=100GB \
  --boot-disk-type=hyperdisk-balanced \
  $METADATA_ARGS \
  --scopes=cloud-platform \
  --quiet

# Wait for the instance to be ready
echo ""
echo "=== Waiting for instance to start ==="
sleep 30

# Wait for setup to complete using serial port output (more reliable than SSH in CI)
echo ""
echo "=== Waiting for setup to complete (this may take 10-15 minutes) ==="
MAX_WAIT=1500  # 25 minutes
WAITED=0

# Function to check serial port output for completion marker
check_serial_output() {
  gcloud compute instances get-serial-port-output "$INSTANCE_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    2>/dev/null
}

# Function to get last N lines from serial output
get_serial_tail() {
  check_serial_output | grep -v "^$" | tail -${1:-10}
}

# Wait for setup to complete by checking serial port output
while [[ $WAITED -lt $MAX_WAIT ]]; do
  SERIAL_OUTPUT=$(check_serial_output 2>/dev/null || echo "")
  
  # Check if setup is complete
  if echo "$SERIAL_OUTPUT" | grep -q "=== Setup Complete ==="; then
    echo ""
    echo "✅ Setup complete!"
    break
  fi
  
  # Check for errors
  if echo "$SERIAL_OUTPUT" | grep -q "ERROR\|FATAL\|failed to"; then
    echo ""
    echo "⚠️  Warning: Possible error detected, continuing to wait..."
  fi
  
  # Show progress every 60 seconds
  if [[ $((WAITED % 60)) -eq 0 ]] && [[ $WAITED -gt 0 ]]; then
    echo ""
    echo "[$WAITED seconds] Latest progress:"
    # Show last few meaningful lines from serial output
    echo "$SERIAL_OUTPUT" | grep -E "^(===|Done|Installing|Cloning|Setting|Creating|npm|pnpm)" | tail -3 || echo "(waiting for output...)"
  else
    echo -n "."
  fi
  
  sleep 30
  WAITED=$((WAITED + 30))
done

if [[ $WAITED -ge $MAX_WAIT ]]; then
  echo ""
  echo "❌ ERROR: Setup timed out after $MAX_WAIT seconds!"
  echo ""
  echo "Last 50 lines from serial output:"
  get_serial_tail 50
  echo ""
  echo "Cleaning up..."
  gcloud compute instances delete "$INSTANCE_NAME" --project="$PROJECT_ID" --zone="$ZONE" --quiet
  exit 1
fi

# SSH options for post-setup commands
SSH_OPTS="--ssh-flag=-o --ssh-flag=StrictHostKeyChecking=no --ssh-flag=-o --ssh-flag=UserKnownHostsFile=/dev/null --ssh-flag=-o --ssh-flag=LogLevel=ERROR"

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

# Get commit info from the instance (try SSH first, fall back to serial output)
echo ""
echo "=== Getting commit info ==="

# Try SSH first
COMMIT_INFO=$(run_ssh "cat /home/developer/.image-info 2>/dev/null" 2>/dev/null || echo "")

# If SSH failed, try to extract from serial output
if [ -z "$COMMIT_INFO" ]; then
  echo "SSH unavailable, extracting commit info from serial output..."
  SERIAL_OUTPUT=$(check_serial_output 2>/dev/null || echo "")
  # Extract from our formatted output
  COMMIT_SHA=$(echo "$SERIAL_OUTPUT" | grep "^COMMIT_SHA=" | tail -1 | cut -d'=' -f2)
  COMMIT_MSG=$(echo "$SERIAL_OUTPUT" | grep "^COMMIT_MSG=" | tail -1 | cut -d'=' -f2-)
  COMMIT_AUTHOR=$(echo "$SERIAL_OUTPUT" | grep "^COMMIT_AUTHOR=" | tail -1 | cut -d'=' -f2-)
  if [ -z "$COMMIT_SHA" ]; then
    COMMIT_SHA="unknown"
    COMMIT_MSG="Unable to retrieve commit info"
    COMMIT_AUTHOR="unknown"
  fi
else
  # Parse commit info from SSH output
  COMMIT_SHA=$(echo "$COMMIT_INFO" | grep "COMMIT_SHA=" | cut -d'=' -f2)
  COMMIT_MSG=$(echo "$COMMIT_INFO" | grep "COMMIT_MSG=" | cut -d'=' -f2-)
  COMMIT_AUTHOR=$(echo "$COMMIT_INFO" | grep "COMMIT_AUTHOR=" | cut -d'=' -f2-)
fi

echo "Commit: ${COMMIT_SHA:-unknown} - ${COMMIT_MSG:-N/A} (${COMMIT_AUTHOR:-unknown})"

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

