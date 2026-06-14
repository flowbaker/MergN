import { cn } from "@/lib/utils";
import Logo from "@/assets/mergn-logo.svg?react";

export function MergNLogo({ className }: { className?: string }) {
  return <Logo className={cn("text-foreground", className)} aria-hidden />;
}
