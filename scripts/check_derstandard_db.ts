import 'dotenv/config';
import { db } from "../server/db";
import { listings } from "../shared/schema";
import { eq, and, like, desc, sql } from "drizzle-orm";

async function checkDerStandardDB() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 DerStandard Database Analysis');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Count total DerStandard listings
  const totalCount = await db.select({ count: sql<number>`count(*)` })
    .from(listings)
    .where(eq(listings.source, 'derstandard'));

  console.log(`📊 Total DerStandard listings: ${totalCount[0].count}\n`);

  // Sample 20 recent listings
  const recentListings = await db.select({
    id: listings.id,
    url: listings.url,
    title: listings.title,
    price: listings.price,
    area: listings.area,
    location: listings.location,
    category: listings.category,
    region: listings.region
  })
    .from(listings)
    .where(eq(listings.source, 'derstandard'))
    .orderBy(desc(listings.id))
    .limit(20);

  console.log('📋 Sample of 20 recent listings:\n');

  for (const listing of recentListings) {
    console.log(`ID ${listing.id}:`);
    console.log(`  URL: ${listing.url}`);
    console.log(`  Title: ${listing.title?.substring(0, 80)}`);
    console.log(`  Price: ${listing.price} EUR | Area: ${listing.area} m²`);
    console.log(`  Location: ${listing.location} | Region: ${listing.region}`);
    console.log('');
  }

  // Check for keywords in titles that might indicate commercial listings
  console.log('\n🔍 Analyzing titles for commercial keywords:\n');

  const commercialKeywords = [
    'provisionsfrei', 'provision', 'makler', 'gmbh', 'bauträger',
    'erstbezug', 'neubau projekt', 'rendite', 'investment'
  ];

  for (const keyword of commercialKeywords) {
    const count = await db.select({ count: sql<number>`count(*)` })
      .from(listings)
      .where(
        and(
          eq(listings.source, 'derstandard'),
          like(listings.title, `%${keyword}%`)
        )
      );

    console.log(`  "${keyword}": ${count[0].count} listings`);
  }

  // Check location distribution
  console.log('\n📍 Location/Region Distribution:\n');

  const regions = await db.select({
    region: listings.region,
    count: sql<number>`count(*)`
  })
    .from(listings)
    .where(eq(listings.source, 'derstandard'))
    .groupBy(listings.region)
    .orderBy(desc(sql<number>`count(*)`));

  for (const r of regions) {
    console.log(`  ${r.region}: ${r.count} listings`);
  }

  // Check categories
  console.log('\n🏠 Category Distribution:\n');

  const categories = await db.select({
    category: listings.category,
    count: sql<number>`count(*)`
  })
    .from(listings)
    .where(eq(listings.source, 'derstandard'))
    .groupBy(listings.category)
    .orderBy(desc(sql<number>`count(*)`));

  for (const c of categories) {
    console.log(`  ${c.category}: ${c.count} listings`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  process.exit(0);
}

checkDerStandardDB().catch(console.error);
