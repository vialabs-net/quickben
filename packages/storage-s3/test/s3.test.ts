import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { runStorageContractTests } from "@quickben/adapter-tests";
import { bytesToStream } from "@quickben/core";
import { describe, expect, it, vi } from "vitest";

import { normalizePrefix, s3Storage } from "../src";

interface StoredObject {
  bytes: Uint8Array;
  contentType: string | undefined;
}

const notFound = (name: string) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });

/** An S3 client in memory: `send` answers the four commands the adapter uses. */
function fakeClient(objects = new Map<string, StoredObject>()) {
  const send = vi.fn((command: unknown) => {
    if (command instanceof PutObjectCommand) {
      const { Key, Body, ContentType } = command.input;
      objects.set(String(Key), { bytes: Body as Uint8Array, contentType: ContentType });
      return Promise.resolve({});
    }
    if (command instanceof HeadObjectCommand || command instanceof GetObjectCommand) {
      const object = objects.get(String(command.input.Key));
      if (!object) {
        return Promise.reject(
          notFound(command instanceof HeadObjectCommand ? "NotFound" : "NoSuchKey"),
        );
      }
      const base = { ContentLength: object.bytes.byteLength, ContentType: object.contentType };
      if (command instanceof HeadObjectCommand) return Promise.resolve(base);
      return Promise.resolve({
        ...base,
        Body: {
          transformToWebStream: () => bytesToStream(object.bytes),
          transformToByteArray: () => Promise.resolve(object.bytes),
        },
      });
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(String(command.input.Key));
      return Promise.resolve({});
    }
    return Promise.reject(new Error("Unexpected command"));
  });
  return { objects, send, client: { send } as unknown as S3Client };
}

runStorageContractTests(() => s3Storage({ bucket: "files", client: fakeClient().client }));

describe("s3Storage", () => {
  it("sends the bucket, the prefixed key, the length and the type", async () => {
    const fake = fakeClient();
    const storage = s3Storage({ bucket: "files", client: fake.client, prefix: "uploads/" });
    await storage.put("a/b.png", new Uint8Array([1, 2]), { contentType: "image/png" });
    const command = fake.send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command.input).toMatchObject({
      Bucket: "files",
      Key: "uploads/a/b.png",
      ContentLength: 2,
      ContentType: "image/png",
    });
    await storage.put("a/c", new Uint8Array([1]));
    expect((fake.send.mock.calls[1]?.[0] as PutObjectCommand).input).not.toHaveProperty(
      "ContentType",
    );
    expect(normalizePrefix("x")).toBe("x/");
    expect(normalizePrefix("")).toBe("");
  });

  it("treats an object without a body as missing", async () => {
    const client = { send: () => Promise.resolve({}) } as unknown as S3Client;
    const storage = s3Storage({ bucket: "files", client });
    expect(await storage.get("a.png")).toBeNull();
    expect(await storage.getBytes("a.png")).toBeNull();
    const head = await storage.head("a.png");
    expect(head).toEqual({ key: "a.png", size: 0, contentType: null });
  });

  it("rethrows errors other than not found", async () => {
    const client = {
      send: () => Promise.reject(Object.assign(new Error("denied"), { name: "AccessDenied" })),
    } as unknown as S3Client;
    await expect(s3Storage({ bucket: "files", client }).head("a.png")).rejects.toThrow("denied");
  });

  it("creates a client from clientConfig", async () => {
    const storage = s3Storage({
      bucket: "files",
      clientConfig: {
        region: "us-east-1",
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
      },
    });
    const url = await storage.signedUrl?.("a/b.pdf", { expiresIn: 60, downloadName: "Año.pdf" });
    expect(url).toMatch(/^https:\/\/files\.s3\.us-east-1\.amazonaws\.com\/a\/b\.pdf\?/);
    expect(url).toContain("X-Amz-Expires=60");
    expect(decodeURIComponent(url ?? "")).toContain("filename*=UTF-8''A%C3%B1o.pdf");
  });

  it("signs URLs with the default expiry", async () => {
    const client = new S3Client({
      region: "eu-west-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    const url = await s3Storage({ bucket: "files", client }).signedUrl?.("a.png");
    expect(url).toContain("X-Amz-Expires=300");
    expect(url).not.toContain("response-content-disposition");
  });
});
