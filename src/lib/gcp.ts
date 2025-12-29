import { 
  InstancesClient, 
  ZoneOperationsClient,
  SnapshotsClient,
  GlobalOperationsClient,
  DisksClient,
  AddressesClient,
  RegionOperationsClient,
  ImagesClient,
} from "@google-cloud/compute";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "teable-666";
const ZONE = process.env.GCP_ZONE || "asia-east2-a"; // Hong Kong
const REGION = ZONE.replace(/-[a-z]$/, ""); // asia-east2
const MACHINE_TYPE = process.env.GCP_MACHINE_TYPE || "n2-standard-8";
const IMAGE_FAMILY = process.env.GCP_IMAGE_FAMILY || "teable-dev";
const DISK_SIZE_GB = 100;

// Initialize GCP clients with credentials from environment
function getGCPCredentials() {
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (credentialsJson) {
    try {
      return { credentials: JSON.parse(credentialsJson) };
    } catch {
      console.error("Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON");
    }
  }
  // Fall back to default credentials (for local development with gcloud auth)
  return {};
}

const gcpOptions = getGCPCredentials();
const instancesClient = new InstancesClient(gcpOptions);
const zoneOperationsClient = new ZoneOperationsClient(gcpOptions);
const snapshotsClient = new SnapshotsClient(gcpOptions);
const globalOperationsClient = new GlobalOperationsClient(gcpOptions);
const disksClient = new DisksClient(gcpOptions);
const addressesClient = new AddressesClient(gcpOptions);
const regionOperationsClient = new RegionOperationsClient(gcpOptions);
const imagesClient = new ImagesClient(gcpOptions);

export interface BaseImageInfo {
  name: string;
  family: string;
  createdAt: string;
  description: string | null;
  commitSha: string | null;
  commitMsg: string | null;
  commitAuthor: string | null;
}

export interface DevEnvironment {
  name: string;
  status: string; // RUNNING, STOPPED (has snapshot but no instance), STAGING, etc.
  externalIp: string | null;
  internalIp: string | null;
  createdAt: string;
  lastActiveAt: string;
  username: string;
  machineType: string;
  zone: string;
  hasSnapshot: boolean;
}

function getInstanceName(username: string): string {
  // Sanitize username for GCP instance name requirements
  const sanitized = username.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `dev-${sanitized}`;
}

function getSnapshotName(username: string): string {
  const sanitized = username.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `dev-snapshot-${sanitized}`;
}

function getAddressName(username: string): string {
  const sanitized = username.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `dev-ip-${sanitized}`;
}

// Get or create a static IP address for the user
async function getOrCreateStaticIP(username: string): Promise<string> {
  const addressName = getAddressName(username);
  
  // Try to get existing address
  try {
    const [address] = await addressesClient.get({
      project: PROJECT_ID,
      region: REGION,
      address: addressName,
    });
    console.log(`Using existing static IP: ${address.address}`);
    return address.address!;
  } catch (error) {
    const err = error as { code?: number; status?: number };
    if (err.code !== 5 && err.code !== 404 && err.status !== 404) {
      throw error;
    }
  }
  
  // Create new static IP
  console.log(`Creating new static IP for ${username}`);
  const [operation] = await addressesClient.insert({
    project: PROJECT_ID,
    region: REGION,
    addressResource: {
      name: addressName,
      description: `Static IP for ${username}'s dev environment`,
      networkTier: "PREMIUM",
    },
  });
  
  // Wait for operation
  await waitForRegionOperation(operation.name!);
  
  // Get the created address
  const [newAddress] = await addressesClient.get({
    project: PROJECT_ID,
    region: REGION,
    address: addressName,
  });
  
  console.log(`Created static IP: ${newAddress.address}`);
  return newAddress.address!;
}

// Delete static IP address
async function deleteStaticIP(username: string): Promise<void> {
  const addressName = getAddressName(username);
  
  try {
    const [operation] = await addressesClient.delete({
      project: PROJECT_ID,
      region: REGION,
      address: addressName,
    });
    await waitForRegionOperation(operation.name!);
    console.log(`Deleted static IP: ${addressName}`);
  } catch (error) {
    const err = error as { code?: number; status?: number };
    if (err.code !== 5 && err.code !== 404 && err.status !== 404) {
      throw error;
    }
    // IP doesn't exist, that's fine
  }
}

