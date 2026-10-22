// Adds or replaces platforms in the in-app updater's feed (latest.json), keeping the ones already there,
// so the macOS and Windows builds of a release can each add their own entry in either order.
//
//   node scripts/latest-json.mjs <file> <version> <notes> <platform> <url> <sig-file> [<platform> <url> <sig-file>…]
//
// A file for another version is replaced rather than merged.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const [file, version, notes, ...rest] = process.argv.slice(2)
if (!file || !version || rest.length === 0 || rest.length % 3 !== 0) {
  console.error('Usage: latest-json.mjs <file> <version> <notes> <platform> <url> <sig-file> […]')
  process.exit(1)
}

const old = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
const platforms = old?.version === version ? { ...old.platforms } : {}
for (let i = 0; i < rest.length; i += 3) {
  const [platform, url, sigFile] = rest.slice(i, i + 3)
  platforms[platform] = { signature: readFileSync(sigFile, 'utf8').trim(), url }
}

const latest = { version, notes, pub_date: new Date().toISOString(), platforms }
writeFileSync(file, JSON.stringify(latest, null, 2) + '\n')
console.log(`latest.json ${version}: ${Object.keys(platforms).sort().join(', ')}`)
