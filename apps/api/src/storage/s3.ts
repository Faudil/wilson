import {
  CopyObjectCommand, CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import type { Config } from "../config.js";
import type { BlobStore } from "./blobStore.js";

export class S3BlobStore implements BlobStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: Pick<Config, "S3_ENDPOINT" | "S3_REGION" | "S3_BUCKET" | "S3_ACCESS_KEY" | "S3_SECRET_KEY" | "S3_FORCE_PATH_STYLE">) {
    this.bucket = config.S3_BUCKET;
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    });
  }

  /** Creates the bucket if it does not exist. Call once at startup. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(key: string, body: Buffer, contentType = "application/octet-stream"): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`empty body for ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({ Bucket: this.bucket, Key: toKey, CopySource: `${this.bucket}/${encodeURIComponent(fromKey).replace(/%2F/g, "/")}` }),
    );
  }
}
