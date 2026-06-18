import { Typography } from "@nous-research/ui/ui/components/typography/index";
import type { StatusResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

export function SidebarFooter(_: SidebarFooterProps) {
  // Minimal, elegant RoleFit wordmark. The Hermes version string + the
  // "Nous Research" external link are intentionally hidden (not deleted)
  // to keep the footer calm and on-brand for the light glass chrome.
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2",
        "px-5 py-2.5",
        "border-t border-current/10",
      )}
    >
      <Typography className="text-xs font-medium tracking-[-0.01em] text-text-tertiary">
        RoleFit
      </Typography>
    </div>
  );
}

interface SidebarFooterProps {
  status: StatusResponse | null;
}
