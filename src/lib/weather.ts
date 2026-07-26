import { scopedKey } from "./storageScope";

const CITY_BASE = "grok_assistant_weather_city";
function cityKey() {
  return scopedKey(CITY_BASE);
}

export type WeatherResult = {
  location: { name: string; latitude: number; longitude: number; timezone?: string };
  current: {
    temperature_c: number;
    feels_like_c: number;
    humidity_pct: number;
    wind_kmh: number;
    precipitation_mm: number;
    conditions: string;
    time?: string;
  };
  daily?: Array<{
    date: string;
    high_c: number;
    low_c: number;
    precipitation_mm: number;
    conditions: string;
  }>;
  summary: string;
  source?: string;
  error?: string;
};

export function getDefaultCity(): string {
  try {
    return localStorage.getItem(cityKey()) || "";
  } catch {
    return "";
  }
}

export function setDefaultCity(city: string) {
  try {
    if (city.trim()) localStorage.setItem(cityKey(), city.trim());
    else localStorage.removeItem(cityKey());
  } catch {
    /* ignore */
  }
}

/** True if the user is asking about weather / forecast. */
export function looksLikeWeather(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(weather|forecast|temperature|temp\b|humidity|rain|raining|snow|snowing|windy|storm|thunderstorm|umbrella|hot outside|cold outside|how hot|how cold)\b/.test(
      t
    ) ||
    /\b(what(?:'s| is) it like outside)\b/.test(t) ||
    /\b(do i need (a |an )?(coat|jacket|umbrella))\b/.test(t)
  );
}

/**
 * Pull a place name from phrases like:
 * - weather in Toronto
 * - forecast for New York
 * - temperature in Paris, France
 */
export function extractWeatherPlace(text: string): string | null {
  const t = text.trim();
  const patterns = [
    /\b(?:weather|forecast|temperature|temp|rain|snow|humidity|wind)\s+(?:in|for|at|near)\s+(.+?)(?:\?|$)/i,
    /\b(?:in|for|at|near)\s+([A-Za-z\u00C0-\u024F][\w\s,.'-]{1,60})\s+(?:weather|forecast|temperature)\b/i,
    /\bhow(?:'s| is)\s+(?:the\s+)?weather\s+(?:in|for|at|near)\s+(.+?)(?:\?|$)/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const place = m[1]
        .replace(/[?.!]+$/, "")
        .replace(/\s+(today|tonight|tomorrow|this week)$/i, "")
        .trim();
      if (place.length >= 2) return place;
    }
  }
  return null;
}

export async function fetchWeather(opts: {
  q?: string;
  lat?: number;
  lon?: number;
  signal?: AbortSignal;
}): Promise<WeatherResult> {
  const sp = new URLSearchParams();
  if (opts.q?.trim()) sp.set("q", opts.q.trim());
  if (opts.lat != null && opts.lon != null) {
    sp.set("lat", String(opts.lat));
    sp.set("lon", String(opts.lon));
  }

  if (![...sp.keys()].length) {
    return {
      location: { name: "", latitude: 0, longitude: 0 },
      current: {
        temperature_c: 0,
        feels_like_c: 0,
        humidity_pct: 0,
        wind_kmh: 0,
        precipitation_mm: 0,
        conditions: "",
      },
      summary: "",
      error: "No location provided",
    };
  }

  const res = await fetch(`/api/weather?${sp.toString()}`, {
    signal: opts.signal,
  });
  const data = (await res.json().catch(() => ({}))) as WeatherResult & {
    error?: string;
  };
  if (!res.ok) {
    return {
      location: { name: opts.q || "", latitude: 0, longitude: 0 },
      current: {
        temperature_c: 0,
        feels_like_c: 0,
        humidity_pct: 0,
        wind_kmh: 0,
        precipitation_mm: 0,
        conditions: "",
      },
      summary: "",
      error: data.error || `Weather failed (${res.status})`,
    };
  }
  return data;
}

/** Browser geolocation → lat/lon (prompts user). */
export function getBrowserLocation(
  timeoutMs = 8000
): Promise<{ lat: number; lon: number } | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer);
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 600_000 }
    );
  });
}

/**
 * Resolve weather for a user message: explicit place → default city → geo.
 */
export async function resolveWeatherForMessage(
  text: string,
  signal?: AbortSignal
): Promise<WeatherResult | null> {
  const place = extractWeatherPlace(text);
  if (place) {
    return fetchWeather({ q: place, signal });
  }

  const city = getDefaultCity();
  if (city) {
    return fetchWeather({ q: city, signal });
  }

  const geo = await getBrowserLocation();
  if (geo) {
    return fetchWeather({ lat: geo.lat, lon: geo.lon, signal });
  }

  return {
    location: { name: "", latitude: 0, longitude: 0 },
    current: {
      temperature_c: 0,
      feels_like_c: 0,
      humidity_pct: 0,
      wind_kmh: 0,
      precipitation_mm: 0,
      conditions: "",
    },
    summary: "",
    error:
      "No location yet. Ask e.g. “weather in Toronto”, or set a default city in Settings.",
  };
}
