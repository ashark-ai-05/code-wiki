import type { CodeWikiAdapter, AdapterType } from './types.js';

export class AdapterRegistry {
  private adapters: Map<string, CodeWikiAdapter> = new Map();

  register(adapter: CodeWikiAdapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`Adapter "${adapter.name}" is already registered`);
    }
    this.adapters.set(adapter.name, adapter);
  }

  getByName(name: string): CodeWikiAdapter | undefined {
    return this.adapters.get(name);
  }

  getByType(type: AdapterType): CodeWikiAdapter[] {
    return Array.from(this.adapters.values()).filter((a) => a.type === type);
  }

  all(): CodeWikiAdapter[] {
    return Array.from(this.adapters.values());
  }

  static withBuiltins(): AdapterRegistry {
    const registry = new AdapterRegistry();
    // Will be populated in Task 6 after adapters are created
    return registry;
  }
}
