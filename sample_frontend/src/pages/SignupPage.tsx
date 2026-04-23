import { SignUp } from "@clerk/clerk-react";
import { AuthFrame } from "../components/AuthFrame";

export function SignupPage() {
  return (
    <AuthFrame>
      <SignUp routing="path" path="/signup" signInUrl="/login" forceRedirectUrl="/protected" />
    </AuthFrame>
  );
}
