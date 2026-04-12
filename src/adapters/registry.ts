import type { CodeWikiAdapter, AdapterType } from './types.js';
import { JavaAdapter } from './languages/java.js';
import { TypeScriptAdapter } from './languages/typescript.js';
import { KafkaAdapter } from './communication/kafka.js';

export class AdapterRegistry {
  private adapters: Map<string, CodeWikiAdapter> = new Map();

  register(adapter: CodeWikiAdapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(
        `Adapter "${adapter.name}" is already registered`
      );
    }
    this.adapters.set(adapter.name, adapter);
  }

  getByName(name: string): CodeWikiAdapter | undefined {
    return this.adapters.get(name);
  }

  getByType(type: AdapterType): CodeWikiAdapter[] {
    return Array.from(this.adapters.values()).filter(
      (a) => a.type === type
    );
  }

  all(): CodeWikiAdapter[] {
    return Array.from(this.adapters.values());
  }

  static withBuiltins(): AdapterRegistry {
    const registry = new AdapterRegistry();
    registry.register(new JavaAdapter());
    registry.register(new TypeScriptAdapter());
    registry.register(new KafkaAdapter());
    return registry;
  }
}
