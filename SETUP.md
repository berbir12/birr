# Setting up automatic SMS forwarding

Telegram bots and Mini Apps can't read your SMS. Instead, your phone forwards each telebirr and CBE
message to your Birr server the moment it arrives, and the bot replies with the usual confirmation card.

```
SMS from 127 / CBE ──► phone automation ──► POST https://<project>.vercel.app/ingest/sms ──► Birr ──► card in Telegram
```

Pasting into the bot still works any time, as a fallback.

## 1. Deploy first

Your phone has to reach Birr over HTTPS, so deploy it to Vercel first ([DEPLOY.md](DEPLOY.md)).
The address is your production URL, e.g. `https://birr-tracker.vercel.app`.

## 2. Get your URL and token

Send `/connect` to the bot. It replies with:

- **URL**: `https://<project>.vercel.app/ingest/sms`
- **Token**: `birr_…`

The token is the only thing protecting the endpoint. Anyone who has it can add transactions to your account.
Keep it private and delete the bot's message once the automation works.

- `/connect` again issues a new token. The old one keeps working for 1 hour so you have time to update the phone.
- `/disconnect` revokes the token immediately, for example if you lose your phone.

## 3. iPhone (Shortcuts)

You need iOS 17 or later for automations that run without asking. Create **two** automations, one for
telebirr and one for CBE.

### telebirr automation

1. Open **Shortcuts** → **Automation** tab → **+** (New Automation) → **Message**.
2. Leave **Sender** empty. In **Message Contains** type `telebirr`.
   > Every telebirr transaction SMS contains the word "telebirr". Matching on content avoids having to
   > save 127 as a contact.
3. Choose **Run Immediately**, and turn **Notify When Run** off if you don't want a banner. Tap **Next**.
4. Tap **New Blank Automation** → **Add Action** → search for **Get Contents of URL**.
5. Tap **URL** and paste the URL from `/connect`.
6. Tap the **›** arrow to expand the options:
   - **Method:** `POST`
   - **Headers** → **Add new header**:
     - Key: `Authorization`
     - Value: `Bearer birr_…` (the word `Bearer`, a space, then your token)
   - **Request Body:** `JSON`
     - **Add new field → Text**, key `body`. For the value, tap it, choose the **Shortcut Input** variable,
       then tap the variable again and pick **Content**. Depending on your iOS version the label may be
       *Message* or *Body*; pick the one holding the message text.
     - **Add new field → Text**, key `sender`. Value: **Shortcut Input** → **Sender**.
7. Tap **Done**.

### CBE automation

Repeat the steps above with **Message Contains** set to `CBE`. You can also long-press the telebirr
automation → **Duplicate** and just change the word.

### What gets sent

```json
{ "sender": "127", "body": "Dear …  You have transferred ETB 15.00 to …" }
```

`received_at` is optional. If you leave it out, the server uses the time the request arrives, which is
within seconds of the SMS because the automation runs immediately. If you want to add it, use
**Current Date** with **Date Format → ISO 8601**.

### Good to know

- **Unrelated messages are ignored.** "Message Contains: CBE" also fires on promotions or OTPs that
  mention CBE. The server records nothing for those and the bot stays quiet.
- **Duplicates are harmless.** If an automation fires twice, or you also paste the same SMS, it's recorded once.
- **No internet means a missed message.** If your phone is offline when the SMS arrives, the forward fails
  and iOS doesn't retry it. Paste the message into the bot later. Balance reconciliation (coming in this
  phase) will flag gaps as "possible missing SMS" so you know what to look for.
- **Saved contacts are fine.** If you saved 127 or CBE as a contact, the sender arrives as the contact
  name. Birr then identifies the message from its text instead.

## 4. Android (SMS forwarder app)

Any SMS-forwarding app that can send an HTTP POST works (search the Play Store for "SMS forwarder webhook").
Configure it with:

- **Filter:** sender is `127` or `CBE`
- **URL:** the URL from `/connect`
- **Method:** POST, content type `application/json`
- **Header:** `Authorization: Bearer birr_…`
  - If the app can't set headers, append `?token=birr_…` to the URL instead.
- **Body template:** `{"sender": "<sender>", "body": "<message>", "received_at": "<timestamp>"}`, using
  the app's own placeholders for sender, message text and receive time. Unix seconds, milliseconds and
  ISO 8601 are all accepted.

## 5. Test it

From any computer, using your URL and token (macOS/Linux terminal, or Git Bash on Windows):

```sh
curl -X POST "https://<project>.vercel.app/ingest/sms" \
  -H "Authorization: Bearer birr_…" \
  -H "Content-Type: application/json" \
  -d '{"sender":"127","body":"Dear TEST\nYou have transferred ETB 1.00 to Test Person (2519****0000) on 01/01/2026 10:00:00. Your transaction number is TESTTEST01. The service fee is  ETB 0.00 and  15% VAT on the service fee is ETB 0.00. Your current E-Money Account  balance is ETB 1.00.\nThank you for using telebirr"}'
```

You should get `{"ok":true,"status":"created",…}` and a card in the bot. Tap 🗑 on it to remove the test
transaction.

On the phone, the real test is the next actual transaction. A small airtime top-up works: even though
Birr doesn't parse airtime messages yet, the bot will tell you one arrived and put it in the review queue.
That proves the automation works.

| Response | Meaning |
|---|---|
| `401 unauthorized` | Token missing or wrong. Check the `Bearer ` prefix, then run `/connect` again. |
| `403 forbidden` | The token's Telegram account isn't in `ALLOWED_TELEGRAM_IDS`. |
| `400 bad_body` | No `body` field. Check the JSON field names in the Shortcut. |
| `429 rate_limited` | More than `INGEST_RATE_LIMIT_PER_MIN` requests a minute. |
| `"status":"ignored"` | Reached Birr, but it isn't a telebirr or CBE transaction. |
| `"status":"review"` | Reached Birr, but the format isn't known yet. It's in the review queue. |

## Backfilling old messages

The automation only catches new SMS. To add your history, **send the export file to the bot** as a
document (.xml, .csv or .txt, up to 20 MB). Birr keeps only telebirr and CBE messages and shows a
preview before anything is saved:

```
📦 messages.csv
2,431 messages in the file · 312 from telebirr/CBE (telebirr 201 · CBE 111)
📅 12 Mar 2025 – 24 Nov 2026

✅ 287 new · ↺ 18 already recorded · 🔍 7 for review
```

Tap **📥 Import** to save, or **✖ Cancel**. Importing the same file twice is harmless, and `/undo` removes
the whole import. Afterwards Birr tells you how many internal transfers it linked and where the balance
doesn't add up (probably missing SMS).

Where to get a file:

- **iPhone:** iOS has no built-in SMS export. Back up the phone to a computer and export the 127 and CBE
  conversations with a tool such as iMazing (CSV or TXT). Or paste batches of messages into the bot; it
  handles many at once and orders undated CBE ones by balance.
- **Android:** use "SMS Backup & Restore" to back up messages, then send the .xml to the bot.

Export only the 127 and CBE conversations if you can. It keeps the file small, and Birr discards other
messages anyway.
