declare const db: { order: { create(args: object): Promise<{ id: string }> } };

export class CartService {
  validate(items: Array<{ sku: string; qty: number }>): boolean {
    return items.length > 0 && items.every((item) => item.qty > 0);
  }

  async createOrder(items: Array<{ sku: string; qty: number }>) {
    return db.order.create({ data: { items } });
  }
}

export const services = {
  cart: new CartService(),
};
