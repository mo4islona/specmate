import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://specmate:specmate@localhost:5432/specmate',
  },
  strict: true,
  verbose: true,
})
