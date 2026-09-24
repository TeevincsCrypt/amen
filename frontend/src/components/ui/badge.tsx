import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em]",
  {
    variants: {
      variant: {
        default: "border-border text-muted-foreground",
        cash: "border-cash/50 text-cash",
        vespers: "border-vespers/50 text-vespers",
        frozen: "border-destructive/60 text-destructive",
        gilt: "border-gilt/50 text-gilt",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