// Wait for region operation (for addresses)
async function waitForRegionOperation(operationName: string): Promise<void> {
  const maxRetries = 60; // 5 minutes max
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const [operation] = await regionOperationsClient.get({
        project: PROJECT_ID,
        region: REGION,
        operation: operationName,
      });

      if (operation.status === "DONE") {
        if (operation.error) {
          throw new Error(
            `Operation failed: ${JSON.stringify(operation.error.errors)}`
          );
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      const err = error as { code?: number; status?: number };
      if (err.code === 404 || err.status === 404 || err.code === 5) {
        return; // Operation completed and was cleaned up
      }
      throw error;
    }
  }

  throw new Error("Region operation timed out");
}

// Check if a snapshot exists for the user
async function snapshotExists(username: string): Promise<boolean> {
  const snapshotName = getSnapshotName(username);
  try {
    await snapshotsClient.get({
      project: PROJECT_ID,
      snapshot: snapshotName,
    });
    return true;
  } catch (error) {
    const err = error as { code?: number; status?: number };
    if (err.code === 5 || err.code === 404 || err.status === 404) {
      return false;
    }
    throw error;
  }
}

// Wait for global operation (for snapshots)
async function waitForGlobalOperation(operationName: string): Promise<void> {
  const maxRetries = 120; // 10 minutes max (5 seconds per retry)
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const [operation] = await globalOperationsClient.get({
        project: PROJECT_ID,
        operation: operationName,
      });

      if (operation.status === "DONE") {
        if (operation.error) {
          throw new Error(
            `Operation failed: ${JSON.stringify(operation.error.errors)}`
          );
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      const err = error as { code?: number; status?: number };
      if (err.code === 404 || err.status === 404 || err.code === 5) {
        console.log("Operation not found, assuming completed");
        return;
      }
      throw error;
    }
  }

  throw new Error("Operation timed out");
}

// Get the latest base image info from the image family
export async function getBaseImageInfo(): Promise<BaseImageInfo | null> {
  try {
    const [image] = await imagesClient.getFromFamily({
      project: PROJECT_ID,
      family: IMAGE_FAMILY,
    });

    // Parse description format: "commit:xxx|msg:xxx|author:xxx|built:xxx"
    const description = image.description || "";
    let commitSha: string | null = null;
    let commitMsg: string | null = null;
    let commitAuthor: string | null = null;

    const parts = description.split("|");
    for (const part of parts) {
      if (part.startsWith("commit:")) {
        commitSha = part.replace("commit:", "");
      } else if (part.startsWith("msg:")) {
        commitMsg = part.replace("msg:", "");
      } else if (part.startsWith("author:")) {
        commitAuthor = part.replace("author:", "");
      }
    }

    return {
      name: image.name || "",
      family: IMAGE_FAMILY,
      createdAt: image.creationTimestamp || "",
      description: image.description || null,
      commitSha,
      commitMsg,
      commitAuthor,
    };
  } catch (error) {
    console.error("Error getting base image info:", error);
    return null;
  }
}

export async function getUserSSHKeys(username: string): Promise<string[]> {
  try {
    const response = await fetch(`https://github.com/${username}.keys`);
    if (!response.ok) {
      return [];
    }
    const keys = await response.text();
    return keys
      .split("\n")
      .filter((key) => key.trim())
      .map((key) => `${username}:${key.trim()}`);
  } catch (error) {
    console.error("Error fetching SSH keys:", error);
    return [];
  }
}

