# RealTimeChat

A Next.js encrypted chat application for Vercel. Supabase has been removed. The app uses Neon PostgreSQL, Vercel Blob for encrypted attachments, signed HTTP-only sessions, and browser-side E2EE.

## Deploy from Android / Vercel dashboard

1. Import `MayanKiz/RealTimeChat` into Vercel.
2. Add the **Neon PostgreSQL** Marketplace integration.
3. Add the **Vercel Blob** Marketplace integration.
4. In Vercel project settings, add `AUTH_SECRET` as a long random value and set `AUTH_URL` to the production URL.
5. Redeploy.
6. Run `npm run db:migrate` once from a trusted environment with `DATABASE_URL`, or execute `db/migrations/001_initial.sql` in the Neon SQL editor.

Required variables are documented in `.env.example`. Never put `DATABASE_URL`, `AUTH_SECRET`, or `BLOB_READ_WRITE_TOKEN` in a `NEXT_PUBLIC_*` variable.

## Security model

- Passwords are salted and hashed with Node `scrypt`; sessions are random, hashed server-side, HTTP-only, SameSite cookies.
- The browser creates a non-extractable ECDH P-256 private key in IndexedDB. Only the public key is stored in Neon.
- Messages are encrypted per recipient with ECDH P-256, HKDF-SHA-256, and AES-256-GCM before persistence.
- The server stores ciphertext envelopes and never receives plaintext message content.
- The UI verifies sender public keys and shows fingerprints for out-of-band comparison.
- Messages use cursor-based polling because Vercel Functions do not provide a persistent WebSocket server.
- Attachment uploads require authentication and room membership; callers must upload `application/octet-stream` ciphertext and the metadata stores an encrypted file key.

## Safe legacy migration

The old Supabase data is not copied or deleted automatically. See `scripts/legacy-migration.md`. Preserve old encrypted envelopes only after backing up the original database and mapping legacy user IDs. Existing encrypted messages remain readable only on devices retaining the original IndexedDB private key. If legacy plaintext rows exist, stop and make an explicit archival/deletion decision; never copy them into the new encrypted table.

This project is not formally audited. Device compromise, XSS, malicious extensions, key substitution before fingerprint verification, and device loss remain important risks.
