"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";

export interface AccountOpt {
  id: string;
  source: "gh" | "token";
  host: string;
  login: string;
  label: string;
  ghActive: boolean;
  isDefault: boolean;
}

/** value: "__default" = the default account, "" = whichever account gh has active, otherwise an account id. */
export const DEFAULT_ACCOUNT = "__default";

/** Convert the select value into the `account` field of a PR reference (undefined = use the default). */
export function accountField(value: string): string | undefined {
  return value === DEFAULT_ACCOUNT ? undefined : value;
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<AccountOpt[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d: { accounts: AccountOpt[] }) => alive && setAccounts(d.accounts))
      .catch(() => alive && setAccounts([]));
    return () => {
      alive = false;
    };
  }, []);
  return accounts;
}

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function AccountSelect({ id, value, onChange, accounts }: { id: string; value: string; onChange: (v: string) => void; accounts: AccountOpt[] | null }) {
  const def = accounts?.find((a) => a.isDefault);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>GitHub account</Label>
      <select id={id} className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={DEFAULT_ACCOUNT}>{def ? `Default (${def.label} @ ${def.host})` : "Default (the account gh has active)"}</option>
        {def ? <option value="">Whichever account gh has active</option> : null}
        {(accounts ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.label} @ {a.host} ({a.source === "gh" ? "gh" : "token"})
          </option>
        ))}
      </select>
    </div>
  );
}
