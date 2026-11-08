import { mayCount, quietly, type PrivacySignals } from './siteEvents'

// Cloudflare Web Analytics shows page views, where visitors came from, devices, countries, and loading speed, with no
// cookie. A deployment turns it on by building with its site token, and it runs only where the town's own totals would
// count: on the town itself, and never for a browser that sends Global Privacy Control or Do Not Track.

const BEACON_SCRIPT = 'https://static.cloudflareinsights.com/beacon.min.js'

/** The beacon to add, or null when this build has no token or this page must not be measured. */
export function webAnalyticsBeacon(token: string | undefined, pathname: string, signals: PrivacySignals) {
  const site = token?.trim()
  if (!site || !mayCount(pathname, signals)) return null
  return { script: BEACON_SCRIPT, config: JSON.stringify({ token: site }) }
}

/** Adds the beacon once at startup; a blocked or failed beacon only leaves a visit unmeasured. */
export function startWebAnalytics() {
  quietly(() => {
    const beacon = webAnalyticsBeacon(
      import.meta.env.VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN,
      window.location.pathname,
      navigator,
    )
    if (!beacon) return
    const element = document.createElement('script')
    element.setAttribute('src', beacon.script)
    element.dataset.cfBeacon = beacon.config
    document.body.append(element)
  })
}
