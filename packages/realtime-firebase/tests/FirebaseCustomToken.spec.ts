import { NodeUtilities } from "@gasboost/fake-node";
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { FirebaseCustomToken } from "../src/FirebaseCustomToken";

describe("FirebaseCustomToken", () => {
  const utilities = new NodeUtilities();

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  const serviceAccount = {
    email: "firebase-adminsdk@example.iam.gserviceaccount.com",
    privateKey,
  };

  it("Firebase Custom Tokenを生成する", () => {
    const token = FirebaseCustomToken.generate({
      uid: "user-1",
      serviceAccount,
      utilities,
      now: new Date("2026-09-13T00:00:00.000Z"),
    });

    const segments = token.split(".");

    expect(segments).toHaveLength(3);

    const [headerSegment, payloadSegment, signatureSegment] = segments;

    expect(headerSegment).toBeDefined();
    expect(payloadSegment).toBeDefined();
    expect(signatureSegment).toBeDefined();

    expect(headerSegment).not.toContain("=");
    expect(payloadSegment).not.toContain("=");
    expect(signatureSegment).not.toContain("=");
  });

  it("Firebase公式仕様のheaderを生成する", () => {
    const token = FirebaseCustomToken.generate({
      uid: "user-1",
      serviceAccount,
      utilities,
      now: new Date("2026-09-13T00:00:00.000Z"),
    });

    const [headerSegment] = token.split(".");

    const header = JSON.parse(
      Buffer.from(headerSegment, "base64url").toString("utf8"),
    );

    expect(header).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
  });

  it("Firebase公式仕様のpayloadを生成する", () => {
    const now = new Date("2026-09-13T00:00:00.000Z");

    const token = FirebaseCustomToken.generate({
      uid: "user-1",
      serviceAccount,
      utilities,
      now,
    });

    const [, payloadSegment] = token.split(".");

    const payload = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8"),
    );

    const issuedAt = Math.floor(now.getTime() / 1000);

    expect(payload).toEqual({
      iss: serviceAccount.email,
      sub: serviceAccount.email,
      aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iat: issuedAt,
      exp: issuedAt + 3600,
      uid: "user-1",
    });
  });

  it("custom claimsをclaims配下に格納する", () => {
    const token = FirebaseCustomToken.generate({
      uid: "user-1",
      claims: {
        storeId: "store-1",
        role: "manager",
      },
      serviceAccount,
      utilities,
      now: new Date("2026-09-13T00:00:00.000Z"),
    });

    const [, payloadSegment] = token.split(".");

    const payload = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8"),
    );

    expect(payload.claims).toEqual({
      storeId: "store-1",
      role: "manager",
    });
  });

  it("claimsを省略できる", () => {
    const token = FirebaseCustomToken.generate({
      uid: "user-1",
      serviceAccount,
      utilities,
      now: new Date("2026-09-13T00:00:00.000Z"),
    });

    const [, payloadSegment] = token.split(".");

    const payload = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8"),
    );

    expect(payload).not.toHaveProperty("claims");
  });

  it("1文字のuidを許可する", () => {
    expect(() =>
      FirebaseCustomToken.generate({
        uid: "a",
        serviceAccount,
        utilities,
      }),
    ).not.toThrow();
  });

  it("128文字のuidを許可する", () => {
    expect(() =>
      FirebaseCustomToken.generate({
        uid: "a".repeat(128),
        serviceAccount,
        utilities,
      }),
    ).not.toThrow();
  });

  it("空のuidを拒否する", () => {
    expect(() =>
      FirebaseCustomToken.generate({
        uid: "",
        serviceAccount,
        utilities,
      }),
    ).toThrow("Firebase Custom Token uid must not be empty");
  });

  it("129文字のuidを拒否する", () => {
    expect(() =>
      FirebaseCustomToken.generate({
        uid: "a".repeat(129),
        serviceAccount,
        utilities,
      }),
    ).toThrow("Firebase Custom Token uid must not exceed 128 characters");
  });

  it("空のservice account emailを拒否する", () => {
    expect(() =>
      FirebaseCustomToken.generate({
        uid: "user-1",
        serviceAccount: {
          email: "",
          privateKey,
        },
        utilities,
      }),
    ).toThrow("Firebase service account email must not be empty");
  });

  it("空のprivate keyを拒否する", () => {
    expect(() =>
      FirebaseCustomToken.generate({
        uid: "user-1",
        serviceAccount: {
          email: serviceAccount.email,
          privateKey: "",
        },
        utilities,
      }),
    ).toThrow("Firebase service account private key must not be empty");
  });

  it.each([
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
  ])("reserved claim %s を拒否する", (claim) => {
    expect(() =>
      FirebaseCustomToken.generate({
        uid: "user-1",
        claims: {
          [claim]: "invalid",
        },
        serviceAccount,
        utilities,
      }),
    ).toThrow(`Firebase Custom Token claim "${claim}" is reserved`);
  });

  it("RSA SHA-256で署名したtokenを生成する", () => {
    const token = FirebaseCustomToken.generate({
      uid: "user-1",
      serviceAccount,
      utilities,
      now: new Date("2026-09-13T00:00:00.000Z"),
    });

    const [headerSegment, payloadSegment, signatureSegment] = token.split(".");

    const unsignedToken = `${headerSegment}.${payloadSegment}`;

    const expectedSignature = utilities
      .base64EncodeWebSafe(
        utilities.computeRsaSha256Signature(unsignedToken, privateKey),
      )
      .replace(/=+$/u, "");

    expect(signatureSegment).toBe(expectedSignature);
  });

  it("iatとexpを秒単位で生成する", () => {
    const now = new Date("2026-09-13T07:30:45.123Z");

    const token = FirebaseCustomToken.generate({
      uid: "user-1",
      serviceAccount,
      utilities,
      now,
    });

    const [, payloadSegment] = token.split(".");

    const payload = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8"),
    );

    const issuedAt = Math.floor(now.getTime() / 1000);

    expect(payload.iat).toBe(issuedAt);
    expect(payload.exp).toBe(issuedAt + 3600);
  });
});
