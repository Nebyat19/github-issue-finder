#!/usr/bin/env node

const { spawn } = require('node:child_process')
const fs = require('node:fs')

const env = { ...process.env }

;(async() => {
  // If running the web server then migrate existing database
  if (process.argv.slice(-3).join(' ') === 'pnpm run start') {
    const url = new URL(process.env.DATABASE_URL)
    const target = url.protocol === 'file:' && url.pathname

    // restore database if not present and replica exists
    const newDb = target && !fs.existsSync(target)
    if (newDb && process.env.BUCKET_NAME) {
      await exec(`litestream restore -config litestream.yml -if-replica-exists ${target}`)
    }

    // prepare database
    // Pin Prisma CLI to app version to avoid runtime installs of Prisma 7.
    await exec('npx --yes prisma@5.9.1 migrate deploy')
  }

  // launch application
  if (process.env.BUCKET_NAME) {
    await exec(`litestream replicate -config litestream.yml -exec ${JSON.stringify(process.argv.slice(2).join(' '))}`)
  } else {
    await exec(process.argv.slice(2).join(' '))
  }
})()

function exec(command) {
  const child = spawn(command, { shell: true, stdio: 'inherit', env })
  return new Promise((resolve, reject) => {
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} failed rc=${code}`))
      }
    })
  })
}
