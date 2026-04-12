import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ServiceNode, Edge } from '../graph/types.js';

export interface TechMatrix {
  languages: Record<string, string[]>;
  frameworks: Record<string, string[]>;
  build: Record<string, string[]>;
}

export interface SourcesMeta {
  graph_path: string;
  graph_loaded_at: string;
  graph_freshness_seconds: number;
}

export class GraphReader {
  private _services: ServiceNode[] = [];
  private _edges: Edge[] = [];
  private _matrix: TechMatrix = {
    languages: {},
    frameworks: {},
    build: {},
  };
  private _loadedAt = new Date();
  private _servicesJsonMtime = 0;

  constructor(public readonly graphDir: string) {
    this.refresh();
  }

  refresh(): void {
    const servicesPath = path.join(this.graphDir, 'services.json');
    if (!existsSync(servicesPath)) {
      throw new Error(
        `services.json not found at ${servicesPath}. Run 'code-wiki build' first.`
      );
    }
    const servicesRaw = JSON.parse(
      readFileSync(servicesPath, 'utf-8')
    ) as { services?: ServiceNode[] };
    this._services = servicesRaw.services ?? [];
    this._servicesJsonMtime = statSync(servicesPath).mtimeMs;

    const edgesPath = path.join(this.graphDir, 'edges.json');
    if (existsSync(edgesPath)) {
      const edgesRaw = JSON.parse(
        readFileSync(edgesPath, 'utf-8')
      ) as { edges?: Edge[] };
      this._edges = edgesRaw.edges ?? [];
    } else {
      this._edges = [];
    }

    const matrixPath = path.join(this.graphDir, 'tech-matrix.json');
    if (existsSync(matrixPath)) {
      this._matrix = JSON.parse(
        readFileSync(matrixPath, 'utf-8')
      ) as TechMatrix;
    } else {
      this._matrix = { languages: {}, frameworks: {}, build: {} };
    }

    this._loadedAt = new Date();
  }

  services(): ServiceNode[] {
    return this._services;
  }

  edges(): Edge[] {
    return this._edges;
  }

  techMatrix(): TechMatrix {
    return this._matrix;
  }

  getServiceById(id: string): ServiceNode | undefined {
    return this._services.find((s) => s.id === id);
  }

  freshnessSeconds(): number {
    return Math.max(0, Math.floor((Date.now() - this._servicesJsonMtime) / 1000));
  }

  sourcesMeta(): SourcesMeta {
    return {
      graph_path: this.graphDir,
      graph_loaded_at: this._loadedAt.toISOString(),
      graph_freshness_seconds: this.freshnessSeconds(),
    };
  }
}
