#!/usr/bin/env node
/**
 * Generate a bcrypt hash for ADMIN_PASSWORD_HASH.
 * Usage: node scripts/hash-password.cjs "your-secure-password"
 */
const bcrypt = require('bcryptjs')

const password = process.argv[2]
if (!password) {
  console.error('Usage: node scripts/hash-password.cjs "your-secure-password"')
  process.exit(1)
}

const hash = bcrypt.hashSync(password, 12)
console.log(hash)
