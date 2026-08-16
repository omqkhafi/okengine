/**
 * Operator settings — identity + theme.
 */

import type { JSX } from "react";
import { ModeToggle } from "@/components/mode-toggle";
import { SECTION_HEAD_CLASS } from "@/components/explorer/explorer-chrome.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import type { SessionOperator } from "@/client.ts";

/** Props for {@link SettingsDialog}. */
export interface SettingsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly operator: SessionOperator;
}

/**
 * Centered settings dialog for the signed-in operator.
 *
 * @param props - Open state and operator identity
 */
export function SettingsDialog({ open, onOpenChange, operator }: SettingsDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="settings-dialog">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Operator account and appearance.</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col">
          <SettingsFact label="Name" value={operator.name} />
          <SettingsFact label="Email" value={operator.email} />
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <dt className={SECTION_HEAD_CLASS}>Theme</dt>
            <dd>
              <ModeToggle />
            </dd>
          </div>
        </dl>
      </DialogContent>
    </Dialog>
  );
}

function SettingsFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 px-4 py-2">
      <dt className={SECTION_HEAD_CLASS}>{label}</dt>
      <dd className="min-w-0 truncate text-xs text-foreground">{value}</dd>
    </div>
  );
}
