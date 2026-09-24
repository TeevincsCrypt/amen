import Image from "next/image";
import { cn } from "@/lib/utils";

/** Amen mark (the pointed-arch "A") with optional wordmark. */
export function Logo({ className, size = 28, wordmark = true, sub }: { className?: string; size?: number; wordmark?: boolean; sub?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image src="/amen-logo.svg" alt="" width={size} height={size} priority unoptimized />
      {wordmark && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight">Amen</span>
          {sub && <span className="mt-1 font-mono text-[10px] text-muted-foreground">{sub}</span>}
        </span>
      )}
    </span>
  );
}
