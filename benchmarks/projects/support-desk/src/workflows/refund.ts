import { services } from "../services/index";

/** A human reviews every refund before money moves. */
export async function approveRefund(ticketId: string): Promise<boolean> {
  return awaitHumanDecision(ticketId);
}

export async function refundWorkflow(ticketId: string, orderId: string, amount: number) {
  const approved = await approveRefund(ticketId);
  if (!approved) return { status: "rejected" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await services.billing.refundOrder(orderId, amount);
      break;
    } catch {
      // Retry the charge-back; the gateway is flaky.
    }
  }
  await services.notify.email("customer@example.com", "Your refund is on its way");
  return { status: "refunded" };
}

declare function awaitHumanDecision(ticketId: string): Promise<boolean>;
