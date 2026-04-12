import type { ServiceNode, Edge } from '../graph/types.js';
import { emptyNarrationBlock } from './narration.js';

export function frontmatter(
  fields: Record<string, unknown>
): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(
        `${key}: [${value.map((v) => `"${v}"`).join(', ')}]`
      );
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

export function serviceOverview(
  service: ServiceNode,
  edges: Edge[]
): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    summary: `${service.id} — ${service.type}`,
    source_repos: [service.id],
    source_pass: 'fingerprint',
    tags: [
      ...service.tech_stack.languages,
      ...service.tech_stack.frameworks,
    ],
  });

  const downstream = edges.filter((e) => e.from === service.id);
  const upstream = edges.filter((e) => e.to === service.id);

  let md = `${fm}# ${service.id}\n\n`;
  md +=
    '> Auto-generated from structural analysis. Run `code-wiki narrate` to add prose.\n\n';
  md += `${emptyNarrationBlock(`services/${service.id}/overview.md`)}\n\n`;
  md += '## Tech Stack\n\n';
  md += `- **Languages:** ${service.tech_stack.languages.join(', ') || 'unknown'}\n`;
  md += `- **Frameworks:** ${service.tech_stack.frameworks.join(', ') || 'none detected'}\n`;
  md += `- **Build:** ${service.tech_stack.build.join(', ') || 'unknown'}\n\n`;

  if (downstream.length > 0) {
    md += '## Downstream Dependencies\n\n';
    for (const edge of downstream) {
      md += `- **${edge.to}** via ${edge.type}`;
      if (edge.details.topic)
        md += ` (topic: \`${edge.details.topic}\`)`;
      md += '\n';
    }
    md += '\n';
  }

  if (upstream.length > 0) {
    md += '## Upstream Dependencies\n\n';
    for (const edge of upstream) {
      md += `- **${edge.from}** via ${edge.type}`;
      if (edge.details.topic)
        md += ` (topic: \`${edge.details.topic}\`)`;
      md += '\n';
    }
    md += '\n';
  }

  return md;
}

export function serviceTechStack(service: ServiceNode): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    source_repos: [service.id],
  });

  let md = `${fm}# ${service.id} — Tech Stack\n\n`;
  md += '| Category | Technologies |\n';
  md += '|----------|--------------|\n';
  md += `| Languages | ${service.tech_stack.languages.join(', ') || '-'} |\n`;
  md += `| Frameworks | ${service.tech_stack.frameworks.join(', ') || '-'} |\n`;
  md += `| Build | ${service.tech_stack.build.join(', ') || '-'} |\n`;
  md += `| Runtime | ${service.tech_stack.runtime.join(', ') || '-'} |\n`;
  md += `| Databases | ${service.tech_stack.databases.join(', ') || '-'} |\n`;

  return md;
}

export function serviceDependencies(
  service: ServiceNode,
  edges: Edge[]
): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    source_repos: [service.id],
  });

  const downstream = edges.filter((e) => e.from === service.id);
  const upstream = edges.filter((e) => e.to === service.id);

  let md = `${fm}# ${service.id} — Dependencies\n\n`;

  md += '## Downstream (this service calls)\n\n';
  if (downstream.length === 0) {
    md += 'No downstream dependencies detected.\n\n';
  } else {
    md += '| Target | Type | Details | Confidence |\n';
    md += '|--------|------|---------|------------|\n';
    for (const edge of downstream) {
      const detail = edge.details.topic
        ? `topic: ${edge.details.topic}`
        : JSON.stringify(edge.details);
      md += `| [[${edge.to}]] | ${edge.type} | ${detail} | ${edge.confidence} |\n`;
    }
    md += '\n';
  }

  md += '## Upstream (calls this service)\n\n';
  if (upstream.length === 0) {
    md += 'No upstream dependencies detected.\n\n';
  } else {
    md += '| Source | Type | Details | Confidence |\n';
    md += '|--------|------|---------|------------|\n';
    for (const edge of upstream) {
      const detail = edge.details.topic
        ? `topic: ${edge.details.topic}`
        : JSON.stringify(edge.details);
      md += `| [[${edge.from}]] | ${edge.type} | ${detail} | ${edge.confidence} |\n`;
    }
    md += '\n';
  }

  return md;
}

export function serviceApi(service: ServiceNode): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    source_repos: [service.id],
  });

  let md = `${fm}# ${service.id} — API\n\n`;
  md +=
    '> Auto-generated from static analysis. Lists endpoints and topics this service exposes.\n\n';

  const byType = new Map<string, typeof service.exposes>();
  for (const ex of service.exposes) {
    const list = byType.get(ex.type) ?? [];
    list.push(ex);
    byType.set(ex.type, list);
  }

  if (byType.size === 0) {
    md += 'No exposed endpoints or topics detected.\n';
    return md;
  }

  for (const [type, entries] of byType) {
    md += `## ${prettyTypeName(type)} (${entries.length})\n\n`;
    md += '| Identifier | Role | Source | Confidence |\n';
    md += '|------------|------|--------|------------|\n';
    for (const ex of entries) {
      const src = ex.source.line
        ? `${ex.source.path}:${ex.source.line}`
        : ex.source.path;
      md += `| \`${ex.identifier}\` | ${ex.role} | ${src} | ${ex.confidence} |\n`;
    }
    md += '\n';
  }

  return md;
}

