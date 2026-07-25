/**
 * Tiny Stripe stub used by the durable charge flow.
 *
 * @param key - Secret key from the vault
 */
export function stripe(_key: string): {
  create(orderId: string): { id: string };
  confirm(intent: { id: string }): boolean;
} {
  return {
    create(orderId) {
      return { id: `pi_${orderId}` };
    },
    confirm(_intent) {
      return true;
    },
  };
}
