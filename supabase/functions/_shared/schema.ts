// Structured output contract for the judges (JSON Schema 2020-12). The AI must return exactly this shape;
// checkJudgementShape() enforces it in code (no schema library, so it runs unchanged in Deno and Node).
export const judgementSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "FloorIsYoursModelJudgement",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "needsReview",
    "reviewReason",
    "ratings",
    "strength",
    "improvement",
    "turns"
  ],
  "properties": {
    "needsReview": {
      "type": "boolean"
    },
    "reviewReason": {
      "type": [
        "string",
        "null"
      ]
    },
    "ratings": {
      "type": "array",
      "maxItems": 4,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "level",
          "evidence",
          "justification"
        ],
        "properties": {
          "id": {
            "enum": [
              "position",
              "reasoning",
              "structure",
              "delivery"
            ]
          },
          "level": {
            "type": "integer",
            "minimum": 0,
            "maximum": 4
          },
          "justification": {
            "type": "string",
            "minLength": 1,
            "maxLength": 600
          },
          "evidence": {
            "type": "array",
            "minItems": 1,
            "maxItems": 4,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "start",
                "end",
                "quote",
                "observation",
                "source"
              ],
              "properties": {
                "start": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 60
                },
                "end": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 60
                },
                "quote": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "observation": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 400
                },
                "source": {
                  "enum": [
                    "transcript",
                    "audio"
                  ]
                }
              }
            }
          }
        }
      }
    },
    "strength": {
      "type": "string",
      "maxLength": 400
    },
    "improvement": {
      "type": "string",
      "maxLength": 400
    },
    "turns": {
      "type": "array",
      "maxItems": 3,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "judgeId",
          "text"
        ],
        "properties": {
          "judgeId": {
            "enum": [
              "ada",
              "tunde",
              "zainab"
            ]
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 600
          }
        }
      }
    }
  }
} as const;

/** Same schema without $schema/title, for tool / function-calling parameters. */
export const toolSchema: Record<string, unknown> = (() => { const { $schema: _s, title: _t, ...rest } = judgementSchema; return JSON.parse(JSON.stringify(rest)); })();

// Minimal JSON Schema checker for the keywords used above (type, enum, required, properties,
// additionalProperties, items, min/maxItems, minimum/maximum, min/maxLength). Returns error strings.
type S = { type?: string | readonly string[]; enum?: readonly unknown[]; required?: readonly string[]; properties?: Record<string, S>;
  additionalProperties?: boolean; items?: S; minItems?: number; maxItems?: number; minimum?: number; maximum?: number; minLength?: number; maxLength?: number };

const typeOf = (v: unknown) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const matches = (v: unknown, t: string) => t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeOf(v) === t;

export function checkSchema(v: unknown, s: S, at = 'root', out: string[] = []): string[] {
  if (s.type) {
    const types = typeof s.type === 'string' ? [s.type] : s.type;
    if (!types.some(t => matches(v, t))) { out.push(`${at} must be ${types.join(' or ')}`); return out; }
  }
  if (s.enum && !s.enum.includes(v)) out.push(`${at} must be one of ${s.enum.join(', ')}`);
  if (typeof v === 'string') {
    if (s.minLength !== undefined && [...v].length < s.minLength) out.push(`${at} is too short`);
    if (s.maxLength !== undefined && [...v].length > s.maxLength) out.push(`${at} is too long`);
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) out.push(`${at} must be >= ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) out.push(`${at} must be <= ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push(`${at} needs at least ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${at} allows at most ${s.maxItems} items`);
    if (s.items) v.forEach((x, i) => checkSchema(x, s.items!, `${at}/${i}`, out));
  }
  if (typeOf(v) === 'object' && (s.properties || s.required)) {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) out.push(`${at} is missing ${k}`);
    for (const [k, x] of Object.entries(o)) {
      const p = s.properties?.[k];
      if (p) checkSchema(x, p, `${at}/${k}`, out);
      else if (s.additionalProperties === false) out.push(`${at} has unexpected property ${k}`);
    }
  }
  return out;
}

export const checkJudgementShape = (raw: unknown) => checkSchema(raw, judgementSchema as unknown as S);
