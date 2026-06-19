import { S3Client, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export const BUCKET = process.env.R2_BUCKET_NAME;

// Presigned URL, 1 óra lejárat
export async function getPresignedUrl(key, expiresInSeconds = 3600) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(r2, cmd, { expiresIn: expiresInSeconds });
}

export async function objectExists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// /mnt/manga/Kavita/{user}/{manga}/{chapter}/{file} → manga/kavita/{user}/{manga}/{chapter}/{file}
// /mnt/manga2/padli_manga/{...}                    → manga/padli_manga/{...}
// /opt/padli/uploads/{file}                        → uploads/{file}
export function localPathToR2Key(absolutePath) {
  if (absolutePath.startsWith("/mnt/manga/Kavita/")) {
    return "manga/kavita/" + absolutePath.slice("/mnt/manga/Kavita/".length);
  }
  if (absolutePath.startsWith("/mnt/manga2/padli_manga/")) {
    return "manga/padli_manga/" + absolutePath.slice("/mnt/manga2/padli_manga/".length);
  }
  if (absolutePath.startsWith("/opt/padli/uploads/")) {
    return "uploads/" + absolutePath.slice("/opt/padli/uploads/".length);
  }
  throw new Error(`Ismeretlen útvonal: ${absolutePath}`);
}

// Egy prefix alatti fájlnevek listázása (csak fájlnév, path nélkül)
export async function listFiles(prefix) {
  const files = [];
  let token;
  do {
    const cmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token });
    const res = await r2.send(cmd);
    for (const obj of res.Contents ?? []) {
      const name = obj.Key.slice(prefix.length);
      if (name && !name.includes("/")) files.push(name);
    }
    token = res.NextContinuationToken;
  } while (token);
  return files;
}

// library_path + manga_folder + chapter + file → R2 key
export function mangaImageToR2Key(libraryPath, mangaFolder, chapter, file) {
  const full = `${libraryPath}/${mangaFolder}/${chapter}/${file}`;
  return localPathToR2Key(full.replace(/\/+/g, "/"));
}
