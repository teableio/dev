import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";

export default async function ErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error || "An unknown error occurred";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex items-center justify-center">
      <div className="text-center px-6">
        <div className="w-20 h-20 rounded-3xl bg-amber-500/20 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-10 h-10 text-amber-400" />
        </div>

        <h1 className="text-3xl font-bold mb-4">Authentication Error</h1>

        <p className="text-slate-400 mb-8 max-w-md mx-auto">
          {error === "AccessDenied"
            ? "You don't have permission to access this application."
            : `An error occurred during authentication: ${error}`}
        </p>

        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Try Again
        </Link>
      </div>
    </div>
  );
}

