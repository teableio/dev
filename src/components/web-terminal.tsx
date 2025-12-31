"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
  Terminal,
  Maximize2,
  Minimize2,
  X,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Loader2,
} from "lucide-react"

interface WebTerminalProps {
  externalIp: string
  ttydPassword: string | null
  username: string
  instanceId: string
  onClose?: () => void
}

export function WebTerminal({
  externalIp,
  ttydPassword,
  username,
  instanceId,
  onClose,
}: WebTerminalProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [usePopup, setUsePopup] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Build ttyd URL - Note: Basic Auth in URL may not work in iframe due to browser security
  // We'll try iframe first, but provide popup fallback
  const ttydPort = 7681
  const baseUrl = `http://${externalIp}:${ttydPort}`
  
  // For iframe, we try without auth first (ttyd may be configured without auth in some cases)
  // For popup/new tab, we use auth URL
  const ttydAuthUrl = ttydPassword
    ? `http://developer:${ttydPassword}@${externalIp}:${ttydPort}`
    : baseUrl

  // URL without credentials for display
  const displayUrl = baseUrl

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false)
    setHasError(false)
  }, [])

  const handleIframeError = useCallback(() => {
    setIsLoading(false)
    setHasError(true)
  }, [])

  const handleRetry = useCallback(() => {
    setIsLoading(true)
    setHasError(false)
    setRetryCount((c) => c + 1)
    // Force iframe reload by updating key
    if (iframeRef.current) {
      iframeRef.current.src = baseUrl
    }
  }, [baseUrl])

  const handleOpenExternal = useCallback(() => {
    // Open with auth URL in new tab
    window.open(ttydAuthUrl, "_blank")
  }, [ttydAuthUrl])

  const handleUsePopup = useCallback(() => {
    setUsePopup(true)
    // Open in popup window for better terminal experience
    const width = 1024
    const height = 768
    const left = (window.screen.width - width) / 2
    const top = (window.screen.height - height) / 2
    window.open(
      ttydAuthUrl,
      `terminal-${instanceId}`,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`
    )
  }, [ttydAuthUrl, instanceId])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev)
  }, [])

  // Auto-retry a few times if loading fails
  useEffect(() => {
    if (hasError && retryCount < 3) {
      const timer = setTimeout(() => {
        handleRetry()
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [hasError, retryCount, handleRetry])

  // Container classes based on fullscreen state
  const containerClasses = isFullscreen
    ? "fixed inset-0 z-50 bg-slate-950"
    : "rounded-2xl bg-slate-900 border border-slate-700 overflow-hidden"

  return (
    <div className={containerClasses}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800/50 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">Web Terminal</h3>
            <p className="text-xs text-slate-400">
              developer@{instanceId} • {externalIp}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status indicator */}
          {isLoading && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-500/10 text-amber-400 text-xs">
              <Loader2 className="w-3 h-3 animate-spin" />
              Connecting...
            </div>
          )}
          {hasError && retryCount >= 3 && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-red-500/10 text-red-400 text-xs">
              <AlertCircle className="w-3 h-3" />
              Connection failed
            </div>
          )}

          {/* Retry button */}
          <button
            onClick={handleRetry}
            className="p-2 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors"
            title="Refresh terminal"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {/* Open in new tab */}
          <button
            onClick={handleOpenExternal}
            className="p-2 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </button>

          {/* Fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>

          {/* Close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
              title="Close terminal"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Terminal content */}
      <div
        className={`relative bg-black ${isFullscreen ? "h-[calc(100vh-57px)]" : "h-[500px]"}`}
      >
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 z-10">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mb-4" />
            <p className="text-slate-400 text-sm">Connecting to terminal...</p>
            <p className="text-slate-500 text-xs mt-2">
              This may take a few seconds on first connection
            </p>
          </div>
        )}

        {/* Error overlay */}
        {hasError && retryCount >= 3 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 z-10">
            <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
            <p className="text-white font-medium mb-2">
              Unable to connect to terminal
            </p>
            <p className="text-slate-400 text-sm mb-4 max-w-md text-center">
              The web terminal service may still be starting up. This usually
              takes 1-2 minutes after the environment starts.
            </p>
            <div className="flex flex-col gap-3 items-center">
              <div className="flex gap-3">
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors text-sm font-medium"
                >
                  Try Again
                </button>
                <button
                  onClick={handleUsePopup}
                  className="px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors text-sm font-medium"
                >
                  Open in Popup
                </button>
              </div>
              <button
                onClick={handleOpenExternal}
                className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors text-sm font-medium"
              >
                Open in New Tab
              </button>
              {ttydPassword && (
                <p className="text-xs text-slate-500 mt-2">
                  Credentials: developer / {ttydPassword}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Popup mode indicator */}
        {usePopup && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 z-10">
            <Terminal className="w-12 h-12 text-emerald-400 mb-4" />
            <p className="text-white font-medium mb-2">
              Terminal opened in popup window
            </p>
            <p className="text-slate-400 text-sm mb-4">
              Check your popup window for the terminal
            </p>
            <button
              onClick={() => setUsePopup(false)}
              className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors text-sm font-medium"
            >
              Show Embedded Terminal
            </button>
          </div>
        )}

        {/* ttyd iframe - use base URL without auth, browser will prompt if needed */}
        {!usePopup && (
          <iframe
            ref={iframeRef}
            key={retryCount}
            src={baseUrl}
            className="w-full h-full border-0"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            title={`Terminal - ${instanceId}`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </div>

      {/* Footer with tips */}
      <div className="px-4 py-2 bg-slate-800/30 border-t border-slate-700/50">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <span>
              💡 Tip: Type <code className="bg-slate-700 px-1 rounded">claude</code> to start Claude Code AI assistant
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>User: developer</span>
            <span>•</span>
            <span>Port: {ttydPort}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Compact button to open terminal
interface WebTerminalButtonProps {
  onClick: () => void
  disabled?: boolean
}

export function WebTerminalButton({ onClick, disabled }: WebTerminalButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 hover:border-emerald-500/50 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
    >
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 flex items-center justify-center">
        <Terminal className="w-5 h-5 text-emerald-400" />
      </div>
      <div className="text-left">
        <div className="font-medium text-white">Web Terminal</div>
        <div className="text-xs text-slate-400">
          Open terminal in browser • Claude Code ready
        </div>
      </div>
      <ExternalLink className="w-4 h-4 text-slate-400 ml-auto" />
    </button>
  )
}

