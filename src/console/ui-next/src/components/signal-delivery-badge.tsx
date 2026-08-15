/**
 * Signal delivery badge — once / broadcast / live (Units tree + contract).
 */

import type { JSX } from "react";
import type { SignalDelivery } from "../../../../manifest/types.ts";
import { Badge } from "@/components/ui/badge";
import { SIGNAL_DELIVERY_SPECS } from "@/features/units/lib/signal-delivery.ts";
import { cn } from "@/lib/utils";

/** Props for {@link SignalDeliveryBadge}. */
export interface SignalDeliveryBadgeProps {
  readonly delivery: SignalDelivery;
  readonly className?: string;
}

/**
 * Outline badge colored by signal delivery physics.
 *
 * @param props - Delivery mode
 */
export function SignalDeliveryBadge({
  delivery,
  className,
}: SignalDeliveryBadgeProps): JSX.Element {
  const spec = SIGNAL_DELIVERY_SPECS[delivery];
  return (
    <Badge
      variant="outline"
      title={spec.title}
      className={cn("h-5 px-1.5 font-mono text-[10px]", spec.badgeClass, className)}
      data-slot="signal-delivery-badge"
      data-delivery={delivery}
    >
      {spec.label}
    </Badge>
  );
}
