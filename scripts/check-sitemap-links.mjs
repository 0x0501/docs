#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

const DEFAULT_SITEMAPS = [
  'https://docs.desirecore.com/sitemap.xml',
  'https://docs.desirecore.com/en/sitemap.xml',
]
const CONCURRENCY = 20
const TIMEOUT_MS = 15_000
const MAX_ATTEMPTS = 2

const sitemapSources = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : DEFAULT_SITEMAPS

function decodeXml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
}

async function loadSitemap(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source, {
      headers: { 'user-agent': 'DesireCore-Sitemap-Checker/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`Sitemap ${source} returned HTTP ${response.status}`)
    }
    return response.text()
  }
  return readFile(source, 'utf8')
}

function extractUrls(xml, source) {
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => decodeXml(match[1].trim()))
  if (urls.length === 0) {
    throw new Error(`Sitemap ${source} does not contain any <loc> entries`)
  }
  return urls
}

function getHtmlMetadata(html) {
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1]
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1]
  const robots = html.match(/<meta[^>]+(?:name|property)=["']robots["'][^>]+content=["']([^"']+)/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']robots["']/i)?.[1]
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim()
  return { canonical: canonical ? decodeXml(canonical) : null, robots, title }
}

async function checkUrl(url) {
  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'DesireCore-Sitemap-Checker/1.0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const contentType = response.headers.get('content-type') ?? ''
      const html = await response.text()
      const metadata = getHtmlMetadata(html)
      const problems = []

      if (!response.ok) problems.push(`HTTP ${response.status}`)
      if (!contentType.toLowerCase().includes('text/html')) {
        problems.push(`unexpected content-type ${contentType || '(missing)'}`)
      }
      if (response.url !== url) problems.push(`redirected to ${response.url}`)
      if (metadata.canonical && metadata.canonical !== url) {
        problems.push(`canonical points to ${metadata.canonical}`)
      }
      if (metadata.robots?.toLowerCase().includes('noindex')) {
        problems.push(`robots=${metadata.robots}`)
      }
      if (/\b(?:404|page not found|页面未找到)\b/i.test(metadata.title ?? '')) {
        problems.push(`possible soft 404 title: ${metadata.title}`)
      }

      if (response.status >= 500 && attempt < MAX_ATTEMPTS) continue
      return { url, status: response.status, problems }
    } catch (error) {
      lastError = error
    }
  }
  return { url, status: 'error', problems: [lastError?.message ?? 'request failed'] }
}

async function main() {
  const sitemapEntries = await Promise.all(sitemapSources.map(async (source) => ({
    source,
    urls: extractUrls(await loadSitemap(source), source),
  })))
  const allUrls = sitemapEntries.flatMap((entry) => entry.urls)
  const duplicateUrls = [...new Set(allUrls.filter((url, index) => allUrls.indexOf(url) !== index))]
  const urls = [...new Set(allUrls)]

  console.log(`Sitemaps: ${sitemapEntries.length}`)
  for (const entry of sitemapEntries) console.log(`- ${entry.source}: ${entry.urls.length} URLs`)
  console.log(`Unique URLs to check: ${urls.length}`)

  const results = new Array(urls.length)
  let cursor = 0
  let completed = 0
  async function worker() {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= urls.length) return
      results[index] = await checkUrl(urls[index])
      completed += 1
      if (completed % 50 === 0 || completed === urls.length) {
        console.log(`Checked ${completed}/${urls.length}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker))

  const statusCounts = Object.groupBy
    ? Object.fromEntries(Object.entries(Object.groupBy(results, (result) => result.status)).map(([status, items]) => [status, items.length]))
    : results.reduce((counts, result) => ({ ...counts, [result.status]: (counts[result.status] ?? 0) + 1 }), {})
  const failures = results.filter((result) => result.problems.length > 0)

  console.log(`Status summary: ${JSON.stringify(statusCounts)}`)
  if (duplicateUrls.length > 0) {
    console.error(`Duplicate URLs (${duplicateUrls.length}):`)
    for (const url of duplicateUrls) console.error(`- ${url}`)
  }
  if (failures.length > 0) {
    console.error(`Failed SEO checks (${failures.length}):`)
    for (const failure of failures) {
      console.error(`- ${failure.url}: ${failure.problems.join('; ')}`)
    }
  }

  if (duplicateUrls.length > 0 || failures.length > 0) process.exitCode = 1
  else console.log('All sitemap URLs passed real HTTP and SEO checks.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
