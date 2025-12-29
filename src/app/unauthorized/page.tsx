import Link from "next/link";
import { ShieldX, ArrowLeft } from "lucide-react";

export default function Unauthorized() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex items-center justify-center">
      <div className="text-center px-6">
        <div className="w-20 h-20 rounded-3xl bg-red-500/20 flex items-center justify-center mx-auto mb-6">
          <ShieldX className="w-10 h-10 text-red-400" />
        </div>

        <h1 className="text-3xl font-bold mb-4">Access Denied</h1>

        <p className="text-slate-400 mb-8 max-w-md mx-auto">
          You don&apos;t have access to the{" "}
          <code className="px-2 py-1 rounded bg-slate-800/50 text-slate-300">
            teableio/teable-ee
          </code>{" "}
          repository. Please contact your administrator to request access.
        </p>

        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>
      </div>
    </div>
  );
}

