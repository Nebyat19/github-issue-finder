import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";



async function main() {
  // Clean up existing data
  
  await prisma.apiKey.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.repository.deleteMany();
  await prisma.user.deleteMany();

  // Create admin user
  const hashedPassword = await bcrypt.hash("admin123", 10);
  const adminUser = await prisma.user.create({
    data: {
      email: "admin@example.com",
      passwordHash: hashedPassword,
      role: "admin",
      isApproved: true,
      isBanned: false,
      isAdmin: true,
    },
  });

  console.log("✓ Admin user created:");
  console.log(`  Email: admin@example.com`);
  console.log(`  Password: admin123`);

  // Create a test user (inactive, requires approval)
  const testUser = await prisma.user.create({
    data: {
      email: "user@example.com",
      passwordHash: await bcrypt.hash("user123", 10),
      role: "user",
      isApproved: false,
      isBanned: false,
      isAdmin: false,
    },
  });

  console.log("\n✓ Test user created (requires admin approval):");
  console.log(`  Email: user@example.com`);
  console.log(`  Password: user123`);

  // Create API keys for testing
  const adminApiKey = await prisma.apiKey.create({
    data: {
      userId: adminUser.id,
      token: `sk-admin-${Math.random().toString(36).substring(7)}`,
      isActive: true,
    },
  });

  console.log("\n✓ API keys created:");
  console.log(`  Admin API Key: ${adminApiKey.token}`);

  console.log("\n✓ Database initialized successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
