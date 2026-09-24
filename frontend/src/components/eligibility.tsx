"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const KEY = "amen:eligibility:v1";

export function EligibilityStrip() {
  return (
    <div className="border-b border-border bg-secondary/40 px-4 py-2 text-center text-[11px] leading-relaxed text-muted-foreground">
      <strong className="font-medium text-foreground">Not for US persons.</strong> Stock Tokens are debt securities issued by
      Robinhood Assets (Jersey) Limited. <strong className="font-medium text-foreground">They are not shares</strong>: economic
      exposure only, no ownership, no voting. Nothing here is investment advice. Amen is not a broker.{" "}
      <Link className="underline" href="/risk">
        Risks
      </Link>
    </div>
  );
}

/** First-visit attestation. It's stored locally; nothing is sent anywhere. */
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/95 p-6 backdrop-blur" role="dialog" aria-modal>
      <div className="max-w-lg space-y-5">
        <p className="text-xs uppercase tracking-[0.3em] text-gilt">Before you enter</p>
        <h2 className="font-serif text-3xl">Amen Protocol</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Amen isn&apos;t available to US persons.</li>
          <li>
            Robinhood Stock Tokens are <em>debt securities</em>. They give economic exposure to a share, not ownership of it,
            and no voting rights.
          </li>
          <li>Oracles can pause, weekend marks can be stale, and markets can be voided and refunded.</li>
          <li>Nothing here is investment advice. Amen is software, not a broker.</li>
        </ul>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I confirm I am not a US person, and I understand the above.</span>
        </label>
        <div className="flex gap-3">
          <Button
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
          <Link href="/risk" onClick={() => setShow(false)}>
            <Button variant="ghost">Read the risks first</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
