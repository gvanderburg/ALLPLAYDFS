export const DOCUMENT_LIMIT = 25 * 1024 * 1024;
export const VIDEO_LIMIT = 250 * 1024 * 1024;
const extensions: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "video/mp4": [".mp4"],
  "video/webm": [".webm"],
};
export function validTakeFile(fileName: string, contentType: string, size: number): boolean {
  return !!extensions[contentType]?.some(ext => fileName.toLowerCase().endsWith(ext)) &&
    !/[\x00-\x1f/\\]/.test(fileName) && Number.isInteger(size) && size > 0 &&
    size <= (contentType.startsWith("video/") ? VIDEO_LIMIT : DOCUMENT_LIMIT);
}
export function validTakeSignature(type: string, bytes: Buffer): boolean {
  if (type === "application/pdf") return bytes.subarray(0, 5).toString() === "%PDF-";
  if (type === "video/mp4") return bytes.subarray(4, 8).toString() === "ftyp";
  if (type === "video/webm") return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (type.endsWith("wordprocessingml.document")) return bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  return type === "text/plain" && !bytes.includes(0);
}
export function parseTakeRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return null;
  return { start, end };
}
