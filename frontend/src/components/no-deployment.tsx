import { activeChain } from "@/lib/chains";

export function NoDeployment() {
  return (
    <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
      No Amen deployment is configured for chain {activeChain.id}. Run <code className="font-mono">script/local-demo.sh</code>{" "}
      (local) or a deploy script, then <code className="font-mono">npm run sync</code>.
    </div>
  );
}
