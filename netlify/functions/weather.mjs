/**
 * Weather via Open-Meteo (free, no API key).
 * GET /api/weather?q=Toronto
 * GET /api/weather?lat=43.65&lon=-79.38
 * → { location, current, daily, summary }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const WMO = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const params = event.queryStringParameters || {};
    let lat = params.lat != null ? Number(params.lat) : NaN;
    let lon = params.lon != null ? Number(params.lon) : NaN;
    let placeName = typeof params.q === "string" ? params.q.trim() : "";
    let timezone = "auto";

    if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && placeName) {
      const geo = await geocode(placeName);
      if (!geo) {
        return json(404, {
          error: `Could not find location “${placeName}”. Try a city name.`,
        });
      }
      lat = geo.lat;
      lon = geo.lon;
      placeName = geo.name;
      timezone = geo.timezone || "auto";
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return json(400, {
        error: "Provide ?q=City or ?lat=&lon=",
      });
    }

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
      `&timezone=${encodeURIComponent(timezone)}` +
      `&forecast_days=5`;

    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json(502, {
        error: data?.reason || data?.error || `Weather upstream ${r.status}`,
      });
    }

    const c = data.current || {};
    const code = c.weather_code ?? 0;
    const current = {
      temperature_c: c.temperature_2m,
      feels_like_c: c.apparent_temperature,
      humidity_pct: c.relative_humidity_2m,
      wind_kmh: c.wind_speed_10m,
      precipitation_mm: c.precipitation,
      weather_code: code,
      conditions: WMO[code] || `Weather code ${code}`,
      time: c.time,
    };

    const daily = [];
    const d = data.daily || {};
    const days = d.time?.length || 0;
    for (let i = 0; i < days; i++) {
      const dc = d.weather_code?.[i] ?? 0;
      daily.push({
        date: d.time[i],
        high_c: d.temperature_2m_max?.[i],
        low_c: d.temperature_2m_min?.[i],
        precipitation_mm: d.precipitation_sum?.[i],
        conditions: WMO[dc] || `Code ${dc}`,
        weather_code: dc,
      });
    }

    const location = {
      name: placeName || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
      latitude: lat,
      longitude: lon,
      timezone: data.timezone || timezone,
    };

    const summary = formatSummary(location, current, daily);

    return json(200, {
      location,
      current,
      daily,
      summary,
      source: "Open-Meteo",
    });
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : "Weather request failed",
    });
  }
}

async function geocode(q) {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search` +
    `?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  const hit = data?.results?.[0];
  if (!hit) return null;
  const parts = [hit.name, hit.admin1, hit.country_code].filter(Boolean);
  return {
    lat: hit.latitude,
    lon: hit.longitude,
    name: parts.join(", "),
    timezone: hit.timezone,
  };
}

function formatSummary(location, current, daily) {
  const lines = [
    `Location: ${location.name}`,
    `Now: ${current.conditions}, ${fmtC(current.temperature_c)} (feels ${fmtC(current.feels_like_c)}), humidity ${current.humidity_pct}%, wind ${current.wind_kmh} km/h, precip ${current.precipitation_mm} mm`,
    `As of: ${current.time || "now"} (${location.timezone})`,
  ];
  if (daily.length) {
    lines.push("Next days:");
    for (const day of daily.slice(0, 5)) {
      lines.push(
        `  ${day.date}: ${day.conditions}, high ${fmtC(day.high_c)} / low ${fmtC(day.low_c)}, precip ${day.precipitation_mm} mm`
      );
    }
  }
  lines.push("Source: Open-Meteo (live).");
  return lines.join("\n");
}

function fmtC(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Math.round(Number(n))}°C`;
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...CORS,
    },
    body: JSON.stringify(payload),
  };
}
