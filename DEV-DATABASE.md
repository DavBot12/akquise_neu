# Development Database Setup

## Overview

The project now supports separate development and production databases using Neon branches.

## Database Configuration

### Production Database
- **File:** `.env`
- **Branch:** Main Neon branch (with production data)
- **Usage:** `npm start` (production builds)

### Development Database
- **File:** `.env.development`
- **Branch:** Child Neon branch (schema only, no data)
- **Usage:** `npm run dev` (development mode)

## Usage

### Run Development Server with Dev Database
```bash
npm run dev
```

This will automatically:
- Load environment variables from `.env.development`
- Use the development database (empty, safe for testing)
- Enable `DEBUG_SCRAPER=true` for detailed logging
- Set `NODE_ENV=development`

### Push Database Schema to Dev Database
```bash
npm run db:push:dev
```

### Run Production Build
```bash
npm start
```

This uses the production database from `.env`.

## Benefits

✅ **Safe Testing**: Test scrapers without contaminating production data
✅ **Isolated Development**: Each developer can have their own dev branch
✅ **Easy Reset**: Delete and recreate dev branch to start fresh
✅ **Schema Sync**: Dev branch automatically includes production schema

## Environment Files

- `.env` - Production database (DO NOT COMMIT)
- `.env.development` - Development database (DO NOT COMMIT)
- `.env.example` - Template for new developers

## Verification

To verify you're using the correct database:

```bash
# Start dev server
npm run dev

# In another terminal, check which database is connected
# The logs will show: "Connected to database: neondb on ep-red-haze-a2p0vytl-pooler..."
```

Production database endpoint: `ep-jolly-dust-a22d0vlg-pooler`
Development database endpoint: `ep-red-haze-a2p0vytl-pooler`

## Resetting Dev Database

If you need to clear all data from dev database:

1. Go to Neon Console: https://console.neon.tech
2. Select the `development` branch
3. Delete the branch
4. Create a new `development` branch from `main`
5. Update `.env.development` with the new connection string
6. Run `npm run db:push:dev` to apply schema

## Notes

- Both databases use the same schema (via Drizzle migrations)
- Development database starts empty (no listings, no users)
- You may need to create a test user manually in dev database
- All scrapers will write to whichever database is configured
