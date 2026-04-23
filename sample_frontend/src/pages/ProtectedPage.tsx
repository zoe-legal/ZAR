import { RedirectToSignIn, SignedIn, SignedOut } from "@clerk/clerk-react";
import { ProtectedContent } from "../components/ProtectedContent";

export function ProtectedPage() {
  return (
    <>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <SignedIn>
        <ProtectedContent />
      </SignedIn>
    </>
  );
}
