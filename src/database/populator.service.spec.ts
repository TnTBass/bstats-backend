import { PopulatorService } from './populator.service';

type RedisCall = {
  method: string;
  args: unknown[];
};

class FakeRedis {
  calls: RedisCall[] = [];
  occupiedKeys = new Set<string>(['plugins.ids']);
  values = new Map<string, string>();

  constructor(options?: { occupiedKeys?: string[]; values?: Record<string, string> }) {
    for (const key of options?.occupiedKeys ?? []) {
      this.occupiedKeys.add(key);
    }
    for (const [key, value] of Object.entries(options?.values ?? {})) {
      this.values.set(key, value);
    }
  }

  exists(key: string): Promise<number> {
    this.calls.push({ method: 'exists', args: [key] });
    return Promise.resolve(this.occupiedKeys.has(key) ? 1 : 0);
  }

  get(key: string): Promise<string | null> {
    this.calls.push({ method: 'get', args: [key] });
    return Promise.resolve(this.values.get(key) ?? null);
  }

  hmset(key: string, data: Record<string, unknown>, ...rest: unknown[]): Promise<void> {
    this.occupiedKeys.add(key);
    this.calls.push({ method: 'hmset', args: [key, data, ...rest] });
    return Promise.resolve();
  }

  hset(key: string, field: string, value: unknown, ...rest: unknown[]): Promise<void> {
    this.calls.push({ method: 'hset', args: [key, field, value, ...rest] });
    return Promise.resolve();
  }

  sadd(key: string, value: unknown, ...rest: unknown[]): Promise<void> {
    this.calls.push({ method: 'sadd', args: [key, value, ...rest] });
    return Promise.resolve();
  }

  set(key: string, value: unknown, ...rest: unknown[]): Promise<unknown> {
    if (rest.includes('NX') && this.values.has(key)) {
      this.calls.push({ method: 'set', args: [key, value, ...rest] });
      return Promise.resolve(null);
    }

    this.values.set(key, String(value));
    this.occupiedKeys.add(key);
    this.calls.push({ method: 'set', args: [key, value, ...rest] });
    return Promise.resolve(rest.includes('NX') ? 'OK' : undefined);
  }

  incr(key: string): Promise<number> {
    const nextValue = parseInt(this.values.get(key) ?? '0', 10) + 1;
    this.values.set(key, String(nextValue));
    this.calls.push({ method: 'incr', args: [key] });
    return Promise.resolve(nextValue);
  }

  del(key: string): Promise<void> {
    this.values.delete(key);
    this.occupiedKeys.delete(key);
    this.calls.push({ method: 'del', args: [key] });
    return Promise.resolve();
  }
}

describe('PopulatorService', () => {
  it('backfills Fabric seed data when Redis was already populated', async () => {
    const redis = new FakeRedis();

    new PopulatorService({ getRedis: () => redis } as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(redis.calls).toContainEqual({
      method: 'set',
      args: ['software.index.id.url:fabric', 6, expect.any(Function)],
    });
    expect(redis.calls).toContainEqual({
      method: 'set',
      args: [
        'plugins.index.id.url+name:fabric._fabric_',
        4,
        expect.any(Function),
      ],
    });
    expect(redis.calls).toContainEqual({
      method: 'set',
      args: ['charts.index.uid.pluginId+chartId:4.servers', 33, expect.any(Function)],
    });
  });

  it('allocates new Fabric ids when preferred seed ids are already occupied', async () => {
    const redis = new FakeRedis({
      occupiedKeys: ['software:6', 'plugins:4', 'charts:33'],
      values: {
        'software.id-increment': '100',
        'plugins.id-increment': '200',
        'charts.uid-increment': '300',
      },
    });

    new PopulatorService({ getRedis: () => redis } as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(redis.calls).toContainEqual({
      method: 'set',
      args: ['software.index.id.url:fabric', 101, expect.any(Function)],
    });
    expect(redis.calls).toContainEqual({
      method: 'set',
      args: [
        'plugins.index.id.url+name:fabric._fabric_',
        201,
        expect.any(Function),
      ],
    });
    expect(redis.calls).toContainEqual({
      method: 'set',
      args: [
        'charts.index.uid.pluginId+chartId:201.servers',
        301,
        expect.any(Function),
      ],
    });
  });

  it('does not allocate occupied low ids when counters are missing', async () => {
    const redis = new FakeRedis({
      occupiedKeys: [
        'software:1',
        'software:2',
        'software:3',
        'software:4',
        'software:5',
        'software:6',
        'plugins:1',
        'plugins:2',
        'plugins:3',
        'plugins:4',
        'charts:1',
        'charts:2',
        'charts:3',
        'charts:33',
      ],
    });

    new PopulatorService({ getRedis: () => redis } as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(redis.calls).toContainEqual({
      method: 'set',
      args: ['software.index.id.url:fabric', 7, expect.any(Function)],
    });
    expect(redis.calls).toContainEqual({
      method: 'set',
      args: [
        'plugins.index.id.url+name:fabric._fabric_',
        5,
        expect.any(Function),
      ],
    });
    expect(redis.calls).toContainEqual({
      method: 'set',
      args: [
        'charts.index.uid.pluginId+chartId:5.servers',
        34,
        expect.any(Function),
      ],
    });
  });
});
