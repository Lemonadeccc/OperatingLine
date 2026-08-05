import Fastify from 'fastify';

export interface PublicJsonSchemaCase {
  readonly value: unknown;
  readonly accepted: boolean;
}

/**
 * Exercise a generated public JSON Schema through the same AJV-based validator
 * engine that the Orchestrator already depends on through Fastify.
 */
export async function validatePublicJsonSchemaCases(
  schemaInput: object,
  cases: readonly PublicJsonSchemaCase[],
): Promise<void> {
  const schema = structuredClone(schemaInput) as Record<string, unknown>;
  delete schema['$schema'];
  delete schema['$id'];

  const app = Fastify({
    ajv: {
      customOptions: {
        allErrors: true,
        coerceTypes: false,
        removeAdditional: false,
        strict: true,
        strictRequired: false,
        strictTypes: false,
        useDefaults: false,
      },
    },
    logger: false,
  });
  app.post(
    '/validate',
    {
      schema: { body: schema },
    },
    async () => ({ accepted: true }),
  );

  try {
    await app.ready();
    for (const [index, contractCase] of cases.entries()) {
      const response = await app.inject({
        method: 'POST',
        url: '/validate',
        payload: contractCase.value,
      });
      const accepted = response.statusCode >= 200 && response.statusCode < 300;
      if (accepted !== contractCase.accepted) {
        throw new Error(
          `Public JSON Schema case ${index + 1} expected accepted=${String(contractCase.accepted)}, received status ${response.statusCode}: ${response.body}`,
        );
      }
    }
  } finally {
    await app.close();
  }
}
