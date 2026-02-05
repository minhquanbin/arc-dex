import { NextResponse } from "next/server";
import { encryptEntitySecret } from "@/lib/encryptEntitySecret";

const CIRCLE_API_BASE_URL = "https://api.circle.com/v1/w3s";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing CIRCLE_API_KEY env var" },
        { status: 500 }
      );
    }

    if (!entitySecret) {
      return NextResponse.json(
        { error: "Missing CIRCLE_ENTITY_SECRET env var" },
        { status: 500 }
      );
    }

    // Validate entity secret format
    if (!/^[a-f0-9]{64}$/i.test(entitySecret)) {
      return NextResponse.json(
        { error: "CIRCLE_ENTITY_SECRET must be 64 hexadecimal characters" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { templateId, requestBody } = body || {};

    if (!templateId || !requestBody) {
      return NextResponse.json(
        { error: "templateId and requestBody are required" },
        { status: 400 }
      );
    }

    // ✅ Generate FRESH ciphertext for THIS request
    console.log("🔐 Encrypting entity secret for this request...");
    const entitySecretCiphertext = await encryptEntitySecret(entitySecret, apiKey);
    console.log("✓ Entity secret encrypted successfully");

    // ✅ Inject fresh ciphertext into request body
    const finalRequestBody = {
      ...requestBody,
      entitySecretCiphertext: entitySecretCiphertext,
    };

    // Log for debugging (remove in production)
    console.log("📤 Deploying with params:", {
      templateId,
      blockchain: finalRequestBody.blockchain,
      walletId: finalRequestBody.walletId,
      hasIdempotencyKey: !!finalRequestBody.idempotencyKey,
      hasEntitySecret: !!finalRequestBody.entitySecretCiphertext,
      ciphertextLength: finalRequestBody.entitySecretCiphertext?.length || 0,
    });

    const upstream = await fetch(
      `${CIRCLE_API_BASE_URL}/templates/${templateId}/deploy`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(finalRequestBody),
      }
    );

    const text = await upstream.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (!upstream.ok) {
      console.error("❌ Circle API error:", {
        status: upstream.status,
        statusText: upstream.statusText,
        response: json,
      });

      return NextResponse.json(
        {
          error: "Circle API deployment failed",
          status: upstream.status,
          statusText: upstream.statusText,
          details: json,
        },
        { status: upstream.status }
      );
    }

    console.log("✅ Deployment successful:", json);
    return NextResponse.json(json, { status: 200 });
  } catch (e: any) {
    console.error("❌ Deploy route error:", e);
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}