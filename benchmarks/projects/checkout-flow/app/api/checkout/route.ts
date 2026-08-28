import { services } from "../../../src/services";
import { fulfillmentWorkflow } from "../../../src/fulfillment";

export async function POST(request: Request) {
  const body = await request.json();
  if (!services.cart.validate(body.items)) {
    return Response.json({ error: "empty cart" }, { status: 400 });
  }
  const payment = await fetch("https://api.stripe.com/v1/charges", {
    method: "POST",
    body: JSON.stringify({ amount: body.total }),
  });
  if (!payment.ok) {
    return Response.json({ error: "payment declined" }, { status: 402 });
  }
  const order = await services.cart.createOrder(body.items);
  await fulfillmentWorkflow(order.id);
  return Response.json({ orderId: order.id });
}
