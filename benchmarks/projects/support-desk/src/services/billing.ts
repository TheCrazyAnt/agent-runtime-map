declare const db: { refund: { create(args: object): Promise<object> } };

export class BillingService {
  async refundOrder(orderId: string, amount: number) {
    await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      body: JSON.stringify({ order: orderId, amount }),
    });
    return db.refund.create({ data: { orderId, amount } });
  }
}

export class NotifyService {
  async email(to: string, subject: string) {
    await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      body: JSON.stringify({ to, subject }),
    });
  }
}
