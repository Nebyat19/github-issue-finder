import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";



async function seedDatabase() {
  // Admin user
  const existingAdmin = await prisma.user.findUnique({
    where: { email: "admin@issue-finder.com" },
  });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash("admin@123", 10);
    const adminUser = await prisma.user.create({
      data: {
        email: "admin@issue-finder.com",
        passwordHash: hashedPassword,
        role: "admin",
        isApproved: true,
        isBanned: false,
        isAdmin: true,
      },
    });
    console.log("✓ Admin user created: admin@issue-finder.com / admin@123");

    // Admin API key
    const adminApiKey = await prisma.apiKey.create({
      data: {
        userId: adminUser.id,
        token: `sk-admin-${Math.random().toString(36).substring(7)}`,
        isActive: true,
      },
    });
    console.log(`✓ Admin API Key: ${adminApiKey.token}`);
  } else {
    console.log("✓ Admin user already exists, skipping creation");
  }

  // Test user
  const existingTestUser = await prisma.user.findUnique({
    where: { email: "user@example.com" },
  });

  if (!existingTestUser) {
    const hashedPassword = await bcrypt.hash("user123", 10);
    await prisma.user.create({
      data: {
        email: "user@example.com",
        passwordHash: hashedPassword,
        role: "user",
        isApproved: false,
        isBanned: false,
        isAdmin: false,
      },
    });
    console.log("✓ Test user created: user@example.com / user123");
  } else {
    console.log("✓ Test user already exists, skipping creation");
  }

  console.log("✓ Database initialized successfully!");
}

// Run seed manually if called directly
if (require.main === module) {
  seedDatabase()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
