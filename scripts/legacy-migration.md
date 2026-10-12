# Legacy migration

The old Supabase schema is not copied automatically. Export users, room metadata, memberships, public keys, and ciphertext envelopes only after verifying a backup. Map legacy `auth.users.id` values to the new `users.id` values in a private operator script. Never export `messages.body` into the new database: if plaintext rows exist, stop, review them manually, and decide whether to delete or separately archive them. Existing encrypted envelopes remain decryptable only on devices that retain the original IndexedDB private key.
