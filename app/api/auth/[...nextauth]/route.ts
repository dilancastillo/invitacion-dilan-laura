import NextAuth from "next-auth";
import { authIsConfigured, authOptions } from "../../../../lib/auth";

export const dynamic = "force-dynamic";
const handler = NextAuth(authOptions);

async function guardedHandler(...args: Parameters<typeof handler>) {
  if (!authIsConfigured()) {
    return Response.json({ error: "El acceso privado aún no está configurado." }, {
      status: 503, headers: { "Cache-Control": "private, no-store" },
    });
  }
  return handler(...args);
}
export { guardedHandler as GET, guardedHandler as POST };
