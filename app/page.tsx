import { WeddingInvitation } from "./WeddingInvitation";

export default function Home() {
  return (
    <WeddingInvitation
      guestName="Invitado especial"
      initialResponse={null}
      preview
      token={null}
    />
  );
}
