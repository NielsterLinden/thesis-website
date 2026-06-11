import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Request, Response } from 'express';
import { loadConfig } from '../config';
import { DataController } from '../data.controller';

// Runs against the REAL frozen CSV (loadConfig().dataCsvPath), same philosophy
// as the other suites: the artifact under test is the one we ship.

function makeReq(acceptEncoding?: string): Request {
  return { headers: acceptEncoding ? { 'accept-encoding': acceptEncoding } : {} } as Request;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as Buffer | string | undefined,
    sendFile: jest.fn(),
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: Buffer | string) {
      this.body = body;
      return this;
    },
  };
  return { res: res as unknown as Response, raw: res, headers };
}

describe('GET /data/runs.csv', () => {
  const config = loadConfig();

  it('serves the gzipped frozen CSV to gzip-accepting clients, byte-exact', () => {
    const controller = new DataController(config);
    const { res, raw, headers } = makeRes();
    controller.getRunsCsv(makeReq('gzip, deflate, br'), res);

    expect(raw.statusCode).toBe(200);
    expect(headers['content-type']).toContain('text/csv');
    expect(headers['content-encoding']).toBe('gzip');
    expect(headers['vary']).toBe('accept-encoding');
    expect(headers['content-disposition']).toContain('04_thesis_final.csv');

    const decoded = gunzipSync(raw.body as Buffer);
    expect(decoded.length).toBe(statSync(config.dataCsvPath).size);
    const header = decoded.toString('utf-8', 0, 10_000).split('\n')[0];
    expect(header).toContain('config/axes/H10_Model Size Label');
  });

  it('gzips once and reuses the cached buffer on later requests', () => {
    const controller = new DataController(config);
    const first = makeRes();
    const second = makeRes();
    controller.getRunsCsv(makeReq('gzip'), first.res);
    controller.getRunsCsv(makeReq('gzip'), second.res);
    expect(second.raw.body).toBe(first.raw.body);
  });

  it('falls back to the identity file for clients that do not accept gzip', () => {
    const controller = new DataController(config);
    const { res, raw, headers } = makeRes();
    controller.getRunsCsv(makeReq(), res);
    expect(raw.sendFile).toHaveBeenCalledWith(config.dataCsvPath, expect.any(Function));
    expect(headers['content-encoding']).toBeUndefined();
  });

  it('404s when the CSV is missing without attempting to gzip', () => {
    const controller = new DataController({ ...config, dataCsvPath: resolve('does-not-exist.csv') });
    const { res, raw } = makeRes();
    controller.getRunsCsv(makeReq('gzip'), res);
    expect(raw.statusCode).toBe(404);
    expect(raw.body).toBe('runs.csv not found');
  });
});
