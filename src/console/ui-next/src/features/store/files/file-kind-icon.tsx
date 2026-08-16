/**
 * Type-tinted glyph for a files folder or object.
 */

import type { JSX } from "react";
import {
  ColorsIcon,
  File01Icon,
  FileExportIcon,
  Folder01Icon,
  MusicNote01Icon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { explorerIconInk } from "@/components/explorer/explorer-chrome.ts";
import { cn } from "@/lib/utils.ts";
import type { FileKind } from "../lib/files-meta.ts";

/** Props for {@link FileKindIcon}. */
export interface FileKindIconProps {
  readonly kind: FileKind | "folder";
  readonly className?: string;
  readonly well?: boolean;
}

const KIND_WELL: Record<FileKind | "folder", string> = {
  folder: "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  image: "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  text: "border-border/60 bg-muted/50 text-muted-foreground",
  code: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  pdf: "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  patch: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  video: "border-fuchsia-500/35 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
  audio: "border-teal-500/35 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  archive: "border-orange-500/35 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  binary: "border-border/60 bg-muted/40 text-muted-foreground",
};

/**
 * Icon well for a files browser row or tile.
 *
 * @param props - Kind + optional well chrome
 */
export function FileKindIcon({ kind, className, well = true }: FileKindIconProps): JSX.Element {
  const icon =
    kind === "folder"
      ? Folder01Icon
      : kind === "image"
        ? ColorsIcon
        : kind === "pdf"
          ? FileExportIcon
          : kind === "video"
            ? PlayIcon
            : kind === "audio"
              ? MusicNote01Icon
              : File01Icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        well && "size-7 rounded-md border",
        well ? KIND_WELL[kind] : explorerIconInk(KIND_WELL[kind]),
        className,
      )}
      aria-hidden
    >
      <HugeiconsIcon icon={icon} className="size-3.5" />
    </span>
  );
}
