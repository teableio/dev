import { NextResponse, NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  createDevEnvironment,
  getDevEnvironment,
  deleteDevEnvironment,
  stopDevEnvironment,
  listUserEnvironments,
  MACHINE_CONFIGS,
} from "@/lib/gcp";

// GET /api/environment - Get current user's environments
// Query params: ?instanceId=xxx (optional, if omitted returns all environments)
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const instanceId = searchParams.get("instanceId");

    if (instanceId) {
      // Get specific environment
      const environment = await getDevEnvironment(session.username, instanceId);
      return NextResponse.json({ environment, machineConfigs: MACHINE_CONFIGS });
    } else {
      // List all environments for this user
      const environments = await listUserEnvironments(session.username);
      // For backward compatibility, also return the default environment separately
      const defaultEnv = environments.find(e => e.instanceId === "default") || null;
      return NextResponse.json({ 
        environment: defaultEnv, // For backward compatibility
        environments, // All environments
        machineConfigs: MACHINE_CONFIGS 
      });
    }
  } catch (error) {
    console.error("Error getting environment:", error);
    return NextResponse.json(
      { error: "Failed to get environment" },
      { status: 500 }
    );
  }
}

// POST /api/environment - Create a new environment
// Body: { machineType?: string, instanceId?: string }
export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Parse request body for optional machineType and instanceId
    let machineType: string | undefined;
    let instanceId: string | undefined;
    try {
      const body = await request.json();
      machineType = body.machineType;
      instanceId = body.instanceId;
    } catch {
      // No body or invalid JSON - use defaults
    }

    // Pass user's GitHub OAuth token for git push access
    const environment = await createDevEnvironment({
      username: session.username,
      githubToken: session.accessToken,
      machineType,
      instanceId,
    });
    return NextResponse.json({ environment });
  } catch (error) {
    console.error("Error creating environment:", error);
    const message =
      error instanceof Error ? error.message : "Failed to create environment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/environment - Stop the environment (create snapshot, delete instance)
// Body: { instanceId?: string }
export async function PATCH(request: NextRequest) {
  const session = await auth();

  if (!session?.username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let instanceId: string | undefined;
    try {
      const body = await request.json();
      instanceId = body.instanceId;
    } catch {
      // No body - use default
    }

    await stopDevEnvironment(session.username, instanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error stopping environment:", error);
    const message =
      error instanceof Error ? error.message : "Failed to stop environment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/environment - Delete the environment completely (instance + snapshot)
// Body: { instanceId?: string }
export async function DELETE(request: NextRequest) {
  const session = await auth();

  if (!session?.username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let instanceId: string | undefined;
    try {
      const body = await request.json();
      instanceId = body.instanceId;
    } catch {
      // No body - use default
    }

    await deleteDevEnvironment(session.username, instanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting environment:", error);
    return NextResponse.json(
      { error: "Failed to delete environment" },
      { status: 500 }
    );
  }
}