export async function createDevEnvironment(
  username: string,
  githubToken?: string
): Promise<DevEnvironment> {
  const instanceName = getInstanceName(username);
  const snapshotName = getSnapshotName(username);

  // Check if instance already exists and is running
  const existing = await getDevEnvironment(username);
  if (existing && existing.status !== "STOPPED") {
    throw new Error("Environment already exists");
  }

  // Get user's SSH keys from GitHub
  const sshKeys = await getUserSSHKeys(username);
  if (sshKeys.length === 0) {
    throw new Error(
      "No SSH keys found on GitHub. Please add an SSH key to your GitHub account."
    );
  }

  const now = new Date().toISOString();
  const hasSnap = await snapshotExists(username);
  
  // Get or create static IP for this user
  const staticIP = await getOrCreateStaticIP(username);

  // Determine disk configuration - from snapshot or fresh image
  const diskConfig = hasSnap
    ? {
        // Restore from snapshot
        boot: true,
        autoDelete: true,
        initializeParams: {
          sourceSnapshot: `projects/${PROJECT_ID}/global/snapshots/${snapshotName}`,
          diskSizeGb: DISK_SIZE_GB.toString(),
          diskType: `zones/${ZONE}/diskTypes/pd-ssd`,
        },
      }
    : {
        // Fresh from base image
        boot: true,
        autoDelete: true,
        initializeParams: {
          sourceImage: `projects/${PROJECT_ID}/global/images/family/${IMAGE_FAMILY}`,
          diskSizeGb: DISK_SIZE_GB.toString(),
          diskType: `zones/${ZONE}/diskTypes/pd-ssd`,
        },
      };

  // Create the instance
  const [operation] = await instancesClient.insert({
    project: PROJECT_ID,
    zone: ZONE,
    instanceResource: {
      name: instanceName,
      machineType: `zones/${ZONE}/machineTypes/${MACHINE_TYPE}`,
      disks: [diskConfig],
      networkInterfaces: [
        {
          network: "global/networks/default",
          accessConfigs: [
            {
              name: "External NAT",
              type: "ONE_TO_ONE_NAT",
              natIP: staticIP, // Use reserved static IP
            },
          ],
        },
      ],
      metadata: {
        items: [
          {
            key: "ssh-keys",
            value: sshKeys.join("\n"),
          },
          {
            key: "created-at",
            value: now,
          },
          {
            key: "last-active-at",
            value: now,
          },
          {
            key: "username",
            value: username,
          },
          {
            key: "startup-script",
            value: getStartupScript(username, hasSnap, githubToken),
          },
        ],
      },
      labels: {
        purpose: "dev-env",
        user: username.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      },
      tags: {
        items: ["dev-env", "http-server", "https-server", "allow-ssh"],
      },
      serviceAccounts: [
        {
          email: "default",
          scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        },
      ],
    },
  });

  // Wait for the operation to complete
  await waitForOperation(operation.name!);

  // Get the created instance
  const env = await getDevEnvironment(username);
  if (!env) {
    throw new Error("Failed to create environment");
  }

  return env;
}

export async function getDevEnvironment(
  username: string
): Promise<DevEnvironment | null> {
  const instanceName = getInstanceName(username);
  const hasSnap = await snapshotExists(username);

  try {
    const [instance] = await instancesClient.get({
      project: PROJECT_ID,
      zone: ZONE,
      instance: instanceName,
    });

    const metadata = instance.metadata?.items || [];
    const getMetadata = (key: string) =>
      metadata.find((m) => m.key === key)?.value || "";

    return {
      name: instance.name!,
      status: instance.status!,
      externalIp:
        instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || null,
      internalIp: instance.networkInterfaces?.[0]?.networkIP || null,
      createdAt: getMetadata("created-at"),
      lastActiveAt: getMetadata("last-active-at"),
      username: getMetadata("username"),
      machineType: MACHINE_TYPE,
      zone: ZONE,
      hasSnapshot: hasSnap,
    };
  } catch (error) {
    // Instance doesn't exist - check for 404 or gRPC code 5 (NOT_FOUND)
    const err = error as { code?: number; status?: number };
    if (err.code === 5 || err.code === 404 || err.status === 404) {
      // No instance, but check if there's a snapshot (stopped state)
      if (hasSnap) {
        // Get static IP if exists (so user can see their reserved IP)
        let staticIP: string | null = null;
        try {
          const [address] = await addressesClient.get({
            project: PROJECT_ID,
            region: REGION,
            address: getAddressName(username),
          });
          staticIP = address.address || null;
        } catch {
          // No static IP
        }
        
        // Return a "STOPPED" environment - has snapshot but no running instance
        return {
          name: instanceName,
          status: "STOPPED",
          externalIp: staticIP,
          internalIp: null,
          createdAt: "",
          lastActiveAt: "",
          username: username,
          machineType: MACHINE_TYPE,
          zone: ZONE,
          hasSnapshot: true,
        };
      }
      return null;
    }
    throw error;
  }
}

