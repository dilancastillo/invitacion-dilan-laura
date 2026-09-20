import "server-only";
import { getServerSession, type NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

export function allowedAdminId(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return false;
  return (process.env.ADMIN_GITHUB_IDS ?? "").split(",").map((id) => id.trim()).includes(value);
}

export function authIsConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_ID?.trim() && process.env.GITHUB_SECRET?.trim() &&
    (process.env.NEXTAUTH_SECRET?.trim().length ?? 0) >= 32 &&
    (process.env.ADMIN_GITHUB_IDS ?? "").split(",").some((id) => /^\d+$/.test(id.trim()))
  );
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET?.trim(),
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  providers: [GitHubProvider({
    clientId: process.env.GITHUB_ID?.trim() ?? "",
    clientSecret: process.env.GITHUB_SECRET?.trim() ?? "",
    authorization: { params: { scope: "read:user" } },
  })],
  callbacks: {
    async signIn({ account }) {
      return authIsConfigured() && account?.provider === "github" && allowedAdminId(account.providerAccountId);
    },
    async jwt({ token, account }) {
      if (account) token.githubId = account.provider === "github" ? account.providerAccountId : undefined;
      return token;
    },
    async session({ session, token }) {
      // Check the current allowlist on EVERY request, not only when the session was issued.
      session.weddingAdmin = allowedAdminId(token.githubId);
      session.adminGithubId = session.weddingAdmin && typeof token.githubId === "string" ? token.githubId : undefined;
      return session;
    },
  },
};

export async function getAdminSession() {
  if (!authIsConfigured()) return null;
  const session = await getServerSession(authOptions);
  return session?.weddingAdmin === true ? session : null;
}
