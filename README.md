# RealTimeChat

A Next.js chat app using Supabase with NAAZZ-V2-inspired dark styling and browser-side end-to-end encryption (E2EE).

## Security design

- **Saved messages:** plaintext is encrypted in the browser before insert. Supabase stores an encrypted JSON envelope in `messages.encrypted_payload`, not a plaintext message body.
- **Cryptography:** ECDH P-256 key agreement, HKDF-SHA-256 key derivation, and AES-256-GCM authenticated encryption with a fresh random salt and IV for each recipient envelope.
- **Private identity keys:** generated in the browser and stored as a non-extractable `CryptoKey` in IndexedDB. Private keys are not uploaded to Supabase.
- **Recipients:** each message is encrypted separately for each current conversation member, including the sender so their own messages can be decrypted on this device.
- **Live drafts:** drafts are encrypted before being sent over Supabase Realtime Broadcast. Draft text is not written to the messages table.
- **Access controls:** Supabase RLS limits message reads and writes, public-key access to shared participants, and private Realtime topics to conversation members.
- **Key verification:** open the shield button in a conversation to see public-key fingerprints. Compare them with each participant through a separate trusted channel to help detect key substitution.

## Setup

1. Create a Supabase project.
2. In the Supabase SQL Editor, run `supabase/schema.sql`.
3. In Supabase Authentication settings, enable Email OTP / magic links and configure allowed redirect URLs for local and deployed environments.
4. In Supabase Project Settings → API, copy the Project URL and publishable/anon key.
5. Create a local `.env.local` file:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
   ```

6. Install dependencies and run:

   ```bash
   npm install
   npm run dev
   ```

7. Open http://localhost:3000 over localhost or HTTPS, sign in with a magic link, create a room, and share its invite ID with the intended participant. Each participant must sign in and open the room to publish an encryption public key before encrypted messaging works.

## Existing plaintext database migration

If you ran an earlier version that stored messages in `messages.body`, the schema refuses to complete while legacy plaintext rows exist. This is intentional: old messages cannot be made end-to-end encrypted by changing the database schema alone.

1. Export any legacy messages you need to keep.
2. If you are ready to discard all legacy plaintext messages, run this in the Supabase SQL Editor:

   ```sql
   delete from public.messages;
   ```

3. Rerun `supabase/schema.sql`. It will remove the old plaintext `body` column. New messages are stored only in `encrypted_payload`.

Do not run the delete command unless you have decided to permanently remove the old messages.

## Important limitations

- Private keys are device-local. Clearing browser storage or moving to a different browser/device can make existing messages unreadable. There is no encrypted backup or secure key-transfer flow yet. Do not clear site data if you need to keep access to old messages.
- A key fingerprint should be compared with the other participant over a separate trusted channel. Until participants verify fingerprints, a malicious service controlling the key directory could attempt public-key substitution.
- Browser malware, compromised devices, malicious extensions, or an XSS vulnerability can expose plaintext after decryption. E2EE does not protect a compromised endpoint.
- The room ID currently acts as an invite token. Only share it with intended participants. The join flow needs stronger invitation/approval controls before sensitive production use.
- This is an initial E2EE implementation, not a third-party-audited secure messenger. Perform independent security review and two-account testing before relying on it for sensitive conversations.

## Deploy

Deploy as a standard Next.js application on Vercel. Set both environment variables in project settings and redeploy. Use HTTPS in production because Web Crypto and authentication redirects require a secure context.
