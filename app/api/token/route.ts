import { NextResponse } from "next/server";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? "";

async function getRefreshToken() {
  console.log("Refreshing Spotify access token...");

  if (!refreshToken) {
    throw new Error("No refresh token available");
  }

  const payload = {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store" as RequestCache,
  };

  const response = await fetch(SPOTIFY_TOKEN_URL, payload);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Failed to refresh token: ${data.error_description || "Unknown error"}`
    );
  }

  console.log("Access token refreshed successfully.");
  console.log("New access token:", data.access_token);
  return { access_token: data.access_token, expires_in: data.expires_in };
}

export async function GET() {
  const { access_token, expires_in } = await getRefreshToken();
  return NextResponse.json({ access_token, expires_in });
}
