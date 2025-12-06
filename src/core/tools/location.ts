/**
 * Location Tool - IP-based geolocation
 *
 * Uses multiple free IP geolocation APIs with fallback support
 * Optimized for both China and international users
 * LLM can use this to search for local weather, news, etc.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { log } from "../../logger.js";

// Location result interface
interface LocationInfo {
  ip: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
  isp: string;
}

// Cache location for 30 minutes (IP doesn't change frequently)
let cachedLocation: LocationInfo | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
const FETCH_TIMEOUT = 5000; // 5 seconds timeout

/**
 * Fetch with timeout and User-Agent header
 */
async function fetchWithTimeout(url: string, timeout = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; YTerm/1.0)",
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Provider 1: pconline (China optimized, GBK encoded)
 * Schema: { ip, pro, proCode, city, cityCode, region, regionCode, addr, err }
 * Note: Returns GBK encoded response, needs conversion
 */
async function getLocationFromPconline(): Promise<LocationInfo> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch("http://whois.pconline.com.cn/ipJson.jsp?ip=&json=true", {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`pconline: HTTP ${response.status}`);
    }

    // Handle GBK encoding
    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder("gbk");
    const text = decoder.decode(buffer);
    const data = JSON.parse(text) as any;

    if (data.err) {
      throw new Error(`pconline: ${data.err}`);
    }
    const addrParts = (data.addr || "").split(" ");
    const isp = addrParts.length > 1 ? addrParts[addrParts.length - 1] : "Unknown";

    return {
      ip: data.ip,
      city: data.city || "Unknown",
      region: data.pro || "Unknown", // Province as region
      country: "中国",
      countryCode: "CN",
      latitude: 0, // pconline doesn't provide coordinates
      longitude: 0,
      timezone: "Asia/Shanghai", // Default for China
      isp: isp,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Provider 2: ip-api.com (45 req/min, China accessible)
 * Schema: { status, query, country, countryCode, region, regionName, city, lat, lon, timezone, isp }
 */
async function getLocationFromIpApi(): Promise<LocationInfo> {
  const response = await fetchWithTimeout(
    "http://ip-api.com/json/?fields=status,message,country,countryCode,region,regionName,city,lat,lon,timezone,isp,query"
  );

  if (!response.ok) {
    throw new Error(`ip-api.com: HTTP ${response.status}`);
  }

  const data = await response.json() as any;

  if (data.status === "fail") {
    throw new Error(`ip-api.com: ${data.message || "lookup failed"}`);
  }

  return {
    ip: data.query,
    city: data.city || "Unknown",
    region: data.regionName || data.region || "Unknown",
    country: data.country,
    countryCode: data.countryCode,
    latitude: data.lat || 0,
    longitude: data.lon || 0,
    timezone: data.timezone || "Unknown",
    isp: data.isp || "Unknown",
  };
}

/**
 * Provider 2: ip.sb (unlimited, China friendly)
 * Schema: { ip, city, region, country, country_code, latitude, longitude, timezone, isp, organization }
 */
async function getLocationFromIpSb(): Promise<LocationInfo> {
  const response = await fetchWithTimeout("https://api.ip.sb/geoip");

  if (!response.ok) {
    throw new Error(`ip.sb: HTTP ${response.status}`);
  }

  const data = await response.json() as any;

  return {
    ip: data.ip,
    city: data.city || "Unknown",
    region: data.region || "Unknown",
    country: data.country,
    countryCode: data.country_code,
    latitude: data.latitude || 0,
    longitude: data.longitude || 0,
    timezone: data.timezone || "Unknown",
    isp: data.isp || data.organization || data.asn_organization || "Unknown",
  };
}

/**
 * Provider 3: ipwhois.app (10,000 req/month)
 * Schema: { ip, success, country, country_code, region, city, latitude, longitude, timezone, isp }
 */
async function getLocationFromIpWhois(): Promise<LocationInfo> {
  const response = await fetchWithTimeout("https://ipwhois.app/json/");

  if (!response.ok) {
    throw new Error(`ipwhois.app: HTTP ${response.status}`);
  }

  const data = await response.json() as any;

  if (data.success === false) {
    throw new Error(`ipwhois.app: ${data.message || "lookup failed"}`);
  }

  return {
    ip: data.ip,
    city: data.city || "Unknown",
    region: data.region || "Unknown",
    country: data.country,
    countryCode: data.country_code,
    latitude: data.latitude || 0,
    longitude: data.longitude || 0,
    timezone: data.timezone || "Unknown",
    isp: data.isp || "Unknown",
  };
}

/**
 * Provider 4: ipapi.co (1,000 req/day)
 * Schema: { ip, city, region, country_name, country_code, latitude, longitude, timezone, org }
 */
async function getLocationFromIpapiCo(): Promise<LocationInfo> {
  const response = await fetchWithTimeout("https://ipapi.co/json/");

  if (!response.ok) {
    throw new Error(`ipapi.co: HTTP ${response.status}`);
  }

  const data = await response.json() as any;

  if (data.error) {
    throw new Error(`ipapi.co: ${data.reason || "lookup failed"}`);
  }

  return {
    ip: data.ip,
    city: data.city || "Unknown",
    region: data.region || "Unknown",
    country: data.country_name || data.country || "Unknown",
    countryCode: data.country_code || data.country,
    latitude: data.latitude || 0,
    longitude: data.longitude || 0,
    timezone: data.timezone || "Unknown",
    isp: data.org || "Unknown",
  };
}

/**
 * Provider 5: ipinfo.io (50,000 req/month)
 * Schema: { ip, city, region, country (code only), loc ("lat,lon"), timezone, org }
 * Note: country field is country code, not full name
 */
async function getLocationFromIpInfo(): Promise<LocationInfo> {
  const response = await fetchWithTimeout("https://ipinfo.io/json");

  if (!response.ok) {
    throw new Error(`ipinfo.io: HTTP ${response.status}`);
  }

  const data = await response.json() as any;

  // ipinfo.io returns "loc" as "lat,lon" string
  const [lat, lon] = (data.loc || "0,0").split(",").map(Number);

  return {
    ip: data.ip,
    city: data.city || "Unknown",
    region: data.region || "Unknown",
    country: data.country || "Unknown", // This is actually country code
    countryCode: data.country || "Unknown",
    latitude: lat || 0,
    longitude: lon || 0,
    timezone: data.timezone || "Unknown",
    isp: data.org || "Unknown",
  };
}

// List of providers in priority order
const providers = [
  { name: "pconline", fn: getLocationFromPconline },   // China optimized, first priority
  { name: "ip-api.com", fn: getLocationFromIpApi },
  { name: "ip.sb", fn: getLocationFromIpSb },
  { name: "ipwhois.app", fn: getLocationFromIpWhois },
  { name: "ipapi.co", fn: getLocationFromIpapiCo },
  { name: "ipinfo.io", fn: getLocationFromIpInfo },
];

/**
 * Get location with multiple fallbacks
 */
async function getLocation(): Promise<LocationInfo> {
  // Check cache first
  if (cachedLocation && Date.now() - cacheTimestamp < CACHE_DURATION) {
    log.debug("Location: Using cached location", { city: cachedLocation.city });
    return cachedLocation;
  }

  let lastError: Error | null = null;

  // Try each provider in order
  for (const provider of providers) {
    try {
      log.debug(`Location: Trying ${provider.name}`);
      const location = await provider.fn();
      cachedLocation = location;
      cacheTimestamp = Date.now();
      log.debug(`Location: Success with ${provider.name}`, { city: location.city });
      return location;
    } catch (error: any) {
      lastError = error;
      log.debug(`Location: ${provider.name} failed`, { error: error.message });
    }
  }

  throw lastError || new Error("All location providers failed");
}

// ============ Location Tool ============

export const Location = tool(
  async () => {
    const startTime = Date.now();
    log.toolStart("Location", {});

    try {
      const location = await getLocation();
      const durationMs = Date.now() - startTime;

      log.toolEnd("Location", durationMs, 1);

      // Format output for LLM
      const output = `Current Location (based on IP):
- City: ${location.city}
- Region: ${location.region}
- Country: ${location.country} (${location.countryCode})
- Coordinates: ${location.latitude}, ${location.longitude}
- Timezone: ${location.timezone}
- ISP: ${location.isp}

You can use this information to:
- Search for local weather: "weather in ${location.city}"
- Search for local news: "news in ${location.city}" or "news in ${location.country}"
- Search for local events, restaurants, services, etc.`;

      return output;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      log.toolError("Location", error.message);
      return `Failed to get location: ${error.message}`;
    }
  },
  {
    name: "Location",
    description: `Get current location based on IP address.

Usage notes:
- Returns city, region, country, coordinates, and timezone
- Uses free IP geolocation APIs (no API key required)
- Results are cached for 30 minutes
- Use this to get user's approximate location for local searches
- Combine with WebSearch to find local weather, news, events, etc.

Example workflow:
1. Call Location to get user's city
2. Call WebSearch with "weather in [city]" or "news in [city]"`,
    schema: z.object({}),
  }
);
