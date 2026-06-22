import type { ReactNode } from "react";

interface PageTransitionProps {
  pageKey: string;
  children: ReactNode;
}

export const PageTransition = ({ pageKey, children }: PageTransitionProps) => (
  <div key={pageKey} className="page-transition">
    {children}
  </div>
);
