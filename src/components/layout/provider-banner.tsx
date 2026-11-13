import { ShieldCheck, CloudUpload } from "lucide-react";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/db/settings";
import { providerInfo } from "@/lib/provider-info";
import { cn } from "@/lib/utils";

export function ProviderBanner() {
  const db = getDb();
  const info = providerInfo(getSetting(db, "provider"), getSetting(db, "ollamaUrl"));
  const Icon = info.leavesMachine ? CloudUpload : ShieldCheck;
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 border-b px-4 py-2 text-xs",
        info.leavesMachine
          ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span className="font-medium">{info.leavesMachine ? "Code is sent to Anthropic" : "Local only"}</span>
      <span className="text-muted-foreground">· {info.label} · {info.detail}</span>
    </div>
  );
}
