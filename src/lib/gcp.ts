import { 
  InstancesClient, 
  ZoneOperationsClient,
  SnapshotsClient,
  GlobalOperationsClient,
  ImagesClient,
} from "@google-cloud/compute";
import { MACHINE_CONFIGS, DEFAULT_MACHINE_TYPE } from "./machine-configs";
import type { MachineConfig } from "./machine-configs";

// Re-export for convenience
export { MACHINE_CONFIGS, DEFAULT_MACHINE_TYPE };
export type { MachineConfig };

const PROJECT_ID = process.env.GCP_PROJECT_ID || "teable-666";
const ZONE = process.env.GCP_ZONE || "asia-southeast1-a"; // Singapore
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
  instanceId: string; // User-defined instance identifier (e.g., "default", "experiment")
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

// Default instance ID for backward compatibility
const DEFAULT_INSTANCE_ID = "default";

function sanitizeForGCP(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function getInstanceName(username: string, instanceId: string = DEFAULT_INSTANCE_ID): string {
  const sanitizedUser = sanitizeForGCP(username);
  const sanitizedId = sanitizeForGCP(instanceId);
  return `dev-${sanitizedUser}-${sanitizedId}`;
}

function getSnapshotName(username: string, instanceId: string = DEFAULT_INSTANCE_ID): string {
  const sanitizedUser = sanitizeForGCP(username);
  const sanitizedId = sanitizeForGCP(instanceId);
  return `snap-${sanitizedUser}-${sanitizedId}`;
}

// Check if a snapshot exists for the user's instance
async function snapshotExists(username: string, instanceId: string = DEFAULT_INSTANCE_ID): Promise<boolean> {
  const snapshotName = getSnapshotName(username, instanceId);
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

export interface CreateEnvironmentOptions {
  username: string;
  githubToken?: string;
  machineType?: string; // If specified, use only this machine type (no fallback)
  instanceId?: string; // Instance identifier (default: "default")
}

export async function createDevEnvironment(
  usernameOrOptions: string | CreateEnvironmentOptions,
  githubToken?: string
): Promise<DevEnvironment> {
  // Support both old signature and new options object
  const options: CreateEnvironmentOptions = typeof usernameOrOptions === 'string' 
    ? { username: usernameOrOptions, githubToken }
    : usernameOrOptions;
  
  const { username, machineType: requestedMachineType, instanceId = DEFAULT_INSTANCE_ID } = options;
  const token = typeof usernameOrOptions === 'string' ? githubToken : options.githubToken;
  
  const instanceName = getInstanceName(username, instanceId);
  const snapshotName = getSnapshotName(username, instanceId);

  // Check if this specific instance already exists and is running
  const existing = await getDevEnvironment(username, instanceId);
  if (existing && existing.status !== "STOPPED") {
    throw new Error(`Environment "${instanceId}" already exists`);
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

  // Determine which machine configs to try
  // If user specified a machine type, use only that one
  // Otherwise, try all machine types in fallback order
  const configsToTry = requestedMachineType
    ? MACHINE_CONFIGS.filter(c => c.machineType === requestedMachineType)
    : MACHINE_CONFIGS;
  
  if (configsToTry.length === 0) {
    throw new Error(`Invalid machine type: ${requestedMachineType}`);
  }

  // Try each machine type in order until one succeeds
  let lastError: Error | null = null;
  
  for (const config of configsToTry) {
    console.log(`Trying to create instance with ${config.machineType}...`);
    
    // Determine disk configuration - from snapshot or fresh image
    const diskConfig = hasSnap
      ? {
          // Restore from snapshot
          boot: true,
          autoDelete: true,
          initializeParams: {
            sourceSnapshot: `projects/${PROJECT_ID}/global/snapshots/${snapshotName}`,
            diskSizeGb: DISK_SIZE_GB.toString(),
            diskType: `zones/${ZONE}/diskTypes/${config.diskType}`,
          },
        }
      : {
          // Fresh from base image
          boot: true,
          autoDelete: true,
          initializeParams: {
            sourceImage: `projects/${PROJECT_ID}/global/images/family/${IMAGE_FAMILY}`,
            diskSizeGb: DISK_SIZE_GB.toString(),
            diskType: `zones/${ZONE}/diskTypes/${config.diskType}`,
          },
        };

    try {
      // Create the instance
      const [operation] = await instancesClient.insert({
        project: PROJECT_ID,
        zone: ZONE,
        instanceResource: {
          name: instanceName,
          machineType: `zones/${ZONE}/machineTypes/${config.machineType}`,
          disks: [diskConfig],
          networkInterfaces: [
            {
              network: "global/networks/default",
              accessConfigs: [
                {
                  name: "External NAT",
                  type: "ONE_TO_ONE_NAT",
                  // Let GCP auto-assign ephemeral IP (no static IP needed)
                  // SSH config uses StrictHostKeyChecking=no, so IP changes are OK
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
                key: "instance-id",
                value: instanceId,
              },
              {
                key: "startup-script",
                value: getStartupScript(username, hasSnap, token),
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
      
      console.log(`Successfully created instance with ${config.machineType}`);

      // Get the created instance
      const env = await getDevEnvironment(username);
      if (!env) {
        throw new Error("Failed to create environment");
      }

      return env;
    } catch (error) {
      const err = error as { message?: string; code?: number };
      const errorMessage = err.message || String(error);
      
      // Check if it's a quota error - try next machine type
      if (errorMessage.includes("Quota") || errorMessage.includes("quota") || 
          errorMessage.includes("CPUS_PER_VM_FAMILY") || errorMessage.includes("exceeded")) {
        console.log(`Quota exceeded for ${config.machineType}, trying next option...`);
        lastError = error as Error;
        continue;
      }
      
      // For other errors, throw immediately
      throw error;
    }
  }

  // All machine types failed
  throw lastError || new Error("Failed to create environment: all machine types exhausted");
}

export async function getDevEnvironment(
  username: string,
  instanceId: string = DEFAULT_INSTANCE_ID
): Promise<DevEnvironment | null> {
  const instanceName = getInstanceName(username, instanceId);
  const hasSnap = await snapshotExists(username, instanceId);

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
      instanceId: getMetadata("instance-id") || DEFAULT_INSTANCE_ID,
      status: instance.status!,
      externalIp:
        instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || null,
      internalIp: instance.networkInterfaces?.[0]?.networkIP || null,
      createdAt: getMetadata("created-at"),
      lastActiveAt: getMetadata("last-active-at"),
      username: getMetadata("username"),
      machineType: DEFAULT_MACHINE_TYPE,
      zone: ZONE,
      hasSnapshot: hasSnap,
    };
  } catch (error) {
    // Instance doesn't exist - check for 404 or gRPC code 5 (NOT_FOUND)
    const err = error as { code?: number; status?: number };
    if (err.code === 5 || err.code === 404 || err.status === 404) {
      // No instance, but check if there's a snapshot (stopped state)
      if (hasSnap) {
        // Return a "STOPPED" environment - has snapshot but no running instance
        return {
          name: instanceName,
          instanceId: DEFAULT_INSTANCE_ID,
          status: "STOPPED",
          externalIp: null, // No IP when stopped (ephemeral IP will be assigned on start)
          internalIp: null,
          createdAt: "",
          lastActiveAt: "",
          username: username,
          machineType: DEFAULT_MACHINE_TYPE,
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
export async function stopDevEnvironment(username: string, instanceId: string = DEFAULT_INSTANCE_ID): Promise<void> {
  const instanceName = getInstanceName(username, instanceId);
  const snapshotName = getSnapshotName(username, instanceId);
  
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
export async function deleteDevEnvironment(username: string, instanceId: string = DEFAULT_INSTANCE_ID): Promise<void> {
  const instanceName = getInstanceName(username, instanceId);
  const snapshotName = getSnapshotName(username, instanceId);

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

export async function updateLastActiveTime(username: string, instanceId: string = DEFAULT_INSTANCE_ID): Promise<void> {
  const instanceName = getInstanceName(username, instanceId);
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
      const instanceId = getMetadata("instance-id") || DEFAULT_INSTANCE_ID;
      const hasSnap = username ? await snapshotExists(username, instanceId) : false;

      environments.push({
        name: instance.name!,
        instanceId: instanceId,
        status: instance.status!,
        externalIp:
          instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || null,
        internalIp: instance.networkInterfaces?.[0]?.networkIP || null,
        createdAt: getMetadata("created-at"),
        lastActiveAt: getMetadata("last-active-at"),
        username: username,
        machineType: DEFAULT_MACHINE_TYPE,
        zone: ZONE,
        hasSnapshot: hasSnap,
      });
    }
  } catch (error) {
    console.error("Error listing environments:", error);
  }

  return environments;
}

// List all environments for a specific user (including stopped ones with snapshots)
export async function listUserEnvironments(username: string): Promise<DevEnvironment[]> {
  const environments: DevEnvironment[] = [];
  const sanitizedUser = sanitizeForGCP(username);
  
  // First, get all running instances for this user
  try {
    const [instances] = await instancesClient.list({
      project: PROJECT_ID,
      zone: ZONE,
      filter: `labels.purpose="dev-env" AND name:dev-${sanitizedUser}-*`,
    });

    for (const instance of instances) {
      const metadata = instance.metadata?.items || [];
      const getMetadata = (key: string) =>
        metadata.find((m) => m.key === key)?.value || "";
      
      const instanceId = getMetadata("instance-id") || DEFAULT_INSTANCE_ID;
      const hasSnap = await snapshotExists(username, instanceId);

      environments.push({
        name: instance.name!,
        instanceId: instanceId,
        status: instance.status!,
        externalIp:
          instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || null,
        internalIp: instance.networkInterfaces?.[0]?.networkIP || null,
        createdAt: getMetadata("created-at"),
        lastActiveAt: getMetadata("last-active-at"),
        username: username,
        machineType: DEFAULT_MACHINE_TYPE,
        zone: ZONE,
        hasSnapshot: hasSnap,
      });
    }
  } catch (error) {
    console.error("Error listing user instances:", error);
  }

  // Also check for snapshots (stopped instances)
  try {
    const [snapshots] = await snapshotsClient.list({
      project: PROJECT_ID,
      filter: `name:snap-${sanitizedUser}-*`,
    });

    for (const snapshot of snapshots) {
      // Parse instance ID from snapshot name: snap-{username}-{instanceId}
      const match = snapshot.name?.match(new RegExp(`^snap-${sanitizedUser}-(.+)$`));
      if (!match) continue;
      const instanceId = match[1];

      // Check if there's already a running instance for this
      const alreadyListed = environments.find(e => e.instanceId === instanceId);
      if (alreadyListed) continue;

      // This is a stopped instance (has snapshot but no running instance)
      environments.push({
        name: getInstanceName(username, instanceId),
        instanceId: instanceId,
        status: "STOPPED",
        externalIp: null,
        internalIp: null,
        createdAt: snapshot.creationTimestamp || "",
        lastActiveAt: snapshot.creationTimestamp || "",
        username: username,
        machineType: DEFAULT_MACHINE_TYPE,
        zone: ZONE,
        hasSnapshot: true,
      });
    }
  } catch (error) {
    console.error("Error listing user snapshots:", error);
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
  // GitHub token credential setup for developer user
  const devTokenSetup = githubToken
    ? `
# Configure GitHub credentials for developer user
echo "https://${username}:${githubToken}@github.com" > /home/developer/.git-credentials
chmod 600 /home/developer/.git-credentials
chown developer:developer /home/developer/.git-credentials
echo "✓ GitHub credentials configured for developer (owner: ${username})" >> /var/log/startup.log
`
    : `
echo "⚠ No GitHub token provided" >> /var/log/startup.log
`;

  // Common setup - user logs in as 'developer' directly
  // This avoids all permission issues since everything is owned by developer
  const commonSetup = `#!/bin/bash
set -e

# Set HOME for root (required for git config --global)
export HOME=/root

# Log startup
echo "Starting dev environment for ${username} (restore=${isRestore})" >> /var/log/startup.log

# Ensure Docker is running
systemctl start docker

# Add user's SSH public keys to developer's authorized_keys
# User will SSH as 'developer' but we know who they are from the instance metadata
echo "Fetching SSH keys from GitHub for ${username}..." >> /var/log/startup.log
mkdir -p /home/developer/.ssh
curl -s "https://github.com/${username}.keys" > /home/developer/.ssh/authorized_keys
chmod 700 /home/developer/.ssh
chmod 600 /home/developer/.ssh/authorized_keys
chown -R developer:developer /home/developer/.ssh
SSH_KEY_COUNT=$(wc -l < /home/developer/.ssh/authorized_keys)
echo "✓ Added \${SSH_KEY_COUNT} SSH keys for developer (owner: ${username})" >> /var/log/startup.log

# Configure git for developer user with the owner's identity
sudo -u developer HOME=/home/developer git config --global user.name "${username}"
sudo -u developer HOME=/home/developer git config --global user.email "${username}@users.noreply.github.com"
sudo -u developer HOME=/home/developer git config --global credential.helper store

# Set HTTPS URL for git push with stored credentials
cd /home/developer/workspace/teable-ee
git remote set-url origin https://github.com/teableio/teable-ee.git || true

${devTokenSetup}
`;

  // Only run git pull and pnpm install for fresh environments
  const freshSetup = isRestore ? `
# Restored from snapshot - skip git pull to preserve user's changes
echo "Restored from snapshot, skipping git pull" >> /var/log/startup.log
` : `
# Update repository to latest develop branch (fresh environment only)
# Skip git pull since the image is already up-to-date and we may not have credentials yet
echo "Fresh environment - image already has latest code" >> /var/log/startup.log

# Install any new dependencies (in case package.json changed)
cd /home/developer/workspace
sudo -u developer HOME=/home/developer bash -c 'cd /home/developer/workspace && pnpm install' || echo "pnpm install skipped" >> /var/log/startup.log
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

