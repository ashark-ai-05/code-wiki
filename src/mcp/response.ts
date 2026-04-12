import type { GraphReader } from './graph-reader.js';

export interface Evidence {
  kind: 'file' | 'config' | 'graph';
  service_id?: string;
  path?: string;
  line?: number;
}

export interface ToolResponse {
  data: unknown;
  evidence?: Evidence[];
  confidence?: 'static' | 'inferred' | 'mixed';
  sources?: {
    graph_path?: string;
    graph_loaded_at?: string;
    graph_freshness_seconds?: number;
    fingerprint_shas?: Record<string, string>;
  };
}

/**
 * Build a standard response with graph sources auto-populated.
 */
export function buildResponse(
  reader: GraphReader,
  partial: Omit<ToolResponse, 'sources'> & {
    sources?: ToolResponse['sources'];
  }
): ToolResponse {
  return {
    ...partial,
    sources: {
      ...reader.sourcesMeta(),
      ...partial.sources,
    },
  };
}

/**
 * MCP SDK expects tool results shaped like `{ content: [{ type: 'text', text }] }`.
 * We serialize the envelope as pretty JSON.
 */
export function toMcpResult(response: ToolResponse): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
  };
}
