import { NextResponse, NextRequest } from "next/server"
import { auth } from "@/auth"
import { getDevEnvironment } from "@/lib/gcp"

export interface ServiceStatus {
  frontend: {
    running: boolean
    url: string
    error?: string
  }
  backend: {
    running: boolean
    url: string
    error?: string
  }
}

// Check if a service is running by making an HTTP request
async function checkServiceHealth(url: string, timeoutMs = 5000): Promise<{ running: boolean; error?: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      // Don't follow redirects, just check if the service responds
      redirect: "manual",
    })
    clearTimeout(timeoutId)
    // Any response (even 404 or 500) means the service is running
    return { running: true }
  } catch (error) {
    clearTimeout(timeoutId)
    const err = error as Error
    if (err.name === "AbortError") {
      return { running: false, error: "Connection timeout" }
    }
    return { running: false, error: err.message || "Connection failed" }
  }
}

// GET /api/environment/services - Check service status
// Query params: ?instanceId=xxx (optional)
export async function GET(request: NextRequest) {
  const session = await auth()

  if (!session?.username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const instanceId = searchParams.get("instanceId") || "default"

    const environment = await getDevEnvironment(session.username, instanceId)

    if (!environment || !environment.externalIp) {
      return NextResponse.json({
        error: "Environment not running or no external IP",
      }, { status: 404 })
    }

    const frontendUrl = `http://${environment.externalIp}:3000`
    const backendUrl = `http://${environment.externalIp}:3003`

    // Check both services in parallel
    const [frontendStatus, backendStatus] = await Promise.all([
      checkServiceHealth(frontendUrl),
      checkServiceHealth(backendUrl),
    ])

    const status: ServiceStatus = {
      frontend: {
        running: frontendStatus.running,
        url: frontendUrl,
        error: frontendStatus.error,
      },
      backend: {
        running: backendStatus.running,
        url: backendUrl,
        error: backendStatus.error,
      },
    }

    return NextResponse.json({ status })
  } catch (error) {
    console.error("Error checking service status:", error)
    return NextResponse.json(
      { error: "Failed to check service status" },
      { status: 500 }
    )
  }
}

// POST /api/environment/services - Restart services
// Body: { instanceId?: string, service: "frontend" | "backend" | "all" }
export async function POST(request: NextRequest) {
  const session = await auth()

  if (!session?.username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { instanceId = "default", service = "all" } = body

    const environment = await getDevEnvironment(session.username, instanceId)

    if (!environment || !environment.externalIp) {
      return NextResponse.json({
        error: "Environment not running or no external IP",
      }, { status: 404 })
    }

    // Call the service control endpoint on the VM
    const controlUrl = `http://${environment.externalIp}:9999/restart`
    
    try {
      const response = await fetch(controlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
        signal: AbortSignal.timeout(10000),
      })

      if (response.ok) {
        return NextResponse.json({ success: true, message: `Service ${service} restart requested` })
      } else {
        const text = await response.text()
        return NextResponse.json({ 
          success: false, 
          error: `Control service returned: ${text}` 
        }, { status: 500 })
      }
    } catch (error) {
      // Control service not available - this is expected if not set up yet
      const err = error as Error
      return NextResponse.json({
        success: false,
        error: "Service control not available. Please restart manually via SSH.",
        details: err.message,
      }, { status: 503 })
    }
  } catch (error) {
    console.error("Error restarting service:", error)
    return NextResponse.json(
      { error: "Failed to restart service" },
      { status: 500 }
    )
  }
}

