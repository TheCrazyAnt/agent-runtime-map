import { BillingService, NotifyService } from "./billing";

/** Instances live on a shared object; call sites go through its properties. */
export const services = {
  billing: new BillingService(),
  notify: new NotifyService(),
};
