import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider.js";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <div className="auth-loading">Loading your mailbox…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
