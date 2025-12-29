import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";
import { Github, Zap, Clock, Shield, Terminal } from "lucide-react";

export default async function Home() {
  const session = await auth();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Ambient background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -left-40 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 right-1/3 w-80 h-80 bg-violet-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10">
        {/* Header */}
        <header className="px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-semibold tracking-tight">
              Teable Dev
            </span>
          </div>
        </header>

        {/* Hero */}
        <main className="px-6 pt-20 pb-32 max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-slate-400 mb-8">
            <Zap className="w-4 h-4 text-amber-400" />
            Cloud Development Environment
          </div>

          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6">
            <span className="bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              Instant Dev Environment
            </span>
            <br />
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              for Teable
            </span>
          </h1>

          <p className="text-xl text-slate-400 mb-12 max-w-2xl mx-auto leading-relaxed">
            One-click powerful cloud environment with 8 vCPU & 30GB RAM.
            <br />
            Pre-configured with latest code. Connect via VS Code, Cursor, or
            SSH.
          </p>

          <form
            action={async () => {
              "use server";
              await signIn("github");
            }}
          >
            <button
              type="submit"
              className="group inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-white text-slate-900 font-semibold text-lg hover:bg-slate-100 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-white/10"
            >
              <Github className="w-6 h-6" />
              Sign in with GitHub
              <span className="text-slate-400 text-sm font-normal group-hover:translate-x-1 transition-transform">
                →
              </span>
            </button>
          </form>

          <p className="mt-6 text-sm text-slate-500">
            Requires access to{" "}
            <code className="px-2 py-1 rounded bg-slate-800/50 text-slate-400">
              teableio/teable-ee
            </code>
          </p>
        </main>

        {/* Features */}
        <section className="px-6 pb-32 max-w-5xl mx-auto">
          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Zap className="w-6 h-6" />}
              title="Instant Startup"
              description="Pre-built image with all dependencies. Environment ready in under 60 seconds."
              gradient="from-amber-500/20 to-orange-500/20"
            />
            <FeatureCard
              icon={<Clock className="w-6 h-6" />}
              title="Auto Cleanup"
              description="Environments automatically destroy 12 hours after last SSH activity."
              gradient="from-cyan-500/20 to-blue-500/20"
            />
            <FeatureCard
              icon={<Shield className="w-6 h-6" />}
              title="Secure Access"
              description="GitHub OAuth with repository access verification. SSH keys auto-imported."
              gradient="from-violet-500/20 to-purple-500/20"
            />
          </div>
        </section>

        {/* Footer */}
        <footer className="px-6 py-8 border-t border-white/5">
          <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-slate-500">
            <span>© 2024 Teable</span>
            <span>Singapore Region • C4-Standard-8</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  gradient,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  gradient: string;
}) {
  return (
    <div className="relative group">
      <div
        className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${gradient} blur-xl opacity-0 group-hover:opacity-50 transition-opacity`}
      />
      <div className="relative p-8 rounded-3xl bg-white/[0.03] border border-white/[0.05] hover:border-white/10 transition-colors">
        <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-6 text-white/80">
          {icon}
        </div>
        <h3 className="text-lg font-semibold mb-3">{title}</h3>
        <p className="text-slate-400 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
