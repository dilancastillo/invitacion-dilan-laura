import "next-auth";
declare module "next-auth" {
  interface Session { weddingAdmin: boolean; adminGithubId?: string; }
}
