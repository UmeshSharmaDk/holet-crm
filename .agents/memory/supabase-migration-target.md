---
name: Supabase migration target
description: User's intended plan to move StayPilot hosting away from Replit while using Supabase PostgreSQL.
---
The user says they have a Supabase database set up and wants to move the application off Replit. Treat Supabase as the intended database destination, but do not assume the application is already connected to it or that its data is complete.

**Why:** The app uses generic PostgreSQL through `DATABASE_URL`; its private guest identity files are stored separately through Replit-provided Google Cloud credentials. Moving the database alone will not move those files or make the current storage client work outside Replit.

**How to apply:** Confirm the current database source before copying data. Keep guest scans in private encrypted object storage, preserve the existing encryption key during the move, and do not shut down the Replit deployment until the external API, database, and file-storage paths have passed end-to-end tests.
