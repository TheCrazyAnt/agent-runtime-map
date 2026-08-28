export async function fulfillmentWorkflow(orderId: string) {
  const shipped = await requestShipment(orderId);
  if (!shipped) {
    return { status: "backordered" };
  }
  await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    body: JSON.stringify({ template: "shipped", orderId }),
  });
  return { status: "shipped" };
}

declare function requestShipment(orderId: string): Promise<boolean>;
