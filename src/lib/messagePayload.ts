export interface ReplyPreview {
  id: string;
  preview: string;
}

export interface DecodedPayload {
  type: 'text' | 'image';
  text?: string;
  imageBase64?: string;
  replyTo?: ReplyPreview;
}

const PAYLOAD_PREFIX = 'SC_PAYLOAD_V1:';

/**
 * Encodes text, optional image base64, and optional reply metadata into a single string
 * before client-side encryption. Plain text without extras stays raw for backwards compatibility.
 */
export function encodeMessagePayload(payload: {
  text?: string;
  imageBase64?: string;
  replyTo?: ReplyPreview | null;
}): string {
  const cleanText = payload.text?.trim() || undefined;
  const hasImage = Boolean(payload.imageBase64);
  const hasReply = Boolean(payload.replyTo);

  if (!hasImage && !hasReply) {
    return cleanText || '';
  }

  return (
    PAYLOAD_PREFIX +
    JSON.stringify({
      type: hasImage ? 'image' : 'text',
      text: cleanText,
      imageBase64: payload.imageBase64,
      replyTo: payload.replyTo || undefined,
    })
  );
}

/**
 * Decodes a decrypted message string into structured text/image/reply fields.
 */
export function decodeMessagePayload(raw: string): DecodedPayload {
  if (!raw || !raw.startsWith(PAYLOAD_PREFIX)) {
    return { type: 'text', text: raw || '' };
  }

  try {
    const parsed = JSON.parse(raw.slice(PAYLOAD_PREFIX.length));
    return {
      type: parsed.type === 'image' ? 'image' : 'text',
      text: typeof parsed.text === 'string' ? parsed.text : undefined,
      imageBase64: typeof parsed.imageBase64 === 'string' ? parsed.imageBase64 : undefined,
      replyTo:
        parsed.replyTo && typeof parsed.replyTo.preview === 'string'
          ? { id: String(parsed.replyTo.id || ''), preview: parsed.replyTo.preview }
          : undefined,
    };
  } catch {
    return { type: 'text', text: raw };
  }
}
