# Skypadi Pitch Deck

## Slide 1 — Skypadi

**Headline:** Compare flights. Book faster. All from WhatsApp.

**Subheadline:** Say the trip once. Compare options. Pay securely. Get ticketed. All in one chat.

**Chat demo:**
- User: Need cheapest Lagos to Abuja tomorrow morning.
- Skypadi: I found 5 live options. Cheapest: 7:45am, ₦118k. Best value: 9:10am, ₦124k with 20kg bag.
- User: Book best value. Pay by transfer.
- Skypadi: Secure payment link sent. Ticket and PNR will arrive here after confirmation.
- Skypadi: PNR: 4T9K2Q. I’ll watch this flight and alert you if anything changes.

**Speaker note:** Skypadi is a WhatsApp-first flight booking assistant for African travel markets, starting with Nigeria. The core pain is repeated searching and form-filling across local and international flight sites.

## Slide 2 — The Problem

**Headline:** Finding and booking the right flight takes too much work.

**Core idea:** Travellers want the best option for their time and budget, but today they repeat the same search and booking steps across multiple sites.

**Pain points:**
- Repeated search across airline and OTA websites.
- Price comparison fatigue across routes, times, baggage, and restrictions.
- Re-entered forms for route, date, passengers, contact details, and payment.
- Post-booking follow-up scattered across email, payment receipts, PNRs, and support channels.

**Wedge:** Travellers do not want to fill the same travel forms again and again. They want to say the trip once, compare options fast, and book from one familiar thread.

**Speaker note:** The problem is convenience first. Flight websites exist, but comparing prices and completing bookings across multiple sites forces travellers to repeat the same intent and passenger details over and over.

## Slide 3 — The Solution

**Headline:** Say the trip once. Skypadi handles the repeated work.

**Core promise:** Tell Skypadi your trip once. It searches across options, explains the tradeoffs, reuses your details, and helps complete the booking in WhatsApp.

**What Skypadi does:**
- Turns plain-language requests into comparable flight options.
- Compares timing, fare, baggage, restrictions, and payment options.
- Collects passenger details once and reuses them with consent.
- Sends secure payment links or transfer instructions.
- Keeps ticket, PNR, receipt, itinerary, changes, and support in the same thread.
- Routes edge cases, fraud flags, VIP requests, and sensitive refund work to trained humans.

**Speaker note:** The product is not just a chatbot. It is a controlled booking workflow with AI at the interface and human escalation where fulfilment risk is high.

## Slide 4 — Product Flow

**Headline:** From chat request to ticketed itinerary.

**Customer flow:**
1. Ask once: “Cheapest Lagos to Abuja tomorrow morning.”
2. Compare: live fares, baggage, timing, and change/refund rules.
3. Reuse details: saved passenger details and fare rules accepted.
4. Pay: secure link, bank transfer, USSD, or card checkout.
5. Ticket: PNR, receipt, itinerary, and calendar-ready summary.
6. Support: alerts, changes, refunds, and human takeover.

**Backend control plane:**
- WhatsApp Business and Flows for structured prompts, templates, confirmations, and support thread.
- AI travel brain for intent, saved traveller details, fare explanation, policy answers, and voice/multilingual routing.
- Inventory layer for airline, OTA, GDS, or NDC content with fare-rule validation.
- Payments and reconciliation through secure provider flows.
- CRM and human agents for exceptions, refunds, reissues, and SLA tracking.

**Safety rule:** Never ask for full card or bank account numbers in chat. Push sensitive payment to a secure provider flow.

**Speaker note:** The customer sees a simple conversation. Behind the scenes, Skypadi follows structured steps and controlled integrations.

## Slide 5 — Market

**Headline:** African flight demand spans local, regional, and international trips.

