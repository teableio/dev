import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          // repo scope required for git push access
          scope: "read:user read:org repo",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "github" && profile) {
        // Check if user has access to teable-ee repository
        const hasAccess = await checkRepoAccess(
          account.access_token!,
          profile.login as string
        );
        if (!hasAccess) {
          return "/unauthorized";
        }
        return true;
      }
      return true;
    },
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.accessToken = account.access_token;
        token.username = profile.login;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.username = token.username as string;
      return session;
    },
  },
  pages: {
    signIn: "/",
    error: "/error",
  },
});

async function checkRepoAccess(
  accessToken: string,
  username: string
): Promise<boolean> {
  try {
    // Check if user is a collaborator on teable-ee
    const response = await fetch(
      `https://api.github.com/repos/teableio/teable-ee/collaborators/${username}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    // 204 = is collaborator, 404 = not collaborator
    if (response.status === 204) {
      return true;
    }

    // Also check if user is a member of teableio org
    const orgResponse = await fetch(
      `https://api.github.com/orgs/teableio/members/${username}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    return orgResponse.status === 204;
  } catch (error) {
    console.error("Error checking repo access:", error);
    return false;
  }
}

// Extend the session types
declare module "next-auth" {
  interface Session {
    accessToken: string;
    username: string;
  }
}

