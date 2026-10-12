# RealTimeChat

A Next.js chat app , cyan/violet ambient glow, glass panels, and **optional live draft sharing**.

## Features

- Supabase email magic-link authentication
- Room creation and invite-by-room-ID flow
- Persisted chat messages in Postgres
- Ephemeral draft snapshots over private Supabase Realtime Broadcast
- Live draft privacy toggle
- Mobile-responsive UI and reduced-motion support

## Setup

1. Create a Supabase project.
2. In the Supabase SQL Editor, run `supabase/schema.sql`.
3. In Supabase Authentication settings, enable Email OTP / magic links and configure the allowed redirect URLs for your local and deployed app.
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

7. Open http://localhost:3000, sign in with email, create a room, and share its room ID with the other participant. The other person signs in and joins with that ID.

## Live draft behavior

While live sharing is enabled, the composer broadcasts temporary draft snapshots to the active private room. Drafts are not stored in the messages table. Sending writes one normal message to Postgres and clears the preview. Turning sharing off sends a clear event and stops sharing draft text.

## Security notes

- Never use a Supabase service-role key in the browser.
- Run the SQL policies before testing private Realtime channels.
- Keep room IDs private. The included join RPC grants membership to any authenticated user who knows a room UUID, so use a trusted invite-only workflow before deploying this to sensitive conversations.
- Realtime authorization depends on the RLS policies on `realtime.messages`. Test that users outside a room cannot subscribe or broadcast.
- Realtime presence and draft state are temporary UI state; the app also expires stale draft previews after 12 seconds.

## Deploy

Deploy as a standard Next.js application on Vercel. Set both environment variables in the project settings, then redeploy.
