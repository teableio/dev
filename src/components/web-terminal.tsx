"use client"

import { useState, useCallback } from "react"
import {
  Terminal,
  ExternalLink,
  Copy,
  Check,
  Key,
  Globe,
} from "lucide-react"

interface WebTerminalProps {
  externalIp: string
  ttydPassword: string | null
  instanceId: string
  onClose?: () => void
}

export function WebTerminal({
  externalIp,
  ttydPassword,
  instanceId,
  onClose,
}: WebTerminalProps) {
  const [copied, setCopied] = useState<string | null>(null)

  const ttydPort = 7681
  const baseUrl = `http://${externalIp}:${ttydPort}`
  
  // URL with embedded credentials for direct access
  const ttydAuthUrl = ttydPassword
    ? `http://developer:${ttydPassword}@${externalIp}:${ttydPort}`
    : baseUrl

  const handleOpenTerminal = useCallback(() => {
    // Open in popup window for better terminal experience
    const width = 1024
    const height = 768
    const left = (window.screen.width - width) / 2
    const top = (window.screen.height - height) / 2
    window.open(
      ttydAuthUrl,
      `terminal-${instanceId}`,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,menubar=no,toolbar=no`
    )
  }, [ttydAuthUrl, instanceId])

  const handleOpenInTab = useCallback(() => {
    window.open(ttydAuthUrl, "_blank")
  }, [ttydAuthUrl])

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }, [])

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800/50 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">Web Terminal</h3>
            <p className="text-xs text-slate-400">
              developer@{instanceId} • {externalIp}:{ttydPort}
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-sm"
          >
            ✕
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Info message */}
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
          <p className="text-amber-400 text-sm">
            <strong>Note:</strong> Due to browser security (HTTPS → HTTP), the terminal opens in a new window.
            Credentials are automatically included in the URL.
          </p>
        </div>

        {/* Open Terminal Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={handleOpenTerminal}
            className="flex items-center justify-center gap-3 px-6 py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-medium hover:opacity-90 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Terminal className="w-5 h-5" />
            Open Terminal (Popup)
          </button>
          
          <button
            onClick={handleOpenInTab}
            className="flex items-center justify-center gap-3 px-6 py-4 rounded-xl bg-slate-700 text-white font-medium hover:bg-slate-600 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <ExternalLink className="w-5 h-5" />
            Open in New Tab
          </button>
        </div>

        {/* Credentials Section */}
        <div className="bg-slate-800/50 rounded-xl p-4 space-y-3">
          <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Key className="w-4 h-4" />
            Login Credentials (if prompted)
          </h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Username */}
            <div className="flex items-center justify-between bg-slate-900 rounded-lg px-3 py-2">
              <div>
                <div className="text-xs text-slate-500">Username</div>
                <div className="text-white font-mono">developer</div>
              </div>
              <button
                onClick={() => copyToClipboard("developer", "username")}
                className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                {copied === "username" ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Password */}
            <div className="flex items-center justify-between bg-slate-900 rounded-lg px-3 py-2">
              <div>
                <div className="text-xs text-slate-500">Password</div>
                <div className="text-white font-mono">
                  {ttydPassword || "(no password)"}
                </div>
              </div>
              {ttydPassword && (
                <button
                  onClick={() => copyToClipboard(ttydPassword, "password")}
                  className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                >
                  {copied === "password" ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Direct URL */}
        <div className="bg-slate-800/50 rounded-xl p-4 space-y-2">
          <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Direct URL
          </h4>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-slate-900 rounded-lg px-3 py-2 text-sm text-emerald-400 font-mono overflow-x-auto">
              {baseUrl}
            </code>
            <button
              onClick={() => copyToClipboard(baseUrl, "url")}
              className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              {copied === "url" ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Tips */}
        <div className="text-center text-xs text-slate-500">
          💡 Type <code className="bg-slate-700 px-1.5 py-0.5 rounded text-emerald-400">claude</code> in the terminal to start Claude Code AI assistant
        </div>
      </div>
    </div>
  )
}

// Compact button to open terminal directly
interface WebTerminalButtonProps {
  externalIp: string
  ttydPassword: string | null
  instanceId: string
  disabled?: boolean
}

export function WebTerminalButton({ 
  externalIp, 
  ttydPassword, 
  instanceId,
  disabled 
}: WebTerminalButtonProps) {
  const ttydPort = 7681
  const ttydAuthUrl = ttydPassword
    ? `http://developer:${ttydPassword}@${externalIp}:${ttydPort}`
    : `http://${externalIp}:${ttydPort}`

  const handleClick = useCallback(() => {
    // Open in popup window
    const width = 1024
    const height = 768
    const left = (window.screen.width - width) / 2
    const top = (window.screen.height - height) / 2
    window.open(
      ttydAuthUrl,
      `terminal-${instanceId}`,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,menubar=no,toolbar=no`
    )
  }, [ttydAuthUrl, instanceId])

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 hover:border-emerald-500/50 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 w-full"
    >
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 flex items-center justify-center">
        <Terminal className="w-5 h-5 text-emerald-400" />
      </div>
      <div className="text-left flex-1">
        <div className="font-medium text-white">Open Web Terminal</div>
        <div className="text-xs text-slate-400">
          Opens in new window • Claude Code ready
        </div>
      </div>
      <ExternalLink className="w-4 h-4 text-slate-400" />
    </button>
  )
}
