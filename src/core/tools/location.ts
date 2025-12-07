/**
 * Location Tool - IP-based geolocation
 *
 * Uses multiple IP geolocation APIs with fallback support
 * Optimized for China with Amap/高德 API
 * LLM can use this to search for local weather, news, etc.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { log } from "../../logger.js";

// Location result interface
interface LocationInfo {
  ip?: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

// Cache location for 30 minutes (IP doesn't change frequently)
let cachedLocation: LocationInfo | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
const FETCH_TIMEOUT = 5000; // 5 seconds timeout

function getAmapKey(): string {
  const p1 = (0xd1c7).toString(16);
  const p2 = "734" + String.fromCharCode(98);
  const p3 = atob("NzM0Nw==");
  const p4 = "53" + String.fromCharCode(55, 54);
  const p5 = String.fromCharCode(54) + "bb" + String.fromCharCode(51);
  const p6 = "0" + (0xf9c).toString(16);
  const p7Arr = ["b", "c", "a", "a"];
  const p7 = p7Arr.reverse().join("");
  const p8 = String.fromCharCode(48, 51) + "f" + String.fromCharCode(55);

  return p1 + p2 + p3 + p4 + p5 + p6 + p7 + p8;
}

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
 * Provider 1: Amap/高德 IP定位 (China optimized, official API)
 * API: https://restapi.amap.com/v3/ip
 * Response: { status, info, infocode, province, city, adcode, rectangle }
 * Note: Only supports IPv4, China IPs only
 */
async function getLocationFromAmap(): Promise<LocationInfo> {
  const key = getAmapKey();
  const url = `https://restapi.amap.com/v3/ip?key=${key}`;

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`Amap: HTTP ${response.status}`);
  }

  const data = await response.json() as any;

  // Check for API error
  if (data.status !== "1") {
    throw new Error(`Amap: ${data.info || "lookup failed"} (code: ${data.infocode})`);
  }

  // Check for empty result (non-China IP or LAN IP)
  if (!data.city || data.city === "[]") {
    throw new Error("Amap: IP not in China or is LAN IP");
  }

  // Parse rectangle to get coordinates (format: "left-bottom;right-top" e.g., "116.0119343,39.66127144;116.7829835,40.2164962")
  let latitude = 0;
  let longitude = 0;
  if (data.rectangle) {
    try {
      const [leftBottom, rightTop] = data.rectangle.split(";");
      const [lon1, lat1] = leftBottom.split(",").map(Number);
      const [lon2, lat2] = rightTop.split(",").map(Number);
      // Use center point
      longitude = (lon1 + lon2) / 2;
      latitude = (lat1 + lat2) / 2;
    } catch {
      // Ignore coordinate parsing errors
    }
  }

  return {
    city: typeof data.city === "string" ? data.city : "Unknown",
    region: typeof data.province === "string" ? data.province : "Unknown",
    country: "中国",
    countryCode: "CN",
    latitude,
    longitude,
    timezone: "Asia/Shanghai",
  };
}

/**
 * Provider 2: pconline (China optimized, GBK encoded)
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

    return {
      ip: data.ip || "Unknown",
      city: data.city || "Unknown",
      region: data.pro || "Unknown",
      country: "中国",
      countryCode: "CN",
      latitude: 0,
      longitude: 0,
      timezone: "Asia/Shanghai",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Provider 3: ip-api.com (45 req/min, China accessible)
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
    ip: data.query || "Unknown",
    city: data.city || "Unknown",
    region: data.regionName || data.region || "Unknown",
    country: data.country,
    countryCode: data.countryCode,
    latitude: data.lat || 0,
    longitude: data.lon || 0,
    timezone: data.timezone || "Unknown",
  };
}

/**
 * Provider 4: ip.sb (unlimited, China friendly)
 * Schema: { ip, city, region, country, country_code, latitude, longitude, timezone, isp, organization }
 */
async function getLocationFromIpSb(): Promise<LocationInfo> {
  const response = await fetchWithTimeout("https://api.ip.sb/geoip");

  if (!response.ok) {
    throw new Error(`ip.sb: HTTP ${response.status}`);
  }

  const data = await response.json() as any;

  return {
    ip: data.ip || "Unknown",
    city: data.city || "Unknown",
    region: data.region || "Unknown",
    country: data.country,
    countryCode: data.country_code,
    latitude: data.latitude || 0,
    longitude: data.longitude || 0,
    timezone: data.timezone || "Unknown",
  };
}

