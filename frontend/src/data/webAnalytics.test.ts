import { describe, expect, it } from 'vitest'
import { webAnalyticsBeacon } from './webAnalytics'

describe('webAnalyticsBeacon', () => {
  it('measures only the town, only with a token, and never a browser that refused', () => {
    expect(webAnalyticsBeacon(' site-token ', '/', {})?.config).toBe('{"token":"site-token"}')
    expect(webAnalyticsBeacon(undefined, '/', {})).toBeNull()
    expect(webAnalyticsBeacon('site-token', '/admin', {})).toBeNull()
    expect(webAnalyticsBeacon('site-token', '/', { globalPrivacyControl: true })).toBeNull()
    expect(webAnalyticsBeacon('site-token', '/', { doNotTrack: '1' })).toBeNull()
  })
})
