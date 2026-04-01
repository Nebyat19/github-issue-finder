#!/bin/bash

# Navigate to project root
cd /vercel/share/v0-project

# Generate Prisma client
npx prisma generate

# Run migrations (create database and tables)
npx prisma migrate deploy

# Seed the database with initial admin user
npx tsx scripts/init-db.ts

echo "Database setup complete!"
