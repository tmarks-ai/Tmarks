import { describe, expect, it } from 'vitest'
import { isPublicHostname, isPublicHttpUrl, parseIpv4Like, parseIpv6 } from '../src/lib/net/public-url'

describe('isPublicHttpUrl', () => {
  it('accepts ordinary public http(s) URLs', () => {
    expect(isPublicHttpUrl('https://example.com/page')).toBe(true)
    expect(isPublicHttpUrl('http://sub.domain.example.com:8080/path?q=1')).toBe(true)
    expect(isPublicHttpUrl('http://8.8.8.8/dns')).toBe(true)
  })

  it('rejects non-http(s) schemes and malformed URLs', () => {
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isPublicHttpUrl('ftp://example.com/')).toBe(false)
    expect(isPublicHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isPublicHttpUrl('data:image/png;base64,AAAA')).toBe(false)
    expect(isPublicHttpUrl('not a url')).toBe(false)
    expect(isPublicHttpUrl('')).toBe(false)
  })

  it('rejects private/loopback/link-local/metadata IPv4 literals', () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://127.1.2.3/', // 127/8 covers the whole block
      'http://10.0.0.5/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://0.0.0.0/',
      'http://100.64.0.7/', // CGNAT
      'http://224.0.0.1/', // multicast
      'http://240.0.0.1/', // reserved
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false)
    }
  })

  it('rejects IPv6 loopback/ULA/link-local/multicast and IPv4-mapped forms', () => {
    for (const url of [
      'http://[::1]/',
      'http://[::]/',
      'http://[fe80::1]/',
      'http://[fc00::1]/',
      'http://[fd12:3456:789a::1]/',
      'http://[ff02::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:169.254.169.254]/',
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false)
    }
    // WHATWG normalizes the mapped form to hex — both spellings must be caught.
    expect(isPublicHostname('[::ffff:7f00:1]')).toBe(false)
  })

  it('accepts public IPv6 literals', () => {
    expect(isPublicHttpUrl('http://[2606:4700::1111]/')).toBe(true)
    expect(isPublicHttpUrl('http://[2001:4860:4860::8888]/')).toBe(true)
  })

  it('rejects localhost names', () => {
    expect(isPublicHttpUrl('http://localhost:3000/')).toBe(false)
    expect(isPublicHttpUrl('http://app.localhost/')).toBe(false)
    expect(isPublicHostname('LOCALHOST')).toBe(false)
  })

  it('rejects numeric-host spellings of internal addresses (inet_aton forms)', () => {
    // The URL parser normalizes these to dotted quads; the guard must catch
    // raw hostnames too (defense in depth for direct isPublicHostname calls).
    expect(isPublicHostname('2130706433')).toBe(false) // 127.0.0.1
    expect(isPublicHostname('0x7f.1')).toBe(false)
    expect(isPublicHostname('0177.0.0.1')).toBe(false)
    expect(isPublicHostname('127.1')).toBe(false)
    expect(isPublicHostname('2886729729')).toBe(false) // 172.16.0.1
  })

  it('keeps real domains domain-shaped', () => {
    // A trailing label that is not numeric means a domain, not an IPv4 host.
    expect(isPublicHostname('example.com')).toBe(true)
    expect(isPublicHostname('xn--fiqs8s.com')).toBe(true)
    expect(isPublicHostname('api.internal.corp')).toBe(true) // DNS-resolvable name — out of scope, allowed
    expect(isPublicHostname('example.com.')).toBe(true) // trailing FQDN dot
    expect(isPublicHostname('shop.0x1')).toBe(true) // non-numeric label → domain, not an IP literal
  })
})

describe('parseIpv4Like', () => {
  it('assembles inet_aton forms like a resolver would', () => {
    expect(parseIpv4Like('127.0.0.1')).toBe(0x7f000001)
    expect(parseIpv4Like('2130706433')).toBe(0x7f000001)
    expect(parseIpv4Like('0x7f.1')).toBe(0x7f000001)
    expect(parseIpv4Like('127.1')).toBe(0x7f000001)
    expect(parseIpv4Like('1.2.3.4')).toBe(0x01020304)
  })

  it('returns null for domains and out-of-range values', () => {
    expect(parseIpv4Like('example.com')).toBeNull()
    expect(parseIpv4Like('1.2.3.4.5')).toBeNull()
    expect(parseIpv4Like('256.1.1.1')).toBeNull()
    expect(parseIpv4Like('4294967296')).toBeNull()
    expect(parseIpv4Like('1.2.3')).toBe(0x01020003) // valid partial form
  })
})

describe('parseIpv6', () => {
  it('parses compressed, plain and embedded-IPv4 literals', () => {
    expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(parseIpv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(parseIpv6('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1])
    expect(parseIpv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1])
    expect(parseIpv6('2606:4700::6810:84e5')).toEqual([0x2606, 0x4700, 0, 0, 0, 0, 0x6810, 0x84e5])
  })

  it('rejects malformed literals', () => {
    expect(parseIpv6(':::1')).toBeNull()
    expect(parseIpv6('1:2:3')).toBeNull() // too few groups, no compression
    expect(parseIpv6('1:2:3:4:5:6:7:8:9')).toBeNull()
    expect(parseIpv6('fe80::1::2')).toBeNull()
    expect(parseIpv6('example.com')).toBeNull()
  })
})
