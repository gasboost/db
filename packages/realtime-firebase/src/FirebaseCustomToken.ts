export type FirebaseCustomTokenUtilities = {
  base64EncodeWebSafe(data: string | ArrayLike<number>): string;

  computeRsaSha256Signature(value: string, key: string): number[];
};

export type FirebaseServiceAccount = {
  readonly email: string;
  readonly privateKey: string;
};

export type FirebaseCustomClaims = Readonly<Record<string, unknown>>;

export class FirebaseCustomToken {
  private static readonly AUDIENCE =
    "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";

  private static readonly RESERVED_CLAIMS = new Set([
    "acr",
    "amr",
    "at_hash",
    "aud",
    "auth_time",
    "azp",
    "cnf",
    "c_hash",
    "exp",
    "iat",
    "iss",
    "jti",
    "nbf",
    "nonce",
    "sub",
    "firebase",
    "user_id",
  ]);

  public static generate({
    uid,
    claims,
    serviceAccount,
    utilities,
    now = new Date(),
  }: {
    uid: string;
    claims?: FirebaseCustomClaims;
    serviceAccount: FirebaseServiceAccount;
    utilities: FirebaseCustomTokenUtilities;
    now?: Date;
  }): string {
    if (uid.length === 0) {
      throw new Error("Firebase Custom Token uid must not be empty");
    }

    if (uid.length > 128) {
      throw new Error(
        "Firebase Custom Token uid must not exceed 128 characters",
      );
    }

    if (serviceAccount.email.trim().length === 0) {
      throw new Error("Firebase service account email must not be empty");
    }

    if (serviceAccount.privateKey.trim().length === 0) {
      throw new Error("Firebase service account private key must not be empty");
    }

    if (claims) {
      for (const claim of Object.keys(claims)) {
        if (FirebaseCustomToken.RESERVED_CLAIMS.has(claim)) {
          throw new Error(`Firebase Custom Token claim "${claim}" is reserved`);
        }
      }
    }

    const issuedAt = Math.floor(now.getTime() / 1000);

    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const payload = {
      iss: serviceAccount.email,
      sub: serviceAccount.email,
      aud: FirebaseCustomToken.AUDIENCE,
      iat: issuedAt,
      exp: issuedAt + 3600,
      uid,
      ...(claims ? { claims } : {}),
    };

    const encodedHeader = utilities
      .base64EncodeWebSafe(JSON.stringify(header))
      .replace(/=+$/u, "");

    const encodedPayload = utilities
      .base64EncodeWebSafe(JSON.stringify(payload))
      .replace(/=+$/u, "");

    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    const signature = utilities.computeRsaSha256Signature(
      unsignedToken,
      serviceAccount.privateKey,
    );

    const encodedSignature = utilities
      .base64EncodeWebSafe(signature)
      .replace(/=+$/u, "");

    return `${unsignedToken}.${encodedSignature}`;
  }
}
