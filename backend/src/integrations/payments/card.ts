export type CardPaymentProviderStatus =
  | { configured: true; provider: string }
  | { configured: false; reason: "provider_not_selected" };

export function getCardPaymentProviderStatus(): CardPaymentProviderStatus {
  return { configured: false, reason: "provider_not_selected" };
}
