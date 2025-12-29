import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { getDevEnvironment, getBaseImageInfo } from "@/lib/gcp";
import { EnvironmentPanel } from "@/components/environment-panel";
import { Terminal, LogOut, User } from "lucide-react";

export default async function Dashboard() {
  const session = await auth();

  if (!session) {
    redirect("/");
  }

  const [environment, baseImage] = await Promise.all([
    getDevEnvironment(session.username),
    getBaseImageInfo(),
  ]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Ambient background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -left-40 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10">
        {/* Header */}
        <header className="px-6 py-4 flex items-center justify-between max-w-6xl mx-auto border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-semibold tracking-tight">
              Teable Dev
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/5">
              <User className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-medium">{session.username}</span>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="p-2 rounded-xl hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
                title="Sign out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </form>
          </div>
        </header>

        {/* Main content */}
        <main className="px-6 py-12 max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Development Environment</h1>
            <p className="text-slate-400">
              Create and manage your cloud development environment
            </p>
          </div>

          <EnvironmentPanel
            username={session.username}
            initialEnvironment={environment}
            baseImage={baseImage}
          />
        </main>
      </div>
    </div>
  );
}

