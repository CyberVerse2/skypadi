# WhatsApp Conversation UI Design

**Date:** 2026-04-29

**Status:** Draft for review

## Goal

Define the first-time Skypadi WhatsApp booking flow using WhatsApp-native UI features: list messages, reply buttons, Flows, media uploads, and document delivery.

This document complements `2026-04-29-whatsapp-backend-rewrite-design.md`. The backend spec defines architecture and state transitions. This UI spec defines how users move through those states inside WhatsApp.

## Product Rules

- Skypadi always asks for origin when the user does not provide it.
- Skypadi should not silently assume Lagos or any other origin.
- Preferences such as "cheapest but not stressful", preferred airlines, baggage sensitivity, and payment method are learned over time from confirmed user behavior.
- First-time users should not be asked a separate optimization-preference question before search. Skypadi should show cheapest, best value, and earliest by default.
- WhatsApp interactive reply buttons should be used for short choices with up to three options.
- WhatsApp list messages should be used for choices with more than three likely options.
- WhatsApp Flows should be used for structured forms, especially passenger details.
- Visible labels are not trusted as business identifiers. Workflows should use structured reply IDs such as `origin:LOS`, `trip_type:one_way`, and `flight_option:<id>`.

## WhatsApp UI Feature Mapping

| Need | WhatsApp Feature | Reason |
| --- | --- | --- |
| Origin selection | List message | Origin has more than three likely options. |
| One-way vs return | Reply buttons | Binary choice, one tap. |
| Passenger count | Reply buttons | Usually 1, 2, or more. |
| Highlighted flight choice | Reply buttons | Cheapest, best value, earliest fit into three buttons. |
| More flight options | List message | More than three options need a scrollable selection. |
| Passenger details | WhatsApp Flow | Structured data is safer than free text. |
| Payment method | Reply buttons | Transfer or card. |
| Payment proof | Media upload plus reply button | User can upload receipt or tap "I've paid". |
| Ticket delivery | Document message | E-ticket can be sent directly in WhatsApp. |
| Reminders and updates outside the service window | Message templates | Required for outbound business-initiated messages. |

## First-Time User Flow

### 1. User Sends Travel Request

```text
User:
I need a flight to Abuja tomorrow morning.
```

Skypadi extracts:

```text
destination: Abuja
departure_date: tomorrow
departure_window: morning
```

Origin is missing, so the next step is origin selection.

### 2. Origin Selection With List Message

```text
Skypadi:
Sure. Where are you flying from?

[Choose city]
```

List message:

```text
Popular departure cities
- Lagos
- Abuja
- Port Harcourt
- Kano
- Enugu
- Owerri
- Asaba
- Benin
- Uyo
- Other
```

Suggested row IDs:

```text
origin:LOS
origin:ABV
origin:PHC
origin:KAN
origin:ENU
origin:QOW
origin:ABB
origin:BNI
origin:QUO
origin:OTHER
```

The list should be dynamic:

- First-time users see popular Nigerian departure cities.
- Returning users see recent and frequently used origins first.
- If the user selects `origin:OTHER`, Skypadi asks them to type the city or airport.

### 3. Trip Type With Reply Buttons

After the user selects an origin:

```text
Skypadi:
Is this one-way or return?

[One-way] [Return]
```

Button IDs:

```text
trip_type:one_way
trip_type:return
```

If the user taps `Return`, Skypadi asks:

```text
What date are you returning?
```

If the user taps `One-way`, Skypadi continues to passenger count.

### 4. Passenger Count With Reply Buttons

```text
Skypadi:
How many passengers?

[Just me] [2 people] [More]
```

Button IDs:

```text
passengers:1
passengers:2
passengers:more
```

If the user taps `More`, Skypadi asks:

```text
How many passengers are travelling?
```

### 5. Search Confirmation

Once required search fields are available:

```text
Skypadi:
Searching Lagos -> Abuja for tomorrow morning, one-way, 1 passenger.
```

The workflow then searches Wakanow, stores the search, stores normalized option snapshots, and ranks options.

### 6. Flight Results

For three highlighted options, use reply buttons:

```text
Skypadi:
I found 3 good options:

Cheapest
ValueJet
7:30 AM
NGN 142,000

Best value
Ibom Air
8:45 AM
NGN 158,000
My pick: less rushed, better overall.

Earliest
Air Peace
6:45 AM
NGN 171,000

Choose one:

[Cheapest] [Best value] [Earliest]
```

Button IDs:

```text
flight_option:<cheapest_option_id>
flight_option:<best_value_option_id>
flight_option:<earliest_option_id>
```

If there are more useful options to show, send a list message instead:

```text
[View flight options]
```

List sections may be:

```text
Recommended
- Ibom Air, 8:45 AM, NGN 158,000

Lowest fares
- ValueJet, 7:30 AM, NGN 142,000
- Airline B, 10:20 AM, NGN 151,000

Earliest
- Air Peace, 6:45 AM, NGN 171,000
```

### 7. Passenger Details With WhatsApp Flow

