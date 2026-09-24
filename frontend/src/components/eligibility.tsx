"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

const KEY = "amen:eligibility:v1";

export function EligibilityStrip() {
  return (
    <div className="border-b border-border bg-card px-4 py-2 text-center text-[11px] leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">Not for US persons.</span> Stock Tokens are debt securities issued by
      Robinhood Assets (Jersey) Limited. <span className="font-medium text-foreground">They are not shares</span>: economic
      exposure only, no ownership, no voting. Not investment advice.{" "}
      <Link className="underline underline-offset-2 hover:text-foreground" href="/risk">
        Risks
      </Link>
    </div>
  );
}

/** First-visit attestation for the app. Stored locally; nothing is sent anywhere. */
export function EligibilityGate() {
  const [show, setShow] = useState(false);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true);
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/90 p-5 backdrop-blur-md" role="dialog" aria-modal>
      <div className="w-full max-w-md space-y-5 rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <Logo size={28} />
          <Globe className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Before you enter</h2>
          <p className="text-sm text-muted-foreground">Please confirm the following.</p>
        </div>
        <ul className="space-y-2.5 text-sm text-muted-foreground">
          {[
            "Amen isn't available to US persons.",
            "Robinhood Stock Tokens are debt securities. They give economic exposure to a share, not ownership of it, and no voting rights.",
            "Oracles can pause, weekend marks can be stale, and markets can be voided and refunded.",
            "Nothing here is investment advice. Amen is software, not a broker.",
          ].map((t) => (
            <li key={t} className="flex gap-2.5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
              {t}
            </li>
          ))}
        </ul>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card-raised p-3 text-sm">
          <input type="checkbox" className="mt-0.5 accent-primary" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I confirm I am not a US person, and I understand the above.</span>
        </label>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={!checked}
            onClick={() => {
              try {
                localStorage.setItem(KEY, String(Date.now()));
              } catch {}
              setShow(false);
            }}
          >
            Enter
          </Button>
          <Link href="/risk">
            <Button variant="outline">Read the risks</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
