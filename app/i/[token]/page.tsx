import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WeddingInvitation } from "../../WeddingInvitation";
import { getInviteByToken } from "../../../lib/rsvp";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const title = "Dilan & Laura — Nuestra boda";
  const description = "Acompáñanos a celebrar nuestra boda el 10 de octubre de 2026 en Tunja.";
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      images: [],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [],
    },
  };
}

export default async function PersonalizedInvitation({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await getInviteByToken(token);

  if (!invite) notFound();

  return (
    <WeddingInvitation
      guestName={invite.displayName}
      seatCount={invite.seatCount}
      isTest={invite.isTest}
      token={token}
      initialResponse={
        invite.decision && invite.submittedAt
          ? {
              decision: invite.decision,
              message: invite.message ?? "",
              submittedAt: invite.submittedAt,
            }
          : null
      }
    />
  );
}
