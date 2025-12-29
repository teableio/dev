"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { DevEnvironment, BaseImageInfo } from "@/lib/gcp";
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
} from "lucide-react";

interface EnvironmentPanelProps {
  username: string;
  initialEnvironment: DevEnvironment | null;
  baseImage: BaseImageInfo | null;
}

export function EnvironmentPanel({
  username,
  initialEnvironment,
  baseImage,
}: EnvironmentPanelProps) {
  const [environment, setEnvironment] = useState(initialEnvironment);
  const [, startTransition] = useTransition();
  const [isCreating, setIsCreating] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const router = useRouter();

  // Poll for environment status until target state is reached
  const pollUntilStatus = useCallback(async (
    targetStatus: "RUNNING" | "STOPPED" | null,
    maxAttempts = 60,
    intervalMs = 3000
  ): Promise<DevEnvironment | null> => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch("/api/environment");
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
          return null;
        }
        if (targetStatus && env?.status === targetStatus) {
          setStatusMessage(null);
          return env;
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      } catch (err) {
        console.error("Polling error:", err);
      }
    }

    setStatusMessage(null);
    throw new Error("Timeout waiting for environment status");
  }, []);

  const createEnvironment = async () => {
    setIsCreating(true);
    setError(null);
    setStatusMessage("Creating environment...");

    try {
      const response = await fetch("/api/environment", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create environment");
      }

      // Initial environment created, now poll until RUNNING
      setStatusMessage("Waiting for environment to be ready...");
      const env = await pollUntilStatus("RUNNING");
      
      setEnvironment(env);
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
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to stop environment");
      }

      // Poll until STOPPED
      setStatusMessage("Saving environment state...");
      const env = await pollUntilStatus("STOPPED");
      
      setEnvironment(env);
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
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete environment");
      }

      // Poll until environment is gone (null)
      setStatusMessage("Cleaning up resources...");
      await pollUntilStatus(null);

      setEnvironment(null);
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

  if (!environment) {
    return (
      <div className="rounded-3xl bg-white/[0.03] border border-white/[0.05] p-12 text-center">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center mx-auto mb-6">
          <Server className="w-10 h-10 text-emerald-400" />
        </div>

        <h2 className="text-2xl font-semibold mb-3">No Environment Running</h2>
        <p className="text-slate-400 mb-8 max-w-md mx-auto">
          Create a powerful cloud development environment with 8 vCPU, 32GB RAM,
          and the latest Teable codebase pre-installed.
        </p>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={createEnvironment}
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

  const sshHost = "teable-dev";
  const sshTarget = `${username}@${environment.externalIp}`;
  const sshCommand = `ssh ${sshTarget}`;
  
  // Use direct user@IP format - works without SSH config if keys are set up
  // windowId=_blank opens in a new window instead of reusing current
  // Use user's home directory with symlink to /home/developer/workspace
  const workspacePath = `/home/${username}/workspace`;
  const vscodeUrl = `vscode://vscode-remote/ssh-remote+${sshTarget}${workspacePath}?windowId=_blank`;
  const cursorUrl = `cursor://vscode-remote/ssh-remote+${sshTarget}${workspacePath}?windowId=_blank`;
  const antigravityUrl = `antigravity://vscode-remote/ssh-remote+${sshTarget}/home/developer/workspace?windowId=_blank`;
  
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
  User ${username}
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
EOF
  echo "✓ Added ${sshHost} config"
fi

echo "✓ Ready! You can now click 'Open in Cursor/VS Code'"`;

  const isRunning = environment.status === "RUNNING";
  const isStopped = environment.status === "STOPPED";

  // If stopped, show resume UI
  if (isStopped) {
    return (
      <div className="rounded-3xl bg-white/[0.03] border border-white/[0.05] p-12 text-center">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mx-auto mb-6">
          <Server className="w-10 h-10 text-amber-400" />
        </div>

        <h2 className="text-2xl font-semibold mb-3">Environment Stopped</h2>
        <p className="text-slate-400 mb-8 max-w-md mx-auto">
          Your environment is saved. Resume to continue where you left off, or reset to start fresh.
        </p>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center justify-center gap-4">
          <button
            onClick={createEnvironment}
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

  return (
    <div className="space-y-6">
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
            value="8 vCPU, 32GB"
          />
          <InfoItem
            icon={<MapPin className="w-4 h-4" />}
            label="Region"
            value="Hong Kong"
          />
          <InfoItem
            icon={<Clock className="w-4 h-4" />}
            label="Created"
            value={formatTimeAgo(environment.createdAt)}
          />
        </div>
      </div>

      {/* Connection Steps */}
      {isRunning && environment.externalIp && (
        <div className="rounded-3xl bg-white/[0.03] border border-white/[0.05] p-6">
          <h3 className="text-lg font-semibold mb-6">Connect</h3>

          {/* Quick Connect - IDE buttons first */}
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

          {/* Troubleshooting - collapsed by default */}
          <details className="group">
            <summary className="text-sm text-slate-500 cursor-pointer hover:text-slate-400 transition-colors flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Connection not working? Click here for troubleshooting
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