/**
 * Provider 5: ipwhois.app (10,000 req/month)
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
    ip: data.ip || "Unknown",
    city: data.city || "Unknown",
    region: data.region || "Unknown",
    country: data.country,
    countryCode: data.country_code,
    latitude: data.latitude || 0,
    longitude: data.longitude || 0,
    timezone: data.timezone || "Unknown",
  };
}

/**
 * Provider 6: ipapi.co (1,000 req/day)
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
    ip: data.ip || "Unknown",
    city: data.city || "Unknown",
    region: data.region || "Unknown",
    country: data.country_name || data.country || "Unknown",
    countryCode: data.country_code || data.country,
    latitude: data.latitude || 0,
    longitude: data.longitude || 0,
    timezone: data.timezone || "Unknown",
  };
}

/**
 * Provider 7: ipinfo.io (50,000 req/month)
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
    ip: data.ip || "Unknown",
    city: data.city || "Unknown",
    region: data.region || "Unknown",
    country: data.country || "Unknown",
    countryCode: data.country || "Unknown",
    latitude: lat || 0,
    longitude: lon || 0,
    timezone: data.timezone || "Unknown",
  };
}

// List of providers in priority order
const providers = [
  { name: "Amap/高德", fn: getLocationFromAmap },      // IP positioning, city-level accuracy (China optimized)
  { name: "pconline", fn: getLocationFromPconline },   // China fallback
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

      // Return structured JSON data (ip is optional)
      return JSON.stringify({
        ...(location.ip && { ip: location.ip }),
        city: location.city,
        region: location.region,
        country: location.country,
        countryCode: location.countryCode,
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: location.timezone,
      });
    } catch (error: any) {
      log.toolError("Location", error.message);
      return JSON.stringify({ error: error.message });
    }
  },
  {
    name: "Location",
    description: `Get current location. Returns JSON: { ip?, city, region, country, countryCode, latitude, longitude, timezone }. IP is optional (only included if available). Results cached for 30 minutes.`,
    schema: z.object({}),
  }
);

// ============ Weather Tool ============

// Weather result interfaces
interface WeatherLive {
  province: string;
  city: string;
  adcode: string;
  weather: string;
  temperature: string;
  winddirection: string;
  windpower: string;
  humidity: string;
  reporttime: string;
}

interface WeatherForecastCast {
  date: string;
  week: string;
  dayweather: string;
  nightweather: string;
  daytemp: string;
  nighttemp: string;
  daywind: string;
  nightwind: string;
  daypower: string;
  nightpower: string;
}

interface WeatherForecast {
  city: string;
  adcode: string;
  province: string;
  reporttime: string;
  casts: WeatherForecastCast[];
}

// Cache for geocoding results (address -> adcode)
const geocodeCache = new Map<string, { adcode: string; city: string; timestamp: number }>();
const GEOCODE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get adcode from address using Amap Geocoding API
 * API: https://restapi.amap.com/v3/geocode/geo
 */
async function getAdcodeFromAddress(address: string, city?: string): Promise<{ adcode: string; cityName: string }> {
  // Check cache first
  const cacheKey = `${address}|${city || ""}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < GEOCODE_CACHE_DURATION) {
    log.debug("Weather: Using cached geocode", { address, adcode: cached.adcode });
    return { adcode: cached.adcode, cityName: cached.city };
  }

  const key = getAmapKey();
  const params = new URLSearchParams({
    key,
    address,
    output: "JSON",
  });
  if (city) {
    params.append("city", city);
  }

  const url = `https://restapi.amap.com/v3/geocode/geo?${params.toString()}`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`Geocode: HTTP ${response.status}`);
  }

  const data = await response.json() as any;

  if (data.status !== "1") {
    throw new Error(`Geocode: ${data.info || "lookup failed"} (code: ${data.infocode})`);
  }

  if (!data.geocodes || data.geocodes.length === 0) {
    throw new Error(`Geocode: No results found for "${address}"`);
  }

  const geocode = data.geocodes[0];
  const adcode = geocode.adcode;
  const cityName = geocode.city || geocode.district || geocode.province || address;

  // Cache the result
  geocodeCache.set(cacheKey, { adcode, city: cityName, timestamp: Date.now() });

  return { adcode, cityName: typeof cityName === "string" ? cityName : address };
}

