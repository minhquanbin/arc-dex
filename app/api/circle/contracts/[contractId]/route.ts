import { NextResponse } from "next/server";

const CIRCLE_API_BASE_URL = "https://api.circle.com/v1/w3s";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ contractId: string }> }  // ← Thêm Promise
) {
  try {
    const apiKey = process.env.CIRCLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing CIRCLE_API_KEY env var" },
        { status: 500 }
      );
    }

    const { contractId } = await params;  // ← Thêm await và destructure
    if (!contractId) {
      return NextResponse.json({ error: "Missing contractId" }, { status: 400 });
    }

    const upstream = await fetch(`${CIRCLE_API_BASE_URL}/contracts/${contractId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    const text = await upstream.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: "Circle API contract lookup failed",
          status: upstream.status,
          statusText: upstream.statusText,
          details: json,
        },
        { status: upstream.status }
      );
    }

    return NextResponse.json(json, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}