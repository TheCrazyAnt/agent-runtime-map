export default function CheckoutPage() {
  async function submitCheckout(formData: FormData) {
    await fetch("/api/checkout", {
      method: "POST",
      body: JSON.stringify({ items: [{ sku: String(formData.get("sku")), qty: 1 }], total: 42 }),
    });
  }
  return (
    <form action={submitCheckout}>
      <button type="submit">Buy</button>
    </form>
  );
}
