import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider",
  {
    variants: {
      variant: {
        default: "border-border bg-card-raised text-muted-foreground",
        cash: "border-up/30 bg-up/10 text-up",
        vespers: "border-primary/30 bg-primary/10 text-primary",
        frozen: "border-destructive/40 bg-destructive/10 text-destructive",
        brand: "border-primary/30 bg-primary/10 text-primary",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
