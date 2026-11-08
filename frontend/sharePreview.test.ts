import { describe, expect, it } from 'vitest'
import { DEFAULT_SHARE_TEXT, sharePreviewTags } from './sharePreview'

describe('link preview tags', () => {
  it("names the deployment's town, points crawlers at an absolute image, and keeps settings inside attributes", () => {
    const tags = sharePreviewTags({
      origin: 'https://town.example/',
      title: 'Town of "Robin" <3',
      description: '  ',
    })
    expect(tags).toContain('<title>Town of &quot;Robin&quot; &lt;3</title>')
    expect(tags).toContain('<meta property="og:title" content="Town of &quot;Robin&quot; &lt;3" />')
    expect(tags).toContain('<meta property="og:image" content="https://town.example/og-image.jpg" />')
    expect(tags).toContain(`<meta property="og:description" content="${DEFAULT_SHARE_TEXT.description}" />`)
    expect(sharePreviewTags({})).toContain('<meta property="og:image" content="/og-image.jpg" />')
  })
})
