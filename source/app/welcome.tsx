"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowRight,
  Eye,
  EyeOff,
  ShieldCheck,
  Layers3,
} from "lucide-react";

export default function Welcome({
  email,
  setup,
  error,
}: {
  email: string;
  setup: boolean;
  error: boolean;
  signIn?: string;
}) {
  const [show, S] = useState(false);
  const [message, M] = useState(
    error ? "Secure storage is currently unavailable." : "",
  );
  const [busy, B] = useState(false);
  const [modal, D] = useState(false);
  const [caps, C] = useState(false);

  return (
    <main className="welcome">
      <section className="welcome-hero">
        <div className="wordmark">
          <Layers3 /> RELIABILITY <b>INTELLIGENCE</b>
        </div>
        <div className="hero-copy">
          <span className="eyebrow light">EVIDENCE TO ADVANTAGE</span>
          <h1>
            <span>AI-Enabled</span>
            <br />
            Asset Performance
            <br />
            Management
          </h1>
          <h2>
            Reliability Intelligence. Business Clarity.
            <br />
            Confident Capital Decisions.
          </h2>
          <p>
            Transform fragmented asset history into actionable reliability
            insights, early risk visibility, and evidence-based investment
            decisions.
          </p>
          <div className="chips">
            <span>Bad Actor Intelligence</span>
            <span>MEDFI Incident Management</span>
            <span>DCBF Investment Decisions</span>
          </div>
        </div>
        <div className="journey">
          01 Discover <ArrowRight /> 02 Structure <ArrowRight /> 03 Analyze{" "}
          <ArrowRight /> 04 Decide
        </div>
      </section>
      <section className="login-panel">
        <div className="privacy-badge">
          <ShieldCheck size={16} /> Private demonstration • Synthetic data
        </div>
        <div className="login-inner">
          <img
            className="iapm-login-logo"
            src="/iapm-logo.png"
            alt="iAPM — Intelligent Asset Performance Management"
          />
          <span className="eyebrow">YOUR RELIABILITY WORKSPACE</span>
          <h2>
            Welcome to
            <br />
            Reliability Intelligence.
          </h2>
          <p>
            {setup
              ? "Establish your private demonstration password."
              : "Sign in to turn asset evidence into confident decisions."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              B(true);
              M("");
              const f = new FormData(e.currentTarget);
              try {
                const r = await fetch("/api/auth", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email: f.get("email"),
                    password: f.get("password"),
                    action: setup ? "setup" : "login",
                  }),
                });
                const d: any = await r.json();
                if (!r.ok) M(d.error);
                else window.location.href = "/workbench";
              } catch {
                M("Connection unavailable. Please retry.");
              }
              B(false);
            }}
          >
            <label>
              Email
              <Input
                name="email"
                type="email"
                defaultValue={email}
                required
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <div className="password-input">
                <Input
                  name="password"
                  type={show ? "text" : "password"}
                  minLength={setup ? 12 : 1}
                  maxLength={128}
                  required
                  autoComplete={setup ? "new-password" : "current-password"}
                  onKeyUp={(e) => C(e.getModifierState("CapsLock"))}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={show ? "Hide password" : "Show password"}
                  onClick={() => S(!show)}
                >
                  {show ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </label>
            {caps && <p>Caps Lock is on.</p>}
            <p role="alert" className="error">
              {message}
            </p>
            <Button className="login-submit" disabled={busy || error}>
              {busy
                ? "Signing in…"
                : setup
                  ? "Create password & open workspace"
                  : "Sign in"}
              <ArrowRight />
            </Button>
            <p className="fine">
              Protected by an eight-hour secure application session. Your
              password is stored as a salted hash.
            </p>
          </form>
          <Button variant="link" onClick={() => D(true)}>
            Explore platform capabilities <ArrowRight />
          </Button>
        </div>
        <footer>
          Reliability Intelligence · Controlled demonstration
          <br />
          Version 0.1 · September 2026
        </footer>
      </section>
      <Dialog open={modal} onOpenChange={D}>
        <DialogContent>
          <DialogTitle>One connected decision journey</DialogTitle>
          <DialogDescription>
            Asset register → incident evidence → bad actors → reliability
            forecasts → DCBF → capital priorities → accountable actions. All
            demonstration records are synthetic. AI document extraction is an
            illustrative walkthrough; engineering decisions require review.
          </DialogDescription>
        </DialogContent>
      </Dialog>
    </main>
  );
}