// Stop environment: create snapshot and delete instance (saves money, preserves data)
export async function stopDevEnvironment(username: string): Promise<void> {
  const instanceName = getInstanceName(username);
  const snapshotName = getSnapshotName(username);
  
  // First, check if instance exists
  try {
    await instancesClient.get({
      project: PROJECT_ID,
      zone: ZONE,
      instance: instanceName,
    });
  } catch (error) {
    const err = error as { code?: number; status?: number };
    if (err.code === 5 || err.code === 404 || err.status === 404) {
      throw new Error("No running environment to stop");
    }
    throw error;
  }

  // Delete old snapshot if exists
  try {
    const [deleteOp] = await snapshotsClient.delete({
      project: PROJECT_ID,
      snapshot: snapshotName,
    });
    await waitForGlobalOperation(deleteOp.name!);
  } catch (error) {
    // Ignore if snapshot doesn't exist
    const err = error as { code?: number; status?: number };
    if (err.code !== 5 && err.code !== 404 && err.status !== 404) {
      throw error;
    }
  }

  // Create snapshot from the instance's boot disk
  const [createOp] = await snapshotsClient.insert({
    project: PROJECT_ID,
    snapshotResource: {
      name: snapshotName,
      sourceDisk: `projects/${PROJECT_ID}/zones/${ZONE}/disks/${instanceName}`,
      description: `Snapshot for ${username}'s dev environment`,
      labels: {
        purpose: "dev-env-snapshot",
        user: username.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      },
    },
  });

  await waitForGlobalOperation(createOp.name!);

  // Delete the instance (disk is auto-deleted since autoDelete=true)
  const [deleteInstanceOp] = await instancesClient.delete({
    project: PROJECT_ID,
    zone: ZONE,
    instance: instanceName,
  });

  await waitForOperation(deleteInstanceOp.name!);
}

// Delete environment completely: delete instance AND snapshot
export async function deleteDevEnvironment(username: string): Promise<void> {
  const instanceName = getInstanceName(username);
  const snapshotName = getSnapshotName(username);

  // Delete instance if exists
  try {
    const [operation] = await instancesClient.delete({
      project: PROJECT_ID,
      zone: ZONE,
      instance: instanceName,
    });

    await waitForOperation(operation.name!);
  } catch (error) {
    // Ignore if instance doesn't exist
    const err = error as { code?: number; status?: number };
    if (err.code !== 5 && err.code !== 404 && err.status !== 404) {
      throw error;
    }
  }

  // Delete snapshot if exists
  try {
    const [deleteOp] = await snapshotsClient.delete({
      project: PROJECT_ID,
      snapshot: snapshotName,
    });
    await waitForGlobalOperation(deleteOp.name!);
  } catch (error) {
    // Ignore if snapshot doesn't exist
    const err = error as { code?: number; status?: number };
    if (err.code !== 5 && err.code !== 404 && err.status !== 404) {
      throw error;
    }
  }
}

export async function updateLastActiveTime(username: string): Promise<void> {
  const instanceName = getInstanceName(username);
  const now = new Date().toISOString();

  try {
    // Get current metadata
    const [instance] = await instancesClient.get({
      project: PROJECT_ID,
      zone: ZONE,
      instance: instanceName,
    });

    const metadata = instance.metadata?.items || [];
    const updatedItems = metadata.map((item) => {
      if (item.key === "last-active-at") {
        return { ...item, value: now };
      }
      return item;
    });

    await instancesClient.setMetadata({
      project: PROJECT_ID,
      zone: ZONE,
      instance: instanceName,
      metadataResource: {
        fingerprint: instance.metadata?.fingerprint,
        items: updatedItems,
      },
    });
  } catch (error) {
    console.error("Error updating last active time:", error);
  }
}

export async function listAllDevEnvironments(): Promise<DevEnvironment[]> {
  const environments: DevEnvironment[] = [];

  try {
    const [instances] = await instancesClient.list({
      project: PROJECT_ID,
      zone: ZONE,
      filter: 'labels.purpose="dev-env"',
    });

    for (const instance of instances) {
      const metadata = instance.metadata?.items || [];
      const getMetadata = (key: string) =>
        metadata.find((m) => m.key === key)?.value || "";
      
      const username = getMetadata("username");
      const hasSnap = username ? await snapshotExists(username) : false;

      environments.push({
        name: instance.name!,
        status: instance.status!,
        externalIp:
          instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || null,
        internalIp: instance.networkInterfaces?.[0]?.networkIP || null,
        createdAt: getMetadata("created-at"),
        lastActiveAt: getMetadata("last-active-at"),
        username: username,
        machineType: MACHINE_TYPE,
        zone: ZONE,
        hasSnapshot: hasSnap,
      });
    }
  } catch (error) {
    console.error("Error listing environments:", error);
  }

  return environments;
}

