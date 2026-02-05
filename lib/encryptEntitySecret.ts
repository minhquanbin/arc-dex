/**
 * Dynamic Entity Secret Encryption Utility
 * 
 * This module encrypts entity secret on-demand for each API call
 * to comply with Circle's "no reuse" policy.
 */

import crypto from "crypto";

let cachedPublicKey: string | null = null;

/**
 * Get Circle's public key (cached to reduce API calls)
 */
async function getCirclePublicKey(apiKey: string): Promise<string> {
  // Return cached key if available
  if (cachedPublicKey !== null) {
    return cachedPublicKey;
  }

  const response = await fetch(
    "https://api.circle.com/v1/w3s/config/entity/publicKey",
    {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch public key: ${response.status} - ${error}`);
  }

  const responseData = await response.json();
  
  // ✅ FIX: Correct the response structure
  // According to Circle docs, the structure is: { data: { publicKey: "PEM_STRING" } }
  const publicKeyPem: string = responseData?.data?.publicKey;
  
  if (!publicKeyPem || typeof publicKeyPem !== 'string') {
    console.error('❌ Response structure:', JSON.stringify(responseData, null, 2));
    throw new Error(
      `Public key not found in response. Response structure: ${JSON.stringify(responseData)}`
    );
  }
  
  // Validate PEM format
  if (!publicKeyPem.includes('BEGIN') || !publicKeyPem.includes('PUBLIC KEY')) {
    console.error('❌ Invalid PEM format:', publicKeyPem.substring(0, 100));
    throw new Error('Invalid public key format: not a valid PEM');
  }
  
  // Cache and return
  cachedPublicKey = publicKeyPem;
  console.log('✅ Public key fetched and cached successfully');
  return publicKeyPem;
}

/**
 * Encrypt entity secret using Circle's public key
 * 
 * @param entitySecret Raw entity secret (64 hex chars)
 * @param apiKey Circle API key
 * @returns Fresh encrypted ciphertext
 */
export async function encryptEntitySecret(
  entitySecret: string,
  apiKey: string
): Promise<string> {
  try {
    // Get Circle's public key
    const publicKeyPem = await getCirclePublicKey(apiKey);

    // Convert PEM to crypto key
    const publicKey = crypto.createPublicKey({
      key: publicKeyPem,
      format: 'pem',
    });

    // Encrypt using RSA-OAEP with SHA-256
    const encryptedBuffer = crypto.publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(entitySecret, 'hex')
    );

    const ciphertext = encryptedBuffer.toString('base64');
    console.log('✅ Entity secret encrypted successfully');
    console.log('📝 Ciphertext length:', ciphertext.length, 'chars');
    
    return ciphertext;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("❌ Encryption error:", errorMessage);
    throw new Error(`Failed to encrypt entity secret: ${errorMessage}`);
  }
}

/**
 * Clear cached public key (useful for testing or key rotation)
 */
export function clearPublicKeyCache(): void {
  cachedPublicKey = null;
  console.log('🔄 Public key cache cleared');
}