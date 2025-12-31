"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { DevEnvironment, BaseImageInfo } from "@/lib/gcp";
import { MACHINE_CONFIGS, DEFAULT_MACHINE_TYPE } from "@/lib/machine-configs";
import {
  Server,
  Play,
  Square,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  Clock,
  Cpu,
  HardDrive,
  MapPin,
  Code,
  AlertCircle,
  RotateCcw,
  Package,
  ChevronDown,
  Zap,
  Plus,
  Monitor,
  RefreshCw,
  CircleCheck,
  CircleX,
  Terminal,
} from "lucide-react";
import { WebTerminal, WebTerminalButton } from "./web-terminal";

interface ServiceStatus {
  frontend: {
    running: boolean;
    url: string;
    error?: string;
  };
  backend: {
    running: boolean;
    url: string;
    error?: string;
  };
}

interface EnvironmentPanelProps {
  username: string;
  initialEnvironment: DevEnvironment | null;
  initialEnvironments?: DevEnvironment[];
  baseImage: BaseImageInfo | null;
}

export function EnvironmentPanel({
  initialEnvironment,
  initialEnvironments = [],
  baseImage,
}: EnvironmentPanelProps) {
  const [environments, setEnvironments] = useState<DevEnvironment[]>(initialEnvironments);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    initialEnvironment?.instanceId || (initialEnvironments.length > 0 ? initialEnvironments[0].instanceId : null)
  );
  const [, startTransition] = useTransition();
  const [isCreating, setIsCreating] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedMachineType, setSelectedMachineType] = useState(DEFAULT_MACHINE_TYPE);
  const [showMachineSelector, setShowMachineSelector] = useState(false);
  const [showNewInstanceForm, setShowNewInstanceForm] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState("");
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null);
  const [isCheckingServices, setIsCheckingServices] = useState(false);
  const [restartingService, setRestartingService] = useState<string | null>(null);
  const [showWebTerminal, setShowWebTerminal] = useState(false);
  const router = useRouter();

  // Get the currently selected environment (must be before hooks that use it)
  const environment = environments.find(e => e.instanceId === selectedInstanceId) || null;

  // Check service status
  const checkServiceStatus = useCallback(async (instanceId: string) => {
    setIsCheckingServices(true);
    try {
      const response = await fetch(`/api/environment/services?instanceId=${encodeURIComponent(instanceId)}`);
      if (response.ok) {
        const data = await response.json();
        setServiceStatus(data.status);
      } else {
        setServiceStatus(null);
      }
    } catch (err) {
      console.error("Error checking service status:", err);
      setServiceStatus(null);
    } finally {
      setIsCheckingServices(false);
    }
  }, []);

  // Restart a service
  const restartService = useCallback(async (service: "frontend" | "backend" | "all") => {
    if (!environment) return;
    
    setRestartingService(service);
    try {
      const response = await fetch("/api/environment/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: environment.instanceId, service }),
      });
      
      if (response.ok) {
        // Wait a bit then refresh status
        setTimeout(() => {
          checkServiceStatus(environment.instanceId);
        }, 5000);
      } else {
        const data = await response.json();
        setError(data.error || "Failed to restart service");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restart service");
    } finally {
      setRestartingService(null);
    }
  }, [environment, checkServiceStatus]);

  // Auto-check service status when environment is running
  useEffect(() => {
    if (environment?.status === "RUNNING" && environment.externalIp) {
      checkServiceStatus(environment.instanceId);
      
      // Poll every 30 seconds
      const interval = setInterval(() => {
        checkServiceStatus(environment.instanceId);
      }, 30000);
      
      return () => clearInterval(interval);
    }
  }, [environment?.status, environment?.externalIp, environment?.instanceId, checkServiceStatus]);

  // Refresh environments list
  const refreshEnvironments = useCallback(async () => {
    try {
      const response = await fetch("/api/environment");
      const data = await response.json();
      if (data.environments) {
        setEnvironments(data.environments);
      }
    } catch (err) {
      console.error("Error refreshing environments:", err);
    }
  }, []);

  // Poll for environment status until target state is reached
  const pollUntilStatus = useCallback(async (
    instanceId: string,
    targetStatus: "RUNNING" | "STOPPED" | null,
    maxAttempts = 60,
    intervalMs = 3000
  ): Promise<DevEnvironment | null> => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`/api/environment?instanceId=${encodeURIComponent(instanceId)}`);
        const data = await response.json();
        const env = data.environment as DevEnvironment | null;

        // Update status message
        if (env) {
          setStatusMessage(`Status: ${env.status}...`);
        } else {
          setStatusMessage("Environment not found...");
        }

        // Check if we've reached target state
        if (targetStatus === null && !env) {
          setStatusMessage(null);
          await refreshEnvironments();
          return null;
        }
        if (targetStatus && env?.status === targetStatus) {
          setStatusMessage(null);
          await refreshEnvironments();
          return env;
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      } catch (err) {
        console.error("Polling error:", err);
      }
    }

    setStatusMessage(null);
    await refreshEnvironments();
    throw new Error("Timeout waiting for environment status");
  }, [refreshEnvironments]);

  const createEnvironment = async (instanceId: string = "default") => {
    setIsCreating(true);
    setError(null);
    setStatusMessage("Creating environment...");

    try {
      const response = await fetch("/api/environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          machineType: selectedMachineType,
          instanceId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create environment");
      }

      // Initial environment created, now poll until RUNNING
      setStatusMessage("Waiting for environment to be ready...");
      const env = await pollUntilStatus(instanceId, "RUNNING");
      
      // Select the newly created instance
      if (env) {
        setSelectedInstanceId(env.instanceId);
      }
      setShowNewInstanceForm(false);
      setNewInstanceName("");
      
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsCreating(false);
      setStatusMessage(null);
    }
  };

  const stopEnvironment = async () => {
    if (!environment) return;
    
    if (
      !confirm(
        "Stop this environment? Your data will be saved and you can resume later. (No charges while stopped)"
      )
    ) {
      return;
    }

    setIsStopping(true);
    setError(null);
    setStatusMessage("Stopping environment...");

    try {
      const response = await fetch("/api/environment", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: environment.instanceId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to stop environment");
      }

      // Poll until STOPPED
      setStatusMessage("Saving environment state...");
      await pollUntilStatus(environment.instanceId, "STOPPED");
      
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsStopping(false);
      setStatusMessage(null);
    }
  };

  const deleteEnvironment = async () => {
    if (!environment) return;
    
    const hasSnapshot = environment?.hasSnapshot;
    const message = hasSnapshot
      ? "Are you sure you want to RESET this environment? This will delete your saved data and start fresh from the base image."
      : "Are you sure you want to destroy this environment? All unsaved changes will be lost.";

    if (!confirm(message)) {
      return;
    }

    setIsDeleting(true);
    setError(null);
    setStatusMessage("Deleting environment...");

    try {
      const response = await fetch("/api/environment", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: environment.instanceId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete environment");
      }

      // Poll until environment is gone (null)
      setStatusMessage("Cleaning up resources...");
      await pollUntilStatus(environment.instanceId, null);

      // Select another instance if available
      const remaining = environments.filter(e => e.instanceId !== environment.instanceId);
      if (remaining.length > 0) {
        setSelectedInstanceId(remaining[0].instanceId);
      } else {
        setSelectedInstanceId(null);
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsDeleting(false);
      setStatusMessage(null);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const formatTimeAgo = (isoString: string) => {
    if (!isoString) return "Unknown";
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    return date.toLocaleDateString();
  };

  const formatImageDate = (isoString: string) => {
    if (!isoString) return "Unknown";
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return "less than an hour ago";
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString("en-US", { 
      month: "short", 
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  const selectedConfig = MACHINE_CONFIGS.find(c => c.machineType === selectedMachineType) || MACHINE_CONFIGS[0];

  // Machine type selector - inline JSX to avoid re-mounting
  const machineTypeSelectorJSX = (
    <div className="mb-6">
      <label className="block text-sm font-medium text-slate-400 mb-3">
        Machine Type
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowMachineSelector(!showMachineSelector)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-emerald-500/50 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="font-medium text-white">{selectedConfig.displayName}</div>
              <div className="text-xs text-slate-400">
                {selectedConfig.vCPU} vCPU • {selectedConfig.memoryGB} GB RAM
              </div>
            </div>
          </div>
          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${showMachineSelector ? 'rotate-180' : ''}`} />
        </button>

        {showMachineSelector && (
          <div className="absolute top-full left-0 right-0 mt-2 py-2 rounded-xl bg-slate-800 border border-slate-700 shadow-xl z-10">
            {MACHINE_CONFIGS.map((config) => (
              <button
                key={config.machineType}
                onClick={() => {
                  setSelectedMachineType(config.machineType);
                  setShowMachineSelector(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700/50 transition-colors text-left ${
                  config.machineType === selectedMachineType ? 'bg-emerald-500/10' : ''
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  config.machineType === selectedMachineType 
                    ? 'bg-gradient-to-br from-emerald-500/30 to-cyan-500/30' 
                    : 'bg-slate-700'
                }`}>
                  <Zap className={`w-5 h-5 ${
                    config.machineType === selectedMachineType ? 'text-emerald-400' : 'text-slate-400'
                  }`} />
                </div>
                <div className="flex-1">
                  <div className={`font-medium ${
                    config.machineType === selectedMachineType ? 'text-emerald-400' : 'text-white'
                  }`}>
                    {config.displayName}
                  </div>
                  <div className="text-xs text-slate-400">
                    {config.vCPU} vCPU • {config.memoryGB} GB RAM • {config.diskType}
                  </div>
                </div>
                {config.machineType === selectedMachineType && (
                  <Check className="w-5 h-5 text-emerald-400" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Create new instance form - inline JSX to avoid input focus issues
  const newInstanceFormJSX = (
    <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-6 max-w-md mx-auto">
      <h3 className="text-lg font-semibold mb-4">Create New Environment</h3>
      
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-400 mb-2">
          Instance Name
        </label>
        <input
          type="text"
          value={newInstanceName}
          onChange={(e) => setNewInstanceName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
          placeholder="e.g., experiment, feature-x"
          className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-emerald-500 focus:outline-none text-white placeholder-slate-500"
        />
        <p className="mt-1 text-xs text-slate-500">
          Lowercase letters, numbers, and hyphens only
        </p>
      </div>

      {machineTypeSelectorJSX}

      <div className="flex gap-3">
        <button
          onClick={() => {
            setShowNewInstanceForm(false);
            setNewInstanceName("");
          }}
          className="flex-1 px-4 py-3 rounded-xl border border-slate-600 text-slate-400 hover:bg-slate-700/50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => createEnvironment(newInstanceName || "default")}
          disabled={isCreating}
          className="flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-medium hover:from-emerald-400 hover:to-cyan-400 transition-colors disabled:opacity-50"
        >
          {isCreating ? (
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          ) : (
            "Create"
          )}
        </button>
      </div>
    </div>
  );

  // No environments at all
  if (environments.length === 0 && !environment) {
    return (
      <div className="rounded-3xl bg-white/[0.03] border border-white/[0.05] p-12 text-center">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center mx-auto mb-6">
          <Server className="w-10 h-10 text-emerald-400" />
        </div>

        <h2 className="text-2xl font-semibold mb-3">No Environment Running</h2>
        <p className="text-slate-400 mb-8 max-w-md mx-auto">
          Create a powerful cloud development environment with the latest Teable codebase pre-installed.
        </p>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm max-w-md mx-auto">
            {error}
          </div>
        )}

        {showNewInstanceForm ? (
          newInstanceFormJSX
        ) : (
          <>
            <div className="max-w-md mx-auto mb-8">
              {machineTypeSelectorJSX}
            </div>

            <div className="flex flex-col items-center gap-4">
              <button
                onClick={() => createEnvironment("default")}
                disabled={isCreating}
                className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-semibold text-lg hover:from-emerald-400 hover:to-cyan-400 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    Creating Environment...
                  </>
                ) : (
                  <>
                    <Play className="w-6 h-6" />
                    Create Environment
                  </>
                )}
              </button>
              
              <button
                onClick={() => setShowNewInstanceForm(true)}
                className="text-sm text-slate-500 hover:text-emerald-400 transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Or create with custom name
              </button>
            </div>
          </>
        )}

        <p className="mt-6 text-sm text-slate-500">
          {statusMessage || "Estimated startup time: ~60 seconds"}
        </p>

        {baseImage && (
          <div className="mt-6 text-xs text-slate-600 max-w-md mx-auto">
            <p>
              Base image: <code className="bg-slate-800 px-1 py-0.5 rounded">{baseImage.name}</code>
              <span className="mx-1">•</span>
              Built {formatImageDate(baseImage.createdAt)}
            </p>
            {baseImage.commitMsg && (
              <p className="mt-1 text-slate-500 truncate" title={baseImage.commitMsg}>
                📝 {baseImage.commitMsg}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // At this point, environment is guaranteed to exist
  if (!environment) {
    return null; // TypeScript guard - should never reach here
  }

  const sshHost = `teable-dev-${environment.instanceId}`;
  // Login as 'developer' user - this avoids all permission issues
  // The user's GitHub SSH key is added to developer's authorized_keys
  const sshTarget = `developer@${environment.externalIp}`;
  const sshCommand = `ssh ${sshTarget}`;
  
  // Workspace path for teable-ee (main project)
  const workspacePath = `/home/developer/workspace/teable-ee`;
  const vscodeUrl = `vscode://vscode-remote/ssh-remote+${sshTarget}${workspacePath}?windowId=_blank`;
  const cursorUrl = `cursor://vscode-remote/ssh-remote+${sshTarget}${workspacePath}?windowId=_blank`;
  const antigravityUrl = `antigravity://vscode-remote/ssh-remote+${sshTarget}${workspacePath}?windowId=_blank`;
  
  // Troubleshooting script - clears old host keys and sets up SSH config
  const sshFullSetup = `# Clear old host key and configure SSH
ssh-keygen -R ${environment.externalIp} 2>/dev/null
ssh-keygen -R ${sshHost} 2>/dev/null

# Update or add SSH config
if grep -q "^Host ${sshHost}$" ~/.ssh/config 2>/dev/null; then
  sed -i '' '/^Host ${sshHost}$/,/^Host /{s/HostName .*/HostName ${environment.externalIp}/;}' ~/.ssh/config
  echo "✓ Updated ${sshHost} with new IP"
else
  cat >> ~/.ssh/config << 'EOF'

Host ${sshHost}
  HostName ${environment.externalIp}
  User developer
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
EOF
  echo "✓ Added ${sshHost} config"
fi

echo "✓ Ready! You can now click 'Open in Cursor/VS Code'"`;

  const isRunning = environment.status === "RUNNING";
  const isStopped = environment.status === "STOPPED";

  // Instance selector component - always show when there's at least one environment
  const InstanceSelector = ({ showAddButton = true }: { showAddButton?: boolean }) => {
    if (environments.length === 0) return null;
    
    return (
      <div className="mb-6 flex items-center gap-4 justify-center flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {environments.map((env) => (
            <button
              key={env.instanceId}
              onClick={() => {
                setSelectedInstanceId(env.instanceId);
                setShowNewInstanceForm(false);
              }}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
                env.instanceId === selectedInstanceId && !showNewInstanceForm
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                  : 'bg-slate-800/50 text-slate-400 border border-slate-700 hover:border-slate-600'
              }`}
            >
              <Monitor className="w-4 h-4" />
              {env.instanceId}
              <span className={`w-2 h-2 rounded-full ${
                env.status === 'RUNNING' ? 'bg-emerald-400' : 'bg-amber-400'
              }`} />
            </button>
          ))}
        </div>
        {showAddButton && (
          <button
            onClick={() => setShowNewInstanceForm(true)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border border-dashed transition-colors flex items-center gap-2 ${
              showNewInstanceForm
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
                : 'bg-slate-800/50 text-slate-400 border-slate-600 hover:border-emerald-500/50 hover:text-emerald-400'
            }`}
          >
            <Plus className="w-4 h-4" />
            New Instance
          </button>
        )}
      </div>
    );
  };

  // If stopped, show resume UI
  if (isStopped) {
    return (
      <div className="rounded-3xl bg-white/[0.03] border border-white/[0.05] p-12 text-center">
        <InstanceSelector />
        
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mx-auto mb-6">
          <Server className="w-10 h-10 text-amber-400" />
        </div>

        <h2 className="text-2xl font-semibold mb-3">
          Environment Stopped
          {environments.length > 1 && <span className="text-slate-500 text-lg ml-2">({environment.instanceId})</span>}
        </h2>
        <p className="text-slate-400 mb-8 max-w-md mx-auto">
          Your environment is saved. Resume to continue where you left off, or reset to start fresh.
        </p>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {showNewInstanceForm ? (
          newInstanceFormJSX
        ) : (
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => createEnvironment(environment.instanceId)}
              disabled={isCreating || isDeleting}
              className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-semibold text-lg hover:from-emerald-400 hover:to-cyan-400 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Resuming...
                </>
              ) : (
                <>
                  <Play className="w-6 h-6" />
                  Resume Environment
                </>
              )}
            </button>

            <button
              onClick={deleteEnvironment}
              disabled={isCreating || isDeleting}
              className="inline-flex items-center gap-3 px-6 py-4 rounded-2xl bg-red-500/10 text-red-400 font-semibold hover:bg-red-500/20 transition-all disabled:opacity-50"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <RotateCcw className="w-5 h-5" />
                  Reset
                </>
              )}
            </button>
          </div>
        )}

        <p className="mt-6 text-sm text-slate-500">
          {statusMessage || "Resume restores your saved state • Reset starts fresh from base image"}
        </p>

        {baseImage && (
          <div className="mt-6 text-xs text-slate-600 max-w-md mx-auto">
            <p>
              Base image: <code className="bg-slate-800 px-1 py-0.5 rounded">{baseImage.name}</code>
              <span className="mx-1">•</span>
              Built {formatImageDate(baseImage.createdAt)}
            </p>
            {baseImage.commitMsg && (
              <p className="mt-1 text-slate-500 truncate" title={baseImage.commitMsg}>
                📝 {baseImage.commitMsg}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // One-time SSH setup command (works for all teable-dev instances)
  const sshOneTimeSetup = `# Run this once to enable seamless connections for all Teable dev environments
grep -q "Host teable-dev-\\*" ~/.ssh/config 2>/dev/null || cat >> ~/.ssh/config << 'EOF'

Host teable-dev-*
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
EOF
echo "✓ SSH configured for all Teable dev environments"`;

  return (
    <div className="space-y-6">
      {/* Instance Selector - always show for managing instances */}
      <InstanceSelector />
      
      {/* New Instance Form */}
      {showNewInstanceForm && (
        <div className="rounded-2xl bg-slate-800/80 border border-slate-700 p-6">
          {newInstanceFormJSX}
        </div>
      )}

      {/* Status Card */}
      <div className="rounded-3xl bg-white/[0.03] border border-white/[0.05] overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-white/[0.05] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                isRunning
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-amber-500/20 text-amber-400"
              }`}
            >
              <Server className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">{environment.name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                    isRunning
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-amber-500/20 text-amber-400"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-emerald-400" : "bg-amber-400"}`}
                  />
                  {environment.status}
                </span>
                {environment.hasSnapshot && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
                    💾 Saved
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Stop button - only when running */}
            {isRunning && (
              <button
                onClick={stopEnvironment}
                disabled={isStopping || isDeleting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
              >
                {isStopping ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                Stop
              </button>
            )}

            {/* Reset button */}
            <button
              onClick={deleteEnvironment}
              disabled={isDeleting || isStopping}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : environment?.hasSnapshot ? (
                <RotateCcw className="w-4 h-4" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              {environment?.hasSnapshot ? "Reset" : "Destroy"}
            </button>
          </div>
        </div>

        {/* Info Grid */}
        <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          <InfoItem
            icon={<Cpu className="w-4 h-4" />}
            label="Machine"
            value={environment.machineType}
          />
          <InfoItem
            icon={<HardDrive className="w-4 h-4" />}
            label="Specs"
            value={(() => {
              const config = MACHINE_CONFIGS.find(c => c.machineType === environment.machineType);
              return config ? `${config.vCPU} vCPU, ${config.memoryGB}GB` : "Unknown";
            })()}
          />
          <InfoItem
            icon={<MapPin className="w-4 h-4" />}
            label="Region"
            value={(() => {
              // Map zone to friendly region name
              if (environment.zone?.includes("asia-southeast1")) return "Singapore";
              if (environment.zone?.includes("asia-east2")) return "Hong Kong";
              if (environment.zone?.includes("asia-east1")) return "Taiwan";
              if (environment.zone?.includes("us-")) return "United States";
              return environment.zone || "Unknown";
            })()}
          />
          <InfoItem
            icon={<Clock className="w-4 h-4" />}
            label="Created"
            value={formatTimeAgo(environment.createdAt)}
          />
        </div>
      </div>

      {/* Web Terminal */}
      {isRunning && environment.externalIp && showWebTerminal && (
        <WebTerminal
          externalIp={environment.externalIp}
          ttydPassword={environment.ttydPassword}
          username="developer"
          instanceId={environment.instanceId}
          onClose={() => setShowWebTerminal(false)}
        />
      )}

      {/* Connection Steps */}
      {isRunning && environment.externalIp && (
        <div className="rounded-3xl bg-white/[0.03] border border-white/[0.05] p-6">
          <h3 className="text-lg font-semibold mb-6">Connect</h3>

          {/* Web Terminal Button - Most prominent */}
          <div className="mb-6">
            <WebTerminalButton
              onClick={() => setShowWebTerminal(true)}
              disabled={showWebTerminal}
            />
          </div>

          {/* Quick Connect - IDE buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {/* Cursor */}
            <a
              href={cursorUrl}
              className="flex items-center justify-between p-4 rounded-xl border transition-all bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.05] cursor-pointer hover:border-white/[0.1] hover:scale-[1.01] active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-purple-500/20 text-purple-400">
                  <Code className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-medium">Cursor</div>
                  <div className="text-xs text-slate-400">Opens in new window</div>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-slate-400" />
            </a>

            {/* Antigravity */}
            <a
              href={antigravityUrl}
              className="flex items-center justify-between p-4 rounded-xl border transition-all bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.05] cursor-pointer hover:border-white/[0.1] hover:scale-[1.01] active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-orange-500/20 text-orange-400">
                  <Code className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-medium">Antigravity</div>
                  <div className="text-xs text-slate-400">Opens in new window</div>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-slate-400" />
            </a>

            {/* VS Code */}
            <a
              href={vscodeUrl}
              className="flex items-center justify-between p-4 rounded-xl border transition-all bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.05] cursor-pointer hover:border-white/[0.1] hover:scale-[1.01] active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-500/20 text-blue-400">
                  <Code className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-medium">VS Code</div>
                  <div className="text-xs text-slate-400">Opens in new window</div>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-slate-400" />
            </a>
          </div>

          {/* Service Status Header */}
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-slate-400">Services</h4>
            <button
              onClick={() => checkServiceStatus(environment.instanceId)}
              disabled={isCheckingServices}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors text-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingServices ? 'animate-spin' : ''}`} />
              {isCheckingServices ? 'Checking...' : 'Refresh Status'}
            </button>
          </div>

          {/* Access URLs - Frontend & Backend */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {/* Frontend URL */}
            <div className={`p-4 rounded-xl border transition-colors ${
              serviceStatus?.frontend?.running 
                ? 'bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border-emerald-500/30' 
                : 'bg-gradient-to-r from-red-500/10 to-orange-500/10 border-red-500/30'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    serviceStatus?.frontend?.running ? 'bg-emerald-500/20' : 'bg-red-500/20'
                  }`}>
                    <Monitor className={`w-4 h-4 ${
                      serviceStatus?.frontend?.running ? 'text-emerald-400' : 'text-red-400'
                    }`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${
                        serviceStatus?.frontend?.running ? 'text-emerald-400' : 'text-red-400'
                      }`}>Frontend</span>
                      {serviceStatus && (
                        serviceStatus.frontend.running ? (
                          <CircleCheck className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <CircleX className="w-4 h-4 text-red-400" />
                        )
                      )}
                      {isCheckingServices && !serviceStatus && (
                        <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      Port 3000 • {serviceStatus?.frontend?.running ? 'Running' : serviceStatus?.frontend?.error || 'Not running'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => restartService("frontend")}
                    disabled={restartingService !== null}
                    className={`p-2 rounded-lg transition-colors ${
                      serviceStatus?.frontend?.running 
                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400' 
                        : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400'
                    } disabled:opacity-50`}
                    title={serviceStatus?.frontend?.running ? 'Restart Frontend' : 'Start Frontend'}
                  >
                    {restartingService === "frontend" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                  </button>
                  <a
                    href={`http://${environment.externalIp}:3000`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`p-2 rounded-lg transition-colors ${
                      serviceStatus?.frontend?.running 
                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400' 
                        : 'bg-slate-500/20 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <code className="text-xs font-mono text-slate-300 truncate">{`http://${environment.externalIp}:3000`}</code>
                <button
                  onClick={() => copyToClipboard(`http://${environment.externalIp}:3000`, "frontend-url")}
                  className="ml-2 p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-400 transition-colors flex-shrink-0"
                >
                  {copied === "frontend-url" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>

            {/* Backend URL */}
            <div className={`p-4 rounded-xl border transition-colors ${
              serviceStatus?.backend?.running 
                ? 'bg-gradient-to-r from-orange-500/10 to-amber-500/10 border-orange-500/30' 
                : 'bg-gradient-to-r from-red-500/10 to-orange-500/10 border-red-500/30'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    serviceStatus?.backend?.running ? 'bg-orange-500/20' : 'bg-red-500/20'
                  }`}>
                    <Server className={`w-4 h-4 ${
                      serviceStatus?.backend?.running ? 'text-orange-400' : 'text-red-400'
                    }`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${
                        serviceStatus?.backend?.running ? 'text-orange-400' : 'text-red-400'
                      }`}>Backend</span>
                      {serviceStatus && (
                        serviceStatus.backend.running ? (
                          <CircleCheck className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <CircleX className="w-4 h-4 text-red-400" />
                        )
                      )}
                      {isCheckingServices && !serviceStatus && (
                        <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      Port 3003 • {serviceStatus?.backend?.running ? 'Running' : serviceStatus?.backend?.error || 'Not running'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => restartService("backend")}
                    disabled={restartingService !== null}
                    className={`p-2 rounded-lg transition-colors ${
                      serviceStatus?.backend?.running 
                        ? 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-400' 
                        : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400'
                    } disabled:opacity-50`}
                    title={serviceStatus?.backend?.running ? 'Restart Backend' : 'Start Backend'}
                  >
                    {restartingService === "backend" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                  </button>
                  <a
                    href={`http://${environment.externalIp}:3003`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`p-2 rounded-lg transition-colors ${
                      serviceStatus?.backend?.running 
                        ? 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-400' 
                        : 'bg-slate-500/20 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <code className="text-xs font-mono text-slate-300 truncate">{`http://${environment.externalIp}:3003`}</code>
                <button
                  onClick={() => copyToClipboard(`http://${environment.externalIp}:3003`, "backend-url")}
                  className="ml-2 p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-400 transition-colors flex-shrink-0"
                >
                  {copied === "backend-url" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          </div>

          {/* Restart All Services Button */}
          <div className="flex justify-center mb-6">
            <button
              onClick={() => restartService("all")}
              disabled={restartingService !== null}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500/20 to-emerald-500/20 border border-cyan-500/30 text-cyan-400 hover:from-cyan-500/30 hover:to-emerald-500/30 transition-colors disabled:opacity-50"
            >
              {restartingService === "all" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Restarting All Services...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Restart All Services
                </>
              )}
            </button>
          </div>

          {/* SSH Command */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <code className="text-sm font-mono text-slate-300">{sshCommand}</code>
              </div>
              <button
                onClick={() => copyToClipboard(sshCommand, "ssh")}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 transition-colors text-sm"
              >
                {copied === "ssh" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === "ssh" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          {/* First-time SSH Setup - Prominent */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-cyan-500/10 to-emerald-500/10 border border-cyan-500/30">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Zap className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-cyan-400 mb-1">First Time Setup (Run Once)</h4>
                <p className="text-sm text-slate-400 mb-3">
                  Run this command once to enable seamless SSH connections for all Teable dev environments:
                </p>
                <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-700/50">
                  <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
                    {sshOneTimeSetup}
                  </pre>
                </div>
                <button
                  onClick={() => copyToClipboard(sshOneTimeSetup, "onetime")}
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 transition-colors text-sm font-medium"
                >
                  {copied === "onetime" ? (
                    <>
                      <Check className="w-4 h-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy Setup Command
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Troubleshooting - collapsed by default */}
          <details className="group">
            <summary className="text-sm text-slate-500 cursor-pointer hover:text-slate-400 transition-colors flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Still having issues? Click for advanced troubleshooting
            </summary>
            <div className="mt-4 space-y-4">
              <p className="text-sm text-slate-400">
                If you see &quot;Workspace does not exist&quot; or host key errors, run this command:
              </p>
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-700/50">
                <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
                  {sshFullSetup}
                </pre>
                <button
                  onClick={() => copyToClipboard(sshFullSetup, "full")}
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 transition-colors text-sm font-medium"
                >
                  {copied === "full" ? (
                    <>
                      <Check className="w-4 h-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy Fix Command
                    </>
                  )}
                </button>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* Auto-stop notice */}
      <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-4 flex items-start gap-3">
        <Clock className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-blue-200 font-medium">Auto-stop enabled</p>
          <p className="text-sm text-blue-200/70 mt-1">
            This environment will be automatically stopped (not destroyed) 12 hours after your last SSH session ends. 
            Your data is saved and you can resume anytime.
          </p>
        </div>
      </div>

      {/* Base image info */}
      {baseImage && (
        <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-4">
          <div className="flex items-start gap-3">
            <Package className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-300 font-medium">Base Image</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Reset 时使用的基础环境，包含预装的代码和依赖
              </p>
              <div className="mt-2 text-sm text-slate-400">
                <code className="text-xs bg-slate-900 px-1.5 py-0.5 rounded">{baseImage.name}</code>
                <span className="mx-2">•</span>
                Built {formatImageDate(baseImage.createdAt)}
              </div>
              {baseImage.commitMsg && (
                <div className="mt-2 p-2 rounded bg-slate-900/50 border border-slate-700/30">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>Latest commit:</span>
                    {baseImage.commitSha && (
                      <code className="text-emerald-400">{baseImage.commitSha}</code>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-300 truncate" title={baseImage.commitMsg}>
                    {baseImage.commitMsg}
                  </p>
                  {baseImage.commitAuthor && (
                    <p className="mt-1 text-xs text-slate-500">by {baseImage.commitAuthor}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status message during operations */}
      {statusMessage && (
        <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-sm flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          {statusMessage}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}

function InfoItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
        {icon}
        {label}
      </div>
      <div className="font-medium">{value}</div>
    </div>
  );
}


