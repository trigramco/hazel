// Packages
const fetch = require('node-fetch')
const convertStream = require('stream-to-string')

// Utilities
const checkPlatform = require('./platform')

module.exports = class Cache {
  constructor(config) {
    const { account, repository, token, url } = config
    this.config = config

    if (!account || !repository) {
      throw new Error('Neither ACCOUNT, nor REPOSITORY are defined')
    }

    if (token && !url) {
      throw new Error(
        'Neither NOW_URL, nor URL are defined, which are mandatory for private repo mode.'
      )
    }

    this.latest = {}
    this.cacheReleaseList = this.cacheReleaseList.bind(this)
    this.refreshCache = this.refreshCache.bind(this)
    this.loadCache = this.loadCache.bind(this)
  }

  async cacheReleaseList(rawUrl) {
    const { token } = this.config
    const options = {};
    const headers = { Accept: 'application/octet-stream' }
    let url = rawUrl

    if (token && typeof token === 'string' && token.length > 0) {
      headers.Authorization = `token ${token}`

      options.redirect = 'manual'

      url = rawUrl.replace(
        'https://api.github.com/',
        `https://${token}@api.github.com/`
      )
    }

    options.headers = headers;
    
    const { status, body } = await fetch(url, options)

    if (status !== 200) {
      throw new Error(
        `Tried to cache RELEASES, but failed fetching ${url}, status ${status}, ${JSON.stringify(headers)}`
      )
    }

    const content = await convertStream(body)
    const matches = content.match(/[^ ]*\.nupkg/gim)

    if (matches.length === 0) {
      throw new Error(
        `Tried to cache RELEASES, but failed. RELEASES content doesn't contain nupkg`
      )
    }

    const nuPKG = url.replace('RELEASES', matches[0])
    return content.replace(matches[0], nuPKG)
  }

  async refreshCache() {
    const { account, repository, pre, token } = this.config
    const repo = account + '/' + repository
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100`
    const headers = { Accept: 'application/vnd.github.preview' }

    if (token && typeof token === 'string' && token.length > 0) {
      headers.Authorization = `token ${token}`
    }

    const response = await fetch(url, { headers })

    console.log(`${JSON.stringify(headers)}`);
    if (response.status !== 200) {
      throw new Error(
        `GitHub API responded with ${response.status} for url ${url}`
      )
    }

    const data = await response.json()

    if (!Array.isArray(data) || data.length === 0) {
      return
    }

    const release = data.find(item => {
      const isPre = Boolean(pre) === Boolean(item.prerelease)
      return !item.draft && isPre
    })

    if (!release || !release.assets || !Array.isArray(release.assets)) {
      return
    }

    const { tag_name } = release

    if (this.latest.version === tag_name) {
      console.log('Cached version is the same as latest')
      return
    }

    console.log(`Caching version ${tag_name}...`)

    this.latest.version = tag_name
    this.latest.notes = release.body
    this.latest.pub_date = release.published_at

    // Clear list of download links
    this.latest.platforms = {}

    for (const asset of release.assets) {
      const { name, browser_download_url, url, content_type, size } = asset

      if (name === 'RELEASES') {
        try {
          if (!this.latest.files) {
            this.latest.files = {}
          }
          this.latest.files.RELEASES = await this.cacheReleaseList(
            url
          )
        } catch (err) {
          console.error(err)
        }
        continue
      }

      const platform = checkPlatform(name)

      if (!platform) {
        continue
      }

      this.latest.platforms[platform] = {
        name,
        api_url: url,
        url: browser_download_url,
        content_type,
        size: Math.round(size / 1000000 * 10) / 10
      }
    }

    console.log(`Finished caching version ${tag_name}`)
  }

  // This is a method returning the cache
  // because the cache would otherwise be loaded
  // only once when the index file is parsed
  loadCache() {
    return this.latest
  }
}
