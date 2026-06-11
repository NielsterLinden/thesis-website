import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { loadConfig } from '../../config';
import { ReportsController } from '../reports.controller';
import { SidecarService } from '../sidecar.service';

// The controller re-validates against the REAL frozen CSV (loadConfig paths),
// so the spec below uses real columns of data/04_thesis_final_lean.csv.
const H10_KEY = 'config:axes/H10_Model Size Label.value';
const B1_KEY = 'config:axes/B1_Bias Activation Set.value';

function goodSpec(): Record<string, unknown> {
  return {
    title: 'AUROC by B1 (d256_L6)',
    runset: {
      filters: [{ field: H10_KEY, op: '==', value: 'd256_L6' }],
      groupby: [B1_KEY],
    },
    blocks: [
      { type: 'panel', kind: 'bar_by_axis', metric: 'eval_v2/test_auroc', groupby: B1_KEY },
    ],
  };
}

function makeController(opts: {
  enabled?: boolean;
  key?: string;
  render?: SidecarService['render'];
  available?: boolean;
}) {
  const config = {
    ...loadConfig(),
    reportsEnabled: opts.enabled ?? true,
    wandbApiKey: opts.key ?? 'wb-test-key',
    wandbEntity: 'test-entity',
    wandbSourceProject: 'canonical-runs',
    wandbTargetProject: 'thesis-visitor-reports',
  };
  const render =
    opts.render ?? (jest.fn(async () => ({ ok: true as const, url: 'https://wandb.ai/r/1' })) as SidecarService['render']);
  const sidecar = {
    available: () => opts.available ?? true,
    render,
  } as unknown as SidecarService;
  return { controller: new ReportsController(config, sidecar), render };
}

const req = { requestId: 'test', startTime: Date.now(), path: '/reports/save' } as Request & {
  requestId?: string;
  startTime?: number;
};

describe('POST /reports/save (call 2 of the two-call protocol)', () => {
  it('503s when report authoring is disabled or the W&B key is a placeholder', async () => {
    const { controller } = makeController({ enabled: false });
    await expect(controller.save({ spec: goodSpec() }, req)).rejects.toThrow(ServiceUnavailableException);

    const { controller: noKey } = makeController({ key: 'REPLACE_ME' });
    await expect(noKey.save({ spec: goodSpec() }, req)).rejects.toThrow(ServiceUnavailableException);
  });

  it('400s on a missing or tampered spec without touching the sidecar', async () => {
    const { controller, render } = makeController({});
    await expect(controller.save({}, req)).rejects.toThrow(BadRequestException);

    const tampered = { ...goodSpec(), target_project: 'canonical-runs' };
    await expect(controller.save({ spec: tampered }, req)).rejects.toThrow(BadRequestException);

    const rawString = { ...goodSpec(), runset: { filters: 'name == "x"' } };
    await expect(controller.save({ spec: rawString }, req)).rejects.toThrow(BadRequestException);

    expect(render).not.toHaveBeenCalled();
  });

  it('re-validates, forces server routing, and returns the draft URL', async () => {
    const { controller, render } = makeController({});
    const res = await controller.save({ spec: { ...goodSpec(), entity: 'attacker' } }, req);
    expect(res).toEqual({ url: 'https://wandb.ai/r/1' });

    expect(render).toHaveBeenCalledTimes(1);
    const sent = (render as jest.Mock).mock.calls[0][0];
    expect(sent.entity).toBe('test-entity');
    expect(sent.source_project).toBe('canonical-runs');
    expect(sent.target_project).toBe('thesis-visitor-reports');
  });

  it('502s when the renderer fails', async () => {
    const { controller } = makeController({
      render: jest.fn(async () => ({ ok: false as const, error: 'boom' })) as SidecarService['render'],
    });
    await expect(controller.save({ spec: goodSpec() }, req)).rejects.toThrow(BadGatewayException);
  });
});