async function waitForOperation(operationName: string): Promise<void> {
  const maxRetries = 60; // 5 minutes max (5 seconds per retry)
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const [operation] = await zoneOperationsClient.get({
        project: PROJECT_ID,
        zone: ZONE,
        operation: operationName,
      });

      if (operation.status === "DONE") {
        if (operation.error) {
          throw new Error(
            `Operation failed: ${JSON.stringify(operation.error.errors)}`
          );
        }
        return;
      }

      // Wait 5 seconds before checking again
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      const err = error as { code?: number; status?: number };
      // Operation not found - might have completed and been cleaned up
      if (err.code === 404 || err.status === 404 || err.code === 5) {
        console.log("Operation not found, assuming completed");
        return;
      }
      throw error;
    }
  }

  throw new Error("Operation timed out");
}

function getStartupScript(username: string, isRestore: boolean = false, githubToken?: string): string {
  // GitHub token credential setup - store user's OAuth token for git push
  const tokenSetup = githubToken
    ? `
# Configure GitHub credentials using user's OAuth token
sudo -u ${username} bash -c 'echo "https://${username}:${githubToken}@github.com" > /home/${username}/.git-credentials'
chmod 600 /home/${username}/.git-credentials
chown ${username}:${username} /home/${username}/.git-credentials
echo "✓ GitHub credentials configured for ${username}" >> /var/log/startup.log
`
    : `
echo "⚠ No GitHub token provided" >> /var/log/startup.log
`;

  // Common setup for both fresh and restored environments
  const commonSetup = `#!/bin/bash
set -e

# Set HOME for root (required for git config --global)
export HOME=/root

# Log startup
echo "Starting dev environment for ${username} (restore=${isRestore})" >> /var/log/startup.log

# Ensure Docker is running
systemctl start docker

# Add user to docker and developer groups
usermod -aG docker ${username} || true
usermod -aG developer ${username} || true

# Make workspace accessible to all users
chmod 755 /home/developer
chmod -R a+rX /home/developer/workspace
chmod -R g+w /home/developer/workspace

# Create symlink in user's home directory to the shared workspace
ln -sf /home/developer/workspace /home/${username}/workspace
chown -h ${username}:${username} /home/${username}/workspace

# Configure git safe directory for root (needed for sudo git commands)
git config --global --add safe.directory /home/developer/workspace

# Configure git for the user (set HOME explicitly for sudo -u)
sudo -u ${username} HOME=/home/${username} git config --global --add safe.directory /home/developer/workspace
sudo -u ${username} HOME=/home/${username} git config --global user.name "${username}"
sudo -u ${username} HOME=/home/${username} git config --global user.email "${username}@users.noreply.github.com"
sudo -u ${username} HOME=/home/${username} git config --global credential.helper store

# Use HTTPS URL for git push with stored credentials
cd /home/developer/workspace
git remote set-url origin https://github.com/teableio/teable-ee.git || true

${tokenSetup}
`;

  // Only run git pull and pnpm install for fresh environments
  const freshSetup = isRestore ? `
# Restored from snapshot - skip git pull to preserve user's changes
echo "Restored from snapshot, skipping git pull" >> /var/log/startup.log
` : `
# Update repository to latest develop branch (fresh environment only)
cd /home/developer/workspace
sudo -u developer HOME=/home/developer git fetch origin
sudo -u developer HOME=/home/developer git checkout develop
sudo -u developer HOME=/home/developer git pull origin develop

# Install any new dependencies
sudo -u developer HOME=/home/developer bash -c 'cd /home/developer/workspace && pnpm install'
`;

  const activityMonitor = `
# Create SSH activity monitor script
cat > /usr/local/bin/ssh-activity-monitor.sh << 'MONITOR'
#!/bin/bash
# Update last-active-at metadata when SSH connections exist
while true; do
  if who | grep -q .; then
    # There are active SSH sessions
    curl -X PUT "http://metadata.google.internal/computeMetadata/v1/instance/attributes/last-active-at" \\
      -H "Metadata-Flavor: Google" \\
      -d "$(date -Iseconds)" 2>/dev/null || true
  fi
  sleep 300  # Check every 5 minutes
done
MONITOR

chmod +x /usr/local/bin/ssh-activity-monitor.sh

# Start activity monitor in background
nohup /usr/local/bin/ssh-activity-monitor.sh &

echo "Dev environment ready!" >> /var/log/startup.log
`;

  return commonSetup + freshSetup + activityMonitor;
}