After the user chooses a flight:

```text
Skypadi:
Great choice. I need the passenger details to continue.

[Enter passenger details]
```

Flow fields for one passenger:

```text
Full name as on ID
Gender
Phone number
Email
Date of birth, if required by supplier
```

For multiple passengers, repeat passenger sections inside the Flow.

The Flow submission should include the booking ID and structured passenger data:

```json
{
  "bookingId": "book_123",
  "passengers": [
    {
      "fullName": "Celestine Ejiofor",
      "gender": "male",
      "phone": "08012345678",
      "email": "celestine@email.com"
    }
  ]
}
```

### 8. Booking Summary And Payment Method

```text
Skypadi:
Here’s your booking summary:

Lagos -> Abuja
Ibom Air
Tomorrow, 8:45 AM
Passenger: Celestine Ejiofor

Fare: NGN 158,000
Skypadi fee: NGN 3,000
Total: NGN 161,000

Prices can change until ticketing. If the airline changes the fare, I’ll confirm before charging extra.

How would you like to pay?

[Transfer] [Card]
```

Button IDs:

```text
payment_method:transfer
payment_method:card
```

### 9. Transfer Payment

If the user taps transfer:

```text
Skypadi:
Send NGN 161,000 to:

Skypadi Travel
Providus Bank
1234567890

After payment, upload the receipt or tap I've paid.

[I've paid] [Change method]
```

Button IDs:

```text
payment:paid_claimed
payment:change_method
```

Tapping `I've paid` does not confirm payment. It moves the payment attempt to proof received or pending review. Payment confirmation must come from a trusted confirmation path.

### 10. Card Payment

If the user taps card:

```text
Skypadi:
Use this secure link to pay NGN 161,000:

<payment link>

I’ll continue once payment is confirmed.
```

Card confirmation comes from the payment provider webhook, not from the AI.

### 11. Supplier Fulfillment

After trusted payment confirmation:

```text
Skypadi:
Payment confirmed. I’m booking your ticket now.
```

If Wakanow requires email verification:

```text
Skypadi:
Almost done. The booking system is doing one extra verification, so I’m completing that now.
```

The user should not need to handle supplier OTP if Resend receives it through the booking alias.

### 12. Ticket Issued

```text
Skypadi:
Booked.

Your Lagos -> Abuja flight on Ibom Air leaves tomorrow at 8:45 AM.

I’ve sent your e-ticket here and to celestine@email.com. I’ll remind you before the flight and alert you if the airline changes anything.
```

Send the ticket as a WhatsApp document message:

```text
Ibom-Air-Lagos-Abuja-ticket.pdf
```

## State Mapping

```text
collecting_trip_details
  -> origin list
  -> trip type buttons
  -> passenger count buttons

presenting_flight_options
  -> flight buttons or flight list

collecting_passenger_details
  -> WhatsApp Flow

awaiting_payment_choice
  -> transfer/card buttons

awaiting_payment_confirmation
  -> receipt upload or "I've paid" button

issuing_supplier_booking
  -> progress text

awaiting_supplier_verification
  -> progress text while Resend handles OTP

ticket_issued
  -> ticket document
```

## Implementation Notes

- Workflow outputs should describe desired UI, not raw WhatsApp payloads.
- The WhatsApp adapter converts workflow UI intents into Cloud API payloads.
- Store all outbound interactive IDs with the conversation message so inbound replies can be validated against the expected state.
- Reject stale interactive replies when the booking has moved past the state where that reply is valid.
- Keep button/list titles short. Business logic must use IDs, not titles.
- Use message templates for reminders or updates outside WhatsApp's customer-service window.

## Test Cases

```text
RED: user asks for Abuja tomorrow morning without origin.
Expected: workflow emits origin list message with popular Nigerian departure cities.

RED: user selects origin:LOS.
Expected: workflow stores Lagos as origin and emits one-way/return buttons.

RED: user selects trip_type:return.
Expected: workflow asks for return date.

RED: first-time user reaches search-ready state.
Expected: workflow searches without asking a separate optimization preference question.

RED: workflow presents three highlighted flight options.
Expected: workflow emits reply buttons with flight option IDs.

RED: user sends stale flight_option reply after booking state changed.
Expected: workflow rejects reply and asks user to continue from current state.

RED: user taps payment:paid_claimed.
Expected: payment is not confirmed; payment attempt moves to pending review/proof received.
```

## Open Questions

- Which Nigerian departure cities should be in the first default origin list, and in what order?
- Should origin list rows display airport codes, city names, or both?
- Should the passenger details Flow collect date of birth in the first version, or only when Wakanow requires it?
- Should card payment be enabled in the first production cut or should bank transfer ship first?

## Self-Review

- Placeholder scan: no TBD/TODO placeholders.
- Scope check: this document covers WhatsApp conversation UI only; backend architecture remains in the rewrite design spec.
- Consistency check: origin is explicit, preferences are learned, irreversible actions remain outside the AI layer, and interactive labels are not trusted as business IDs.