**Why now:**
- 113M projected African airline passengers in 2025.
- 68.3% of African airline traffic was on international routes in 2024.
- Africa’s aviation market is forecast to reach 411M passengers over 20 years.
- Africa’s aviation market is forecast to grow 4.1% annually over 20 years.
- Nigeria passenger traffic is projected to grow from 15.89M in 2023 to 25.7M by 2029.
- Nigeria aviation-sector revenue is projected to reach $2.58B by 2029.
- Average specified-route airfare in Nigeria was ₦153,648 in February 2026, up 21.38% year over year.

**Market implication:** The winner is not only the cheapest quote. It is the fastest path from intent to comparison to booking to support.

**Speaker note:** Nigeria is the beachhead. The broader market is Africa’s local, regional, and international flight demand.

## Slide 6 — Business Model

**Headline:** Revenue stack: service fees first, ancillaries second, B2B later.

**Revenue streams:**
- Booking service fee: ₦1,000–₦3,500 local per ticket for avoiding repeated searches and booking forms; higher for regional, international, or urgent reissue support.
- Supplier commission or markup where permitted and transparent.
- Ancillary attach: baggage, seat choice, insurance, hotels, airport transfer, lounge, protocol, and visa-document support.
- SME travel desk: monthly subscription for approvals, receipts, team travel ledger, and consolidated support.

**Illustrative unit economics:**
- Ticket value reference: ≈ ₦153,648 average specified-route airfare in Nigeria, February 2026.
- Take rate: ₦2,000–₦5,000 from convenience fee plus supplier or ancillary economics.
- Support cost: falls as AI handles repeated search, FAQs, and forms while humans handle exceptions.
- Retention lever: post-booking thread with alerts, receipts, changes, and family sharing.

**Speaker note:** The willingness-to-pay thesis is convenience: customers pay to avoid repeating searches and forms across multiple booking sites.

## Slide 7 — Go To Market

**Headline:** Win local routes, then expand across African travel corridors.

**Phase 1 — Pilot, 0–90 days:**
- Partner with a licensed agency or OTA inventory provider.
- Launch 3 high-frequency local routes.
- Run manual + AI hybrid operations.
- Measure quote-to-book conversion and human handoff rate.

**Phase 2 — Repeat users, 3–9 months:**
- Build SME travel desks.
- Add referral links and saved itineraries.
- Launch route deal alerts across Africa corridors.
- Establish human support SLAs.

**Phase 3 — Expand, 9–18 months:**
- Add regional and international corridors.
- Add hotels, transfers, and visa help.
- Launch agent network or white-label offering.
- Add corporate reporting and approvals for local and international trips.

**Pilot KPIs:**
- Quote-to-book conversion.
- Payment success.
- Average response time.
- Human handoff rate.
- Refund/reissue turnaround.
- Repeat booking rate.

**Speaker note:** Start narrow to prove faster comparison, conversion, and fulfilment quality, then expand to regional Africa and intercontinental travel.

## Slide 8 — WhatsApp Demo Traction

**Headline:** WhatsApp demo proves the workflow before full scale.

**Demo scope:**
- Customer starts in WhatsApp.
- AI returns ranked flight options.
- Fare rules are explained in plain language.
- Passenger details are collected through structured prompts.
- Payment handoff is routed to a secure provider flow.
- PNR, itinerary, and support thread remain in WhatsApp.

**What the demo proves:**
- Demand signal: users state real routes, dates, budgets, and passenger needs inside WhatsApp.
- Product convenience: customers understand options and next steps without re-entering the same details on multiple sites.
- Operational readiness: automation can separate low-risk steps from human handoff before payment or ticketing risk.
- Repeatable workflow: the same model can support local routes first, then regional Africa and intercontinental travel.

**Traction metrics to show:**
- Demo conversations completed.
- Qualified booking intents captured.
- Quote-to-payment-link conversion.
- Average response time.
- Human handoff rate.
- Top requested routes.

**Speaker note:** The demo should prove that customers can state a trip once, compare options, and move toward booking without repeating the same forms across multiple sites.
