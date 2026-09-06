import { useState } from "react";
import { useLocation } from "react-router-dom";

import { googleLoginUrl } from "../lib/api.js";

export function LoginPage() {
  const location = useLocation();
  const [message, setMessage] = useState<string | null>(
    new URLSearchParams(location.search).get("error")
      ? "Google sign-in was not completed. Please try again."
      : null,
  );

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">OXO</div>
        <h1 id="login-title">Login</h1>
        <a className="google-button" href={googleLoginUrl}>
          <span className="google-mark" aria-hidden="true">
            G
          </span>
          Login with Google
        </a>
        <div className="login-divider">
          <span>or sign up through email</span>
        </div>
        <form
          className="email-login-form"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage("Email/password login is not enabled. Use Google login to continue.");
          }}
        >
          <input aria-label="Email ID" placeholder="Email ID" type="email" />
          <input aria-label="Password" placeholder="Password" type="password" />
          <button type="submit">Login</button>
        </form>
        {message ? (
          <p className="login-message" role="status">
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
