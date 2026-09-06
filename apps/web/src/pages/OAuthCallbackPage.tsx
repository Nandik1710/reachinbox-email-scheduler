import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider.js";

export function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    void refresh().then(() => navigate("/dashboard", { replace: true }));
  }, [navigate, refresh]);

  return <div className="auth-loading">Completing Google sign-in…</div>;
}
