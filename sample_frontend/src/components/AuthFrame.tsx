import type { ReactNode } from "react";

type AuthFrameProps = {
  children: ReactNode;
};

export function AuthFrame({ children }: AuthFrameProps) {
  return (
    <main className="page">
      <section className="auth-shell">
        {children}
      </section>
    </main>
  );
}