function prettyTypeName(type: string): string {
  if (type === 'kafka-topic') return 'Kafka Topics';
  if (type === 'rest-endpoint') return 'REST Endpoints';
  if (type === 'grpc-service') return 'gRPC Services';
  if (type === 'db-schema') return 'Database Schemas';
  return type;
}

export function serviceGlossary(service: ServiceNode): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    source_repos: [service.id],
  });

  let md = `${fm}# ${service.id} — Glossary\n\n`;
  md +=
    '> Every identifier this service exposes or consumes, with direction.\n\n';

  const all = [
    ...service.exposes.map((e) => ({ ex: e, direction: 'exposes' as const })),
    ...service.consumes.map((e) => ({ ex: e, direction: 'consumes' as const })),
  ];

  if (all.length === 0) {
    md += 'No identifiers detected for this service.\n';
    return md;
  }

  const seen = new Set<string>();
  const unique = all.filter(({ ex, direction }) => {
    const key = `${direction}::${ex.type}::${ex.identifier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const exposes = unique.filter((u) => u.direction === 'exposes');
  const consumes = unique.filter((u) => u.direction === 'consumes');

  const section = (title: string, rows: typeof unique): string => {
    if (rows.length === 0) return '';
    let out = `## ${title} (${rows.length})\n\n`;
    out += '| Identifier | Type | Source |\n';
    out += '|------------|------|--------|\n';
    for (const { ex } of rows) {
      const src = ex.source.line
        ? `${ex.source.path}:${ex.source.line}`
        : ex.source.path;
      out += `| \`${ex.identifier}\` | ${ex.type} | ${src} |\n`;
    }
    out += '\n';
    return out;
  };

  md += section('Exposes', exposes);
  md += section('Consumes', consumes);
  return md;
}

export function serviceRunbook(service: ServiceNode): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    source_repos: [service.id],
    note: 'scaffold — humans own the content of this file',
  });

  let md = `${fm}# ${service.id} — Runbook\n\n`;
  md +=
    '> **Scaffold only.** Fill in the sections below with ops knowledge. code-wiki will not overwrite this file once it exists.\n\n';

  md += '## On-call\n\n';
  md += '- _Fill in: who owns this service, escalation path, Slack channel._\n\n';

  md += '## Dashboards\n\n';
  md += '- _Fill in: links to relevant Grafana / Datadog / Kibana dashboards._\n\n';

  md += '## Common incidents\n\n';
  md += '- _Fill in: known failure modes, symptoms, mitigations._\n\n';

  md += '## Deployment\n\n';
  md += '- _Fill in: how to deploy, roll back, and verify._\n\n';

  md += '## Dependencies to watch\n\n';
  md += '- _Fill in: upstream services, infrastructure, third parties._\n';

  return md;
}

export function serviceWorkflows(service: ServiceNode): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    source_repos: [service.id],
  });

  let md = `${fm}# ${service.id} — Workflows\n\n`;
  md +=
    '> Named workflows this service participates in. Cross-repo workflows require federation to be enabled.\n\n';
  md +=
    'No workflows declared locally and federation not enabled. ' +
    'Declare workflows in `code-wiki.yaml` or enable federation to see cross-repo flows.\n';
  return md;
}

export function wikiIndex(
  services: ServiceNode[],
  edges: Edge[]
): string {
  let md = '# Code Wiki\n\n';
  md += `> Auto-generated codebase intelligence. Last updated: ${new Date().toISOString()}\n\n`;
  md += `## Services (${services.length})\n\n`;
  md += '| Service | Languages | Frameworks | Connections |\n';
  md += '|---------|-----------|------------|-------------|\n';

  for (const svc of services) {
    const connCount = edges.filter(
      (e) => e.from === svc.id || e.to === svc.id
    ).length;
    md += `| [[${svc.id}]] | ${svc.tech_stack.languages.join(', ')} | ${svc.tech_stack.frameworks.join(', ') || '-'} | ${connCount} |\n`;
  }
  md += '\n';

  md += '## Dependency Graph\n\n';
  md += '```mermaid\ngraph LR\n';
  for (const edge of edges) {
    const label = edge.details.topic
      ? String(edge.details.topic)
      : edge.type;
    md += `  ${edge.from} -->|${label}| ${edge.to}\n`;
  }
  md += '```\n';

  return md;
}
