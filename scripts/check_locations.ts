
import 'dotenv/config';
import { db } from "../server/db";
import { listings } from "../shared/schema";
import { eq, like, desc } from "drizzle-orm";

async function checkLocations() {
    console.log("Checking locations for Wien...");

    const wienListings = await db.select({
        id: listings.id,
        location: listings.location,
        region: listings.region,
        source: listings.source
    })
        .from(listings)
        .where(eq(listings.region, 'wien'))
        .orderBy(desc(listings.id))
        .limit(20);

    console.log("Found " + wienListings.length + " listings in Wien.");
    wienListings.forEach(l => {
        console.log(`[${l.source}] ID: ${l.id} | Location: "${l.location}"`);
    });

    process.exit(0);
}

checkLocations().catch(console.error);
