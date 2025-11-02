import 'dotenv/config';
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const username = process.argv[2] || "david";
  const result = await db.update(users)
    .set({ is_admin: true })
    .where(eq(users.username, username))
    .returning({ id: users.id, username: users.username, is_admin: users.is_admin });

  if (result.length === 0) {
    console.error(`User '${username}' not found. Create the user first via register or insert.`);
    process.exit(1);
  }

  console.log(`Promoted user '${result[0].username}' (id ${result[0].id}) to admin.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