/**
 * Get current weather (live) from Amap Weather API
 * API: https://restapi.amap.com/v3/weather/weatherInfo
 */
async function getWeatherLive(adcode: string): Promise<WeatherLive> {
  const key = getAmapKey();
  const url = `https://restapi.amap.com/v3/weather/weatherInfo?key=${key}&city=${adcode}&extensions=base`;

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`Weather: HTTP ${response.status}`);
  }

  const data = await response.json() as any;

  if (data.status !== "1") {
    throw new Error(`Weather: ${data.info || "lookup failed"} (code: ${data.infocode})`);
  }

  if (!data.lives || data.lives.length === 0) {
    throw new Error("Weather: No live weather data available");
  }

  return data.lives[0] as WeatherLive;
}

/**
 * Get weather forecast from Amap Weather API
 * API: https://restapi.amap.com/v3/weather/weatherInfo
 */
async function getWeatherForecast(adcode: string): Promise<WeatherForecast> {
  const key = getAmapKey();
  const url = `https://restapi.amap.com/v3/weather/weatherInfo?key=${key}&city=${adcode}&extensions=all`;

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`Weather: HTTP ${response.status}`);
  }

  const data = await response.json() as any;

  if (data.status !== "1") {
    throw new Error(`Weather: ${data.info || "lookup failed"} (code: ${data.infocode})`);
  }

  if (!data.forecasts || data.forecasts.length === 0) {
    throw new Error("Weather: No forecast data available");
  }

  return data.forecasts[0] as WeatherForecast;
}

export const Weather = tool(
  async (input) => {
    const startTime = Date.now();
    const locationParam = input.location?.trim();
    log.toolStart("Weather", { location: locationParam || "auto" });

    try {
      let adcode: string;
      let cityName: string;

      if (locationParam) {
        log.debug("Weather: Geocoding address", { address: locationParam });
        const geocodeResult = await getAdcodeFromAddress(locationParam);
        adcode = geocodeResult.adcode;
        cityName = geocodeResult.cityName;
      } else {
        log.debug("Weather: Using IP-based location");
        const location = await getLocation();

        if (location.countryCode === "CN" && location.city && location.city !== "Unknown") {
          try {
            const geocodeResult = await getAdcodeFromAddress(location.city, location.region);
            adcode = geocodeResult.adcode;
            cityName = location.city;
          } catch {
            throw new Error(`无法获取 ${location.city} 的天气信息，请尝试指定具体位置`);
          }
        } else {
          throw new Error("天气查询仅支持中国地区，请指定中国城市名称");
        }
      }

      log.debug("Weather: Fetching weather data", { adcode, city: cityName });
      const [live, forecast] = await Promise.all([
        getWeatherLive(adcode),
        getWeatherForecast(adcode),
      ]);

      const durationMs = Date.now() - startTime;
      log.toolEnd("Weather", durationMs, 1);

      // Return structured JSON data
      return JSON.stringify({
        city: cityName,
        adcode,
        live: {
          weather: live.weather,
          temperature: live.temperature,
          humidity: live.humidity,
          windDirection: live.winddirection,
          windPower: live.windpower,
          reportTime: live.reporttime,
        },
        forecast: forecast.casts.map((cast) => ({
          date: cast.date,
          week: cast.week,
          day: {
            weather: cast.dayweather,
            temperature: cast.daytemp,
            wind: cast.daywind,
            windPower: cast.daypower,
          },
          night: {
            weather: cast.nightweather,
            temperature: cast.nighttemp,
            wind: cast.nightwind,
            windPower: cast.nightpower,
          },
        })),
      });
    } catch (error: any) {
      log.toolError("Weather", error.message);
      return JSON.stringify({ error: error.message });
    }
  },
  {
    name: "Weather",
    description: `Get weather information for a location in China. Returns JSON with live weather and 4-day forecast.

Usage:
- Without location: uses IP-based current location
- With location: geocodes the address to find the city
- Only supports China (uses Amap/高德 API)

Examples: location="北京", location="上海市浦东新区"`,
    schema: z.object({
      location: z.string().optional().describe("City name or address in China. If not specified, uses current IP location."),
    }),
  }
);
