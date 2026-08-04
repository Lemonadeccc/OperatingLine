import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { AppAdapter } from '@operatingline/adapter-sdk';
import { validateExecutableTaskPlan } from '@operatingline/domain';
import { openOperatingLineDatabase } from '@operatingline/persistence';
import {
  adapterStatusSchema,
  companionGuideDeliverySchema,
  companionGuideRequestSchema,
  companionStateReportSchema,
  guidePlanSchema,
  guideProtocolVersion,
  type CompanionStateReport,
  type GuidePlan,
  type RuntimeStatus,
} from '@operatingline/protocol';
import { z } from 'zod';

import { closeAll, throwAfterCleanup, type CleanupStep } from './lifecycle.js';

export interface StartRuntimeOptions {
  databasePath: string;
  accessToken: string;
  adapters?: readonly AppAdapter[];
  port?: number;
}

export interface RunningRuntime {
  readonly baseUrl: string;
  readonly mcpEndpoint: string;
  getStatus(): RuntimeStatus;
  stop(): Promise<void>;
}

export const runtimeVersion = '0.1.0';

export async function startRuntime(options: StartRuntimeOptions): Promise<RunningRuntime> {
  if (options.accessToken.length < 16) {
    throw new Error('OperatingLine access token must contain at least 16 characters');
  }
  if (options.databasePath.trim().length === 0) {
    throw new Error('OperatingLine database path must not be empty');
  }
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('OperatingLine port must be an integer between 0 and 65535');
  }

  const adapterStatuses = await Promise.all(
    (options.adapters ?? []).map((adapter) => adapter.getStatus()),
  );
  const adapters = adapterStatuses.map((adapter) => adapterStatusSchema.parse(adapter));
  const adapterIds = new Set(adapters.map((adapter) => adapter.id));
  if (adapterIds.size !== adapters.length) {
    throw new Error('OperatingLine adapter ids must be unique');
  }
  const database = openOperatingLineDatabase(options.databasePath);
  let app: ReturnType<typeof createMcpFastifyApp> | undefined;
  let mcpHandler: ReturnType<typeof createMcpHandler> | undefined;
  const cleanupSteps: CleanupStep[] = [
    () => app?.close(),
    () => mcpHandler?.close(),
    () => database.close(),
  ];

  try {
    let status: RuntimeStatus = {
      version: runtimeVersion,
      phase: 'starting',
      database: 'ready',
      adapters,
      mcpEndpoint: null,
    };
    let activePlan: GuidePlan | null = null;
    const latestRevisionByPlanId = new Map<string, number>();

    const getStatus = (): RuntimeStatus => ({
      ...status,
      adapters: status.adapters.map((adapter) => ({
        ...adapter,
        protocolVersions: [...adapter.protocolVersions],
        capabilities: {
          presentation: { ...adapter.capabilities.presentation },
          execution: {
            ...adapter.capabilities.execution,
            rollbackModes: [...adapter.capabilities.execution.rollbackModes],
          },
          runtime: { ...adapter.capabilities.runtime },
        },
      })),
    });

    const listCompanionStates = (): CompanionStateReport[] =>
      database
        .listLatestCompanionStates()
        .map((report) => companionStateReportSchema.parse(report));

    const runtimeMcpHandler = createMcpHandler(() => {
      const server = new McpServer({ name: 'operating-line', version: runtimeVersion });

      server.registerTool(
        'operatingline.health',
        {
          description:
            'Return the health of the OperatingLine orchestrator and connected adapters.',
          inputSchema: z.strictObject({}),
        },
        async () => ({
          content: [{ type: 'text', text: JSON.stringify(getStatus()) }],
        }),
      );

      server.registerTool(
        'operatingline.adapters.list',
        {
          description: 'List connected host adapters and their reported capabilities.',
          inputSchema: z.strictObject({}),
        },
        async () => ({
          content: [{ type: 'text', text: JSON.stringify(getStatus().adapters) }],
        }),
      );

      server.registerTool(
        'operatingline.companions.list',
        {
          description: 'List the latest known state reported by each host companion.',
          inputSchema: z.strictObject({}),
        },
        async () => ({
          content: [{ type: 'text', text: JSON.stringify(listCompanionStates()) }],
        }),
      );

      server.registerTool(
        'operatingline.guide.publish',
        {
          description: 'Validate and publish a versioned guide plan for host companions.',
          inputSchema: guidePlanSchema,
        },
        async (planInput) => {
          const plan = guidePlanSchema.parse(planInput);
          const root = plan.steps.find((step) => step.id === plan.rootStepId);
          if (!root || root.parentId !== null) {
            throw new Error('Guide plan rootStepId must reference a root step');
          }
          const taskNodes = plan.steps.map((step) => ({
            id: step.id,
            parentId: step.parentId,
            order: step.order,
            dependsOn: step.dependsOn,
            title: step.title,
            intent: step.intent,
            status: step.state,
          }));
          const structure = validateExecutableTaskPlan(
            taskNodes,
            new Set(plan.steps.filter((step) => step.action !== null).map((step) => step.id)),
          );
          if (!structure.valid) {
            throw new Error(`Invalid guide plan: ${structure.errors.join('; ')}`);
          }
          const actionAdapterIds = new Set(
            plan.steps.flatMap((step) => (step.action === null ? [] : [step.action.adapterId])),
          );
          if (actionAdapterIds.size > 1) {
            throw new Error(
              'Companion protocol v1 guide plans must target a single action adapter',
            );
          }
          const latestRevision = latestRevisionByPlanId.get(plan.id);
          if (latestRevision !== undefined && plan.revision <= latestRevision) {
            throw new Error(
              `Guide plan ${plan.id} revision ${plan.revision} is not newer than latest accepted revision ${latestRevision}`,
            );
          }
          database.appendEvent({
            id: randomUUID(),
            eventType: 'guide.plan.published',
            payload: {
              planId: plan.id,
              revision: plan.revision,
              protocolVersion: plan.protocolVersion,
            },
          });
          activePlan = plan;
          latestRevisionByPlanId.set(plan.id, plan.revision);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ accepted: true, planId: plan.id, revision: plan.revision }),
              },
            ],
          };
        },
      );

      return server;
    });
    mcpHandler = runtimeMcpHandler;

    const runtimeApp = createMcpFastifyApp();
    app = runtimeApp;
    const nodeHandler = toNodeHandler(runtimeMcpHandler);

    runtimeApp.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith('/mcp') && !request.url.startsWith('/api/')) {
        return;
      }

      if (request.headers.authorization !== `Bearer ${options.accessToken}`) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
    });

    runtimeApp.get('/health', async () => getStatus());
    runtimeApp.get('/api/v1/guide', async () => ({ plan: activePlan }));
    runtimeApp.get('/api/v1/companion/guide', async (request, reply) => {
      const parsedRequest = companionGuideRequestSchema.safeParse(request.query);
      if (!parsedRequest.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', issues: parsedRequest.error.issues });
      }

      const { adapterId, knownPlanId, knownRevision } = parsedRequest.data;
      const planAdapterId = activePlan?.steps.find((step) => step.action !== null)?.action
        ?.adapterId;
      const callerHasActiveRevision =
        activePlan !== null &&
        knownPlanId === activePlan.id &&
        knownRevision !== undefined &&
        knownRevision >= activePlan.revision;
      return companionGuideDeliverySchema.parse({
        protocolVersion: guideProtocolVersion,
        plan: planAdapterId === adapterId && !callerHasActiveRevision ? activePlan : null,
      });
    });
    runtimeApp.post('/api/v1/companion/state', async (request, reply) => {
      const parsedReport = companionStateReportSchema.safeParse(request.body);
      if (!parsedReport.success) {
        return reply.code(400).send({ error: 'invalid_report', issues: parsedReport.error.issues });
      }
      const result = database.recordCompanionState(parsedReport.data);
      if (result === 'conflict') {
        return reply.code(409).send({ result });
      }
      return { result };
    });
    runtimeApp.get('/api/v1/companions', async () => ({ companions: listCompanionStates() }));
    runtimeApp.all('/mcp', async (request, reply) => {
      reply.hijack();
      await nodeHandler(request.raw as unknown as NodeIncomingMessageLike, reply.raw, request.body);
    });

    await runtimeApp.listen({ host: '127.0.0.1', port });
    const address = runtimeApp.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const mcpEndpoint = `${baseUrl}/mcp`;

    status = {
      ...status,
      phase: 'ready',
      mcpEndpoint,
    };

    database.appendEvent({
      id: randomUUID(),
      eventType: 'runtime.started',
      payload: {
        adapters: adapters.map((adapter) => ({ id: adapter.id, version: adapter.version })),
        mcpEndpoint,
      },
    });

    let stopPromise: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      stopPromise ??= (async () => {
        status = { ...status, phase: 'stopped' };
        try {
          database.appendEvent({
            id: randomUUID(),
            eventType: 'runtime.stopped',
            payload: {},
          });
        } catch (error) {
          return throwAfterCleanup(error, cleanupSteps);
        }
        await closeAll(cleanupSteps);
      })();
      return stopPromise;
    };

    return { baseUrl, mcpEndpoint, getStatus, stop };
  } catch (error) {
    return throwAfterCleanup(error, cleanupSteps);
  }
}
