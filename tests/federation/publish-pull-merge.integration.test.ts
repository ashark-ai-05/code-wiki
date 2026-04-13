import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { publishFingerprint } from '../../src/federation/publish.js';
import { pullFederation } from '../../src/federation/pull.js';
import { mergeFederation } from '../../src/federation/merge.js';
import { spawnGit } from '../../src/federation/git.js';
import type { RepoFingerprint } from '../../src/fingerprint/types.js';
import type { FederationConfig } from '../../src/federation/types.js';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function fp(
  name: string,
  kind: 'producer' | 'consumer',
  topic: string
): RepoFingerprint {
  const role = kind === 'producer' ? 'producer' : 'consumer';
  const entries = [
    {
      type: 'kafka-topic' as const,
      identifier: topic,
      role: role as 'producer' | 'consumer',
      source: { path: 'app.yaml', line: 1 },
      detection_method: 'static' as const,
      confidence: 'static' as const,
    },
  ];
  return {
    schema_version: '2.0',
    repo: { name, path: `/repos/${name}` },
    scanned_at: '2026-04-13T10:00:00Z',
    tech_stack: {
      languages: [{ language: 'go', version: '1.22', build_tool: 'go' }],
    },
    exposes: kind === 'producer' ? entries : [],
    consumes: kind === 'consumer' ? entries : [],
    workflows_declared:
      kind === 'producer' ? [{ name: 'flow', entry_point: true }] : undefined,
  };
}

describe('federation publish → merge → read', () => {
  let tmp: string;
  let bareUrl: string;

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cw-fedit-'));
    const bareDir = path.join(tmp, 'bare.git');
    bareUrl = `file://${bareDir}`;
    mkdirSync(bareDir, { recursive: true });
    await spawnGit(['init', '--bare', '--initial-branch=main'], {
      cwd: bareDir,
      throwOnError: true,
    });

    const seed = path.join(tmp, 'seed');
    mkdirSync(seed, { recursive: true });
    await spawnGit(['clone', bareUrl, '.'], { cwd: seed, throwOnError: true });
    mkdirSync(path.join(seed, 'fingerprints'), { recursive: true });
    await spawnGit(['add', '-A'], { cwd: seed, throwOnError: true });
    await spawnGit(
      [
        '-c', 'user.email=ci@code-wiki',
        '-c', 'user.name=ci',
        'commit', '--allow-empty', '-m', 'init',
      ],
      { cwd: seed, throwOnError: true }
    );
    await spawnGit(['push', 'origin', 'main'], {
      cwd: seed,
      throwOnError: true,
    });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('publish → pull → merge produces a cross-repo edge', async () => {
    const config: FederationConfig = {
      enabled: true,
      provider: 'git',
      url: bareUrl,
      branch: 'main',
      publish_strategy: 'direct',
      auth: { method: 'ssh' },
    };

    await publishFingerprint({
      fingerprint: fp('svc-a', 'producer', 'orders.new'),
      config,
    });
    await publishFingerprint({
      fingerprint: fp('svc-b', 'consumer', 'orders.new'),
      config,
    });

    const local = path.join(tmp, 'org-clone');
    await pullFederation({ config, localDir: local });

    const merge = mergeFederation({
      fingerprintsDir: path.join(local, 'fingerprints'),
      graphDir: path.join(local, 'graph'),
    });

    expect(merge.merged.length).toBe(2);

    const edges = JSON.parse(
      readFileSync(path.join(local, 'graph', 'edges.json'), 'utf-8')
    );
    expect(edges.edges).toHaveLength(1);
    expect(edges.edges[0].from).toBe('svc-a');
    expect(edges.edges[0].to).toBe('svc-b');

    const workflows = JSON.parse(
      readFileSync(path.join(local, 'graph', 'workflows.json'), 'utf-8')
    );
    expect(workflows.workflows).toHaveLength(1);
    expect(workflows.workflows[0].services.sort()).toEqual(['svc-a', 'svc-b']);
  });
}, 30000);
