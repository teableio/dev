import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createDevEnvironment,
  getDevEnvironment,
  deleteDevEnvironment,
  stopDevEnvironment,
} from "@/lib/gcp";

// GET /api/environment - Get current user's environment
export async function GET() {
  const session = await auth();

  if (!session?.username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const environment = await getDevEnvironment(session.username);
    return NextResponse.json({ environment });
  } catch (error) {
    console.error("Error getting environment:", error);
    return NextResponse.json(
      { error: "Failed to get environment" },
      { status: 500 }
    );
  }
}

// POST /api/environment - Create a new environment
export async function POST() {
  const session = await auth();

  if (!session?.username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Pass user's GitHub OAuth token for git push access
    const environment = await createDevEnvironment(
      session.username,
      session.accessToken
    );
    return NextResponse.json({ environment });
  } catch (error) {
    console.error("Error creating environment:", error);
    const message =
      error instanceof Error ? error.message : "Failed to create environment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/environment - Stop the environment (create snapshot, delete instance)
export async function PATCH() {
  const session = await auth();

  if (!session?.username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await stopDevEnvironment(session.username);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error stopping environment:", error);
    const message =
      error instanceof Error ? error.message : "Failed to stop environment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/environment - Delete the environment completely (instance + snapshot)
export async function DELETE() {
  const session = await auth();

  if (!session?.username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await deleteDevEnvironment(session.username);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting environment:", error);
    return NextResponse.json(
      { error: "Failed to delete environment" },
      { status: 500 }
    );
  }
}

