#!/bin/bash

# Navigate to project root
cd /vercel/share/v0-project

# Generate Prisma client (pin CLI major version)
npx --yes prisma@5.22.0 generate

# Run migrations (create database and tables)
npx --yes prisma@5.22.0 migrate deploy

# Seed the database with initial admin user
npx tsx scripts/init-db.ts

echo "Database setup complete!"
