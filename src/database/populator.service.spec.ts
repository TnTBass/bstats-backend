import { PopulatorService } from './populator.service';

declare const describe: any;
declare const expect: any;
declare const it: any;

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
    return Promise.resolve('OK');
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

async function populateWith(redis: FakeRedis) {
  const service = new PopulatorService({ getRedis: () => redis } as any);
  await service.ready;
}

describe('PopulatorService', () => {
  it('backfills NeoForge seed data when Redis was already populated', async () => {
    const redis = new FakeRedis();

    await populateWith(redis);

    expect(redis.calls).toContainEqual({
      method: 'set',
      args: ['software.index.id.url:neoforge', 6],
    });
    expect(redis.calls).toContainEqual({
      method: 'set',
      args: [
        'plugins.index.id.url+name:neoforge._neoforge_',
        4,
        expect.any(Function),
      ],
    });
    expect(redis.calls).toContainEqual({
      method: 'set',
      args: ['charts.index.uid.pluginId+chartId:4.servers', 33, expect.any(Function)],
    });
  });

  it('allocates new NeoForge ids when preferred seed ids are already occupied', async () => {
    const redis = new FakeRedis({
      occupiedKeys: ['software:6', 'plugins:4', 'charts:33'],
      values: {
        'software.id-increment': '100',
        'plugins.id-increment': '200',
        'charts.uid-increment': '300',
      },
    });

    await populateWith(redis);

    expect(redis.calls).toContainEqual({
      method: 'set',
      args: ['software.index.id.url:neoforge', 101],
    });
    expect(redis.calls).toContainEqual({
      method: 'set',
      args: [
        'plugins.index.id.url+name:neoforge._neoforge_',
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

    await populateWith(redis);

    expect(redis.calls).toContainEqual({
      method: 'set',
      args: ['software.index.id.url:neoforge', 7],
    });
    expect(redis.calls).toContainEqual({
      method: 'set',
      args: [
        'plugins.index.id.url+name:neoforge._neoforge_',
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

  it('does not backfill NeoForge seed data when NeoForge already exists', async () => {
    const redis = new FakeRedis({
      values: {
        'software.index.id.url:neoforge': '6',
      },
    });

    await populateWith(redis);

    expect(redis.calls).not.toContainEqual({
      method: 'set',
      args: ['seed-lock:neoforge', expect.any(String), 'PX', 60000, 'NX'],
    });
    expect(redis.calls.some((call) => call.method === 'hmset')).toBe(false);
    expect(redis.calls.some((call) => call.method === 'sadd')).toBe(false);
  });

  it('does not backfill NeoForge seed data when another instance holds the seed lock', async () => {
    const redis = new FakeRedis({
      values: {
        'seed-lock:neoforge': 'other-instance',
      },
    });

    await populateWith(redis);

    expect(redis.calls).toContainEqual({
      method: 'set',
      args: ['seed-lock:neoforge', expect.any(String), 'PX', 60000, 'NX'],
    });
    expect(redis.calls.some((call) => call.method === 'hmset')).toBe(false);
    expect(redis.calls.some((call) => call.method === 'sadd')).toBe(false);
  });

  it('fails instead of looping forever when NeoForge id allocation cannot find a free id', async () => {
    const redis = new FakeRedis({
      occupiedKeys: [
        'software:6',
        ...Array.from({ length: 1001 }, (_, index) => `software:${index + 7}`),
      ],
      values: {
        'software.id-increment': '6',
      },
    });

    await expect(populateWith(redis)).rejects.toThrow(
      'Unable to reserve software id for NeoForge seed data',
    );
  });
});
