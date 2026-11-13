"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GitPullRequest, History, LayoutDashboard, FolderGit2, Settings, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/repositories", label: "Repositories", icon: FolderGit2 },
  { href: "/reviews/new", label: "New review", icon: GitPullRequest },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2 px-4 py-4">
        <ScanSearch className="size-5 text-primary" aria-hidden />
        <span className="font-medium tracking-tight">DiffLens</span>
      </div>
      <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                active && "bg-accent text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
      <p className="mt-auto px-4 py-3 text-xs text-muted-foreground">127.0.0.1 only</p>
    </aside>
  );
}
