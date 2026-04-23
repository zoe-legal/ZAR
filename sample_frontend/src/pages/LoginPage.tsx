import { SignIn } from "@clerk/clerk-react";
import { AuthFrame } from "../components/AuthFrame";

export function LoginPage() {
  return (
    <AuthFrame>
      <SignIn routing="path" path="/login" signUpUrl="/signup" forceRedirectUrl="/protected" />
    </AuthFrame>
  );
}
