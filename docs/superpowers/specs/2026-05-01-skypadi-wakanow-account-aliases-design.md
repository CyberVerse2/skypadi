# Skypadi Wakanow Account And Booking Alias Design

## Goal

Skypadi should book Wakanow flights through a Skypadi-owned Wakanow account while still using a unique `@bookings.skypadi.com` alias per customer booking. The supplier account gives us a stable authenticated booking identity. The per-booking alias gives us traceability and lets Skypadi receive supplier emails, extract ticket/payment/receipt data, and deliver controlled updates to the customer.

## Architecture

Use one production Wakanow account owned by Skypadi, for example `bookings@bookings.skypadi.com` or `supplier@bookings.skypadi.com`. The account token/session is treated as supplier credentials and stored outside git in production secrets. Booking jobs authenticate to Wakanow with this account before calling the direct API booking path.

Each booking still creates a unique email alias in `booking_email_aliases`, such as `book_<token>@bookings.skypadi.com`. That alias is passed to Wakanow as the booking contact email. The passenger details remain the real traveler details.

## Data Flow

1. User selects a flight and confirms passenger details.
2. Skypadi creates a booking record and a unique booking email alias.
3. Supplier booking job loads Skypadi Wakanow auth and creates the Wakanow hold through the direct API.
4. The Wakanow booking payload uses:
   - authenticated Skypadi supplier account for API/session identity
   - real traveler details for passenger identity
   - per-booking alias for supplier contact email
5. Wakanow sends ticket, receipt, OTP, payment, or failure emails to the alias.
6. Resend inbound webhook stores the email, links it to `booking_email_aliases`, classifies it, and updates booking state.
7. Skypadi sends deterministic WhatsApp/email updates to the customer.

## Controlled Behavior

Customer-facing messages must not expose the supplier account. They should show the passenger, route, fare, Skypadi fee, payment instructions, ticket status, and final ticket/receipt delivery.

Supplier emails are internal artifacts unless the email is explicitly a ticket or receipt that should be forwarded. Even then, Skypadi should send a controlled message with the attachment/link instead of dumping raw supplier copy into WhatsApp.

## Verification Requirement

Before this becomes the default production path, we must run a live non-payment verification:

1. Register or log into Wakanow with the chosen `@bookings.skypadi.com` supplier account.
2. Confirm Wakanow account OTP arrives through Resend inbound.
3. Create a pending-payment Wakanow booking using authenticated direct API booking.
4. Confirm supplier emails sent to the per-booking alias arrive through Resend inbound.
5. Confirm the inbound email is linked to the correct booking alias and booking record.

If Wakanow does not reliably deliver to `@bookings.skypadi.com`, fallback is to keep the Skypadi Wakanow account on a known deliverable mailbox while still using aliases for ticket/receipt tracking only after provider deliverability is fixed.

## Error Handling

If supplier authentication is missing or expired, booking jobs should fail into manual support rather than falling back to customer-owned Wakanow accounts.

If Wakanow asks for email verification during booking, Skypadi should wait for OTP on the booking alias. If no OTP arrives within the configured window, the booking should pause and notify support.

If ticket or receipt emails do not arrive after payment/issuance, Skypadi should keep the booking in a pending supplier-confirmation state and surface a support action.

## Testing

Unit tests should cover:

- booking contact email remains the per-booking alias
- supplier auth is attached to Wakanow direct API calls
- inbound email alias routing links supplier emails to the correct booking
- missing OTP or missing ticket email produces a support-safe state

Live verification should be manual and explicit because it talks to Wakanow production and can create pending-payment bookings.
