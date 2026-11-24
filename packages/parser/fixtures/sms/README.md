# SMS fixtures

One real (redacted) SMS per `.txt`, with a hand-written `.json` of the expected parse next to it.
`src/fixtures.test.ts` picks up every pair automatically.

## Adding a fixture

1. Copy the SMS exactly, keeping line breaks and double spaces.
2. Redact it: swap in fake names, fake transaction references and receipt tokens, and fake digits
   in account and phone numbers (keep the same length and masking style). Amounts and balances can stay.
3. Save it as `<source>/<next-number>_<kind>.txt`.
4. Write `<same-name>.json` from what the SMS says, not from what the parser outputs.
   Money is in cents, and `occurredAt` is ISO with `+03:00`, or `null` when the SMS has no date (CBE).
5. Run `pnpm test`. If it fails, fix or add a template in `src/telebirr.ts` or `src/cbe.ts`.

Never commit unredacted messages. `_private/` is gitignored if you need a scratch folder.

## Coverage so far

| Source   | Template                     | Fixtures |
|----------|------------------------------|----------|
| telebirr | transfer_out (P2P)           | t01–t08, t11 |
| telebirr | cash_in_agent                | t09 |
| telebirr | wallet_to_bank               | t10 |
| cbe      | transfer_out                 | c02, c05, c08, c09 |
| cbe      | transfer_in                  | c01, c04 |
| cbe      | debit (generic)              | c03, c06, c07, c10 |

Both sequences are in time order with no gaps: each balance equals the previous balance ± amount and charges.
They double as reconciliation test data.

Still needed: telebirr money received, merchant payment, airtime, data package, bill payment, agent cash-out,
bank → wallet; CBE ATM, salary/credit, CBE → telebirr; any failed or reversed transaction.
